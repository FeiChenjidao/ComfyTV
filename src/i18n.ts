import { createI18n } from 'vue-i18n'

import { messages as pentradoMessages } from '@jtydhr88/pentrado/locales'

import { app } from '@/lib/comfyApp'

import en from '../locales/en/main.json'
import zh from '../locales/zh/main.json'
import agentEn from './agent/locales/en.json'
import agentZh from './agent/locales/zh.json'

type Messages = Record<string, unknown>

function mergeMessages(base: Messages, extra: Messages): Messages {
  const out: Messages = { ...base }
  for (const [key, value] of Object.entries(extra)) {
    const prev = out[key]
    out[key] =
      prev && typeof prev === 'object' && value && typeof value === 'object'
        ? mergeMessages(prev as Messages, value as Messages)
        : value
  }
  return out
}

export type SupportedLocale = 'en' | 'zh'

function pickLocale(): SupportedLocale {
  let stored: string | undefined
  try {
    stored = app?.ui?.settings?.getSettingValue?.('Comfy.Locale')
          ?? app?.extensionManager?.setting?.get?.('Comfy.Locale')
  } catch {
    stored = undefined
  }
  const candidate = (stored || navigator.language || 'en').toLowerCase()
  if (candidate.startsWith('zh')) return 'zh'
  return 'en'
}

export const i18n = createI18n({
  legacy: false,
  locale: pickLocale(),
  fallbackLocale: 'en',
  messages: {
    en: mergeMessages({ ...en, ...pentradoMessages.en }, agentEn) as typeof en,
    zh: mergeMessages({ ...zh, ...pentradoMessages.zh }, agentZh) as typeof zh,
  },
  missingWarn: false,
  fallbackWarn: false,
})

export const t = i18n.global.t
