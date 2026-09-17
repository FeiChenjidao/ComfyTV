RESOLUTIONS = ["480P", "720P", "1K", "1080P", "1440P", "2K", "2160P", "4K"]
# Must include every value Stage may hold after syncing a partner workflow's
# COMBO (Nano Banana 2 adds ``auto`` and ultra-wide ratios). ComfyUI prompt
# validation checks the Stage node's INPUT_TYPES list, not the Vue chip UI.
ASPECT_RATIOS = [
    "auto",
    "1:1", "9:16", "16:9", "3:4", "4:3", "3:2", "2:3", "4:5", "5:4", "21:9",
    "1:4", "4:1", "8:1", "1:8",
]

VIDEO_DURATION_MIN_S = 1
VIDEO_DURATION_MAX_S = 120
VIDEO_DURATION_DEFAULT_S = 5

SPEECH_LANGUAGES = [
    "Auto",
    "English", "English (British)", "Mandarin Chinese", "Japanese", "Korean",
    "French", "German", "Spanish", "Brazilian Portuguese", "Portuguese",
    "Italian", "Hindi", "Russian", "Arabic",
]

ACE_TIME_SIGNATURES = ['2', '3', '4', '6']
ACE_LANGUAGES = [
    'ar', 'az', 'bg', 'bn', 'ca', 'cs', 'da', 'de', 'el', 'en', 'es', 'fa',
    'fi', 'fr', 'he', 'hi', 'hr', 'ht', 'hu', 'id', 'is', 'it', 'ja', 'ko',
    'la', 'lt', 'ms', 'ne', 'nl', 'no', 'pa', 'pl', 'pt', 'ro', 'ru', 'sa',
    'sk', 'sr', 'sv', 'sw', 'ta', 'te', 'th', 'tl', 'tr', 'uk', 'ur', 'vi',
    'yue', 'zh', 'unknown',
]
ACE_KEYSCALES = [
    f"{root} {quality}"
    for quality in ["major", "minor"]
    for root in ["C", "C#", "Db", "D", "D#", "Eb", "E", "F", "F#", "Gb",
                 "G", "G#", "Ab", "A", "A#", "Bb", "B"]
]

# --- 3D Model Stage (Tripo + Rodin Gen-2.5 union; Stage INPUT_TYPES must allow
# every value a bound partner COMBO may hold after syncBoundOptionEnums) ---

MODEL3D_TEXTURE_QUALITIES = ["standard", "detailed", "extreme"]
MODEL3D_GEOMETRY_QUALITIES = ["standard", "detailed"]
MODEL3D_MODEL_VERSIONS = [
    "v3.1-20260211",
    "v3.0-20250812",
    "v2.5-20250123",
]
MODEL3D_MATERIALS = ["PBR", "Shaded", "All", "None"]
MODEL3D_MODES = ["Regular", "Fast", "Extreme-High"]
MODEL3D_POLYGON_COUNTS = [
    "Default",
    "4K-Quad", "8K-Quad", "18K-Quad", "50K-Quad", "200K-Quad",
    "2K-Triangle", "20K-Triangle", "150K-Triangle", "200K-Triangle",
    "500K-Triangle", "1M-Triangle",
]
MODEL3D_GEOMETRY_FORMATS = ["glb", "fbx", "obj", "stl"]
MODEL3D_TEXTURE_MODES = [
    "Default", "legacy", "extreme-low", "low", "medium", "high",
]
MODEL3D_ORIENTATIONS = ["default", "align_image"]
MODEL3D_TEXTURE_ALIGNMENTS = ["original_image", "geometry"]
