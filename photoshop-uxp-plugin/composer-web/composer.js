const prompt = document.getElementById("prompt")
const mentions = document.getElementById("mentions")
const list = document.getElementById("reference-list")
const referenceRow = document.getElementById("drop-target")
const presetStrip = document.getElementById("preset-strip")
const layerSource = document.getElementById("active-layer")
const styleCard = document.getElementById("style-reference")
const styleImage = document.getElementById("style-image")
const stylePlaceholder = document.getElementById("style-placeholder")
const styleRemove = document.getElementById("style-remove")
const progress = document.getElementById("progress")
const workspace = document.getElementById("workspace")
const progressFrame = document.getElementById("composer-progress-frame")
const progressStroke = document.getElementById("composer-progress-stroke")
const canvasCard = document.getElementById("canvas")
const canvasImage = document.getElementById("canvas-image")
const canvasPlaceholder = document.getElementById("canvas-placeholder")
const modelTrigger = document.getElementById("model-trigger")
const modelLabel = document.getElementById("model-label")
const modeTrigger = document.getElementById("mode-trigger")
const modeLabel = document.getElementById("mode-label")
const countTrigger = document.getElementById("count-trigger")
const countLabel = document.getElementById("count-label")
const cropToggle = document.getElementById("crop-toggle")
const presetOpen = document.getElementById("preset-open")
const historyCategoryTrigger = document.getElementById("history-category-trigger")
const historyCategoryLabel = document.getElementById("history-category-label")
const renderButton = document.getElementById("render")
const composerSurface = "composer"
const maxReferenceEdge = 2048
const maxDroppedReferenceBytes = 25 * 1024 * 1024
let references = []
let styleReference = null
let canvasReference = null
let presetLibrary = { version: 2, categories: [{ id: "style", name: "风格" }, { id: "function", name: "功能" }], presets: [] }
let selectedPresets = {}
let selectedTags = []
let hostProtocolVersion = 0
let promptFocusRange = null
let lastPromptFocusRequest = 0
let restoringPromptFocus = false
let controls = {
  models: [],
  model: "",
  modelLabel: "模型",
  modeLabel: "模式",
  profile: {},
  modeOptions: {},
  count: 1,
  countSteps: [1, 2, 4, 8],
  historyCategory: "",
  historyCategoryLabel: "未分类",
  historyCategories: [{ id: "", name: "未分类" }],
  crop: true,
  progress: "就绪",
  progressActive: false,
  progressPercent: 0,
  busy: false,
  stopping: false,
}
let dragDepth = 0
let referenceDrag = null
let layerSourceDrag = null
let externalDropIndex = null
let suppressReferenceClick = false
let suppressLayerSourceClick = false
let composerRevision = null
let lastMentionPick = null
let promptSyncTimer = 0
let promptComposing = false
let progressOffset = 0
let progressTimer = 0
let progressGeometry = null
let paintedProgressActive = null
let paintedProgressPercent = null
const pendingHostMessages = []
let hostMessageTimer = 0

function send(message) {
  const payload = { ...message, surface: composerSurface }
  if (window.uxpHost && typeof window.uxpHost.postMessage === "function") {
    window.uxpHost.postMessage(payload)
    return
  }
  if (payload.type === "composer-prompt") {
    const previous = pendingHostMessages.findIndex((item) => item.type === "composer-prompt")
    if (previous >= 0) pendingHostMessages.splice(previous, 1)
  }
  if (pendingHostMessages.length >= 40) pendingHostMessages.shift()
  pendingHostMessages.push(payload)
  if (!hostMessageTimer) {
    hostMessageTimer = setInterval(() => {
      if (!window.uxpHost || typeof window.uxpHost.postMessage !== "function") return
      clearInterval(hostMessageTimer)
      hostMessageTimer = 0
      while (pendingHostMessages.length) window.uxpHost.postMessage(pendingHostMessages.shift())
    }, 100)
  }
}

function rememberPromptFocus() {
  try {
    const selection = window.getSelection()
    if (selection && selection.rangeCount && prompt.contains(selection.anchorNode)) {
      promptFocusRange = selection.getRangeAt(0).cloneRange()
    }
  } catch (_) {}
}

function restorePromptFocus() {
  if (restoringPromptFocus) return
  restoringPromptFocus = true
  try {
    window.focus()
    prompt.focus({ preventScroll: true })
    const selection = window.getSelection()
    if (!selection) return
    selection.removeAllRanges()
    if (promptFocusRange && prompt.contains(promptFocusRange.commonAncestorContainer)) {
      selection.addRange(promptFocusRange)
      return
    }
    const range = document.createRange()
    range.selectNodeContents(prompt)
    range.collapse(false)
    selection.addRange(range)
  } catch (_) {
    try { prompt.focus() } catch (_) {}
  } finally {
    restoringPromptFocus = false
  }
}

