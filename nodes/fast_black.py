import json
import os
import base64
import io as py_io
from pathlib import Path
import shutil
import subprocess
import tempfile
import uuid
from fractions import Fraction
from urllib.parse import parse_qs, urlencode, urlparse

import numpy as np
import torch
import folder_paths
import comfy.model_management
from comfy_api.latest import io
from PIL import Image
from scipy import ndimage

RENDER_REVISION = "exterior-rgb-14-outside-in"

COMFYTV_IMAGE = io.Custom("COMFYTV_IMAGE")
COMFYTV_VIDEO = io.Custom("COMFYTV_VIDEO")


def adjust_rgb(rgb, brightness=0.0, contrast=1.0, saturation=1.0, hue=0.0, gamma=1.0):
    """Same RGB order and hue matrix as the WebGL/Canvas preview."""
    if (brightness, contrast, saturation, hue, gamma) == (0, 1, 1, 0, 1):
        return rgb.copy()
    color = (rgb.astype(np.float64) / 255 - .5) * contrast + .5 + brightness
    gray = color @ np.array([.299, .587, .114])
    color = gray[..., None] + (color - gray[..., None]) * saturation
    co, si = np.cos(np.deg2rad(hue)), np.sin(np.deg2rad(hue))
    matrix = np.array([
        [.213+.787*co-.213*si, .715-.715*co-.715*si, .072-.072*co+.928*si],
        [.213-.213*co+.143*si, .715+.285*co+.140*si, .072-.072*co-.283*si],
        [.213-.213*co-.787*si, .715-.715*co+.715*si, .072+.928*co+.072*si],
    ])
    color = np.clip(np.maximum(color @ matrix.T, 0) ** (1 / gamma), 0, 1)
    return np.floor(color * 255 + .5).astype(np.uint8)


def process_rgba(rgb, threshold, shrink, softness, brightness=0.0, contrast=1.0,
                 saturation=1.0, hue=0.0, gamma=1.0, recolor_enabled=False, replacement_color="#ffffff",
                 recolor_all_black=False, protection_mask=None, edge_threshold=96):
    rgba = np.empty((*rgb.shape[:2], 4), dtype=np.uint8)
    rgba[:, :, :3] = adjust_rgb(rgb, brightness, contrast, saturation, hue, gamma)
    base_alpha = exterior_alpha(rgb, threshold, shrink, softness, protection_mask is not None, edge_threshold)
    protected = np.zeros(base_alpha.shape, dtype=np.float64) if protection_mask is None else np.clip(protection_mask.astype(np.float64), 0, 1)
    rgba[:, :, 3] = np.maximum(base_alpha, np.floor(protected * 255 + .5)).astype(np.uint8)
    if recolor_enabled:
        target = parse_replacement_color(replacement_color)
        if recolor_all_black:
            luminance = rgb.astype(np.float64) @ np.array([.299, .587, .114])
            t = np.clip((luminance - 64) / 64, 0, 1)
            strength = 1 - t * t * (3 - 2 * t)
        else:
            strength = residual_black_weight(rgb)
            strength *= base_alpha > 0
        strength *= 1 - protected
        strength = strength[:, :, None]
        rgba[:, :, :3] = np.floor(rgba[:, :, :3] * (1-strength) + target * strength + .5).astype(np.uint8)
    return rgba


def residual_black_weight(rgb):
    high = rgb.max(axis=2).astype(np.float64)
    chroma = high - rgb.min(axis=2)
    dark = np.clip((high-32)/64, 0, 1)
    neutral = np.clip((chroma-12)/28, 0, 1)
    return (1-dark*dark*(3-2*dark)) * (1-neutral*neutral*(3-2*neutral))


def parse_replacement_color(value):
    if not isinstance(value, str) or len(value) != 7 or value[0] != "#" or any(c not in "0123456789abcdefABCDEF" for c in value[1:]):
        raise ValueError("改色颜色必须为 #RRGGBB 格式，例如 #ff8800。")
    return np.array([int(value[i:i+2], 16) for i in (1, 3, 5)], dtype=np.uint32)


