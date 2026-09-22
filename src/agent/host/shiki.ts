import { createHighlighterCore } from 'shiki/core'
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript'
import type { HighlighterCore } from 'shiki/core'

const LANGS: Record<string, () => Promise<any>> = {
  python: () => import('@shikijs/langs/python'),
  json: () => import('@shikijs/langs/json'),
  javascript: () => import('@shikijs/langs/javascript'),
  typescript: () => import('@shikijs/langs/typescript'),
  bash: () => import('@shikijs/langs/bash'),
  shellscript: () => import('@shikijs/langs/shellscript'),
  markdown: () => import('@shikijs/langs/markdown'),
  yaml: () => import('@shikijs/langs/yaml'),
  html: () => import('@shikijs/langs/html'),
  css: () => import('@shikijs/langs/css'),
}
const ALIASES: Record<string, string> = {
  py: 'python', js: 'javascript', ts: 'typescript', sh: 'bash', shell: 'bash',
  zsh: 'bash', md: 'markdown', yml: 'yaml', jsonc: 'json',
}

let highlighter: Promise<HighlighterCore> | null = null
const loadedLangs = new Set<string>()

function getHighlighter(): Promise<HighlighterCore> {
  if (!highlighter) {
    highlighter = createHighlighterCore({
      themes: [import('@shikijs/themes/github-dark')],
      langs: [],
      engine: createJavaScriptRegexEngine(),
    })
  }
  return highlighter
}

export async function codeToHtml(code: string, options: { lang: string; theme: string; [key: string]: unknown }): Promise<string> {
  const lang = ALIASES[options.lang] ?? options.lang
  const loader = LANGS[lang]
  const hl = await getHighlighter()
  if (!loader) throw new Error(`unsupported language ${options.lang}`)
  if (!loadedLangs.has(lang)) {
    await hl.loadLanguage(await loader())
    loadedLangs.add(lang)
  }
  return hl.codeToHtml(code, { ...options, lang, theme: 'github-dark' } as any)
}