function requestHostPromptFocus() {
  if (restoringPromptFocus) return
  rememberPromptFocus()
  restorePromptFocus()
  const now = Date.now()
  if (now - lastPromptFocusRequest < 120) return
  lastPromptFocusRequest = now
  send({ type: "composer-request-focus" })
}

async function watchComposerFiles() {
  if (!/^https?:$/i.test(window.location.protocol)) return
  try {
    const response = await fetch(`./composer-version?time=${Date.now()}`, { cache: "no-store" })
    if (!response.ok) return
    const payload = await response.json()
    const revision = String(payload.revision || "")
    if (!revision) return
    if (composerRevision === null) composerRevision = revision
    else if (revision !== composerRevision) window.location.reload()
  } catch (_) {}
}

function requestSurfaceMenu(name) {
  send({ type: "composer-open-overlay", menu: name })
}

function paintCanvasReference() {
  const hasImage = Boolean(canvasReference && canvasReference.src)
  canvasCard.classList.toggle("has-preview", hasImage)
  canvasImage.hidden = !hasImage
  canvasPlaceholder.hidden = hasImage
  if (hasImage) {
    const expected = canvasReference.src
    canvasImage.onerror = () => {
      if (canvasImage.src !== expected && canvasImage.getAttribute("src") !== expected) return
      canvasCard.classList.remove("has-preview")
      canvasImage.hidden = true
      canvasPlaceholder.hidden = false
      canvasImage.removeAttribute("src")
    }
    canvasImage.src = expected
  } else {
    canvasImage.onerror = null
    canvasImage.removeAttribute("src")
  }
}

function refreshComposerProgressGeometry() {
  if (!progressFrame.classList.contains("active")) return
  const width = Math.max(0, workspace.clientWidth)
  const height = Math.max(0, workspace.clientHeight)
  if (width < 8 || height < 8) {
    progressGeometry = null
    return
  }
  const inset = 2
  const pathWidth = Math.max(1, width - inset * 2)
  const pathHeight = Math.max(1, height - inset * 2)
  const perimeter = 2 * (pathWidth + pathHeight)
  const percent = Math.max(0, Math.min(100, Number(controls.progressPercent) || 0))
  const lit = percent >= 100
    ? perimeter
    : percent > 0
      ? Math.max(30, perimeter * percent / 100)
      : Math.min(120, perimeter * 0.18)
  progressStroke.setAttribute("x", String(inset))
  progressStroke.setAttribute("y", String(inset))
  progressStroke.setAttribute("width", String(pathWidth))
  progressStroke.setAttribute("height", String(pathHeight))
  progressStroke.setAttribute("rx", "6")
  progressStroke.setAttribute("ry", "6")
  progressStroke.style.strokeDasharray = `${lit} ${Math.max(0.01, perimeter - lit)}`
  progressGeometry = { perimeter, percent }
}

function paintComposerProgress() {
  if (!progressFrame.classList.contains("active")) return
  if (!progressGeometry) refreshComposerProgressGeometry()
  if (!progressGeometry) return
  const { perimeter, percent } = progressGeometry
  progressStroke.style.strokeDashoffset = percent >= 100 ? "0" : String(-(progressOffset % perimeter))
}

function setComposerProgress(active, percent) {
  const running = Boolean(active)
  const value = Math.max(0, Math.min(100, Number(percent) || 0))
  const changed = paintedProgressActive !== running || paintedProgressPercent !== value
  if (changed) {
    paintedProgressActive = running
    paintedProgressPercent = value
    progress.classList.toggle("is-active", running)
    progress.classList.toggle("is-indeterminate", running && value <= 0)
    progress.style.setProperty("--progress-scale", String(value / 100))
    progressFrame.classList.toggle("active", running)
    progressGeometry = null
  }
  if (!running) {
    clearInterval(progressTimer)
    progressTimer = 0
    progressGeometry = null
    return
  }
  if (changed) {
    refreshComposerProgressGeometry()
    paintComposerProgress()
  }
  if (!progressTimer && value < 100) {
    progressTimer = setInterval(() => {
      progressOffset += 8
      paintComposerProgress()
    }, 40)
  } else if (value >= 100 && progressTimer) {
    clearInterval(progressTimer)
    progressTimer = 0
  }
}

function paintProgressControls() {
  const text = controls.progress || "就绪"
  if (progress.textContent !== text) progress.textContent = text
  const busy = Boolean(controls.busy)
  const stopping = Boolean(controls.stopping)
  renderButton.disabled = busy && !stopping
  renderButton.classList.toggle("is-stop", stopping)
  const label = stopping ? "■" : "↑"
  if (renderButton.textContent !== label) renderButton.textContent = label
  setComposerProgress(controls.progressActive, controls.progressPercent)
}

