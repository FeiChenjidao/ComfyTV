"""Map a layer-separation payload into ImageCompositor UI keys."""

from __future__ import annotations

import hashlib
import json
from typing import Any
from urllib.parse import parse_qs, unquote, urlencode, urlparse

_IMAGE_EXT = ('.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.tif', '.tiff')
_PSD_EXT = ('.psd', '.psb')
MAX_LAYERS = 50


def view_url_to_image_ref(url: str) -> dict[str, str] | None:
    raw = (url or '').strip()
    if not raw:
        return None
    parsed = urlparse(raw)
    query = parse_qs(parsed.query)
    filename = (query.get('filename') or [None])[0]
    if filename:
        filename = unquote(filename)
    elif parsed.path:
        filename = unquote(parsed.path.rsplit('/', 1)[-1])
    if not filename:
        return None
    subfolder = unquote((query.get('subfolder') or [''])[0] or '')
    type_ = (query.get('type') or ['output'])[0] or 'output'
    return {'filename': filename, 'subfolder': subfolder, 'type': type_}


def _filename_of(url: str) -> str:
    ref = view_url_to_image_ref(url)
    return (ref or {}).get('filename', '').lower()


def is_psd_url(url: str) -> bool:
    name = _filename_of(url)
    return name.endswith(_PSD_EXT)


def is_raster_url(url: str) -> bool:
    name = _filename_of(url)
    return name.endswith(_IMAGE_EXT)


def _fingerprint(ref: dict[str, str]) -> str:
    blob = f"{ref.get('type', '')}|{ref.get('subfolder', '')}|{ref.get('filename', '')}"
    return hashlib.sha256(blob.encode('utf-8')).hexdigest()[:16]


def _refs_from_payload(payload: str) -> list[tuple[dict[str, str], str | None]]:
    raw = (payload or '').strip()
    if not raw:
        return []
    if raw.startswith('{'):
        try:
            data = json.loads(raw)
        except (ValueError, TypeError):
            return []
        images = data.get('images') if isinstance(data, dict) else None
        if not isinstance(images, list):
            return []
        out: list[tuple[dict[str, str], str | None]] = []
        for item in images:
            if not isinstance(item, dict):
                continue
            url = str(item.get('image_url') or item.get('url') or '').strip()
            ref = view_url_to_image_ref(url)
            if not ref or is_psd_url(url):
                continue
            name = str(item.get('label') or item.get('name') or '').strip() or None
            out.append((ref, name))
            if len(out) >= MAX_LAYERS:
                break
        return out
    if is_psd_url(raw) or not is_raster_url(raw):
        return []
    ref = view_url_to_image_ref(raw)
    return [(ref, None)] if ref else []


def _layer_refs(raw: Any) -> list[dict[str, str]]:
    if not isinstance(raw, list):
        return []
    out: list[dict[str, str]] = []
    for item in raw:
        if isinstance(item, list):
            out.extend(_layer_refs(item))
            continue
        if not isinstance(item, dict):
            continue
        filename = str(item.get('filename') or '').strip()
        if not filename:
            continue
        out.append({
            'filename': filename,
            'subfolder': str(item.get('subfolder') or ''),
            'type': str(item.get('type') or 'temp'),
        })
        if len(out) >= MAX_LAYERS:
            break
    return out


def harvest_compositor_ui(outputs: Any) -> dict[str, Any]:
    """Pick the richest ImageCompositor UI block from a nested history `outputs` map."""
    if not isinstance(outputs, dict):
        return {}
    best: dict[str, Any] = {}
    best_n = 0
    for out in outputs.values():
        if not isinstance(out, dict):
            continue
        layers = _layer_refs(out.get('compositor_layers'))
        if len(layers) <= best_n:
            continue
        ui: dict[str, Any] = {'compositor_layers': layers}
        inputs = out.get('compositor_inputs')
        if isinstance(inputs, list) and inputs:
            ui['compositor_inputs'] = [str(v) for v in inputs]
        else:
            ui['compositor_inputs'] = [_fingerprint(r) for r in layers]
        bboxes = out.get('compositor_bboxes')
        if isinstance(bboxes, list) and bboxes and all(
            isinstance(bbox, dict)
            and isinstance(bbox.get('width'), (int, float))
            and isinstance(bbox.get('height'), (int, float))
            and bbox['width'] > 0
            and bbox['height'] > 0
            for bbox in bboxes
        ):
            ui['compositor_bboxes'] = bboxes
        canvas = out.get('compositor_canvas')
        if isinstance(canvas, list) and canvas:
            ui['compositor_canvas'] = canvas
        images = out.get('images')
        if isinstance(images, list) and images:
            preview_refs = []
            for image in images:
                if not isinstance(image, dict):
                    continue
                if image.get('filename'):
                    preview_refs.append({
                        'filename': str(image['filename']),
                        'subfolder': str(image.get('subfolder') or ''),
                        'type': str(image.get('type') or 'temp'),
                    })
                    continue
                url = str(image.get('image_url') or image.get('url') or '').strip()
                ref = view_url_to_image_ref(url)
                if ref:
                    preview_refs.append(ref)
            if preview_refs:
                ui['images'] = preview_refs
        best = ui
        best_n = len(layers)
    return best


