import { readFileSync, readdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { loadIconSet } from '@iconify/tailwind4/lib/helpers/loader.js'
import { getDynamicCSSRules } from '@iconify/tailwind4/lib/plugins/dynamic.js'
import plugin from 'tailwindcss/plugin'

const SCALE = 1.2
const ICONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../icons')

function loadLocalIconSet() {
  const icons: Record<string, { body: string; width: number; height: number }> = {}
  for (const file of readdirSync(ICONS_DIR)) {
    if (!file.endsWith('.svg')) continue
    const svg = readFileSync(resolve(ICONS_DIR, file), 'utf-8')
    const viewBox = /viewBox="0 0 (\d+) (\d+)"/.exec(svg)
    const body = svg.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '')
    icons[file.replace(/\.svg$/, '')] = {
      body,
      width: viewBox ? Number(viewBox[1]) : 16,
      height: viewBox ? Number(viewBox[2]) : 16,
    }
  }
  return { prefix: 'comfy', icons }
}

const options = {
  iconSets: { comfy: loadLocalIconSet() },
  scale: SCALE,
}

export default plugin(({ matchComponents }) => {
  matchComponents({
    icon: (icon: string) => {
      try {
        return getDynamicCSSRules(icon, options)
      } catch {
        return {}
      }
    },
  })
})

export { loadIconSet }