function paintControls() {
  const nextModel = controls.modelLabel || "模型"
  const nextMode = controls.modeLabel || "模式"
  const nextCount = `${Number(controls.count) || 1}x`
  const nextHistoryCategory = controls.historyCategoryLabel || "未分类"
  if (modelLabel.textContent !== nextModel) modelLabel.textContent = nextModel
  if (modeLabel.textContent !== nextMode) modeLabel.textContent = nextMode
  if (countLabel.textContent !== nextCount) countLabel.textContent = nextCount
  if (historyCategoryLabel.textContent !== nextHistoryCategory) historyCategoryLabel.textContent = nextHistoryCategory
  historyCategoryTrigger.title = `历史分类：${nextHistoryCategory}`
  cropToggle.classList.toggle("is-on", Boolean(controls.crop))
  paintProgressControls()
}

function queuePromptSync(immediate = false) {
  clearTimeout(promptSyncTimer)
  const flush = () => send({ type: "composer-prompt", value: promptText() })
  if (immediate) flush()
  else promptSyncTimer = setTimeout(flush, 100)
}

function selectedPreset(categoryId) {
  const items = Array.isArray(presetLibrary.presets) ? presetLibrary.presets : []
  return items.find((item) => item.categoryId === categoryId && item.id === selectedPresets[categoryId]) || null
}

function paintStyleReference() {
  const activeStyle = selectedPreset("style")
  const hasImage = Boolean(styleReference && styleReference.src)
  styleCard.classList.toggle("has-image", hasImage)
  styleImage.hidden = !hasImage
  styleRemove.hidden = !hasImage
  if (hasImage) styleImage.src = styleReference.src
  else styleImage.removeAttribute("src")
  stylePlaceholder.hidden = hasImage
  stylePlaceholder.textContent = activeStyle && (activeStyle.prefix || activeStyle.suffix)
    ? String(activeStyle.name || "风格").slice(0, 2)
    : "◇"
  const details = []
  if (activeStyle && (activeStyle.prefix || activeStyle.suffix)) details.push(`预设：${activeStyle.name}`)
  if (styleReference && styleReference.name) details.push(`参考：${styleReference.name}`)
  styleCard.title = details.length
    ? `${details.join("；")}。点击替换风格参考图`
    : "添加风格参考图"
}

function paintReferences() {
  list.textContent = ""
  references.forEach((item, index) => {
    const card = document.createElement("button")
    card.className = "reference has-image"
    card.type = "button"
    card.dataset.index = String(index)
    card.title = `${item.name || `参考图${index + 1}`}，拖动排序，点击写入提示词`
    const image = document.createElement("img")
    image.alt = ""
    image.src = item.src || ""
    card.appendChild(image)
    const label = document.createElement("span")
    label.className = "card-label"
    label.textContent = `参考图${index + 1}`
    card.appendChild(label)
    const remove = document.createElement("span")
    remove.className = "remove"
    remove.setAttribute("role", "button")
    remove.textContent = "×"
    remove.title = "移除参考图"
    remove.addEventListener("pointerdown", (event) => {
      event.preventDefault()
      event.stopPropagation()
    })
    remove.addEventListener("click", (event) => {
      event.preventDefault()
      event.stopPropagation()
      send({ type: "composer-remove-reference", index })
    })
    card.appendChild(remove)
    card.addEventListener("pointerdown", beginReferenceDrag)
    card.addEventListener("click", (event) => {
      if (suppressReferenceClick) {
        event.preventDefault()
        suppressReferenceClick = false
        return
      }
      insertMention(`@参考图${index + 1}`)
    })
    list.appendChild(card)
  })
}

function referenceCards(excludeSource = false) {
  return Array.from(list.querySelectorAll(".reference")).filter((card) => (
    !excludeSource || !card.classList.contains("is-drag-source")
  ))
}

function clampDropIndex(index, length) {
  const value = Number(index)
  return Number.isFinite(value) ? Math.max(0, Math.min(Math.round(value), length)) : length
}

function dropIndexAt(clientX) {
  const previousSlot = list.querySelector(".reference-drop-slot")
  if (previousSlot) previousSlot.remove()
  const cards = referenceCards(true)
  for (let index = 0; index < cards.length; index += 1) {
    const rect = cards[index].getBoundingClientRect()
    if (clientX < rect.left + rect.width / 2) return index
  }
  return cards.length
}

function ensureDropSlot(index) {
  let slot = list.querySelector(".reference-drop-slot")
  if (!slot) {
    slot = document.createElement("span")
    slot.className = "reference-drop-slot"
    slot.setAttribute("aria-hidden", "true")
  }
  const cards = referenceCards(true)
  const target = cards[clampDropIndex(index, cards.length)] || null
  if (target) list.insertBefore(slot, target)
  else list.appendChild(slot)
  return slot
}

