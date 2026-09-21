import { app } from '@/lib/comfyApp'

import type { PosterElement } from './posterLayout'

export interface PosterTemplateInfo {
  name: string
  label: string
  description: string
}

function postInit(body: unknown): RequestInit {
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }
}

async function fetchApi(path: string, init?: RequestInit): Promise<Response> {
  const r = await (app as any).api.fetchApi(path, init)
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`)
  return r
}

export async function fetchPosterHtml(params: Record<string, unknown>): Promise<string> {
  return (await fetchApi('/comfytv/poster/html', postInit(params))).text()
}

export async function fetchPosterElements(
  params: Record<string, unknown>
): Promise<PosterElement[]> {
  return (await (await fetchApi('/comfytv/poster/elements', postInit(params))).json()) || []
}

export async function fetchPosterTemplates(): Promise<PosterTemplateInfo[]> {
  return (await (await fetchApi('/comfytv/poster/templates')).json()) || []
}
