import { readComfyOrgAuthSnapshot } from './comfyOrgAuth'

const FIREBASE_PREFIX = 'firebase:authUser:'
const FIREBASE_DB = 'firebaseLocalStorageDb'
const FIREBASE_STORE = 'firebaseLocalStorage'
const RESTORE_TIMEOUT_MS = 4000
const SNAPSHOT_INTERVAL_MS = 1000
const TRANSFER_PARAM = 'comfytv_auth_transfer'
const PROVIDER_PARAM = 'comfytv_auth_provider'
const TRANSFER_TIMEOUT_MS = 5 * 60 * 1000
const TRANSFER_ID = /^[A-Za-z0-9_-]{32,128}$/
const RESTORE_SIGNATURE_KEY = 'comfytv.auth.restore-signature.v2'

type HostBridge = { postMessage?: (message: unknown) => void }
type IndexedRecord = { key: IDBValidKey; value: unknown }
export type AuthEnvelope = {
  version: 2
  localStorage: Record<string, string>
  indexedDb: IndexedRecord[]
  token?: string
  apiKey?: string
}

function host(): HostBridge | undefined {
  return (window as Window & { uxpHost?: HostBridge }).uxpHost
}

function localEntries(): Record<string, string> {
  const entries: Record<string, string> = {}
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index)
    if (!key?.startsWith(FIREBASE_PREFIX)) continue
    const value = localStorage.getItem(key)
    if (value !== null) entries[key] = value
  }
  return entries
}

function requestValue<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function openFirebaseDb(): Promise<IDBDatabase | null> {
  if (!window.indexedDB) return Promise.resolve(null)
  return new Promise((resolve) => {
    const request = indexedDB.open(FIREBASE_DB)
    request.onupgradeneeded = () => {
      request.transaction?.abort()
      resolve(null)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => resolve(null)
  })
}

async function indexedEntries(): Promise<IndexedRecord[]> {
  const db = await openFirebaseDb()
  if (!db || !db.objectStoreNames.contains(FIREBASE_STORE)) {
    db?.close()
    return []
  }
  try {
    const transaction = db.transaction(FIREBASE_STORE, 'readonly')
    const store = transaction.objectStore(FIREBASE_STORE)
    const [keys, values] = await Promise.all([
      requestValue(store.getAllKeys()),
      requestValue(store.getAll()),
    ])
    return keys.map((key, index) => ({ key, value: values[index] }))
  } finally {
    db.close()
  }
}

function apiObject(): any {
  return (window as any).comfyAPI?.app?.app?.api
}

async function snapshot(): Promise<AuthEnvelope> {
  const official = await readComfyOrgAuthSnapshot(apiObject()).catch(() => ({}))
  return {
    version: 2,
    localStorage: localEntries(),
    indexedDb: await indexedEntries().catch(() => []),
    ...official,
  }
}

export function validEnvelope(value: unknown): AuthEnvelope {
  const source = value && typeof value === 'object' ? value as any : {}
  const local: Record<string, string> = {}
  const legacy = source.localStorage || source.entries || {}
  if (legacy && typeof legacy === 'object' && !Array.isArray(legacy)) {
    for (const [key, item] of Object.entries(legacy)) {
      if (key.startsWith(FIREBASE_PREFIX) && typeof item === 'string') local[key] = item
    }
  }
  const indexedDb = Array.isArray(source.indexedDb)
    ? source.indexedDb.filter((item: any) => item && Object.hasOwn(item, 'key') && Object.hasOwn(item, 'value'))
    : []
  return {
    version: 2,
    localStorage: local,
    indexedDb,
    ...(typeof source.token === 'string' && source.token ? { token: source.token } : {}),
    ...(typeof source.apiKey === 'string' && source.apiKey ? { apiKey: source.apiKey } : {}),
  }
}

function signature(value: AuthEnvelope): string {
  return JSON.stringify(value)
}

function comparable(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value)
  } catch {
    return String(value)
  }
}