def normalize_protection_mask(mask, width, height):
    if mask is None:
        return None
    if hasattr(mask, "detach"):
        mask = mask.detach().float().cpu().numpy()
    mask = np.asarray(mask, dtype=np.float32)
    while mask.ndim > 2:
        mask = mask[0]
    if mask.ndim != 2:
        raise ValueError("遮罩蒙版必须是单通道 MASK。")
    if mask.shape != (height, width):
        mask = np.asarray(Image.fromarray(np.clip(mask, 0, 1), mode="F").resize((width, height), Image.Resampling.BILINEAR))
    return np.clip(mask, 0, 1)


def mask_image_values(source, alpha_only=False):
    with Image.open(source) as image:
        if "A" in image.getbands():
            alpha = np.asarray(image.getchannel("A"), dtype=np.uint8)
            if alpha_only or alpha.min() < 255:
                return 255-alpha
        if alpha_only:
            return np.zeros((image.height, image.width), dtype=np.uint8)
        return np.asarray(image.convert("L"), dtype=np.uint8)


def browser_rgb_filter(stream):
    # Chromium guesses BT.709 for untagged HD video; swscale defaults to BT.601.
    rgb_format = stream.get("pix_fmt", "").startswith(("rgb", "bgr", "gbr", "gray", "pal"))
    matrix = stream.get("color_space")
    if not rgb_format and matrix in (None, "unknown", "unspecified", "reserved"):
        matrix = "bt709" if int(stream.get("height", 0)) >= 720 or int(stream.get("width", 0)) >= 1280 else "bt601"
        return f"scale=in_color_matrix={matrix}:flags=bilinear+accurate_rnd+full_chroma_int"
    return "null"


def exterior_distances(rgb, threshold, all_regions=False, edge_threshold=96):
    if all_regions:
        high = rgb.max(axis=2).astype(np.float64)
        chroma = high - rgb.min(axis=2)
        color = rgb.astype(np.float64)
        green_leaf = (chroma > 20) & (color[:, :, 1] > color[:, :, 0] * 1.1) & (color[:, :, 1] > color[:, :, 2] * .8)
        dark = ((color @ np.array([.299, .587, .114])) <= max(0, min(255, int(edge_threshold)))) & ~green_leaf
    else:
        level = rgb.max(axis=2).astype(np.int16)
        dark = (level <= 64) & (level - rgb.min(axis=2) <= 20)
    level = rgb.max(axis=2).astype(np.int16)
    background = level <= threshold
    seeds = np.zeros(background.shape, dtype=bool)
    seeds[0, :] = background[0, :]
    seeds[-1, :] = background[-1, :]
    seeds[:, 0] = background[:, 0]
    seeds[:, -1] = background[:, -1]
    outside = ndimage.binary_propagation(seeds, mask=background)
    if not outside.any():
        return np.full(background.shape, 255, dtype=np.uint8)
    connected = ndimage.binary_propagation(outside, mask=background | dark)
    distance = ndimage.distance_transform_cdt(~outside, metric="chessboard")
    return np.where(connected & dark, np.minimum(distance, 255), 255).astype(np.uint8)


