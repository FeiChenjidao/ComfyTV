/** i18n keys for Stage option widgets shown in controls / params panel. */
export const OPTION_LABEL_KEYS: Record<string, string> = {
  seed: 'v2.ctl.seed',
  negative: 'v2.ctl.negative',
  texture: 'v2.ctl.texture',
  pbr: 'v2.ctl.pbr',
  texture_quality: 'v2.ctl.textureQuality',
  geometry_quality: 'v2.ctl.geometryQuality',
  model_version: 'v2.ctl.modelVersion',
  face_limit: 'v2.ctl.faceLimit',
  quad: 'v2.ctl.quad',
  smart_low_poly: 'v2.ctl.smartLowPoly',
  auto_size: 'v2.ctl.autoSize',
  orientation: 'v2.ctl.orientation',
  texture_alignment: 'v2.ctl.textureAlignment',
  material: 'v2.ctl.material',
  mode: 'v2.ctl.mode3d',
  polygon_count: 'v2.ctl.polygonCount',
  geometry_file_format: 'v2.ctl.geometryFormat',
  texture_mode: 'v2.ctl.textureMode',
  tapose: 'v2.ctl.tapose',
  hd_texture: 'v2.ctl.hdTexture',
  texture_delight: 'v2.ctl.textureDelight',
  addon_highpack: 'v2.ctl.addonHighpack',
  aspect_ratio: 'v2.ctl.aspectRatio',
  resolution: 'v2.ctl.resolution',
  batch_size: 'v2.ctl.batchSize',
  duration_s: 'v2.ctl.duration',
  generate_audio: 'v2.ctl.generateAudio',
  voice: 'v2.ctl.voice',
  language: 'v2.ctl.language',
  speed: 'v2.ctl.speed',
  reference_text: 'v2.ctl.referenceText',
}

export function optionLabelKey(name: string): string | null {
  return OPTION_LABEL_KEYS[name] ?? null
}