function clearDropSlot() {
  const slot = list.querySelector(".reference-drop-slot")
  if (slot) slot.remove()
  externalDropIndex = null
}

function placeDragGhost(event) {
  if (!referenceDrag || !referenceDrag.ghost) return
  referenceDrag.ghost.style.left = `${event.clientX - referenceDrag.offsetX}px`
  referenceDrag.ghost.style.top = `${event.clientY - referenceDrag.offsetY}px`
}

function activateReferenceDrag(event) {
  const drag = referenceDrag
  if (!drag || drag.active) return
  drag.active = true
  suppressReferenceClick = true
  drag.card.classList.add("is-drag-source")
  document.body.classList.add("is-reordering")
  const ghost = drag.card.cloneNode(true)
  ghost.classList.remove("is-drag-source")
  ghost.classList.add("reference-drag-ghost")
  ghost.removeAttribute("id")
  ghost.querySelectorAll("[id]").forEach((node) => node.removeAttribute("id"))
  document.body.appendChild(ghost)
  drag.ghost = ghost
  drag.to = drag.from
  ensureDropSlot(drag.to)
  placeDragGhost(event)
}

function beginReferenceDrag(event) {
  if (event.button !== 0 || (event.target.closest && event.target.closest(".remove"))) return
  const card = event.currentTarget
  const rect = card.getBoundingClientRect()
  referenceDrag = {
    pointerId: event.pointerId,
    card,
    from: Number(card.dataset.index),
    to: Number(card.dataset.index),
    startX: event.clientX,
    startY: event.clientY,
    offsetX: event.clientX - rect.left,
    offsetY: event.clientY - rect.top,
    active: false,
    ghost: null,
  }
  try { card.setPointerCapture(event.pointerId) } catch (_) {}
  window.addEventListener("pointermove", moveReferenceDrag)
  window.addEventListener("pointerup", finishReferenceDrag)
  window.addEventListener("pointercancel", cancelReferenceDrag)
}

function moveReferenceDrag(event) {
  const drag = referenceDrag
  if (!drag || drag.pointerId !== event.pointerId) return
  if (!drag.active && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 4) return
  if (!drag.active) activateReferenceDrag(event)
  event.preventDefault()
  placeDragGhost(event)
  drag.to = dropIndexAt(event.clientX)
  ensureDropSlot(drag.to)
}

function endReferenceDrag(event, commit) {
  const drag = referenceDrag
  if (!drag || (event && drag.pointerId !== event.pointerId)) return
  referenceDrag = null
  window.removeEventListener("pointermove", moveReferenceDrag)
  window.removeEventListener("pointerup", finishReferenceDrag)
  window.removeEventListener("pointercancel", cancelReferenceDrag)
  try { drag.card.releasePointerCapture(drag.pointerId) } catch (_) {}
  drag.card.classList.remove("is-drag-source")
  if (drag.ghost) drag.ghost.remove()
  document.body.classList.remove("is-reordering")
  clearDropSlot()
  if (!commit || !drag.active) return
  setTimeout(() => { suppressReferenceClick = false }, 0)
  const from = clampDropIndex(drag.from, references.length - 1)
  const to = clampDropIndex(drag.to, references.length - 1)
  if (from === to) {
    paintReferences()
    return
  }
  const [item] = references.splice(from, 1)
  references.splice(to, 0, item)
  paintReferences()
  send({ type: "composer-reorder-reference", from, to })
}

function finishReferenceDrag(event) {
  endReferenceDrag(event, true)
}

function cancelReferenceDrag(event) {
  endReferenceDrag(event, false)
}

function beginLayerSourceDrag(event) {
  if (event.button !== 0) return
  const rect = layerSource.getBoundingClientRect()
  layerSourceDrag = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    offsetX: event.clientX - rect.left,
    offsetY: event.clientY - rect.top,
    active: false,
    to: references.length,
    ghost: null,
  }
  try { layerSource.setPointerCapture(event.pointerId) } catch (_) {}
  window.addEventListener("pointermove", moveLayerSourceDrag)
  window.addEventListener("pointerup", finishLayerSourceDrag)
  window.addEventListener("pointercancel", cancelLayerSourceDrag)
}

function moveLayerSourceDrag(event) {
  const drag = layerSourceDrag
  if (!drag || drag.pointerId !== event.pointerId) return
  if (!drag.active && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 4) return
  if (!drag.active) {
    drag.active = true
    suppressLayerSourceClick = true
    document.body.classList.add("is-reordering")
    drag.ghost = layerSource.cloneNode(true)
    drag.ghost.removeAttribute("id")
    drag.ghost.classList.add("reference-drag-ghost")
    document.body.appendChild(drag.ghost)
  }
  event.preventDefault()
  drag.ghost.style.left = `${event.clientX - drag.offsetX}px`
  drag.ghost.style.top = `${event.clientY - drag.offsetY}px`
  const bounds = referenceRow.getBoundingClientRect()
  const inside = event.clientX >= bounds.left && event.clientX <= bounds.right
    && event.clientY >= bounds.top && event.clientY <= bounds.bottom
  if (!inside) {
    clearDropSlot()
    return
  }
  drag.to = dropIndexAt(event.clientX)
  ensureDropSlot(drag.to)
}

