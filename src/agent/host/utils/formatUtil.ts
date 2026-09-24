const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'avif', 'tif', 'tiff', 'svg']
const VIDEO_EXTENSIONS = ['mp4', 'm4v', 'webm', 'mov', 'avi', 'mkv']
const AUDIO_EXTENSIONS = ['mp3', 'wav', 'ogg', 'flac', 'opus', 'm4a']
const THREE_D_EXTENSIONS = ['obj', 'fbx', 'gltf', 'glb', 'stl', 'usdz', 'ply', 'spz', 'splat', 'ksplat']
const TEXT_EXTENSIONS = ['txt', 'md', 'markdown', 'json', 'csv', 'yaml', 'yml', 'xml', 'log']

export type MediaType = 'image' | 'video' | 'audio' | '3D' | 'text' | 'other'

export function getMediaTypeFromFilename(filename: string | null | undefined): MediaType {
  if (!filename) return 'other'
  const ext = filename.split('.').pop()?.toLowerCase()
  if (!ext) return 'other'
  if (IMAGE_EXTENSIONS.includes(ext)) return 'image'
  if (VIDEO_EXTENSIONS.includes(ext)) return 'video'
  if (AUDIO_EXTENSIONS.includes(ext)) return 'audio'
  if (THREE_D_EXTENSIONS.includes(ext)) return '3D'
  if (TEXT_EXTENSIONS.includes(ext)) return 'text'
  return 'other'
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isValidUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value)
}

export function generateUUID(): string {
  return crypto.randomUUID()
}

export function formatTime(seconds: number): string {
  if (isNaN(seconds) || seconds === 0) return '0:00'
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins}:${secs.toString().padStart(2, '0')}`
}