async function restore(value: unknown): Promise<boolean> {
  const envelope = validEnvelope(value)
  let changed = false
  for (const [key, item] of Object.entries(envelope.localStorage)) {
    if (localStorage.getItem(key) === item) continue
    localStorage.setItem(key, item)
    changed = true
  }
  if (envelope.indexedDb.length) {
    const current = await indexedEntries().catch(() => [])
    const currentByKey = new Map(current.map((item) => [comparable(item.key), comparable(item.value)]))
    const pending = envelope.indexedDb.filter((item) => (
      currentByKey.get(comparable(item.key)) !== comparable(item.value)
    ))
    const db = pending.length ? await openFirebaseDb() : null
    if (pending.length && db?.objectStoreNames.contains(FIREBASE_STORE)) {
      const transaction = db.transaction(FIREBASE_STORE, 'readwrite')
      const store = transaction.objectStore(FIREBASE_STORE)
      for (const item of pending) store.put(item.value, item.key)
      await new Promise<void>((resolve, reject) => {
        transaction.oncomplete = () => resolve()
        transaction.onerror = () => reject(transaction.error)
        transaction.onabort = () => reject(transaction.error)
      })
      changed = true
    }
    db?.close()
  }
  const api = apiObject()
  if (api && envelope.token && api.authToken !== envelope.token) {
    api.authToken = envelope.token
    changed = true
  }
  if (api && envelope.apiKey && api.apiKey !== envelope.apiKey) {
    api.apiKey = envelope.apiKey
    changed = true
  }
  return changed
}

function randomTransferId(): string {
  const bytes = new Uint8Array(24)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('')
}

const transferUrl = (id: string) => `/comfytv/photoshop/auth-transfer/${encodeURIComponent(id)}`

function banner(message: string, complete = false): void {
  let element = document.getElementById('comfytv-auth-transfer-banner')
  if (!element) {
    element = document.createElement('div')
    element.id = 'comfytv-auth-transfer-banner'
    Object.assign(element.style, {
      position: 'fixed', top: '12px', left: '50%', zIndex: '2147483647',
      maxWidth: 'min(560px, calc(100vw - 32px))', padding: '10px 14px',
      border: '1px solid rgba(255,255,255,.18)', borderRadius: '8px',
      background: '#1b1b1d', color: '#f2f2f2', transform: 'translateX(-50%)',
    })
    document.body.appendChild(element)
  }
  element.textContent = message
  element.style.borderColor = complete ? '#78a600' : 'rgba(255,255,255,.18)'
}

function clickLoginButton(): void {
  const button = Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find((item) => {
    const label = `${item.getAttribute('aria-label') || ''} ${item.textContent || ''}`.trim()
    return /^(登录|sign\s*in|log\s*in)$/i.test(label)
  })
  button?.click()
}

function installExternalTransfer(transferId: string, provider: string): void {
  if (!TRANSFER_ID.test(transferId)) return
  const label = provider === 'github' ? 'GitHub' : 'Google'
  banner(`请在此窗口完成 ${label} 登录；成功后登录状态会自动同步到 Photoshop。`)
  const startedAt = Date.now()
  let posting = false
  const timer = window.setInterval(async () => {
    if (posting) return
    if (Date.now() - startedAt > TRANSFER_TIMEOUT_MS) {
      window.clearInterval(timer)
      banner('登录同步已超时。请返回 Photoshop 后重新点击登录。')
      return
    }
    posting = true
    try {
      const envelope = await snapshot()
      if (!envelope.token && !envelope.apiKey && !Object.keys(envelope.localStorage).length && !envelope.indexedDb.length) return
      const response = await fetch(transferUrl(transferId), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ envelope }),
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      window.clearInterval(timer)
      banner('登录已完成，可以返回 Photoshop。', true)
    } catch {
      // Login may still be in progress.
    } finally {
      posting = false
    }
  }, 1000)
  window.setTimeout(clickLoginButton, 500)
}