function endLayerSourceDrag(event, commit) {
  const drag = layerSourceDrag
  if (!drag || (event && drag.pointerId !== event.pointerId)) return
  layerSourceDrag = null
  window.removeEventListener("pointermove", moveLayerSourceDrag)
  window.removeEventListener("pointerup", finishLayerSourceDrag)
  window.removeEventListener("pointercancel", cancelLayerSourceDrag)
  try { layerSource.releasePointerCapture(drag.pointerId) } catch (_) {}
  if (drag.ghost) drag.ghost.remove()
  document.body.classList.remove("is-reordering")
  clearDropSlot()
  if (!commit || !drag.active) return
  setTimeout(() => { suppressLayerSourceClick = false }, 0)
  const bounds = referenceRow.getBoundingClientRect()
  const inside = event.clientX >= bounds.left && event.clientX <= bounds.right
    && event.clientY >= bounds.top && event.clientY <= bounds.bottom
  if (inside) send({ type: "composer-add-active-layer", index: clampDropIndex(drag.to, references.length) })
}

function finishLayerSourceDrag(event) {
  endLayerSourceDrag(event, true)
}

function cancelLayerSourceDrag(event) {
  endLayerSourceDrag(event, false)
}

function paintPresets() {
  presetStrip.textContent = ""
  selectedTags.forEach((tag) => {
    const chip = document.createElement("button")
    chip.type = "button"
    chip.className = "preset-chip is-selected"
    chip.title = tag.prompt || tag.description || tag.name || ""
    chip.appendChild(document.createTextNode(tag.name || "预设"))
    const remove = document.createElement("span")
    remove.className = "chip-remove"
    remove.textContent = "×"
    chip.appendChild(remove)
    chip.addEventListener("click", () => send({
      type: "composer-clear-preset",
      categoryId: String(tag.kind || ""),
    }))
    presetStrip.appendChild(chip)
  })
  presetStrip.hidden = !presetStrip.childElementCount
}

function mentionMeta(token) {
  if (token === "@画布") return {
    token,
    label: "画布",
    src: canvasReference && canvasReference.src ? canvasReference.src : "",
  }
  if (token === "@风格") return styleReference
    ? { token, label: "风格", src: styleReference.src || "" }
    : null
  const match = /^@(?:参考图|图片)(\d+)$/.exec(token)
  if (!match) return null
  const index = Number(match[1]) - 1
  const item = references[index]
  return item ? { token: `@参考图${index + 1}`, label: `参考图${index + 1}`, src: item.src || "" } : null
}

function createMention(meta) {
  const chip = document.createElement("span")
  chip.className = "mention-keyword"
  chip.contentEditable = "false"
  chip.draggable = true
  chip.dataset.token = meta.token
  if (meta.src) {
    const image = document.createElement("img")
    image.className = "mention-inline-thumb"
    image.alt = ""
    image.draggable = false
    image.src = meta.src
    chip.appendChild(image)
  }
  chip.appendChild(document.createTextNode(meta.token))
  return chip
}

function renderPrompt(value) {
  const text = String(value || "")
  prompt.textContent = ""
  const expression = /@(?:画布|风格|(?:参考图|图片)\d+)/g
  let cursor = 0
  for (const match of text.matchAll(expression)) {
    if (match.index > cursor) prompt.appendChild(document.createTextNode(text.slice(cursor, match.index)))
    const meta = mentionMeta(match[0])
    prompt.appendChild(meta ? createMention(meta) : document.createTextNode(match[0]))
    cursor = match.index + match[0].length
  }
  if (cursor < text.length) prompt.appendChild(document.createTextNode(text.slice(cursor)))
}

function renderPromptPreservingFocus(value) {
  const focused = document.activeElement === prompt
  const offset = focused ? caretOffset() : 0
  renderPrompt(value)
  if (!focused) return
  prompt.focus({ preventScroll: true })
  setCaretOffset(offset)
  rememberPromptFocus()
}

function promptText() {
  let text = ""
  const visit = (node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      text += node.nodeValue || ""
      return
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return
    if (node.dataset && node.dataset.token) {
      text += node.dataset.token
      return
    }
    if (node.tagName === "BR") {
      text += "\n"
      return
    }
    Array.from(node.childNodes).forEach(visit)
    if (node !== prompt && node.tagName === "DIV") text += "\n"
  }
  Array.from(prompt.childNodes).forEach(visit)
  return text.replace(/\u200b/g, "").replace(/\n{3,}/g, "\n\n")
}

