/** Stage defaults / unions for Tripo + Rodin Gen-2.5 COMBO sync. */

export const MODEL3D_TEXTURE_QUALITIES = ['standard', 'detailed', 'extreme'] as const
export const MODEL3D_GEOMETRY_QUALITIES = ['standard', 'detailed'] as const
export const MODEL3D_MODEL_VERSIONS = [
  'v3.1-20260211',
  'v3.0-20250812',
  'v2.5-20250123',
] as const
export const MODEL3D_MATERIALS = ['PBR', 'Shaded', 'All', 'None'] as const
export const MODEL3D_MODES = ['Regular', 'Fast', 'Extreme-High'] as const
export const MODEL3D_POLYGON_COUNTS = [
  'Default',
  '4K-Quad', '8K-Quad', '18K-Quad', '50K-Quad', '200K-Quad',
  '2K-Triangle', '20K-Triangle', '150K-Triangle', '200K-Triangle',
  '500K-Triangle', '1M-Triangle',
] as const
export const MODEL3D_GEOMETRY_FORMATS = ['glb', 'fbx', 'obj', 'stl'] as const
export const MODEL3D_TEXTURE_MODES = [
  'Default', 'legacy', 'extreme-low', 'low', 'medium', 'high',
] as const
export const MODEL3D_ORIENTATIONS = ['default', 'align_image'] as const
export const MODEL3D_TEXTURE_ALIGNMENTS = ['original_image', 'geometry'] as const
