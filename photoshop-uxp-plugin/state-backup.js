(function attachComfyTvPersistentState(root) {
  "use strict"

  const SCHEMA = 1

  function prefixedValues(store, prefix) {
    const values = {}
    if (!store || typeof store.key !== "function") return values
    for (let index = 0; index < Number(store.length || 0); index += 1) {
      const key = store.key(index)
      if (!key || !String(key).startsWith(prefix)) continue
      const value = store.getItem(key)
      if (value !== null) values[key] = String(value)
    }
    return values
  }

  function hasPrefixedValues(store, prefix) {
    return Object.keys(prefixedValues(store, prefix)).length > 0
  }

  function snapshot(store, prefix, pluginVersion) {
    return {
      schema: SCHEMA,
      pluginVersion: String(pluginVersion || ""),
      savedAt: new Date().toISOString(),
      values: prefixedValues(store, prefix),
    }
  }

  function restore(store, payload, prefix, options = {}) {
    if (!store || !payload || Number(payload.schema) !== SCHEMA || !payload.values || typeof payload.values !== "object") return 0
    const overwrite = options.overwrite === true
    const overwriteKeys = new Set(Array.isArray(options.overwriteKeys) ? options.overwriteKeys : [])
    let restored = 0
    Object.entries(payload.values).forEach(([key, value]) => {
      if (!String(key).startsWith(prefix) || typeof value !== "string") return
      if (!overwrite && !overwriteKeys.has(key) && store.getItem(key) !== null) return
      store.setItem(key, value)
      restored += 1
    })
    return restored
  }

  const api = { SCHEMA, prefixedValues, hasPrefixedValues, snapshot, restore }
  root.ComfyTvPersistentState = api
  if (typeof module !== "undefined" && module.exports) module.exports = api
})(typeof globalThis !== "undefined" ? globalThis : this)