function caretOffset() {
  const selection = window.getSelection()
  if (!selection || !selection.rangeCount || !prompt.contains(selection.anchorNode)) return promptText().length
  const range = document.createRange()
  range.selectNodeContents(prompt)
  range.setEnd(selection.anchorNode, selection.anchorOffset)
  return range.toString().replace(/\u200b/g, "").length
}

function setCaretOffset(offset) {
  const selection = window.getSelection()
  if (!selection) return
  const range = document.createRange()
  let remaining = Math.max(0, offset)
  for (const node of Array.from(prompt.childNodes)) {
    const token = node.nodeType === Node.ELEMENT_NODE && node.dataset ? node.dataset.token : ""
    const length = token ? token.length : String(node.textContent || "").length
    if (token && remaining <= length) {
      range.setStartAfter(node)
      range.collapse(true)
      selection.removeAllRanges()
      selection.addRange(range)
      return
    }
    if (!token && node.nodeType === Node.TEXT_NODE && remaining <= length) {
      range.setStart(node, remaining)
      range.collapse(true)
      selection.removeAllRanges()
      selection.addRange(range)
      return
    }
    remaining -= length
  }
  range.selectNodeContents(prompt)
  range.collapse(false)
  selection.removeAllRanges()
  selection.addRange(range)
}

function mentionQuery() {
  const text = promptText()
  const end = caretOffset()
  const match = text.slice(0, end).match(/@([^\s@]*)$/)
  return match ? { start: end - match[0].length, end, query: match[1] } : null
}

function mentionChoices() {
  const choices = [{
    token: "@画布",
    label: "画布",
    src: canvasReference && canvasReference.src ? canvasReference.src : "",
  }]
  if (styleReference) choices.push({ token: "@风格", label: "风格", src: styleReference.src || "" })
  references.forEach((item, index) => choices.push({
    token: `@参考图${index + 1}`,
    label: `参考图${index + 1}`,
    src: item.src || "",
  }))
  return choices
}

function insertMention(token) {
  const now = Date.now()
  if (lastMentionPick && lastMentionPick.token === token && now - lastMentionPick.time < 250) return
  lastMentionPick = { token, time: now }
  const text = promptText()
  const found = mentionQuery()
  const end = found ? found.end : caretOffset()
  const start = found ? found.start : end
  const next = `${text.slice(0, start)}${token} ${text.slice(end)}`
  const nextCaret = start + token.length + 1
  renderPrompt(next)
  prompt.focus()
  setCaretOffset(nextCaret)
  paintMentions()
  send({ type: "composer-prompt", value: next })
}

function paintMentions() {
  if (document.activeElement !== prompt) {
    mentions.textContent = ""
    mentions.hidden = true
    return
  }
  const query = mentionQuery()
  mentions.textContent = ""
  if (!query) {
    mentions.hidden = true
    return
  }
  mentionChoices().forEach((item) => {
    if (query.query && !item.label.includes(query.query)) return
    const option = document.createElement("button")
    option.type = "button"
    if (item.src) {
      const image = document.createElement("img")
      image.alt = ""
      image.src = item.src
      option.appendChild(image)
    }
    option.appendChild(document.createTextNode(item.token))
    option.addEventListener("mousedown", (event) => event.preventDefault())
    option.addEventListener("click", () => insertMention(item.token))
    mentions.appendChild(option)
  })
  mentions.hidden = !mentions.childElementCount
}

async function filesFromDrop(dataTransfer) {
  const candidates = Array.from(dataTransfer?.files || [])
  if (!candidates.length) {
    Array.from(dataTransfer?.items || []).forEach((item) => {
      if (item.kind !== "file" || typeof item.getAsFile !== "function") return
      const file = item.getAsFile()
      if (file) candidates.push(file)
    })
  }
  const images = []
  for (const file of candidates) {
    if (!file.type.startsWith("image/")) continue
    if (file.size > maxDroppedReferenceBytes) {
      throw new Error("超大图片请点击“添加”选择，插件会自动缩放到 2048px")
    }
    if (typeof createImageBitmap !== "function") throw new Error("当前面板无法缩放拖入图片，请点击“添加”选择")
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, maxReferenceEdge / Math.max(bitmap.width, bitmap.height))
    const width = Math.max(1, Math.round(bitmap.width * scale))
    const height = Math.max(1, Math.round(bitmap.height * scale))
    const canvas = document.createElement("canvas")
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext("2d")
    if (!context) {
      if (typeof bitmap.close === "function") bitmap.close()
      throw new Error("无法创建参考图缩放画布")
    }
    context.drawImage(bitmap, 0, 0, width, height)
    if (typeof bitmap.close === "function") bitmap.close()
    const dataUrl = canvas.toDataURL("image/png")
    canvas.width = 0
    canvas.height = 0
    images.push({ name: file.name || "reference.png", dataUrl })
  }
  return images
}

