/**
 * Copy the host ComfyUI session onto `api.authToken` / `api.apiKey`.
 *
 * `app.queuePrompt` does this before calling `api.queuePrompt`. ComfyTV queues
 * through `api.queuePrompt` directly, so without this the POST has empty
 * extra_data and API nodes 401 → ComfyUI's own login dialog.
 */

function findHostPinia(): any {
  const win = window as any
  if (win.__comfytv_host_pinia) return win.__comfytv_host_pinia
  for (const sel of ['#vue-app', '#app']) {
    const root: any = document.querySelector(sel)
    const vueApp = root?.__vue_app__
    const pinia = vueApp?.config?.globalProperties?.$pinia
                  ?? vueApp?._context?.config?.globalProperties?.$pinia
    if (pinia) return pinia
  }
  return win.app?.extensionManager?._p ?? null
}

const AUTH_STORE_IDS = ['firebaseAuth', 'auth', 'comfyOrgAuth']
const API_KEY_STORE_IDS = ['apiKeyAuth', 'apiKey']

function hostStore(id: string): any {
  return findHostPinia()?._s?.get?.(id)
}

function hostStores(): any[] {
  const map = findHostPinia()?._s
  if (!map || typeof map.values !== 'function') return []
  return [...map.values()]
}

async function tokenFromStore(store: any): Promise<string | undefined> {
  if (!store) return undefined
  try {
    const t = await store.getAuthToken?.()
    if (typeof t === 'string' && t) return t
  } catch { /* store may not be ready */ }
  const raw = store.token ?? store.idToken ?? store.authToken
  const value = typeof raw === 'string' ? raw : raw?.value
  return typeof value === 'string' && value ? value : undefined
}

function keyFromStore(store: any): string | undefined {
  if (!store) return undefined
  try {
    const k = store.getApiKey?.()
    if (typeof k === 'string' && k) return k
  } catch { /* ignore */ }
  const raw = store.apiKey
  const value = typeof raw === 'string' ? raw : raw?.value
  return typeof value === 'string' && value ? value : undefined
}

async function resolveAuthToken(api: any): Promise<string | undefined> {
  try {
    const store = await api.getAuthStore?.()
    const t = await tokenFromStore(store)
    if (t) return t
  } catch { /* private / stubbed on some frontends */ }

  try {
    const t = await tokenFromStore(api.authStoreComposable)
    if (t) return t
  } catch { /* ignore */ }

  for (const id of AUTH_STORE_IDS) {
    const t = await tokenFromStore(hostStore(id))
    if (t) return t
  }
  for (const store of hostStores()) {
    if (typeof store?.getAuthToken !== 'function') continue
    const t = await tokenFromStore(store)
    if (t) return t
  }
  return undefined
}

function resolveApiKey(_api: any): string | undefined {
  for (const id of API_KEY_STORE_IDS) {
    const k = keyFromStore(hostStore(id))
    if (k) return k
  }
  for (const store of hostStores()) {
    if (typeof store?.getApiKey !== 'function') continue
    const k = keyFromStore(store)
    if (k) return k
  }
  return undefined
}

export async function attachComfyOrgAuth(api: any): Promise<void> {
  if (!api || typeof api !== 'object') return
  try {
    await api.waitForAuthInitialization?.()
  } catch { /* desktop / unauthenticated */ }

  const token = await resolveAuthToken(api)
  const key = resolveApiKey(api)
  if (token) api.authToken = token
  if (key) api.apiKey = key
}