def pack_payload_with_compositor_ui(payload: str, ui: dict[str, Any]) -> str:
    """Attach compositor layers and use its rendered image as the preview."""
    layers = ui.get('compositor_layers') if isinstance(ui, dict) else None
    if not isinstance(layers, list) or not layers:
        return payload
    extra = {
        key: ui[key]
        for key in (
            'compositor_layers',
            'compositor_inputs',
            'compositor_bboxes',
            'compositor_canvas',
        )
        if key in ui
    }
    preview = (ui.get('images') or [None])[0]
    preview_url = ''
    if isinstance(preview, dict) and preview.get('filename'):
        preview_url = '/view?' + urlencode({
            'filename': preview['filename'],
            'subfolder': preview.get('subfolder') or '',
            'type': preview.get('type') or 'temp',
        })
    raw = (payload or '').strip()
    if raw.startswith('{'):
        try:
            data = json.loads(raw)
        except (ValueError, TypeError):
            data = None
        if isinstance(data, dict):
            data.update(extra)
            if preview_url:
                data['images'] = [{'index': '1', 'label': 'composite', 'image_url': preview_url}]
            return json.dumps(data)
    images = []
    if preview_url or raw:
        images.append({'index': '1', 'label': 'composite', 'image_url': preview_url or raw})
    return json.dumps({'images': images, **extra})


def compositor_layer_group(payload: str) -> str:
    """Normalize workflow output into a persistent image group with compositor metadata."""
    ui = compositor_ui_from_payload(payload)
    refs = _layer_refs(ui.get('compositor_layers'))
    if not refs:
        return ''

    raw_data = None
    try:
        raw_data = json.loads(payload)
    except (ValueError, TypeError):
        pass
    label_boxes = raw_data.get('compositor_bboxes') if isinstance(raw_data, dict) else None
    bboxes = ui.get('compositor_bboxes')
    images = []
    for index, ref in enumerate(refs):
        bbox = label_boxes[index] if isinstance(label_boxes, list) and index < len(label_boxes) else None
        name = bbox.get('name') if isinstance(bbox, dict) else None
        images.append({
            'index': str(index + 1),
            'label': str(name or f'#{index + 1}'),
            'image_url': '/view?' + urlencode(ref),
        })

    group: dict[str, Any] = {
        'images': images,
        'compositor_layers': refs,
    }
    for key in ('compositor_inputs', 'compositor_bboxes', 'compositor_canvas'):
        if key in ui:
            group[key] = ui[key]
    preview = ui.get('images')
    if isinstance(preview, list) and preview:
        group['compositor_preview'] = preview[0]
    return json.dumps(group)


def compositor_ui_from_payload(payload: str) -> dict[str, Any]:
    """UI dict fragment matching ImageCompositor.execute (layers + preview)."""
    raw = (payload or '').strip()
    if raw.startswith('{'):
        try:
            data = json.loads(raw)
        except (ValueError, TypeError):
            data = None
        if isinstance(data, dict) and _layer_refs(data.get('compositor_layers')):
            ui = harvest_compositor_ui({'packed': data})
            if ui:
                preview = data.get('compositor_preview')
                if isinstance(preview, dict) and preview.get('filename'):
                    ui['images'] = [{
                        'filename': str(preview['filename']),
                        'subfolder': str(preview.get('subfolder') or ''),
                        'type': str(preview.get('type') or 'temp'),
                    }]
                return ui
    pairs = _refs_from_payload(payload)
    if not pairs:
        return {}
    refs = [ref for ref, _ in pairs]
    fps = [_fingerprint(ref) for ref in refs]
    return {
        'images': [refs[0]],
        'compositor_layers': refs,
        'compositor_inputs': fps,
    }