function transferHasImages(dataTransfer) {
  const files = Array.from(dataTransfer?.files || [])
  if (files.some((file) => String(file && file.type || "").startsWith("image/"))) return true
  return Array.from(dataTransfer?.items || []).some((item) => (
    item && item.kind === "file" && String(item.type || "").startsWith("image/")
  ))
}

function previewExternalDrop(event) {
  const target = event.target && event.target.closest ? event.target : null
  const styleDrop = Boolean(target && target.closest("#style-reference"))
  styleCard.classList.toggle("is-drop-target", styleDrop)
  referenceRow.classList.toggle("is-drop-zone", !styleDrop)
  if (styleDrop) {
    clearDropSlot()
    return
  }
  externalDropIndex = dropIndexAt(event.clientX)
  ensureDropSlot(externalDropIndex)
}

function clearExternalDropPreview() {
  clearDropSlot()
  styleCard.classList.remove("is-drop-target")
  referenceRow.classList.remove("is-drop-zone")
}

window.addEventListener("message", (event) => {
  const data = event.data || {}
  if (data.type === "composer-overlay-state") {
    const menu = data.open ? String(data.menu || "") : ""
    modelTrigger.classList.toggle("is-active", menu === "model")
    modeTrigger.classList.toggle("is-active", menu === "mode")
    countTrigger.classList.toggle("is-active", menu === "count")
    presetOpen.classList.toggle("is-active", menu === "preset")
    historyCategoryTrigger.classList.toggle("is-active", menu === "history-category")
    return
  }
  if (data.type === "composer-focus-ready") {
    restorePromptFocus()
    return
  }
  if (data.type === "composer-progress") {
    if (Number(data.protocolVersion) > 0) hostProtocolVersion = Number(data.protocolVersion)
    if (data.progress && typeof data.progress === "object") {
      controls = { ...controls, ...data.progress }
      paintProgressControls()
    }
    return
  }
  if (data.type !== "composer-state") return
  if (Number(data.protocolVersion) > 0) hostProtocolVersion = Number(data.protocolVersion)
  let mentionSourcesChanged = false
  if (Object.prototype.hasOwnProperty.call(data, "references")) {
    references = Array.isArray(data.references) ? data.references : []
    paintReferences()
    mentionSourcesChanged = true
  }
  if (Object.prototype.hasOwnProperty.call(data, "styleReference")) {
    styleReference = data.styleReference && typeof data.styleReference === "object" ? data.styleReference : null
    paintStyleReference()
    mentionSourcesChanged = true
  }
  if (Object.prototype.hasOwnProperty.call(data, "canvasReference")) {
    canvasReference = data.canvasReference && typeof data.canvasReference === "object" ? data.canvasReference : null
    paintCanvasReference()
    mentionSourcesChanged = true
  }
  if (data.presetLibrary && typeof data.presetLibrary === "object") presetLibrary = data.presetLibrary
  if (data.selectedPresets && typeof data.selectedPresets === "object") selectedPresets = data.selectedPresets
  if (Object.prototype.hasOwnProperty.call(data, "selectedTags")) {
    selectedTags = Array.isArray(data.selectedTags) ? data.selectedTags : []
    paintPresets()
    paintStyleReference()
  }
  const currentPrompt = promptText()
  const incomingPrompt = typeof data.prompt === "string" ? data.prompt : currentPrompt
  const promptChanged = incomingPrompt !== currentPrompt
  if (mentionSourcesChanged || (promptChanged && document.activeElement !== prompt)) {
    renderPromptPreservingFocus(incomingPrompt)
    paintMentions()
  }
  if (data.controls && typeof data.controls === "object") {
    controls = { ...controls, ...data.controls }
    paintControls()
  }
})

