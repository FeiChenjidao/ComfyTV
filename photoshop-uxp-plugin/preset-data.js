(function (root) {
  function clean(value) {
    return String(value == null ? "" : value).trim()
  }

  function key(value) {
    return clean(value).toLocaleLowerCase()
  }

  function optionsWithDefaults(options) {
    const source = options && typeof options === "object" ? options : {}
    return {
      version: Number(source.version) || 2,
      defaults: Array.isArray(source.defaults) ? source.defaults : [],
      newId: typeof source.newId === "function"
        ? source.newId
        : (prefix = "preset") => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`,
    }
  }

  function normalizeLibrary(value, options) {
    const config = optionsWithDefaults(options)
    const source = value && typeof value === "object" ? value : {}
    const categories = []
    const usedCategoryIds = new Set()
    const usedCategoryNames = new Set()
    config.defaults.forEach((item, order) => {
      const category = { id: clean(item.id), name: clean(item.name), order, pinned: true }
      if (!category.id || !category.name) return
      categories.push(category)
      usedCategoryIds.add(category.id)
      usedCategoryNames.add(key(category.name))
    })
    const incomingCategories = Array.isArray(source.categories) ? source.categories : []
    incomingCategories.forEach((item) => {
      const name = clean(item && item.name)
      if (!name || usedCategoryNames.has(key(name))) return
      let id = clean(item && item.id)
      if (!id || usedCategoryIds.has(id)) id = config.newId("category")
      categories.push({ id, name, order: categories.length, pinned: false })
      usedCategoryIds.add(id)
      usedCategoryNames.add(key(name))
    })
    const categoryIds = new Set(categories.map((item) => item.id))
    const presets = []
    const usedPresetIds = new Set()
    const namesByCategory = new Map()
    const incomingPresets = Array.isArray(source.presets) ? source.presets : []
    incomingPresets.forEach((item) => {
      const categoryId = clean(item && item.categoryId)
      const name = clean(item && item.name)
      const prefix = clean(item && item.prefix)
      const suffix = clean(item && item.suffix)
      if (!categoryIds.has(categoryId) || !name || (!prefix && !suffix)) return
      const categoryNames = namesByCategory.get(categoryId) || new Set()
      if (categoryNames.has(key(name))) return
      let id = clean(item && item.id)
      if (!id || usedPresetIds.has(id)) id = config.newId("preset")
      presets.push({ id, categoryId, name, prefix, suffix })
      usedPresetIds.add(id)
      categoryNames.add(key(name))
      namesByCategory.set(categoryId, categoryNames)
    })
    return { version: config.version, categories, presets }
  }

  function pruneEmptyCategories(library) {
    const used = new Set(library.presets.map((item) => item.categoryId))
    library.categories = library.categories.filter((item) => item.pinned || used.has(item.id))
    library.categories.forEach((item, order) => { item.order = order })
    return library
  }

  function savePreset(library, data, options) {
    const config = optionsWithDefaults(options)
    const categoryName = clean(data && data.category)
    const name = clean(data && data.name)
    const prefix = clean(data && data.prefix)
    const suffix = clean(data && data.suffix)
    const editId = clean(data && data.id)
    if (!categoryName || !name) return { ok: false, message: "分类和名称都必须填写" }
    if (!prefix && !suffix) return { ok: false, message: "预设内容不能为空" }
    const next = normalizeLibrary(library, config)
    let category = next.categories.find((item) => key(item.name) === key(categoryName))
    if (!category) {
      category = { id: config.newId("category"), name: categoryName, order: next.categories.length, pinned: false }
      next.categories.push(category)
    }
    const duplicate = next.presets.find((item) => item.categoryId === category.id
      && item.id !== editId && key(item.name) === key(name))
    if (duplicate) return { ok: false, message: `“${category.name}”中已经有同名预设` }
    const editing = next.presets.find((item) => item.id === editId)
    const previousCategoryId = editing ? editing.categoryId : ""
    if (editing) Object.assign(editing, { categoryId: category.id, name, prefix, suffix })
    else next.presets.push({ id: config.newId("preset"), categoryId: category.id, name, prefix, suffix })
    pruneEmptyCategories(next)
    return {
      ok: true,
      library: next,
      preset: editing || next.presets[next.presets.length - 1],
      categoryId: category.id,
      previousCategoryId,
      editing: Boolean(editing),
    }
  }

  function deletePreset(library, presetId, options) {
    const next = normalizeLibrary(library, options)
    const item = next.presets.find((entry) => entry.id === clean(presetId))
    if (!item) return { ok: false, message: "预设不存在或已被删除" }
    next.presets = next.presets.filter((entry) => entry.id !== item.id)
    pruneEmptyCategories(next)
    return { ok: true, library: next, preset: item }
  }

  function parseImport(raw) {
    const parsed = JSON.parse(raw)
    if (!parsed || parsed.schema !== "comfytv-preset-library" || Number(parsed.version) !== 1) {
      throw new Error("这不是受支持的 ComfyTV 预设文件")
    }
    if (!Array.isArray(parsed.categories)) throw new Error("预设文件缺少分类数据")
    const entries = []
    let invalid = 0
    parsed.categories.forEach((category) => {
      const categoryName = clean(category && category.name)
      if (!categoryName || !Array.isArray(category.presets)) {
        invalid += 1
        return
      }
      category.presets.forEach((preset) => {
        const name = clean(preset && preset.name)
        const prefix = clean(preset && preset.prefix)
        const suffix = clean(preset && preset.suffix)
        if (!name || (!prefix && !suffix)) {
          invalid += 1
          return
        }
        entries.push({ categoryName, name, prefix, suffix })
      })
    })
    return { entries, invalid }
  }

  function summarizeImport(library, parsed) {
    const newCategories = new Set()
    let additions = 0
    let conflicts = 0
    parsed.entries.forEach((entry) => {
      const category = library.categories.find((item) => key(item.name) === key(entry.categoryName))
      if (!category) newCategories.add(key(entry.categoryName))
      const conflict = category && library.presets.some((item) => item.categoryId === category.id
        && key(item.name) === key(entry.name))
      if (conflict) conflicts += 1
      else additions += 1
    })
    return { newCategories: newCategories.size, additions, conflicts, invalid: parsed.invalid }
  }

  function applyImport(library, parsed, mode, options) {
    if (!parsed || !["overwrite", "skip"].includes(mode)) return null
    const config = optionsWithDefaults(options)
    const next = normalizeLibrary(library, config)
    parsed.entries.forEach((entry) => {
      let category = next.categories.find((item) => key(item.name) === key(entry.categoryName))
      if (!category) {
        category = { id: config.newId("category"), name: entry.categoryName, order: next.categories.length, pinned: false }
        next.categories.push(category)
      }
      const existing = next.presets.find((item) => item.categoryId === category.id && key(item.name) === key(entry.name))
      if (existing) {
        if (mode === "overwrite") Object.assign(existing, {
          categoryId: category.id,
          name: entry.name,
          prefix: entry.prefix,
          suffix: entry.suffix,
        })
      } else {
        next.presets.push({ id: config.newId("preset"), categoryId: category.id, name: entry.name, prefix: entry.prefix, suffix: entry.suffix })
      }
    })
    return pruneEmptyCategories(next)
  }

  const api = {
    normalizeLibrary,
    pruneEmptyCategories,
    savePreset,
    deletePreset,
    parseImport,
    summarizeImport,
    applyImport,
  }
  root.ComfyTVPresetData = api
  if (typeof module !== "undefined" && module.exports) module.exports = api
})(typeof globalThis !== "undefined" ? globalThis : this)
