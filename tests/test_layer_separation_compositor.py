import importlib.util
from pathlib import Path

_PATH = Path(__file__).resolve().parents[1] / 'nodes' / 'stages' / 'common' / 'compositor_ui.py'


def _mod():
    spec = importlib.util.spec_from_file_location('compositor_ui', _PATH)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_view_url_to_image_ref():
    m = _mod()
    ref = m.view_url_to_image_ref('/view?filename=a.png&subfolder=out&type=output')
    assert ref == {'filename': 'a.png', 'subfolder': 'out', 'type': 'output'}


def test_psd_url():
    m = _mod()
    assert m.is_psd_url('/view?filename=sep.psd&type=output')
    assert not m.is_psd_url('/view?filename=sep.png&type=output')


def test_batch_payload_becomes_compositor_layers():
    m = _mod()
    payload = '{"images":[{"image_url":"/view?filename=a.png&type=output","label":"A"},'
    payload += '{"image_url":"/view?filename=b.png&type=output","label":"B"}]}'
    ui = m.compositor_ui_from_payload(payload)
    assert ui['images'][0]['filename'] == 'a.png'
    assert [r['filename'] for r in ui['compositor_layers']] == ['a.png', 'b.png']
    assert len(ui['compositor_inputs']) == 2
    assert 'compositor_bboxes' not in ui


def test_psd_payload_has_no_compositor_ui():
    m = _mod()
    assert m.compositor_ui_from_payload('/view?filename=sep.psd&type=output') == {}


def test_single_png_payload():
    m = _mod()
    ui = m.compositor_ui_from_payload('/view?filename=hero.png&type=output')
    assert ui['compositor_layers'][0]['filename'] == 'hero.png'


def test_harvest_picks_nested_compositor_layers():
    m = _mod()
    ui = m.harvest_compositor_ui({
        '9': {'images': [{'filename': 'comp.png', 'subfolder': '', 'type': 'output'}]},
        '25': {
            'images': [{'filename': 'preview.png', 'subfolder': '', 'type': 'temp'}],
            'compositor_layers': [
                [{'filename': 'base.png', 'subfolder': '', 'type': 'temp'}],
                [{'filename': 'fg.png', 'subfolder': '', 'type': 'temp'}],
            ],
            'compositor_inputs': ['aaaa', 'bbbb'],
            'compositor_bboxes': [
                {'x': 0, 'y': 0, 'width': 1024, 'height': 768, 'name': 'base'},
                {'x': 10, 'y': 20, 'width': 300, 'height': 400, 'name': 'fg'},
            ],
            'compositor_canvas': [{'w': 1024, 'h': 768}],
        },
    })
    assert [r['filename'] for r in ui['compositor_layers']] == ['base.png', 'fg.png']
    assert ui['compositor_canvas'] == [{'w': 1024, 'h': 768}]
    assert ui['compositor_inputs'] == ['aaaa', 'bbbb']


def test_harvest_drops_zero_sized_bboxes():
    m = _mod()
    ui = m.harvest_compositor_ui({
        '25': {
            'compositor_layers': [
                {'filename': 'base.png', 'subfolder': '', 'type': 'temp'},
            ],
            'compositor_bboxes': [
                {'x': 0, 'y': 0, 'width': 0, 'height': 0, 'name': 'base'},
            ],
        },
    })
    assert 'compositor_bboxes' not in ui


def test_pack_attaches_layers_to_single_url():
    m = _mod()
    packed = m.pack_payload_with_compositor_ui(
        '/view?filename=out.png&type=output',
        {'compositor_layers': [
            {'filename': 'a.png', 'subfolder': '', 'type': 'temp'},
            {'filename': 'b.png', 'subfolder': '', 'type': 'temp'},
        ]},
    )
    data = __import__('json').loads(packed)
    assert data['images'][0]['image_url'].endswith('filename=out.png&type=output') or 'filename=out.png' in data['images'][0]['image_url']
    assert [r['filename'] for r in data['compositor_layers']] == ['a.png', 'b.png']
    ui = m.compositor_ui_from_payload(packed)
    assert [r['filename'] for r in ui['compositor_layers']] == ['a.png', 'b.png']


def test_pack_uses_compositor_preview_not_first_saved_layer():
    m = _mod()
    packed = m.pack_payload_with_compositor_ui(
        '/view?filename=image_layer_00001.png&subfolder=layers&type=output',
        {
            'images': [{'filename': 'ComfyUI_temp_preview.png', 'subfolder': '', 'type': 'temp'}],
            'compositor_layers': [{'filename': 'base.png', 'subfolder': '', 'type': 'temp'}],
        },
    )
    data = __import__('json').loads(packed)
    assert data['images'][0]['image_url'] == '/view?filename=ComfyUI_temp_preview.png&subfolder=&type=temp'
    assert data['compositor_layers'][0]['filename'] == 'base.png'
    ui = m.compositor_ui_from_payload(packed)
    assert ui['images'] == [{
        'filename': 'ComfyUI_temp_preview.png',
        'subfolder': '',
        'type': 'temp',
    }]


def test_compositor_layer_group_keeps_preview_and_layer_metadata():
    m = _mod()
    payload = __import__('json').dumps({
        'images': [{'image_url': '/view?filename=preview.png&type=temp'}],
        'compositor_layers': [
            {'filename': 'base.png', 'subfolder': '', 'type': 'temp'},
            {'filename': 'coat.png', 'subfolder': '', 'type': 'temp'},
        ],
        'compositor_bboxes': [{'name': 'background'}, {'name': 'coat'}],
        'compositor_canvas': [{'w': 1024, 'h': 768}],
    })
    group = __import__('json').loads(m.compositor_layer_group(payload))
    assert [item['label'] for item in group['images']] == ['background', 'coat']
    assert [m.view_url_to_image_ref(item['image_url'])['filename'] for item in group['images']] == [
        'base.png', 'coat.png',
    ]
    assert group['compositor_preview']['filename'] == 'preview.png'
    assert group['compositor_canvas'] == [{'w': 1024, 'h': 768}]

    ui = m.compositor_ui_from_payload(__import__('json').dumps(group))
    assert ui['images'] == [{
        'filename': 'preview.png',
        'subfolder': '',
        'type': 'temp',
    }]