function socialProvider(event: Event): 'google' | 'github' | null {
  const button = (event.target as HTMLElement | null)?.closest?.('button')
  if (!button) return null
  const text = `${button.getAttribute('aria-label') || ''} ${button.textContent || ''}`.toLowerCase()
  if (text.includes('google')) return 'google'
  if (text.includes('github')) return 'github'
  return null
}

function startTransferPoll(bridge: HostBridge, transferId: string): void {
  const startedAt = Date.now()
  let loading = false
  const timer = window.setInterval(async () => {
    if (loading) return
    if (Date.now() - startedAt > TRANSFER_TIMEOUT_MS) {
      window.clearInterval(timer)
      bridge.postMessage?.({ type: 'comfytv-auth-transfer-timeout' })
      return
    }
    loading = true
    try {
      const response = await fetch(transferUrl(transferId), { cache: 'no-store' })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const payload = await response.json() as { ready?: boolean; envelope?: unknown; entries?: unknown }
      if (!payload.ready) return
      const envelope = validEnvelope(payload.envelope || { entries: payload.entries })
      window.clearInterval(timer)
      await restore(envelope)
      bridge.postMessage?.({ type: 'comfytv-auth-snapshot', envelope, origin: location.origin })
      await fetch(transferUrl(transferId), { method: 'DELETE' }).catch(() => undefined)
      bridge.postMessage?.({ type: 'comfytv-auth-transfer-complete' })
      window.setTimeout(() => location.reload(), 350)
    } catch {
      // The external browser may still be opening or signing in.
    } finally {
      loading = false
    }
  }, 1000)
}

export function installUxpAuthPersistence(): void {
  const params = new URLSearchParams(location.search)
  const externalId = params.get(TRANSFER_PARAM) || ''
  if (externalId) installExternalTransfer(externalId, params.get(PROVIDER_PARAM) || 'google')

  const bridge = host()
  if (!bridge?.postMessage) return
  let monitoring = false
  let publishing = false
  let lastSignature = ''
  let restoreTimer = 0

  const publish = async () => {
    if (publishing) return
    publishing = true
    try {
      const envelope = await snapshot()
      const next = signature(envelope)
      if (next === lastSignature) return
      lastSignature = next
      bridge.postMessage?.({ type: 'comfytv-auth-snapshot', envelope, origin: location.origin })
    } finally {
      publishing = false
    }
  }
  const startMonitoring = () => {
    if (monitoring) return
    monitoring = true
    void publish()
    window.setInterval(() => void publish(), SNAPSHOT_INTERVAL_MS)
  }

  window.addEventListener('message', (event: MessageEvent<any>) => {
    if (event.data?.type !== 'comfytv-auth-restore') return
    window.clearTimeout(restoreTimer)
    const envelope = validEnvelope(event.data.envelope || { entries: event.data.entries })
    const nextSignature = signature(envelope)
    if (sessionStorage.getItem(RESTORE_SIGNATURE_KEY) === nextSignature) {
      lastSignature = nextSignature
      startMonitoring()
      return
    }
    void restore(envelope).then((changed) => {
      sessionStorage.setItem(RESTORE_SIGNATURE_KEY, nextSignature)
      lastSignature = nextSignature
      if (changed) location.reload()
      else startMonitoring()
    })
  })
  bridge.postMessage({ type: 'comfytv-auth-restore-request', origin: location.origin })
  restoreTimer = window.setTimeout(startMonitoring, RESTORE_TIMEOUT_MS)

  window.addEventListener('click', (event) => {
    const provider = socialProvider(event)
    if (!provider) return
    event.preventDefault()
    event.stopPropagation()
    event.stopImmediatePropagation()
    const transferId = randomTransferId()
    startTransferPoll(bridge, transferId)
    bridge.postMessage?.({
      type: 'comfytv-auth-open-external', transferId, provider, origin: location.origin,
    })
  }, true)
}