def exterior_alpha(rgb, threshold, shrink, softness, all_regions=False, edge_threshold=96):
    level = rgb.max(axis=2).astype(np.float64)
    alpha = np.floor(np.clip((level - threshold) * 255 / 34, 0, 255))
    shrink = max(0, min(200, int(shrink)))
    softness = max(0, min(20, int(softness)))
    if shrink or softness:
        edge_limit = min(160, edge_threshold + shrink // 2) if all_regions else edge_threshold
        distance = exterior_distances(rgb, threshold, all_regions, edge_limit).astype(np.float64)
        if softness:
            t = np.clip((distance - shrink) / (softness + 1), 0, 1)
            factor = t * t * (3 - 2 * t)
        else:
            factor = distance > shrink
        alpha = np.floor(alpha * factor + 0.5)
    return alpha.astype(np.uint8)


def build_processed_video(ffmpeg, source, output, fps, threshold, shrink, softness, is_image=False,
                          brightness=0.0, contrast=1.0, saturation=1.0, hue=0.0, gamma=1.0,
                          recolor_enabled=False, replacement_color="#ffffff", recolor_all_black=False,
                          protection_mask=None, edge_threshold=96):
    """Lossless RGBA frames, with the preview's RGB and matte operations baked in."""
    ffprobe = find_ffprobe(ffmpeg)
    info = json.loads(subprocess.check_output([
        str(ffprobe), "-v", "error", "-select_streams", "v:0",
        "-show_entries", "stream=width,height,pix_fmt,color_space", "-of", "json", str(source),
    ]))
    stream = info["streams"][0]
    width, height = int(stream["width"]), int(stream["height"])
    rate = f"{fps.numerator}/{fps.denominator}"
    flags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
    decode = [ffmpeg, "-nostdin", "-v", "error", "-i", str(source)]
    rgb_filter = browser_rgb_filter(stream)
    decode += ["-frames:v", "1", "-vf", rgb_filter] if is_image else ["-vf", f"fps={rate},{rgb_filter}"]
    decode += ["-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"]
    encode = [ffmpeg, "-nostdin", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgba",
              "-s", f"{width}x{height}", "-r", rate, "-i", "pipe:0", "-an",
              "-c:v", "ffv1", "-pix_fmt", "bgra", str(output)]
    decoder = encoder = None
    with tempfile.TemporaryFile() as decode_errors, tempfile.TemporaryFile() as encode_errors:
        try:
            decoder = subprocess.Popen(decode, stdout=subprocess.PIPE, stderr=decode_errors, creationflags=flags)
            encoder = subprocess.Popen(encode, stdin=subprocess.PIPE, stdout=subprocess.DEVNULL,
                                       stderr=encode_errors, creationflags=flags)
            frame_bytes = width * height * 3
            while True:
                comfy.model_management.throw_exception_if_processing_interrupted()
                raw = bytearray()
                while len(raw) < frame_bytes:
                    block = decoder.stdout.read(frame_bytes - len(raw))
                    if not block:
                        break
                    raw.extend(block)
                if not raw:
                    break
                if len(raw) != frame_bytes:
                    raise RuntimeError("外轮廓遮罩解码帧不完整。")
                rgb = np.frombuffer(raw, dtype=np.uint8).reshape(height, width, 3)
                encoder.stdin.write(process_rgba(rgb, threshold, shrink, softness,
                                                brightness, contrast, saturation, hue, gamma,
                                                recolor_enabled, replacement_color, recolor_all_black,
                                                protection_mask, edge_threshold).tobytes())
            encoder.stdin.close()
            decoder_code, encoder_code = decoder.wait(), encoder.wait()
            if decoder_code or encoder_code:
                decode_errors.seek(0)
                encode_errors.seek(0)
                raise RuntimeError("外轮廓遮罩生成失败：" + (decode_errors.read() + encode_errors.read()).decode("utf-8", errors="replace")[-4000:])
        finally:
            for process in (decoder, encoder):
                if process is not None:
                    if process.poll() is None:
                        process.kill()
                        process.wait()
                    if process.stdout:
                        process.stdout.close()
                    if process.stdin and not process.stdin.closed:
                        process.stdin.close()


def media_path(value):
    url = urlparse(value)
    if url.scheme or url.netloc or url.path != "/view":
        raise ValueError("请连接 ComfyTV 加载节点的本机视频或图片输出。")
    query = parse_qs(url.query)
    filename = query.get("filename", [""])[0]
    kind = query.get("type", ["output"])[0]
    for annotation in ("input", "output", "temp"):
        suffix = f" [{annotation}]"
        if filename.endswith(suffix):
            filename, kind = filename[:-len(suffix)], annotation
            break
    base = folder_paths.get_directory_by_type(kind) if kind in ("input", "output", "temp") else None
    if not filename or not base:
        raise ValueError("加载节点没有有效的本机媒体文件，请重新选择或上传文件。")
    root = Path(base).resolve()
    path = (root / query.get("subfolder", [""])[0] / filename).resolve()
    if not path.is_relative_to(root):
        raise ValueError("媒体文件超出 ComfyUI 的媒体目录。")
    if not path.is_file():
        raise FileNotFoundError(f"媒体文件不存在：{path}")
    return path


def path_to_view_url(path):
    relative = path.resolve().relative_to(Path(folder_paths.get_output_directory()).resolve())
    return "/view?" + urlencode({"filename": relative.name, "subfolder": relative.parent.as_posix(), "type": "output"})


def find_ffmpeg(override):
    candidate = override.strip().strip('"') or os.environ.get("COMFYTV_FFMPEG", "") or shutil.which("ffmpeg")
    if not candidate or not Path(candidate).is_file():
        raise FileNotFoundError("未找到 FFmpeg，请加入 PATH，或设置 COMFYTV_FFMPEG 为可执行文件路径。")
    return str(candidate)


def find_ffprobe(ffmpeg):
    sibling = Path(ffmpeg).with_name("ffprobe.exe" if os.name == "nt" else "ffprobe")
    candidate = os.environ.get("COMFYTV_FFPROBE", "") or (str(sibling) if sibling.is_file() else shutil.which("ffprobe"))
    if not candidate or not Path(candidate).is_file():
        raise FileNotFoundError("未找到 FFprobe，请加入 PATH，或设置 COMFYTV_FFPROBE 为可执行文件路径。")
    return str(candidate)


def probe_video_timing(ffmpeg, source):
    ffprobe = find_ffprobe(ffmpeg)
    raw = subprocess.check_output([
        str(ffprobe), "-v", "error", "-select_streams", "v:0",
        "-show_entries", "stream=avg_frame_rate,r_frame_rate:format=duration",
        "-of", "json", str(source),
    ], stderr=subprocess.STDOUT)
    info = json.loads(raw.decode("utf-8", errors="replace"))
    stream = info.get("streams", [{}])[0]
    fps_text = stream.get("avg_frame_rate") or stream.get("r_frame_rate") or "24/1"
    fps = Fraction(fps_text) if fps_text != "0/0" else Fraction(24, 1)
    duration = float(info.get("format", {}).get("duration") or stream.get("duration") or 0)
    if duration <= 0:
        raise RuntimeError("无法读取输入视频的时长。")
    return duration, fps


class VideoBlackToAlphaVP8(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="VideoBlackToAlphaVP8",
            display_name="快速去黑",
            category="ComfyTV/Video",
            description="接收 ComfyTV 视频或图片，去黑透明并可修改残留黑色，导出无音频 VP8 WebM。",
            search_aliases=["去黑", "透明视频", "VP8", "black to alpha", "快速去黑"],
            inputs=[
                COMFYTV_VIDEO.Input("video", display_name="ComfyTV 视频", optional=True,
                                    tooltip="连接 ComfyTV 的 Load Video 或 Asset Video Loader。"),
                COMFYTV_IMAGE.Input("image", display_name="ComfyTV 图片", optional=True,
                                    tooltip="连接 ComfyTV 的 Load Image 或 Asset Image Loader；图片默认导出 1 秒。"),
                io.Mask.Input("mask", display_name="遮罩蒙版", optional=True,
                              tooltip="白色区域保护原画面不去黑，黑色区域正常去黑，灰色区域按强度保护。"),
                io.String.Input("filename_prefix", display_name="输出前缀", default="transparent/wave", dynamic_prompts=False),
                io.Int.Input("black_threshold", display_name="去黑阈值", default=6, min=0, max=254,
                             tooltip="决定哪些暗部变透明；改色只改变去黑后仍可见的黑色，不改变透明范围。默认 6。"),
                io.Int.Input("crf", display_name="CRF（越低越清晰）", default=12, min=4, max=63,
                             tooltip="VP8 允许 4–63；数值越低画质越高、文件越大。"),
                io.Float.Input("brightness", display_name="亮度", default=0.0, min=-1.0, max=1.0, step=0.01),
                io.Float.Input("contrast", display_name="对比度", default=1.0, min=0.0, max=3.0, step=0.01),
                io.Float.Input("saturation", display_name="饱和度", default=1.0, min=0.0, max=3.0, step=0.01),
                io.Float.Input("hue", display_name="色相（度）", default=0.0, min=-180.0, max=180.0, step=1.0),
                io.Float.Input("gamma", display_name="伽马", default=1.0, min=0.1, max=5.0, step=0.01),
                io.Int.Input("feather_shrink", display_name="外圈去黑边（像素）", default=0, min=0, max=200, step=1,
                             tooltip="只清理与画面外部透明背景相连、靠近外轮廓的暗色边缘；保护封闭孔洞和亮色/彩色细节。"),
                io.Int.Input("feather_softness", display_name="外圈柔和（像素）", default=0, min=0, max=20, step=1,
                             tooltip="仅柔化外圈暗边的透明度过渡；不模糊内部孔洞或彩色前景。"),
                io.Int.Input("preview_frame", display_name="预览帧（从 0 开始）", default=0, min=0, max=999999,
                             socketless=True, extra_dict={"hidden": True}),
                io.Boolean.Input("recolor_enabled", display_name="改色", default=False, optional=True,
                                 tooltip="只将去黑后仍可见的黑色、近黑色改为所选颜色，保持原有透明度，保护亮色和彩色前景。"),
                io.String.Input("replacement_color", display_name="改色颜色", default="#ffffff", optional=True,
                                dynamic_prompts=False, tooltip="选择或吸取用于替换黑色的颜色，格式为 #RRGGBB。"),
                io.Boolean.Input("recolor_all_black", display_name="应用到全部黑色", default=False, optional=True,
                                 tooltip="按视觉亮度修改全部黑色与近黑色，包含深紫、深红暗边。蒙版白色区域不改色，灰色按比例生效。保持透明度；可能影响未保护的前景深色细节。"),
                io.String.Input("mask_image_url", default="", optional=True, dynamic_prompts=False,
                                socketless=True, extra_dict={"hidden": True}),
            ],
            outputs=[
                COMFYTV_VIDEO.Output("video", display_name="ComfyTV 视频"),
                io.String.Output("webm_path", display_name="WEBM 文件路径"),
            ],
            is_output_node=True,
        )

    @classmethod
    def fingerprint_inputs(cls, video=None, image=None, **kwargs):
        source = video or image
        if source:
            stat = media_path(source).stat()
            return stat.st_mtime_ns, stat.st_size, RENDER_REVISION
        return None

    @classmethod
    def execute(cls, video=None, image=None, filename_prefix="transparent/wave", black_threshold=6, crf=12,
                brightness=0.0, contrast=1.0, saturation=1.0, hue=0.0, gamma=1.0,
                feather_shrink=0, feather_softness=0, preview_frame=0,
                recolor_enabled=False, replacement_color="#ffffff", recolor_all_black=False, mask=None, mask_image_url=""):
        if bool(video) == bool(image):
            raise ValueError("请只连接一个 ComfyTV 视频或 ComfyTV 图片输入。")
        source_url = video or image
        source = media_path(str(source_url))
        is_image = bool(image)
        ffmpeg = find_ffmpeg("")
        duration = 1.0
        fps = Fraction(24, 1)
        if not is_image:
            duration, fps = probe_video_timing(ffmpeg, source)
        threshold = int(black_threshold)
        if not 0 <= threshold < 255:
            raise ValueError("去黑阈值必须在 0–254 之间。")
        quality = max(4, min(63, int(crf)))
        ffprobe = find_ffprobe(ffmpeg)
        media_size = json.loads(subprocess.check_output([
            str(ffprobe), "-v", "error", "-select_streams", "v:0",
            "-show_entries", "stream=width,height", "-of", "json", str(source),
        ]))["streams"][0]
        if mask is not None and mask_image_url:
            mask = mask_image_values(media_path(mask_image_url)).astype(np.float32) / 255
        protection_mask = normalize_protection_mask(mask, int(media_size["width"]), int(media_size["height"]))
        if recolor_enabled:
            parse_replacement_color(replacement_color)
        folder, stem, counter, subfolder, _ = folder_paths.get_save_image_path(
            filename_prefix, folder_paths.get_output_directory()
        )
        name = f"{stem}_{counter:05}_{uuid.uuid4().hex[:8]}.webm"
        output = Path(folder) / name
        fd, temp_name = tempfile.mkstemp(suffix=".webm", prefix=".encoding-", dir=folder)
        os.close(fd)
        mask_path = Path(folder) / f".matte-{uuid.uuid4().hex}.nut"
        graph = (
            "[0:v:0]setpts=PTS-STARTPTS,pad=ceil(iw/2)*2:ceil(ih/2)*2:color=black@0,"
            "tpad=stop_mode=clone:stop_duration=1,scale=out_color_matrix=bt709:out_range=tv,format=yuva420p[v]"
        )
        command = [
            ffmpeg, "-nostdin", "-hide_banner", "-loglevel", "error", "-y",
        ]
        command.extend(["-i", str(mask_path)])
        command.extend([
            "-t", f"{duration:.6f}",
            "-filter_complex", graph, "-map", "[v]", "-an",
            "-c:v", "libvpx", "-pix_fmt", "yuva420p", "-auto-alt-ref", "0",
            "-crf", str(quality), "-b:v", "8M", "-deadline", "good",
            "-cpu-used", "2", "-threads", "1", "-fps_mode", "cfr",
            "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv",
            "-r", f"{fps.numerator}/{fps.denominator}", "-metadata:s:v", "alpha_mode=1", temp_name,
        ])
        process = None
        try:
            build_processed_video(ffmpeg, source, mask_path, fps, threshold,
                                  feather_shrink, feather_softness, is_image,
                                  brightness, contrast, saturation, hue, gamma,
                                  recolor_enabled, replacement_color, recolor_all_black, protection_mask)
            with tempfile.TemporaryFile() as errors:
                process = subprocess.Popen(
                    command, stdout=subprocess.DEVNULL, stderr=errors,
                    creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
                )
                while True:
                    comfy.model_management.throw_exception_if_processing_interrupted()
                    try:
                        code = process.wait(timeout=0.25)
                        break
                    except subprocess.TimeoutExpired:
                        continue
                if code:
                    errors.seek(0)
                    detail = errors.read().decode("utf-8", errors="replace")[-4000:]
                    raise RuntimeError(f"FFmpeg 导出失败：\n{detail}")
            os.replace(temp_name, output)
        finally:
            if process is not None and process.poll() is None:
                process.kill()
                process.wait()
            Path(temp_name).unlink(missing_ok=True)
            mask_path.unlink(missing_ok=True)
        from comfy_api.latest import ui
        return io.NodeOutput(
            path_to_view_url(output), str(output),
            ui=ui.PreviewVideo([ui.SavedResult(name, subfolder, io.FolderType.output)]),
        )


class VideoBlackToAlphaPreview(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="VideoBlackToAlphaPreview",
            display_name="快速去黑预览",
            category="ComfyTV/Video",
            description="只处理输入视频或图片的第一帧，用于快速调整去黑和颜色参数。",
            search_aliases=["去黑预览", "透明预览", "black to alpha preview"],
            inputs=[
                COMFYTV_VIDEO.Input("video", display_name="ComfyTV 视频", optional=True),
                COMFYTV_IMAGE.Input("image", display_name="ComfyTV 图片", optional=True),
                io.Int.Input("black_threshold", display_name="去黑阈值", default=6, min=0, max=254),
                io.Float.Input("brightness", display_name="亮度", default=0.0, min=-1.0, max=1.0, step=0.01),
                io.Float.Input("contrast", display_name="对比度", default=1.0, min=0.0, max=3.0, step=0.01),
                io.Float.Input("saturation", display_name="饱和度", default=1.0, min=0.0, max=3.0, step=0.01),
                io.Float.Input("hue", display_name="色相（度）", default=0.0, min=-180.0, max=180.0, step=1.0),
                io.Float.Input("gamma", display_name="伽马", default=1.0, min=0.1, max=5.0, step=0.01),
            ],
            outputs=[io.Image.Output("image", display_name="预览帧")],
            is_output_node=True,
        )

    @classmethod
    def execute(cls, video=None, image=None, black_threshold=6, brightness=0.0, contrast=1.0,
                saturation=1.0, hue=0.0, gamma=1.0, feather_shrink=0, feather_softness=0, preview_frame=0,
                recolor_enabled=False, replacement_color="#ffffff", recolor_all_black=False, mask=None, edge_threshold=96):
        if bool(video) == bool(image):
            raise ValueError("请只连接一个 ComfyTV 视频或 ComfyTV 图片输入。")
        source = media_path(str(video or image))
        ffmpeg = find_ffmpeg("")
        ffprobe = find_ffprobe(ffmpeg)
        media_info = json.loads(subprocess.check_output([
            str(ffprobe), "-v", "error", "-select_streams", "v:0",
            "-show_entries", "stream=width,height,pix_fmt,color_space", "-of", "json", str(source),
        ], stderr=subprocess.STDOUT))
        stream = media_info.get("streams", [{}])[0]
        width, height = int(stream.get("width", 0)), int(stream.get("height", 0))
        if width <= 0 or height <= 0:
            raise RuntimeError("无法读取输入媒体的画面尺寸。")
        out_width, out_height = width + width % 2, height + height % 2

        threshold = max(0, min(254, int(black_threshold)))
        frame = max(0, int(preview_frame)) if not image else 0
        command = [ffmpeg, "-nostdin", "-v", "error", "-i", str(source), "-vf",
                   f"select=eq(n\\,{frame}),{browser_rgb_filter(stream)}", "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"]
        comfy.model_management.throw_exception_if_processing_interrupted()
        result = subprocess.run(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False)
        comfy.model_management.throw_exception_if_processing_interrupted()
        if result.returncode or len(result.stdout) != width * height * 3:
            raise RuntimeError("预览帧生成失败：" + result.stderr.decode("utf-8", errors="replace")[-4000:])
        rgb = np.frombuffer(result.stdout, dtype=np.uint8).reshape(height, width, 3)
        protection_mask = normalize_protection_mask(mask, width, height)
        rgba = process_rgba(rgb, threshold, feather_shrink, feather_softness,
                            brightness, contrast, saturation, hue, gamma, recolor_enabled, replacement_color,
                            recolor_all_black, protection_mask, edge_threshold)
        padded = np.zeros((out_height, out_width, 4), dtype=np.uint8)
        padded[:height, :width] = rgba
        preview = torch.from_numpy(padded).unsqueeze(0).float() / 255.0
        from comfy_api.latest import ui
        return io.NodeOutput(preview, ui=ui.PreviewImage(preview))


from aiohttp import web
from server import PromptServer


def _register_preview_route():
    server_instance = getattr(PromptServer, "instance", None)
    if server_instance is None:
        return

    @server_instance.routes.get("/comfytv/fast_black_render_info")
    async def fast_black_render_info(request):
        return web.json_response({"revision": RENDER_REVISION})

    @server_instance.routes.get("/comfytv/fast_black_mask_view")
    async def fast_black_mask_view(request):
        source = media_path(request.query.get("source", ""))
        mask = mask_image_values(source, request.query.get("mode") == "alpha")
        buffer = py_io.BytesIO()
        Image.fromarray(mask).save(buffer, format="PNG")
        return web.Response(body=buffer.getvalue(), content_type="image/png")

    @server_instance.routes.post("/comfytv/fast_black_preview")
    async def fast_black_preview(request):
        data = await request.json()
        source = str(data.get("source") or "")
        if not source:
            raise web.HTTPBadRequest(text="missing source")
        try:
            result = VideoBlackToAlphaPreview.execute(
                video=source,
                black_threshold=data.get("black_threshold", 6),
                brightness=data.get("brightness", 0.0),
                contrast=data.get("contrast", 1.0),
                saturation=data.get("saturation", 1.0),
                hue=data.get("hue", 0.0),
                gamma=data.get("gamma", 1.0),
                feather_shrink=data.get("feather_shrink", 0),
                feather_softness=data.get("feather_softness", 0),
                recolor_enabled=data.get("recolor_enabled", False),
                replacement_color=data.get("replacement_color", "#ffffff"),
                recolor_all_black=data.get("recolor_all_black", False),
                edge_threshold=data.get("edge_threshold", 96),
                preview_frame=data.get("preview_frame", 0),
            )
            tensor = result[0][0].clamp(0, 1).mul(255).byte().cpu().numpy()
            buffer = py_io.BytesIO()
            Image.fromarray(tensor, "RGBA").save(buffer, format="PNG")
            encoded = base64.b64encode(buffer.getvalue()).decode("ascii")
            return web.json_response({"image": f"data:image/png;base64,{encoded}"})
        except Exception as error:
            return web.json_response({"error": str(error)}, status=400)

    @server_instance.routes.post("/comfytv/fast_black_media_info")
    async def fast_black_media_info(request):
        data = await request.json()
        source = media_path(str(data.get("source") or ""))
        ffmpeg = find_ffmpeg("")
        ffprobe = find_ffprobe(ffmpeg)
        raw = subprocess.check_output([
            str(ffprobe), "-v", "error", "-count_frames", "-select_streams", "v:0",
            "-show_entries", "stream=width,height,avg_frame_rate,nb_read_frames:format=duration",
            "-of", "json", str(source),
        ], stderr=subprocess.STDOUT)
        info = json.loads(raw.decode("utf-8", errors="replace"))
        stream = info.get("streams", [{}])[0]
        fps = Fraction(stream.get("avg_frame_rate") or "24/1")
        frames = int(stream.get("nb_read_frames") or 0)
        if not frames:
            frames = max(1, round(float(info.get("format", {}).get("duration", 1)) * float(fps)))
        return web.json_response({"width": int(stream.get("width", 0)), "height": int(stream.get("height", 0)), "fps": float(fps), "frames": frames})


_register_preview_route()
