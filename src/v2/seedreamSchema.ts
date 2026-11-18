export interface SeedreamNumberSpec {
  default: number
  min: number
  max: number
  step: number
}

export interface SeedreamModelSpec {
  key: string
  sizeOptions: string[]
  defaultSize: string
  width: SeedreamNumberSpec
  height: SeedreamNumberSpec
  backgroundOptions: string[]
  defaultBackground: string
  seed: SeedreamNumberSpec
}

function configOf(required: Record<string, unknown>, name: string): Record<string, unknown> {
  const spec = required[name]
  if (!Array.isArray(spec) || !spec[1] || typeof spec[1] !== 'object') return {}
  return spec[1] as Record<string, unknown>
}

function numberSpec(config: Record<string, unknown>, fallback: SeedreamNumberSpec): SeedreamNumberSpec {
  const num = (key: keyof SeedreamNumberSpec) => {
    const value = Number(config[key])
    return Number.isFinite(value) ? value : fallback[key]
  }
  return { default: num('default'), min: num('min'), max: num('max'), step: num('step') }
}

export function parseSeedreamModels(payload: unknown): SeedreamModelSpec[] {
  const root = payload && typeof payload === 'object' ? payload as Record<string, any> : {}
  const entry = root.ByteDanceSeedreamNodeV3 ?? root
  const modelSpec = entry?.input?.required?.model
  const options = Array.isArray(modelSpec) && modelSpec[1]?.options
  if (!Array.isArray(options)) return []

  const out: SeedreamModelSpec[] = []
  for (const option of options) {
    const key = String(option?.key ?? '')
    const required = option?.inputs?.required
    if (!key || !required || typeof required !== 'object') continue
    const size = configOf(required, 'size_preset')
    const background = configOf(required, 'background')
    const sizeOptions = Array.isArray(size.options) ? size.options.map(String) : []
    out.push({
      key,
      sizeOptions,
      defaultSize: String(size.default ?? sizeOptions[0] ?? 'Custom'),
      width: numberSpec(configOf(required, 'width'), { default: 2048, min: 240, max: 8594, step: 2 }),
      height: numberSpec(configOf(required, 'height'), { default: 2048, min: 240, max: 8594, step: 2 }),
      backgroundOptions: Array.isArray(background.options) ? background.options.map(String) : [],
      defaultBackground: String(background.default ?? 'auto'),
      seed: numberSpec(configOf(required, 'seed'), { default: 42, min: 0, max: 2147483647, step: 1 }),
    })
  }
  return out
}