prompt.addEventListener("input", () => {
  paintMentions()
  if (!promptComposing) queuePromptSync()
})
prompt.addEventListener("compositionstart", () => { promptComposing = true })
prompt.addEventListener("compositionend", () => {
  promptComposing = false
  queuePromptSync(true)
})
prompt.addEventListener("blur", () => queuePromptSync(true))
prompt.addEventListener("focus", requestHostPromptFocus)
prompt.addEventListener("pointerup", requestHostPromptFocus)
prompt.addEventListener("mouseup", requestHostPromptFocus)
prompt.addEventListener("click", paintMentions)
prompt.addEventListener("keyup", paintMentions)
prompt.addEventListener("keydown", (event) => {
  if (event.key === "Escape") mentions.hidden = true
})
prompt.addEventListener("paste", async (event) => {
  const clipboard = event.clipboardData
  if (transferHasImages(clipboard)) {
    event.preventDefault()
    const available = Math.max(0, 6 - references.length - (styleReference ? 1 : 0))
    if (!available) {
      send({ type: "composer-error", message: "风格和参考图合计最多 6 张" })
      return
    }
    referenceRow.classList.add("is-drop-zone")
    try {
      const images = (await filesFromDrop(clipboard)).slice(0, available)
      if (!images.length) throw new Error("剪贴板里没有可用的图片")
      const stamp = Date.now()
      images.forEach((item, index) => {
        if (!item.name || item.name === "reference.png" || item.name === "image.png") {
          item.name = `clipboard-${stamp}${images.length > 1 ? `-${index + 1}` : ""}.png`
        }
      })
      send({ type: "composer-add-files", files: images, index: references.length })
    } catch (error) {
      send({ type: "composer-error", message: error && error.message ? error.message : "无法读取剪贴板图片" })
    } finally {
      referenceRow.classList.remove("is-drop-zone")
    }
    return
  }
  const text = clipboard && clipboard.getData("text/plain")
  if (!text) return
  event.preventDefault()
  document.execCommand("insertText", false, text)
})

window.addEventListener("focus", () => {
  if (document.activeElement === prompt) restorePromptFocus()
})

window.addEventListener("resize", () => {
  progressGeometry = null
  refreshComposerProgressGeometry()
  paintComposerProgress()
})

document.getElementById("add").addEventListener("click", () => send({ type: "composer-pick-reference" }))
document.getElementById("canvas").addEventListener("click", () => insertMention("@画布"))
layerSource.addEventListener("pointerdown", beginLayerSourceDrag)
layerSource.addEventListener("click", (event) => {
  if (suppressLayerSourceClick) {
    event.preventDefault()
    suppressLayerSourceClick = false
    return
  }
  send({ type: "composer-add-active-layer", index: references.length })
})
styleCard.addEventListener("click", () => send({ type: "composer-pick-style-reference" }))
styleRemove.addEventListener("mousedown", (event) => event.preventDefault())
styleRemove.addEventListener("click", (event) => {
  event.preventDefault()
  event.stopPropagation()
  send({ type: "composer-remove-style-reference" })
})

modelTrigger.addEventListener("click", (event) => {
  event.stopPropagation()
  requestSurfaceMenu("model")
})
modeTrigger.addEventListener("click", (event) => {
  event.stopPropagation()
  requestSurfaceMenu("mode")
})
countTrigger.addEventListener("click", (event) => {
  event.stopPropagation()
  requestSurfaceMenu("count")
})
cropToggle.addEventListener("click", () => send({ type: "composer-toggle-crop" }))
presetOpen.addEventListener("click", (event) => {
  event.stopPropagation()
  requestSurfaceMenu("preset")
})
historyCategoryTrigger.addEventListener("click", (event) => {
  event.stopPropagation()
  requestSurfaceMenu("history-category")
})
renderButton.addEventListener("click", () => send({ type: "composer-render" }))
renderButton.addEventListener("contextmenu", (event) => {
  event.preventDefault()
  send({ type: "composer-render-random" })
})
window.addEventListener("dragenter", (event) => {
  event.preventDefault()
  dragDepth += 1
  document.body.classList.add("is-dragging")
})
window.addEventListener("dragover", (event) => {
  event.preventDefault()
  if (event.dataTransfer) event.dataTransfer.dropEffect = "copy"
  previewExternalDrop(event)
})
window.addEventListener("dragleave", () => {
  dragDepth = Math.max(0, dragDepth - 1)
  if (!dragDepth) {
    document.body.classList.remove("is-dragging")
    clearExternalDropPreview()
  }
})
window.addEventListener("drop", async (event) => {
  event.preventDefault()
  const insertIndex = externalDropIndex
  const styleDrop = Boolean(event.target && event.target.closest && event.target.closest("#style-reference"))
  dragDepth = 0
  document.body.classList.remove("is-dragging")
  clearExternalDropPreview()
  try {
    const images = await filesFromDrop(event.dataTransfer)
    if (images.length) {
      send({
        type: styleDrop ? "composer-add-style-files" : "composer-add-files",
        files: images,
        index: insertIndex,
      })
    } else {
      send({
        type: styleDrop ? "composer-add-active-layer-style" : "composer-add-active-layer",
        index: insertIndex,
      })
    }
  } catch (error) {
    send({ type: "composer-error", message: error && error.message ? error.message : "无法读取拖入图片" })
  }
})
window.addEventListener("dragend", () => {
  dragDepth = 0
  document.body.classList.remove("is-dragging")
  clearExternalDropPreview()
})

send({ type: "composer-ready" })
watchComposerFiles()
setInterval(watchComposerFiles, 4000)
