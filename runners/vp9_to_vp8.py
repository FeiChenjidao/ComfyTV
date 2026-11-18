from ._delivery import DELIVERY_CODECS
from .media import localize
from .media_filter import has_encoder
from .media_torch import torch_process_video


def _video_codec(view_url: str) -> str:
    import av

    with av.open(str(localize(view_url))) as container:
        if not container.streams.video:
            raise RuntimeError("VP9 to VP8: input has no video stream.")
        return str(container.streams.video[0].codec_context.name or '')


def vp9_to_vp8(view_url: str, quality='high', progress=None) -> str:
    if not has_encoder('libvpx'):
        raise RuntimeError(
            "VP9 to VP8: this PyAV build lacks the libvpx encoder."
        )
    if _video_codec(view_url) != 'vp9':
        raise RuntimeError("VP9 to VP8: input video codec must be VP9.")

    quality = quality if quality in {'draft', 'standard', 'high'} else 'high'
    return torch_process_video(
        view_url,
        lambda image, _time: image,
        progress=progress,
        alpha_in=True,
        out_alpha=True,
        alpha_options=DELIVERY_CODECS['vp8_alpha']['quality'][quality],
        alpha_vcodec='libvpx',
    )


__all__ = ['vp9_to_vp8']
