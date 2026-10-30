function loadModule(name) {
  try {
    return require(name)
  } catch (_) {
    return {}
  }
}

const { action, app, core, imaging, constants } = loadModule("photoshop")
const { storage } = loadModule("uxp")

const DEFAULT_SERVER = "http://127.0.0.1:8188"
const WEB_PANEL_ID = "com.comfytv.photoshop.web"
const EMBEDDED_COMFY = "http://localhost:8188"
const STORE_PREFIX = "comfytv.uxp."
const PLUGIN_VERSION = "0.2.2"
const clientId = `comfytv-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`

let socket = null
let reconnectTimer = null
let modelPullTimer = null
let modelListSynced = false
let toastTimer = null
let latestRenderFile = null
let capturePreviewFile = null
let lastCaptureBounds = null
let lastSentFrame = null
let lastDocumentPpi = 72
let renderCount = 0
let renderHistory = []
let selectedHistoryIndex = 0
let historyPage = 0
const HISTORY_PAGE_SIZE = 8
const HISTORY_WARN_COUNT = 380
const HISTORY_KEEP_MS = 7 * 24 * 60 * 60 * 1000
let watchTimer = null
let liveTimer = null
let lastHistoryMarker = null
let lastSelectionKey = null
let suppressWatchUntil = 0

function element(id) {
  return document.getElementById(id)
}

const SERVER_PORTS = [8188, 8189, 8190, 8000, 3000]

function normalizeServer(value) {
  const server = String(value || "").trim().replace(/\/$/, "")
  const match = /^http:\/\/(127\.0\.0\.1|localhost):(\d+)$/i.exec(server)
  const port = match ? Number(match[2]) : 0
  if (!match || SERVER_PORTS.indexOf(port) < 0) {
    throw new Error("只允许本机端口 8188、8189、8190、8000、3000")
  }
  // UXP 的域名白名单不认 127.0.0.1 这种 IP，请求会被报成 Manifest entry not found。
  // localhost 和它是同一台机器、同一个端口。
  return `http://localhost:${port}`
}

function serverAddress() {
  return normalizeServer(element("server").value)
}

function socketAddress() {
  return serverAddress().replace(/^http:/i, "ws:")
}

function setConnection(message, state = "") {
  const target = element("connection-state")
  target.textContent = message
  target.className = `connection-state${state ? ` ${state}` : ""}`
}

function setProgress(message) {
  element("progress-label").textContent = message
}

const MARQUEE_THICK = 4
const MARQUEE_HEAD = 28
let marqueePercent = 0
let marqueeOffset = 0
let marqueeTimer = 0
let marqueeHideTimer = 0

function setEdge(id, size, along) {
  const edge = element(id)
  if (along === "height") {
    edge.style.width = MARQUEE_THICK + "px"
    edge.style.height = Math.max(0, size) + "px"
    return
  }
  edge.style.height = MARQUEE_THICK + "px"
  edge.style.width = Math.max(0, size) + "px"
}

function placeMarqueeHead(distance, width, height) {
  const head = element("pf-head")
  const tip = Math.max(0, distance)
  const span = Math.min(MARQUEE_HEAD, tip)
  if (span < 2) {
    head.style.display = "none"
    return
  }
  head.style.display = "block"
  head.style.right = "auto"
  head.style.bottom = "auto"
  if (tip <= width) {
    head.style.left = Math.max(0, tip - span) + "px"
    head.style.top = "0px"
    head.style.width = span + "px"
    head.style.height = MARQUEE_THICK + "px"
    return
  }
  let rest = tip - width
  if (rest <= height) {
    head.style.left = (width - MARQUEE_THICK) + "px"
    head.style.top = Math.max(0, rest - span) + "px"
    head.style.width = MARQUEE_THICK + "px"
    head.style.height = span + "px"
    return
  }
  rest -= height
  if (rest <= width) {
    head.style.left = (width - rest) + "px"
    head.style.top = (height - MARQUEE_THICK) + "px"
    head.style.width = span + "px"
    head.style.height = MARQUEE_THICK + "px"
    return
  }
  rest -= width
  head.style.left = "0px"
  head.style.top = (height - rest) + "px"
  head.style.width = MARQUEE_THICK + "px"
  head.style.height = span + "px"
}

function paintMarquee() {
  const frame = element("progress-frame")
  const width = frame.clientWidth
  const height = frame.clientHeight
  if (width < 8 || height < 8) return
  const perimeter = 2 * (width + height)
  const lit = perimeter * (Math.max(0, Math.min(100, marqueePercent)) / 100)
  setEdge("pf-top", Math.min(lit, width), "width")
  setEdge("pf-right", Math.min(Math.max(lit - width, 0), height), "height")
  setEdge("pf-bottom", Math.min(Math.max(lit - width - height, 0), width), "width")
  setEdge("pf-left", Math.min(Math.max(lit - width - height - width, 0), height), "height")
  const travel = lit > MARQUEE_HEAD ? (marqueeOffset % Math.max(1, lit - MARQUEE_HEAD)) + MARQUEE_HEAD : lit
  placeMarqueeHead(travel, width, height)
}

function ensureMarqueeClock() {
  if (marqueeTimer) return
  marqueeTimer = setInterval(() => {
    marqueeOffset += 10
    paintMarquee()
  }, 40)
}

function setMarquee(percent, running) {
  clearTimeout(marqueeHideTimer)
  const frame = element("progress-frame")
  if (!running) {
    frame.classList.remove("active")
    clearInterval(marqueeTimer)
    marqueeTimer = 0
    return
  }
  marqueePercent = Math.max(0, Math.min(100, Number(percent) || 0))
  frame.classList.add("active")
  paintMarquee()
  ensureMarqueeClock()
}

function finishMarquee() {
  setMarquee(100, true)
  marqueeHideTimer = setTimeout(() => setMarquee(0, false), 500)
}

function showStatus(message, isError = false) {
  const target = element("status-toast")
  target.textContent = message
  target.className = `status-toast${isError ? " error" : ""}`
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => target.classList.add("hidden"), isError ? 6500 : 3500)
}

function setBusy(busy) {
  element("render").disabled = busy
  element("send-layer").disabled = busy
  const wrap = document.querySelector(".generate-wrap")
  if (wrap) wrap.classList.toggle("is-disabled", busy)
  if (busy) setConnection("读取图像", "busy")
  else if (socket?.readyState === WebSocket.OPEN) setConnection("已连接", "connected")
  else setConnection("未连接", "error")
}

const BATCH_MAX = 8
let batchRunning = false
let batchStop = false
let renderDone = null

function batchCount() {
  const value = Number.parseInt(element("batch-count").value, 10)
  if (!Number.isFinite(value)) return 1
  return Math.max(1, Math.min(BATCH_MAX, value))
}

function setRenderLabel(text) {
  const button = element("render")
  const stopping = text === "停止"
  button.title = stopping ? "停止后面的生成" : "开始生成。右键会先换一个随机种子。生成过程中再点一次，停掉后面的。"
  button.classList.toggle("is-stop", stopping)
}

function settleRender(error) {
  const pending = renderDone
  renderDone = null
  if (!pending) return
  if (error) pending.reject(error)
  else pending.resolve()
}

function armRenderWait() {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (renderDone && renderDone.reject === reject) {
        renderDone = null
        reject(new Error("这一张等待超时"))
      }
    }, 8 * 60 * 1000)
    renderDone = {
      resolve: () => {
        clearTimeout(timer)
        resolve()
      },
      reject: (error) => {
        clearTimeout(timer)
        reject(error)
      },
    }
  })
}

function plainBounds(bounds) {
  if (!bounds) return null
  const value = {
    left: Math.floor(Number(bounds.left)),
    top: Math.floor(Number(bounds.top)),
    right: Math.ceil(Number(bounds.right)),
    bottom: Math.ceil(Number(bounds.bottom)),
  }
  if (!Object.values(value).every(Number.isFinite)) return null
  if (value.right <= value.left || value.bottom <= value.top) return null
  return value
}

async function activeSelection(document) {
  try {
    return plainBounds(await document.selection.bounds)
  } catch (_) {
    return null
  }
}

function fullDocumentBounds(document) {
  const width = Math.max(1, Math.round(Number(document.width)))
  const height = Math.max(1, Math.round(Number(document.height)))
  return { left: 0, top: 0, right: width, bottom: height }
}

function padPercent() {
  const number = Number.parseFloat(element("crop-pad").value)
  if (!Number.isFinite(number)) return 32
  return Math.max(0, Math.min(200, number))
}

function expandSelectionBounds(bounds, limit, percent) {
  const next = clampBounds(bounds, limit)
  if (!next || !limit || percent <= 0) return next
  const docWidth = limit.right - limit.left
  const docHeight = limit.bottom - limit.top
  const width = next.right - next.left
  const height = next.bottom - next.top
  const padX = percent / 100 * width
  const padY = padX / (width / height)
  let newWidth = width + padX * 2
  let newHeight = height + padY * 2
  if (newWidth > docWidth) {
    const scale = docWidth / newWidth
    newWidth = docWidth
    newHeight *= scale
  }
  if (newHeight > docHeight) {
    const scale = docHeight / newHeight
    newHeight = docHeight
    newWidth *= scale
  }
  let left = next.left - (newWidth - width) / 2
  let top = next.top - (newHeight - height) / 2
  let right = left + newWidth
  let bottom = top + newHeight
  if (left < limit.left) {
    left = limit.left
    right = left + newWidth
  } else if (right > limit.right) {
    right = limit.right
    left = right - newWidth
  }
  if (top < limit.top) {
    top = limit.top
    bottom = top + newHeight
  } else if (bottom > limit.bottom) {
    bottom = limit.bottom
    top = bottom - newHeight
  }
  return clampBounds({ left, top, right, bottom }, limit) || next
}

function clampBounds(bounds, limit) {
  const next = plainBounds(bounds)
  if (!next || !limit) return next
  const value = {
    left: Math.max(limit.left, next.left),
    top: Math.max(limit.top, next.top),
    right: Math.min(limit.right, next.right),
    bottom: Math.min(limit.bottom, next.bottom),
  }
  if (value.right <= value.left || value.bottom <= value.top) return null
  return value
}

const GPT_MIN_PIXELS = 655360
const GPT_MAX_PIXELS = 8294400
const GPT_MAX_EDGE = 3840
const GPT_MIN_EDGE = 480
const GPT_MAX_RATIO = 3
const GPT_STEP = 16

function edgeLimit(value, fallback) {
  const number = Number.parseInt(value, 10)
  if (!Number.isFinite(number)) return fallback
  return Math.max(GPT_STEP, Math.min(GPT_MAX_EDGE, number))
}

function snapStep(value) {
  return Math.max(GPT_STEP, Math.round(value / GPT_STEP) * GPT_STEP)
}

function fitGptImageSize(width, height) {
  let w = Math.max(1, width)
  let h = Math.max(1, height)
  if (w / h > GPT_MAX_RATIO) w = h * GPT_MAX_RATIO
  else if (h / w > GPT_MAX_RATIO) h = w * GPT_MAX_RATIO

  let scale = 1
  if (Math.max(w, h) > GPT_MAX_EDGE) scale = Math.min(scale, GPT_MAX_EDGE / Math.max(w, h))
  if (w * h > GPT_MAX_PIXELS) scale = Math.min(scale, Math.sqrt(GPT_MAX_PIXELS / (w * h)))
  if (w * h * scale * scale < GPT_MIN_PIXELS) scale = Math.max(scale, Math.sqrt(GPT_MIN_PIXELS / (w * h)))
  if (Math.min(w, h) * scale < GPT_MIN_EDGE) scale = Math.max(scale, GPT_MIN_EDGE / Math.min(w, h))
  if (Math.max(w, h) * scale > GPT_MAX_EDGE) scale = Math.min(scale, GPT_MAX_EDGE / Math.max(w, h))
  w *= scale
  h *= scale

  // 只把长边收到 16 的倍数，短边按原比例再收一次。两边一起变，比例不会被拉扁。
  const aspect = w / h
  let snappedW = snapStep(Math.min(GPT_MAX_EDGE, w))
  let snappedH = snapStep(snappedW / aspect)
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const pixels = snappedW * snappedH
    const edge = Math.max(snappedW, snappedH)
    const shortEdge = Math.min(snappedW, snappedH)
    if (pixels < GPT_MIN_PIXELS || shortEdge < GPT_MIN_EDGE) {
      const grow = Math.max(Math.sqrt(GPT_MIN_PIXELS / pixels), GPT_MIN_EDGE / shortEdge)
      snappedW = snapStep(snappedW * grow)
      snappedH = snapStep(snappedW / aspect)
      continue
    }
    if (pixels > GPT_MAX_PIXELS || edge > GPT_MAX_EDGE || edge / shortEdge > GPT_MAX_RATIO + 1e-6) {
      const shrink = Math.min(Math.sqrt(GPT_MAX_PIXELS / pixels), GPT_MAX_EDGE / edge)
      snappedW = snapStep(Math.max(GPT_STEP, snappedW * shrink))
      snappedH = snapStep(snappedW / aspect)
      continue
    }
    break
  }
  return {
    width: Math.max(GPT_STEP, Math.min(GPT_MAX_EDGE, snappedW)),
    height: Math.max(GPT_STEP, Math.min(GPT_MAX_EDGE, snappedH)),
  }
}

function placeWindow(originStart, originSize, targetSize, containerStart, containerEnd, coverStart, coverEnd) {
  let start = Math.round(originStart + (originSize - targetSize) / 2)
  if (coverEnd - coverStart <= targetSize) {
    if (start > coverStart) start = coverStart
    if (start + targetSize < coverEnd) start = coverEnd - targetSize
  }
  if (start < containerStart) start = containerStart
  if (start + targetSize > containerEnd) start = containerEnd - targetSize
  return start
}

// 对齐 16 的倍数时不缩放像素。开了外扩就从外扩范围里裁；没开就向文档外面多取一圈。
function alignBoundsToStep(bounds, limit, shrink, cover) {
  const next = clampBounds(bounds, limit)
  if (!next || !limit) return next
  const width = next.right - next.left
  const height = next.bottom - next.top
  const docW = limit.right - limit.left
  const docH = limit.bottom - limit.top
  let targetW = shrink ? Math.floor(width / GPT_STEP) * GPT_STEP : Math.ceil(width / GPT_STEP) * GPT_STEP
  let targetH = shrink ? Math.floor(height / GPT_STEP) * GPT_STEP : Math.ceil(height / GPT_STEP) * GPT_STEP
  targetW = Math.max(GPT_STEP, targetW)
  targetH = Math.max(GPT_STEP, targetH)
  if (targetW > docW) targetW = Math.floor(docW / GPT_STEP) * GPT_STEP
  if (targetH > docH) targetH = Math.floor(docH / GPT_STEP) * GPT_STEP
  if (targetW < GPT_STEP || targetH < GPT_STEP) return next

  const container = shrink ? next : limit
  const inner = cover || next
  const left = placeWindow(next.left, width, targetW, container.left, container.right, inner.left, inner.right)
  const top = placeWindow(next.top, height, targetH, container.top, container.bottom, inner.top, inner.bottom)
  if (left < limit.left || top < limit.top || left + targetW > limit.right || top + targetH > limit.bottom) return next
  if (shrink && (left < next.left || top < next.top || left + targetW > next.right || top + targetH > next.bottom)) return next
  return { left, top, right: left + targetW, bottom: top + targetH }
}

function overMaxFrame(width, height) {
  let maxRes = edgeLimit(element("max-res").value, 1024)
  let minRes = edgeLimit(element("min-res").value, 512)
  if (minRes > maxRes) minRes = maxRes
  const longest = Math.max(width, height)
  const shortest = Math.min(width, height)
  const ratio = longest / Math.max(1, shortest)
  const userOk = longest <= maxRes && shortest >= minRes
  const hardOk = width <= GPT_MAX_EDGE && height <= GPT_MAX_EDGE && width * height <= GPT_MAX_PIXELS
    && shortest >= GPT_MIN_EDGE && width * height >= GPT_MIN_PIXELS && ratio <= GPT_MAX_RATIO + 1e-6
  if (userOk && hardOk) return null
  const fitted = captureSize({ left: 0, top: 0, right: width, bottom: height })
  if (!fitted || (fitted.width === width && fitted.height === height)) return null
  return {
    width: fitted.width,
    height: fitted.height,
    padLeft: 0,
    padTop: 0,
    contentWidth: width,
    contentHeight: height,
    resample: true,
  }
}

function sentPlaceBounds() {
  const bounds = lastCaptureBounds
  const frame = lastSentFrame
  if (!bounds) return null
  if (!frame || frame.resample) return bounds
  return {
    left: bounds.left - frame.padLeft,
    top: bounds.top - frame.padTop,
    right: bounds.left - frame.padLeft + frame.width,
    bottom: bounds.top - frame.padTop + frame.height,
  }
}

function captureSize(bounds) {
  const sourceWidth = Math.max(1, bounds.right - bounds.left)
  const sourceHeight = Math.max(1, bounds.bottom - bounds.top)
  let maxRes = edgeLimit(element("max-res").value, 1024)
  let minRes = edgeLimit(element("min-res").value, 512)
  if (minRes > maxRes) minRes = maxRes

  // 先把宽收进上下限，高度按比例跟着走，再反过来收高。
  const ratio = sourceWidth / sourceHeight
  let width = Math.min(Math.max(sourceWidth, minRes), maxRes)
  let height = width / ratio
  if (height > maxRes) {
    height = maxRes
    width = height * ratio
  } else if (height < minRes) {
    height = minRes
    width = height * ratio
  }
  return fitGptImageSize(width, height)
}

async function encodePixels(options, frame) {
  let result
  try {
    // 不调用 applyAlpha，避免把透明乘进颜色。透明通道单独写进 PNG。
    // Photoshop 2024 的 encodeImageData 遇到透明通道会报 jpeg 错误，所以自己写 PNG。
    result = await imaging.getPixels({ ...options, applyAlpha: false })
    const width = result.imageData.width
    const height = result.imageData.height
    const encoded = await rgbPngFromImageData(result.imageData, frame, frame?.fill || "edge", frame?.opaque === true)
    const imageBase64 = normalizeBase64(encoded)
    if (!imageBase64) throw new Error("Photoshop 没有返回可用图像")
    return { encoded: imageBase64, sourceBounds: plainBounds(result.sourceBounds), width, height }
  } finally {
    if (result?.imageData) result.imageData.dispose()
  }
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1)
    table[n] = c >>> 0
  }
  return table
})()

function crc32(bytes) {
  let c = 0xffffffff
  for (let i = 0; i < bytes.length; i += 1) c = CRC_TABLE[(c ^ bytes[i]) & 255] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function concatBytes(parts) {
  let length = 0
  for (let i = 0; i < parts.length; i += 1) length += parts[i].length
  const out = new Uint8Array(length)
  let offset = 0
  for (let i = 0; i < parts.length; i += 1) {
    out.set(parts[i], offset)
    offset += parts[i].length
  }
  return out
}

function pngChunk(type, data) {
  const name = new Uint8Array(4)
  for (let i = 0; i < 4; i += 1) name[i] = type.charCodeAt(i)
  const body = concatBytes([name, data])
  const crc = crc32(body)
  const head = new Uint8Array(4)
  const length = data.length
  head[0] = (length >>> 24) & 255
  head[1] = (length >>> 16) & 255
  head[2] = (length >>> 8) & 255
  head[3] = length & 255
  const tail = new Uint8Array([(crc >>> 24) & 255, (crc >>> 16) & 255, (crc >>> 8) & 255, crc & 255])
  return concatBytes([head, body, tail])
}

function adler32(data) {
  let a = 1
  let b = 0
  for (let i = 0; i < data.length; i += 1) {
    a = (a + data[i]) % 65521
    b = (b + a) % 65521
  }
  return ((b << 16) | a) >>> 0
}

const LENGTH_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258]
const LENGTH_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0]
const DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577]
const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13]

function reverseBits(code, bits) {
  let out = 0
  for (let index = 0; index < bits; index += 1) out = (out << 1) | ((code >>> index) & 1)
  return out
}

function fixedLiteral(value) {
  if (value <= 143) return { code: reverseBits(0x30 + value, 8), bits: 8 }
  if (value <= 255) return { code: reverseBits(0x190 + (value - 144), 9), bits: 9 }
  if (value <= 279) return { code: reverseBits(value - 256, 7), bits: 7 }
  return { code: reverseBits(0xc0 + (value - 280), 8), bits: 8 }
}

function lengthSymbol(length) {
  for (let index = LENGTH_BASE.length - 1; index >= 0; index -= 1) {
    if (length >= LENGTH_BASE[index]) {
      return { symbol: 257 + index, extra: length - LENGTH_BASE[index], extraBits: LENGTH_EXTRA[index] }
    }
  }
  return { symbol: 257, extra: 0, extraBits: 0 }
}

function distanceSymbol(distance) {
  for (let index = DIST_BASE.length - 1; index >= 0; index -= 1) {
    if (distance >= DIST_BASE[index]) {
      return { symbol: index, extra: distance - DIST_BASE[index], extraBits: DIST_EXTRA[index] }
    }
  }
  return { symbol: 0, extra: 0, extraBits: 0 }
}

function deflateRaw(data) {
  const writer = { bytes: [], acc: 0, count: 0 }
  const write = (code, bits) => {
    while (writer.count > 20) {
      writer.bytes.push(writer.acc & 255)
      writer.acc >>>= 8
      writer.count -= 8
    }
    writer.acc |= (code & ((1 << bits) - 1)) << writer.count
    writer.count += bits
    while (writer.count >= 8) {
      writer.bytes.push(writer.acc & 255)
      writer.acc >>>= 8
      writer.count -= 8
    }
  }
  const emitLiteral = (value) => {
    const code = fixedLiteral(value)
    write(code.code, code.bits)
  }
  const emitMatch = (length, distance) => {
    const codedLength = lengthSymbol(length)
    const lengthCode = fixedLiteral(codedLength.symbol)
    write(lengthCode.code, lengthCode.bits)
    if (codedLength.extraBits) write(codedLength.extra, codedLength.extraBits)
    const codedDistance = distanceSymbol(distance)
    write(reverseBits(codedDistance.symbol, 5), 5)
    if (codedDistance.extraBits) write(codedDistance.extra, codedDistance.extraBits)
  }

  write(1, 1)
  write(1, 2)
  const hashBits = 15
  const hashMask = (1 << hashBits) - 1
  const head = new Int32Array(1 << hashBits)
  const prev = new Int32Array(data.length)
  head.fill(-1)
  let position = 0
  while (position < data.length) {
    let bestLength = 0
    let bestDistance = 0
    if (position + 2 < data.length) {
      const hash = ((data[position] << 10) ^ (data[position + 1] << 5) ^ data[position + 2]) & hashMask
      let candidate = head[hash]
      prev[position] = candidate
      head[hash] = position
      let chain = 0
      while (candidate >= 0 && position - candidate <= 32768 && chain < 24) {
        if (data[candidate] === data[position] && data[candidate + 1] === data[position + 1] && data[candidate + 2] === data[position + 2]) {
          let length = 3
          const limit = Math.min(258, data.length - position)
          while (length < limit && data[candidate + length] === data[position + length]) length += 1
          if (length > bestLength) {
            bestLength = length
            bestDistance = position - candidate
            if (length === limit) break
          }
        }
        candidate = prev[candidate]
        chain += 1
      }
    }
    if (bestLength >= 3) {
      emitMatch(bestLength, bestDistance)
      const end = position + bestLength
      position += 1
      while (position < end && position + 2 < data.length) {
        const hash = ((data[position] << 10) ^ (data[position + 1] << 5) ^ data[position + 2]) & hashMask
        prev[position] = head[hash]
        head[hash] = position
        position += 1
      }
      position = end
    } else {
      emitLiteral(data[position])
      position += 1
    }
  }
  emitLiteral(256)
  if (writer.count > 0) writer.bytes.push(writer.acc & 255)
  return new Uint8Array(writer.bytes)
}

function zlibWrap(data, payload) {
  const sum = adler32(data)
  return concatBytes([
    new Uint8Array([0x78, 0x01]),
    payload,
    new Uint8Array([(sum >>> 24) & 255, (sum >>> 16) & 255, (sum >>> 8) & 255, sum & 255]),
  ])
}

function zlibStore(data) {
  const parts = []
  let offset = 0
  while (offset < data.length) {
    const size = Math.min(65535, data.length - offset)
    const last = offset + size >= data.length
    const header = new Uint8Array(5)
    header[0] = last ? 1 : 0
    header[1] = size & 255
    header[2] = (size >>> 8) & 255
    const nlen = (~size) & 0xffff
    header[3] = nlen & 255
    header[4] = (nlen >>> 8) & 255
    parts.push(header, data.subarray(offset, offset + size))
    offset += size
  }
  const stored = concatBytes(parts)
  return zlibWrap(data, stored)
}

function zlibCompress(data) {
  const compressed = deflateRaw(data)
  const wrapped = zlibWrap(data, compressed)
  if (wrapped.length >= data.length + 16) return zlibStore(data)
  return wrapped
}

function bytesToBase64(bytes) {
  let binary = ""
  const chunk = 8192
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + chunk, bytes.length)))
  }
  return btoa(binary)
}

function buildRgbRaw(data, width, height, step, frame, fill, channels) {
  const count = channels === 4 ? 4 : 3
  const dstW = frame?.width || width
  const dstH = frame?.height || height
  const padLeft = frame?.padLeft || 0
  const padTop = frame?.padTop || 0
  const stride = 1 + dstW * count
  const raw = new Uint8Array(stride * dstH)
  for (let y = 0; y < dstH; y += 1) {
    const row = y * stride
    for (let x = 0; x < dstW; x += 1) {
      const to = row + 1 + x * count
      let sx = x - padLeft
      let sy = y - padTop
      const inside = sx >= 0 && sy >= 0 && sx < width && sy < height
      if (!inside && fill === "black") {
        if (count === 4) raw[to + 3] = 255
        continue
      }
      if (!inside) {
        sx = Math.max(0, Math.min(width - 1, sx))
        sy = Math.max(0, Math.min(height - 1, sy))
      }
      const from = (sy * width + sx) * step
      if (step === 1) {
        raw[to] = data[from]
        raw[to + 1] = data[from]
        raw[to + 2] = data[from]
      } else {
        raw[to] = data[from]
        raw[to + 1] = data[from + 1]
        raw[to + 2] = data[from + 2]
      }
      if (count === 4) raw[to + 3] = step >= 4 ? data[from + 3] : 255
    }
  }
  return raw
}

async function rgbPngFromImageData(imageData, frame, fill, opaque) {
  const width = imageData.width
  const height = imageData.height
  const data = await imageData.getData({ chunky: true })
  let step = imageData.components
  if (!step) {
    if (data.length === width * height * 4) step = 4
    else if (data.length === width * height * 3) step = 3
    else step = 1
  }
  const channels = !opaque && step === 4 ? 4 : 3
  const padded = frame && (frame.width !== width || frame.height !== height)
  const raw = buildRgbRaw(data, width, height, step, padded ? frame : null, fill || "edge", channels)
  return rgbPngBase64(padded ? frame.width : width, padded ? frame.height : height, raw, channels)
}

function rgbPngBase64(width, height, raw, channels) {
  const ihdr = new Uint8Array(13)
  ihdr[0] = (width >>> 24) & 255
  ihdr[1] = (width >>> 16) & 255
  ihdr[2] = (width >>> 8) & 255
  ihdr[3] = width & 255
  ihdr[4] = (height >>> 24) & 255
  ihdr[5] = (height >>> 16) & 255
  ihdr[6] = (height >>> 8) & 255
  ihdr[7] = height & 255
  ihdr[8] = 8
  ihdr[9] = channels === 4 ? 6 : 2
  const png = concatBytes([
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", zlibCompress(raw)),
    pngChunk("IEND", new Uint8Array(0)),
  ])
  return bytesToBase64(png)
}

function solidWhitePng(width, height) {
  const stride = 1 + width * 3
  const raw = new Uint8Array(stride * height)
  const row = new Uint8Array(stride)
  row.fill(255)
  row[0] = 0
  for (let y = 0; y < height; y += 1) raw.set(row, y * stride)
  return rgbPngBase64(width, height, raw)
}

function selectionCommand(to) {
  return {
    _obj: "set",
    _target: [{ _ref: "channel", _property: "selection" }],
    to,
    _options: { dialogOptions: "dontDisplay" },
  }
}

function fillCommand(color) {
  return {
    _obj: "fill",
    using: { _enum: "fillContents", _value: color },
    opacity: { _unit: "percentUnit", _value: 100 },
    mode: { _enum: "blendMode", _value: "normal" },
    _options: { dialogOptions: "dontDisplay" },
  }
}

async function encodeSelectionMask(document, sourceBounds, frame, selection) {
  const size = { width: frame.width, height: frame.height }
  if (!selection) return solidWhitePng(size.width, size.height)

  // 只在选区里填白会留下透明像素，编码时触发 alpha/jpeg 报错，位置也不对。
  // 先铺满不透明黑，再把选区填白，按和画布相同的范围取样，然后收回历史。
  const history = document.activeHistoryState
  try {
    await action.batchPlay([
      {
        _obj: "duplicate",
        _target: [{ _ref: "channel", _property: "selection" }],
        name: "ComfyTVSel",
        _options: { dialogOptions: "dontDisplay" },
      },
      selectionCommand({ _enum: "ordinal", _value: "none" }),
      {
        _obj: "make",
        _target: [{ _ref: "layer" }],
        using: { _obj: "layer", name: "ComfyTV Mask" },
        _options: { dialogOptions: "dontDisplay" },
      },
      fillCommand("black"),
      selectionCommand({ _ref: "channel", _name: "ComfyTVSel" }),
      fillCommand("white"),
    ], { modalBehavior: "execute" })
    const layer = document.activeLayers[0]
    if (!layer) return solidWhitePng(size.width, size.height)
    const pixelOptions = {
      documentID: document.id,
      layerID: layer.id,
      sourceBounds,
      componentSize: 8,
      colorSpace: "RGB",
    }
    if (frame.resample) pixelOptions.targetSize = size
    const image = await encodePixels(pixelOptions, { ...frame, fill: "black", opaque: true })
    if (image.encoded) return image.encoded
  } catch (_) {
    // 历史会在 finally 里收回，失败时退回整张白遮罩。
  } finally {
    try { document.activeHistoryState = history } catch (_) {}
  }
  return solidWhitePng(size.width, size.height)
}

function captureNote(bounds, mode, frame) {
  const width = bounds.right - bounds.left
  const height = bounds.bottom - bounds.top
  if (frame?.resample) return `取样超过生成上限，已缩到 ${frame.width}×${frame.height}`
  if (mode === "crop") return `外扩范围已裁到 ${width}×${height}，按文档原像素送出`
  if (mode === "grow") return `已向外取到 ${width}×${height}，按文档原像素送出`
  return `已按文档原像素送出 ${width}×${height}`
}

async function captureWorkflowInput() {
  if (!app.documents.length) throw new Error("请先打开 Photoshop 文档")
  return withPixelRuler(async () => {
  const document = app.activeDocument
  const selection = await activeSelection(document)
    const limit = fullDocumentBounds(document)
    if (!limit) throw new Error("无法读取当前文档尺寸")
  const crop = element("crop-selection").checked && selection
    const tight = selection && clampBounds(selection, limit)
    const expand = crop && padPercent() > 0
    const mode = expand ? "crop" : (crop ? "grow" : "document")
    const rawBounds = expand ? expandSelectionBounds(tight, limit, padPercent()) : (crop ? tight : limit)
    const sourceBounds = alignBoundsToStep(rawBounds, limit, expand, expand ? tight : rawBounds) || rawBounds
    const nativeWidth = Math.max(1, Math.round(sourceBounds.right - sourceBounds.left))
    const nativeHeight = Math.max(1, Math.round(sourceBounds.bottom - sourceBounds.top))
    const frame = overMaxFrame(nativeWidth, nativeHeight)
    const pixelOptions = {
    documentID: document.id,
    sourceBounds,
    componentSize: 8,
    colorSpace: "RGB",
    }
    if (frame?.resample) pixelOptions.targetSize = { width: frame.width, height: frame.height }
    lastDocumentPpi = Number(document.resolution) || lastDocumentPpi || 72

    const canvas = await encodePixels(pixelOptions, frame)
    const maskFrame = frame || { width: nativeWidth, height: nativeHeight, padLeft: 0, padTop: 0, resample: false }
    const maskBase64 = await encodeSelectionMask(document, sourceBounds, maskFrame, selection)
  lastCaptureBounds = sourceBounds
    lastSentFrame = frame
    try {
      await rememberBlendSelection(Boolean(selection))
    } catch (_) {}

    const profile = profilePayload(renderProfile)
  return {
      captureNote: captureNote(sourceBounds, mode, frame),
    canvasBase64: canvas.encoded,
    maskBase64,
    configdata: {
      positive: composePrompt(),
      negative: element("negative").value,
      seed: String(validSeed()),
      pluginVer: PLUGIN_VERSION,
      family: profile.family,
      aspect: profile.aspect,
      resolution: profile.resolution,
      quality: profile.quality,
      background: profile.background,
      size: profile.size,
      group: profile.group,
      referenceCount: referenceFiles.length,
      referenceNames: referenceFiles.map((file) => file.name || ""),
    },
    queue: true,
  }
  })
}

async function encodeActiveLayers() {
  if (!app.documents.length) throw new Error("请先打开 Photoshop 文档")
  const document = app.activeDocument
  const active = document.activeLayers || []
  const layers = []
  for (let index = 0; index < active.length; index += 1) layers.push(active[index])
  if (!layers.length) throw new Error("请先选择一个图层")
  const selection = await activeSelection(document)
  const limit = fullDocumentBounds(document)
  const payloads = []
  for (let index = 0; index < layers.length; index += 1) {
    const layer = layers[index]
    const layerBounds = clampBounds(plainBounds(layer.boundsNoEffects || layer.bounds), limit)
    if (!layerBounds) throw new Error(`图层「${layer.name || index + 1}」没有可发送的像素`)
    const sourceBounds = (selection && clampBounds(selection, layerBounds)) || layerBounds
    const image = await encodePixels({
      documentID: document.id,
      layerID: layer.id,
      sourceBounds,
      componentSize: 8,
      colorSpace: "RGB",
    })
    payloads.push({
      image_base64: image.encoded,
      document: document.name,
      layer: layer.name,
      bounds: sourceBounds,
      layer_bounds: image.sourceBounds || layerBounds,
      selection_bounds: selection,
      create_new: index > 0,
    })
  }
  return payloads
}

async function request(path, options = {}) {
  const response = await fetch(`${serverAddress()}${path}`, options)
  let payload = {}
  try {
    payload = await response.json()
  } catch (_) {
    if (!response.ok) throw new Error(`ComfyUI 返回 HTTP ${response.status}`)
  }
  if (!response.ok) throw new Error(payload.error || `ComfyUI 返回 HTTP ${response.status}`)
  return payload
}

function validSeed() {
  const value = Number.parseInt(element("seed").value, 10)
  return Number.isFinite(value) ? Math.max(0, Math.min(2147483647, value)) : randomSeed()
}

function randomSeed() {
  const value = Math.floor(Math.random() * 2147483647)
  element("seed").value = String(value)
  saveSettings()
  return value
}

function sendSocket(payload) {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    throw new Error("工作流通道未连接，请确认 ComfyUI 页面已打开")
  }
  socket.send(JSON.stringify(payload))
}

function sendWorkflowPayload(payload) {
  // 画布、遮罩、参考图、排队分成多条消息。旧服务端单条上限 4MB，合在一起会把连接掐掉。
  const workflow = Number(element("workflow").value)
  const profile = payload.configdata
    ? {
      family: payload.configdata.family,
      aspect: payload.configdata.aspect,
      resolution: payload.configdata.resolution,
      quality: payload.configdata.quality,
      background: payload.configdata.background,
      size: payload.configdata.size,
      group: payload.configdata.group,
    }
    : profilePayload(renderProfile)
  sendSocket({ referenceClear: true })
  referenceFiles.forEach((file, index) => {
    sendSocket({
      referenceBase64: file.base64,
      referenceIndex: index + 1,
      referenceName: file.name || "",
    })
  })
  sendSocket({ canvasBase64: payload.canvasBase64 })
  if (payload.maskBase64) sendSocket({ maskBase64: payload.maskBase64 })
  if (Number.isFinite(workflow)) sendSocket({ workflow })
  sendSocket({ renderProfile: profile })
  sendSocket({
    queue: payload.queue,
    workflow: Number.isFinite(workflow) ? workflow : 0,
    renderProfile: profile,
    referenceCount: referenceFiles.length,
    configdata: payload.configdata,
  })
}

function updateOptions(selectId, value) {
  if (!Array.isArray(value)) return
  const select = element(selectId)
  select.innerHTML = ""
  value.forEach((item, index) => {
    const option = document.createElement("option")
    option.value = String(index)
    option.textContent = typeof item === "string" ? item : String(item?.name || `选项 ${index + 1}`)
    option.selected = Boolean(item?.selected)
    select.appendChild(option)
  })
  const followed = selectId === "workflow" && syncProfileToModel()
  if (typeof syncComposer === "function") syncComposer()
  if (followed) pushRenderProfile()
}

function base64ToBuffer(value) {
  const clean = String(value).replace(/^data:image\/[^;]+;base64,/, "")
  const binary = atob(clean)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes.buffer
}

async function writeDataFile(name, base64) {
  const folder = await storage.localFileSystem.getDataFolder()
  const file = await folder.createFile(name, { overwrite: true })
  await file.write(base64ToBuffer(base64), { format: storage.formats.binary })
  return file
}

function stampPngResolution(bytes, ppi) {
  const perMeter = Math.max(1, Math.round(Number(ppi) / 0.0254))
  const data = new Uint8Array(9)
  data[0] = (perMeter >>> 24) & 255
  data[1] = (perMeter >>> 16) & 255
  data[2] = (perMeter >>> 8) & 255
  data[3] = perMeter & 255
  data[4] = data[0]
  data[5] = data[1]
  data[6] = data[2]
  data[7] = data[3]
  data[8] = 1
  const chunk = pngChunk("pHYs", data)
  let offset = 8
  let physAt = -1
  let physLength = 0
  let iendAt = -1
  while (offset + 12 <= bytes.length) {
    const length = ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0
    const type = String.fromCharCode(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7])
    if (type === "pHYs") {
      physAt = offset
      physLength = length
    }
    if (type === "IEND") {
      iendAt = offset
      break
    }
    offset += 12 + length
  }
  if (iendAt < 0) return bytes
  if (physAt >= 0) {
    return concatBytes([
      bytes.subarray(0, physAt),
      chunk,
      bytes.subarray(physAt + 12 + physLength),
    ])
  }
  return concatBytes([bytes.subarray(0, iendAt), chunk, bytes.subarray(iendAt)])
}

// PNG 不写分辨率时，Photoshop 按 72 ppi 放置。文档是 300 ppi 就会先放大再缩小，像素被滤糊。
async function stampPngPpi(file, ppi) {
  const resolution = Number(ppi)
  if (!file || !Number.isFinite(resolution) || resolution < 1) return
  const data = await file.read({ format: storage.formats.binary })
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data)
  if (bytes.length < 24 || bytes[0] !== 137 || bytes[1] !== 80 || bytes[2] !== 78 || bytes[3] !== 71) return
  const out = stampPngResolution(bytes, resolution)
  await file.write(out.buffer, { format: storage.formats.binary })
}

function historyKey() {
  return `${STORE_PREFIX}renderHistory`
}

function nextRenderNumber() {
  let max = 0
  for (const item of renderHistory) max = Math.max(max, Number(item.number) || 0)
  return max + 1
}

function saveRenderHistory() {
  const stored = renderHistory.map((item) => ({ name: item.name, number: item.number }))
  localStorage.setItem(historyKey(), JSON.stringify(stored))
}

function readRenderHistory() {
  try {
    const parsed = JSON.parse(localStorage.getItem(historyKey()) || "[]")
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item) => item && item.name && Number(item.number) > 0)
  } catch (_) {
    return []
  }
}

async function historyFile(item) {
  const folder = await storage.localFileSystem.getDataFolder()
  return folder.getEntry(item.name)
}

const THUMB_KEEP = 48

function thumbNameFor(name) {
  return `thumb-${String(name).replace(/\.png$/i, "")}.png`
}

function unfilterPaeth(raw, rawOffset, dest, prev, stride, channels) {
  for (let index = 0; index < channels; index += 1) dest[index] = (raw[rawOffset + index] + prev[index]) & 255
  for (let index = channels; index < stride; index += 1) {
    const left = dest[index - channels]
    const up = prev[index]
    const upperLeft = prev[index - channels]
    const estimate = left + up - upperLeft
    const leftDistance = estimate > left ? estimate - left : left - estimate
    const upDistance = estimate > up ? estimate - up : up - estimate
    const diagonalDistance = estimate > upperLeft ? estimate - upperLeft : upperLeft - estimate
    let predicted = upperLeft
    if (leftDistance <= upDistance && leftDistance <= diagonalDistance) predicted = left
    else if (upDistance <= diagonalDistance) predicted = up
    dest[index] = (raw[rawOffset + index] + predicted) & 255
  }
}

function unfilterRow(filter, source, sourceOffset, dest, prev, stride, channels) {
  if (filter === 0) {
    dest.set(source.subarray(sourceOffset, sourceOffset + stride))
    return
  }
  if (filter === 1) {
    for (let index = 0; index < channels; index += 1) dest[index] = source[sourceOffset + index]
    for (let index = channels; index < stride; index += 1) dest[index] = (source[sourceOffset + index] + dest[index - channels]) & 255
    return
  }
  if (filter === 2) {
    for (let index = 0; index < stride; index += 1) dest[index] = (source[sourceOffset + index] + prev[index]) & 255
    return
  }
  if (filter === 3) {
    for (let index = 0; index < stride; index += 1) {
      const left = index >= channels ? dest[index - channels] : 0
      dest[index] = (source[sourceOffset + index] + ((left + prev[index]) >> 1)) & 255
    }
    return
  }
  unfilterPaeth(source, sourceOffset, dest, prev, stride, channels)
}

function paintThumbRow(row, channels, sampleX, dstW, rgb, sampleY) {
  const out = sampleY * dstW * 3
  for (let x = 0; x < dstW; x += 1) {
    const index = sampleX[x] * channels
    let red = row[index]
    let green = red
    let blue = red
    let alpha = 255
    if (channels === 3 || channels === 4) {
      green = row[index + 1]
      blue = row[index + 2]
    }
    if (channels === 4) alpha = row[index + 3]
    else if (channels === 2) alpha = row[index + 1]
    const scale = alpha / 255
    const dest = out + x * 3
    rgb[dest] = Math.round(red * scale)
    rgb[dest + 1] = Math.round(green * scale)
    rgb[dest + 2] = Math.round(blue * scale)
  }
}

async function makeThumbRgb(bytes, maxEdge) {
  const header = pngHeader(bytes)
  if (!header || header.bitDepth !== 8 || bytes[28] !== 0) return null
  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[header.colorType]
  if (!channels) return null
  const parts = []
  let offset = 8
  while (offset + 12 <= bytes.length) {
    const length = ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0
    const type = String.fromCharCode(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7])
    if (type === "IDAT") parts.push(bytes.subarray(offset + 8, offset + 8 + length))
    if (type === "IEND") break
    offset += 12 + length
  }
  if (!parts.length) return null
  const width = header.width
  const height = header.height
  const stride = width * channels
  const rowBytes = stride + 1
  const inflated = inflateZlib(concatBytes(parts), rowBytes * height)
  if (inflated.length < rowBytes * height) return null
  const scale = Math.min(1, maxEdge / Math.max(width, height))
  const dstW = Math.max(1, Math.round(width * scale))
  const dstH = Math.max(1, Math.round(height * scale))
  const rgb = new Uint8Array(dstW * dstH * 3)
  const sampleX = new Int32Array(dstW)
  for (let x = 0; x < dstW; x += 1) sampleX[x] = Math.min(width - 1, Math.floor(((x + 0.5) * width) / dstW))
  const row = new Uint8Array(stride)
  const prev = new Uint8Array(stride)
  let sampleY = 0
  for (let y = 0; y < height && sampleY < dstH; y += 1) {
    if ((y & 63) === 0) await new Promise((resolve) => setTimeout(resolve, 0))
    unfilterRow(inflated[y * rowBytes], inflated, y * rowBytes + 1, row, prev, stride, channels)
    const wanted = Math.min(height - 1, Math.floor(((sampleY + 0.5) * height) / dstH))
    if (y === wanted) {
      paintThumbRow(row, channels, sampleX, dstW, rgb, sampleY)
      sampleY += 1
      while (sampleY < dstH && Math.min(height - 1, Math.floor(((sampleY + 0.5) * height) / dstH)) === y) {
        paintThumbRow(row, channels, sampleX, dstW, rgb, sampleY)
        sampleY += 1
      }
    }
    prev.set(row)
  }
  return { width: dstW, height: dstH, rgb }
}
function encodeThumbPng(width, height, rgb) {
  const stride = 1 + width * 3
  const raw = new Uint8Array(stride * height)
  for (let y = 0; y < height; y += 1) {
    raw.set(rgb.subarray(y * width * 3, (y + 1) * width * 3), y * stride + 1)
  }
  const base64 = rgbPngBase64(width, height, raw, 3)
  return base64ToBuffer(base64)
}

let thumbFolderTask = null

function thumbFolder() {
  if (thumbFolderTask) return thumbFolderTask
  thumbFolderTask = (async () => {
    const root = await storage.localFileSystem.getDataFolder()
    try {
      return await root.getEntry("history-thumbs")
    } catch (_) {
      return root.createFolder("history-thumbs")
    }
  })()
  return thumbFolderTask
}

function protectedThumbNames() {
  const names = new Set()
  const recent = Math.min(renderHistory.length, THUMB_KEEP)
  for (let index = 0; index < recent; index += 1) names.add(thumbNameFor(renderHistory[index].name))
  const start = historyPage * HISTORY_PAGE_SIZE
  const end = Math.min(renderHistory.length, start + HISTORY_PAGE_SIZE)
  for (let index = start; index < end; index += 1) names.add(thumbNameFor(renderHistory[index].name))
  return names
}

async function trimThumbFolder() {
  const folder = await thumbFolder()
  const entries = await folder.getEntries()
  const files = entries.filter((entry) => entry.isFile && /^thumb-.*\.(png|jpg)$/i.test(entry.name))
  if (files.length <= THUMB_KEEP) return
  const protect = protectedThumbNames()
  const spare = files.filter((entry) => !protect.has(entry.name))
  spare.sort((a, b) => String(a.name).localeCompare(String(b.name)))
  const removeCount = files.length - THUMB_KEEP
  for (let index = 0; index < removeCount && index < spare.length; index += 1) {
    try { await spare[index].delete() } catch (_) {}
  }
}

async function retireLooseThumbs() {
  const root = await storage.localFileSystem.getDataFolder()
  const entries = await root.getEntries()
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]
    if (entry.isFile && /^thumb-.*\.(png|jpg)$/i.test(entry.name)) {
      try { await entry.delete() } catch (_) {}
    }
  }
}

let thumbQueue = Promise.resolve()

function enqueueThumb(task) {
  const run = thumbQueue.then(() => new Promise((resolve, reject) => {
    setTimeout(() => {
      try { resolve(task()) } catch (error) { reject(error) }
    }, 0)
  }))
  thumbQueue = run.then(() => {}, () => {})
  return run
}

function rgbFromImageData(data) {
  const rgb = new Uint8Array((data.length / 4) * 3)
  let out = 0
  for (let index = 0; index < data.length; index += 4) {
    const alpha = data[index + 3] / 255
    rgb[out] = Math.round(data[index] * alpha)
    rgb[out + 1] = Math.round(data[index + 1] * alpha)
    rgb[out + 2] = Math.round(data[index + 2] * alpha)
    out += 3
  }
  return rgb
}

function thumbLooksEmpty(data) {
  for (let index = 0; index < data.length; index += 4) {
    if (data[index + 3] >= 8) return false
  }
  return true
}

function thumbSize(width, height) {
  const scale = Math.min(1, 160 / Math.max(width, height))
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

function pixelsFromDrawable(source, sourceWidth, sourceHeight) {
  const size = thumbSize(sourceWidth, sourceHeight)
  const canvas = document.createElement("canvas")
  canvas.width = size.width
  canvas.height = size.height
  const context = canvas.getContext("2d")
  if (!context || typeof context.getImageData !== "function") return null
  context.drawImage(source, 0, 0, size.width, size.height)
  const data = context.getImageData(0, 0, size.width, size.height).data
  canvas.width = 0
  if (thumbLooksEmpty(data)) return null
  return { width: size.width, height: size.height, rgb: rgbFromImageData(data) }
}

async function bitmapThumb(bytes) {
  if (typeof createImageBitmap !== "function" || typeof Blob !== "function") return null
  let bitmap = null
  try {
    const copy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
    bitmap = await createImageBitmap(new Blob([copy], { type: "image/png" }))
    if (!bitmap.width || !bitmap.height) return null
    return pixelsFromDrawable(bitmap, bitmap.width, bitmap.height)
  } catch (_) {
    return null
  } finally {
    if (bitmap && typeof bitmap.close === "function") bitmap.close()
  }
}

function loadThumbImage(url) {
  let image = document.getElementById("thumb-loader")
  if (!image) {
    image = document.createElement("img")
    image.id = "thumb-loader"
    image.alt = ""
    image.decoding = "sync"
    image.style.cssText = "position:absolute;left:-2000px;width:160px;height:160px;pointer-events:none"
    document.body.appendChild(image)
  }
  image.removeAttribute("src")
  return new Promise((resolve, reject) => {
    const finish = (ok) => {
      image.onload = null
      image.onerror = null
      if (ok) resolve(image)
      else reject(new Error("缩略图读取失败"))
    }
    image.onload = () => finish(true)
    image.onerror = () => finish(false)
    image.src = url
  })
}

async function domThumb(file) {
  const url = String(file && file.url || "")
  if (!url) return null
  try {
    const image = await loadThumbImage(url)
    const width = image.naturalWidth || image.width
    const height = image.naturalHeight || image.height
    if (!width || !height) return null
    return pixelsFromDrawable(image, width, height)
  } catch (_) {
    return null
  } finally {
    const image = document.getElementById("thumb-loader")
    if (image) image.removeAttribute("src")
  }
}

async function storeThumbBytes(name, buffer) {
  const folder = await thumbFolder()
  const thumb = await folder.createFile(thumbNameFor(name), { overwrite: true })
  await thumb.write(buffer, { format: storage.formats.binary })
  await trimThumbFolder()
  try {
    return await folder.getEntry(thumb.name)
  } catch (_) {
    return thumb
  }
}

async function writePreparedThumb(name, base64) {
  const clean = String(base64 || "").replace(/^data:image\/[^;]+;base64,/, "")
  const entry = await storeThumbBytes(name, base64ToBuffer(clean))
  return { entry, src: `data:image/png;base64,${clean}` }
}

async function serverThumb(bytes) {
  try {
    const copy = bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
      ? bytes.buffer
      : bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
    const response = await fetch(`${serverAddress()}/ps/thumb`, {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: copy,
    })
    if (!response.ok) return null
    const buffer = await response.arrayBuffer()
    if (!buffer || buffer.byteLength < 32) return null
    return buffer
  } catch (_) {
    return null
  }
}

async function writeThumbFile(file, name) {
  const raw = await file.read({ format: storage.formats.binary })
  const bytes = raw instanceof Uint8Array ? raw : new Uint8Array(raw)
  const prepared = await serverThumb(bytes)
  if (prepared) return storeThumbBytes(name, prepared)
  let small = await bitmapThumb(bytes)
  if (!small) small = await domThumb(file)
  if (!small && readPngBytes(bytes)) small = await makeThumbRgb(bytes, 160)
  if (!small) throw new Error("缩略图解码失败")
  return storeThumbBytes(name, encodeThumbPng(small.width, small.height, small.rgb))
}

async function rememberThumb(item, entry) {
  item.thumb = entry || item.thumb || null
  if (!item.thumbSrc && entry && typeof entry.read === "function") {
    try {
      const raw = await entry.read({ format: storage.formats.binary })
      const bytes = raw instanceof Uint8Array ? raw : new Uint8Array(raw)
      if (bytes.length > 32) item.thumbSrc = `data:image/png;base64,${bytesToBase64(bytes)}`
    } catch (_) {}
  }
  return item.thumbSrc || String(entry && entry.url || "")
}

function ensureThumb(item) {
  if (item.thumbSrc) return Promise.resolve(item.thumb || null)
  if (item.thumbTask) return item.thumbTask
  item.thumbTask = enqueueThumb(async () => {
    const thumbName = thumbNameFor(item.name)
    let entry = item.thumb
    if (!entry) {
      try {
        entry = await (await thumbFolder()).getEntry(thumbName)
      } catch (_) {}
    }
    if (!entry) {
      if (!item.file) item.file = await historyFile(item)
      entry = await writeThumbFile(item.file, item.name)
    }
    await rememberThumb(item, entry)
    return item.thumb
  }).catch((error) => {
    item.thumbTask = null
    throw error
  })
  return item.thumbTask
}

let historyOpen = false
let historyHideTimer = null

function historyCardFromEvent(event) {
  let node = event.target
  const strip = element("history-strip")
  while (node && node !== strip) {
    if (node.classList && node.classList.contains("history-card")) return node
    node = node.parentNode
  }
  return null
}

function clearHistoryThumbs() {
  const strip = element("history-strip")
  if (!strip) return
  const images = strip.querySelectorAll("img")
  for (let index = 0; index < images.length; index += 1) images[index].removeAttribute("src")
}

function historyTrack() {
  const strip = element("history-strip")
  let track = element("history-track")
  if (!track && strip) {
    track = document.createElement("div")
    track.id = "history-track"
    track.className = "history-track"
    strip.appendChild(track)
  }
  return track
}

let thumbMount = 0

function mountVisibleThumbs() {
  const strip = element("history-strip")
  if (!strip || !historyOpen) return
  const token = ++thumbMount
  const cards = strip.querySelectorAll(".history-card")
  for (let index = 0; index < cards.length; index += 1) {
    const card = cards[index]
    const image = card.querySelector("img")
    const item = renderHistory[Number(card.dataset.index)]
    if (!image || !item) continue
    ensureThumb(item).then(() => {
      if (token !== thumbMount || !historyOpen || !card.isConnected) return
      const url = item.thumbSrc || String(item.thumb && item.thumb.url || "")
      if (url && image.getAttribute("src") !== url) image.src = url
    }).catch(() => {
      image.dataset.failed = "1"
    })
  }
}

function setHistoryOpen(open) {
  historyOpen = open && renderHistory.length > 0
  const hover = element("history-hover")
  if (hover) hover.classList.toggle("open", historyOpen)
  if (historyOpen) mountVisibleThumbs()
  else clearHistoryThumbs()
}

function showHistoryCards() {
  clearTimeout(historyHideTimer)
  setHistoryOpen(true)
}

function scheduleHideHistory() {
  clearTimeout(historyHideTimer)
  historyHideTimer = setTimeout(() => setHistoryOpen(false), 180)
}

function scrollActiveHistoryCard() {
  const strip = element("history-strip")
  const card = strip && strip.querySelector(".history-card.active")
  if (!strip || !card) return
  const left = card.offsetLeft
  const right = left + card.offsetWidth
  if (left < strip.scrollLeft) strip.scrollLeft = left
  else if (right > strip.scrollLeft + strip.clientWidth) strip.scrollLeft = right - strip.clientWidth
}

function stepHistory(delta) {
  if (!renderHistory.length) return
  const next = Math.max(0, Math.min(renderHistory.length - 1, selectedHistoryIndex + delta))
  if (next === selectedHistoryIndex) return
  selectHistory(next).then(scrollActiveHistoryCard).catch((error) => showStatus(error.message, true))
}

function typingTarget(node) {
  const tag = node && node.tagName
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT"
}

function focusHistoryKeys() {
  if (typingTarget(document.activeElement)) return
  const stage = document.querySelector(".preview-stage")
  if (stage && document.activeElement !== stage) stage.focus()
}

function historyKeyDelta(event) {
  const key = String(event.key || "")
  const code = String(event.code || "")
  const which = event.keyCode || event.which
  if (key === "ArrowLeft" || key === "Left" || code === "ArrowLeft" || which === 37) return -1
  if (key === "ArrowRight" || key === "Right" || code === "ArrowRight" || which === 39) return 1
  return 0
}

function onHistoryKey(event) {
  if (event._comfytvHistory) return
  const delta = historyKeyDelta(event)
  if (!delta || typingTarget(event.target)) return
  event._comfytvHistory = true
  event.preventDefault()
  event.stopPropagation()
  stepHistory(delta)
}

function historyPageCount() {
  return Math.max(1, Math.ceil(renderHistory.length / HISTORY_PAGE_SIZE))
}

function showHistoryPage(page) {
  const next = Math.max(0, Math.min(historyPageCount() - 1, page))
  if (next === historyPage && element("history-track") && element("history-track").childNodes.length) return
  historyPage = next
  paintHistoryStrip()
}

function paintHistoryStrip() {
  const strip = element("history-strip")
  const track = historyTrack()
  if (!strip || !track) return
  track.textContent = ""
  if (!renderHistory.length) {
    historyPage = 0
    setHistoryOpen(false)
    return
  }
  historyPage = Math.max(0, Math.min(historyPageCount() - 1, historyPage))
  const start = historyPage * HISTORY_PAGE_SIZE
  const end = Math.min(renderHistory.length, start + HISTORY_PAGE_SIZE)
  for (let index = start; index < end; index += 1) {
    const card = document.createElement("span")
    card.className = index === selectedHistoryIndex ? "history-card active" : "history-card"
    card.setAttribute("role", "button")
    card.tabIndex = 0
    card.dataset.index = String(index)
    const image = document.createElement("img")
    image.className = "history-thumb"
    image.alt = ""
    image.decoding = "async"
    const ready = renderHistory[index]
    if (ready && ready.thumbSrc) image.src = ready.thumbSrc
    card.appendChild(image)
    track.appendChild(card)
  }
  if (historyOpen) mountVisibleThumbs()
  warmVisibleThumbs()
}

function warmVisibleThumbs() {
  const start = historyPage * HISTORY_PAGE_SIZE
  const end = Math.min(renderHistory.length, start + HISTORY_PAGE_SIZE)
  for (let index = start; index < end; index += 1) ensureThumb(renderHistory[index]).catch(() => {})
}

let historyWheelAt = 0

function onHistoryWheel(event) {
  if (!historyOpen) return
  event.preventDefault()
  event.stopPropagation()
  let delta = Number(event.deltaY) || 0
  if (!delta && event.wheelDelta) delta = -Number(event.wheelDelta)
  if (Math.abs(Number(event.deltaX) || 0) > Math.abs(delta)) delta = Number(event.deltaX) || 0
  if (!delta) return
  const now = Date.now()
  if (now - historyWheelAt < 160) return
  historyWheelAt = now
  showHistoryPage(historyPage + (delta > 0 ? 1 : -1))
}

function markActiveHistoryCard() {
  const track = element("history-track")
  if (!track) return
  const cards = track.querySelectorAll(".history-card")
  for (let index = 0; index < cards.length; index += 1) {
    cards[index].classList.toggle("active", Number(cards[index].dataset.index) === selectedHistoryIndex)
  }
}

async function selectHistory(index) {
  const item = renderHistory[index]
  if (!item) return
  const page = Math.floor(index / HISTORY_PAGE_SIZE)
  const pageChanged = page !== historyPage || !element("history-track") || !element("history-track").childNodes.length
  selectedHistoryIndex = index
  historyPage = page
  if (pageChanged) paintHistoryStrip()
  else markActiveHistoryCard()
  const file = await historyFile(item)
  if (selectedHistoryIndex !== index) return
  latestRenderFile = file
  renderCount = Number(item.number) || index + 1
  element("add-layer").disabled = false
  showPreview("", file.url)
}

async function restoreRenderHistory() {
  const stored = readRenderHistory()
  const kept = []
  for (const item of stored) {
    try {
      const file = await historyFile(item)
      kept.push({ name: item.name, number: item.number, file })
    } catch (_) {}
  }
  renderHistory = kept
  saveRenderHistory()
  retireLooseThumbs().then(() => trimThumbFolder()).catch(() => {})
  selectedHistoryIndex = 0
  paintHistoryStrip()
  if (kept.length) await selectHistory(0)
  refreshHistoryLimit()
}

async function receiveRender(value, thumbBase64) {
  const base64 = String(value || "").replace(/^data:image\/[^;]+;base64,/, "")
  if (!base64) return
  const number = nextRenderNumber()
  const name = `render-${Date.now()}.png`
  const file = await writeDataFile(name, base64)
  const item = { name, number, file }
  renderHistory.unshift(item)
  saveRenderHistory()
  if (thumbBase64) {
    try {
      const saved = await writePreparedThumb(name, thumbBase64)
      item.thumb = saved.entry
      item.thumbSrc = saved.src
    } catch (_) {}
  }
  if (!item.thumbSrc) ensureThumb(item).catch(() => {})
  selectedHistoryIndex = 0
  historyPage = 0
  latestRenderFile = file
  renderCount = number
  showPreview(base64, file.url)
  element("add-layer").disabled = false
  paintHistoryStrip()
  setProgress("完成")
  finishMarquee()
  showStatus("生成结果已收到")
  refreshHistoryLimit()
}

function renderStamp(name) {
  const match = /render-(\d+)/i.exec(String(name || ""))
  if (!match) return 0
  const stamp = Number(match[1])
  return Number.isFinite(stamp) && stamp > 0 ? stamp : 0
}

let historyLimitDismissed = false

function refreshHistoryLimit() {
  const node = element("history-limit")
  const text = element("history-limit-text")
  if (!node || !text) return
  if (renderHistory.length < HISTORY_WARN_COUNT) {
    historyLimitDismissed = false
    node.classList.add("hidden")
    return
  }
  text.textContent = `生成图已有 ${renderHistory.length} 张`
  if (!historyLimitDismissed) node.classList.remove("hidden")
}

function dismissHistoryLimit() {
  historyLimitDismissed = true
  const node = element("history-limit")
  if (node) node.classList.add("hidden")
}

async function deleteEntry(entry) {
  try {
    await entry.delete()
    return true
  } catch (_) {
    return false
  }
}

async function cleanOldRenders() {
  const button = element("history-clean")
  if (button) button.disabled = true
  const removed = new Set()
  try {
    const cutoff = Date.now() - HISTORY_KEEP_MS
    const root = await storage.localFileSystem.getDataFolder()
    const entries = await root.getEntries()
    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index]
      if (!entry.isFile || !/^render-\d+\.png$/i.test(entry.name)) continue
      const stamp = renderStamp(entry.name)
      if (!stamp || stamp >= cutoff) continue
      if (await deleteEntry(entry)) removed.add(entry.name)
    }
    const folder = await thumbFolder()
    const thumbs = await folder.getEntries()
    for (let index = 0; index < thumbs.length; index += 1) {
      const entry = thumbs[index]
      if (!entry.isFile) continue
      const stamp = renderStamp(entry.name)
      if (!stamp || stamp >= cutoff) continue
      await deleteEntry(entry)
    }
    for (let index = 0; index < renderHistory.length; index += 1) {
      const item = renderHistory[index]
      const stamp = renderStamp(item.name)
      if (!stamp || stamp >= cutoff || removed.has(item.name)) continue
      try {
        await historyFile(item)
      } catch (_) {
        removed.add(item.name)
      }
    }
    const currentName = renderHistory[selectedHistoryIndex] && renderHistory[selectedHistoryIndex].name
    renderHistory = renderHistory.filter((item) => !removed.has(item.name))
    saveRenderHistory()
    if (!renderHistory.length) {
      selectedHistoryIndex = 0
      historyPage = 0
      latestRenderFile = null
      renderCount = 0
      element("add-layer").disabled = true
      showPreview("", "")
      paintHistoryStrip()
    } else if (currentName && renderHistory.some((item) => item.name === currentName)) {
      selectedHistoryIndex = renderHistory.findIndex((item) => item.name === currentName)
      historyPage = Math.floor(selectedHistoryIndex / HISTORY_PAGE_SIZE)
      paintHistoryStrip()
    } else {
      await selectHistory(0)
    }
    showStatus(removed.size ? `已清理 ${removed.size} 张七天前的图片` : "没有七天前的图片")
    refreshHistoryLimit()
  } catch (error) {
    showStatus(error.message || "清理失败", true)
  } finally {
    if (button) button.disabled = false
  }
}

async function openRenderFolder() {
  try {
    const uxp = loadModule("uxp")
    const folder = await storage.localFileSystem.getDataFolder()
    const path = folder.nativePath || ""
    if (uxp.shell && typeof uxp.shell.openPath === "function" && path) {
      await uxp.shell.openPath(path, "打开生成图文件夹")
      return
    }
    showStatus(path ? `文件夹：${path}` : "打不开生成图文件夹", true)
  } catch (error) {
    showStatus(error.message || "打不开生成图文件夹", true)
  }
}

function handleSocketMessage(event) {
  try {
    const message = JSON.parse(event.data)
    if (message.render) {
      receiveRender(message.render, message.thumb).then(() => settleRender()).catch((error) => {
        showStatus(error.message, true)
        settleRender(error)
      })
    }
    if (message.render_status) {
      const status = String(message.render_status)
      if (!batchRunning) setProgress(status)
      if (status === "genrating") setMarquee(0, true)
      else if (status === "genrated") finishMarquee()
      else if (status === "genrate_error") {
        setMarquee(0, false)
        settleRender(new Error("生成失败"))
      }
    }
    if (message.progress !== undefined) {
      const percent = Number(message.progress)
      setProgress(`${percent}%`)
      if (!Number.isNaN(percent)) setMarquee(percent, true)
    }
    if (message.Send_workflow) {
      updateOptions("workflow", message.Send_workflow)
      modelListSynced = true
      if (modelPullTimer) {
        clearInterval(modelPullTimer)
        modelPullTimer = null
      }
    }
    if (message.pullProfile) pushRenderProfile()
    if (message.alert) {
      const alertText = String(message.alert)
      showStatus(alertText, true)
      if (renderDone) settleRender(new Error(alertText))
    }
  } catch (error) {
    showStatus(`无法解析 ComfyUI 消息：${error.message}`, true)
  }
}

function requestModelList() {
  if (modelListSynced) {
    if (modelPullTimer) {
      clearInterval(modelPullTimer)
      modelPullTimer = null
    }
    return
  }
  if (!socket || socket.readyState !== WebSocket.OPEN) return
  try { sendSocket({ pullModels: true }) } catch (_) {}
}

function connectSocket() {
  clearTimeout(reconnectTimer)
  if (socket) {
    socket.onclose = null
    socket.close()
  }
  setConnection("连接中", "busy")
  try {
    socket = new WebSocket(`${socketAddress()}/ps/ws?platform=ps&clientId=${clientId}`)
    socket.onopen = () => {
      setConnection("已连接", "connected")
      showStatus("ComfyUI 工作流通道已连接")
      pushRenderProfile()
      modelListSynced = false
      requestModelList()
      if (modelPullTimer) clearInterval(modelPullTimer)
      modelPullTimer = setInterval(requestModelList, 2000)
    }
    socket.onmessage = handleSocketMessage
    socket.onerror = () => setConnection("连接错误", "error")
    socket.onclose = () => {
      setConnection("已断开", "error")
      reconnectTimer = setTimeout(connectSocket, 4000)
    }
  } catch (error) {
    setConnection("连接错误", "error")
    showStatus(error.message || String(error), true)
    reconnectTimer = setTimeout(connectSocket, 4000)
  }
}

async function connect() {
  try {
    localStorage.setItem(`${STORE_PREFIX}server`, serverAddress())
    setConnection("检查服务", "busy")
    await request("/comfytv/photoshop/status")
    connectSocket()
  } catch (error) {
    setConnection("连接错误", "error")
    showStatus(error.message || String(error), true)
  }
}

function normalizeBase64(encoded) {
  if (encoded && typeof encoded === "object") encoded = encoded.base64 || encoded.data || ""
  return String(encoded || "").replace(/^data:image\/[^;]+;base64,/, "")
}

async function showCapturedPreview(base64) {
  const previous = capturePreviewFile
  capturePreviewFile = await writeDataFile(`capture-${Date.now()}.png`, base64)
  showPreview(base64, capturePreviewFile.url)
  showCanvasReference(capturePreviewFile.url)
  if (previous) {
    try { await previous.delete() } catch (_) {}
  }
}

function showPreview(source, fileUrl) {
  const preview = element("preview")
  const idle = document.querySelector(".empty-image")
  const urls = []
  const raw = String(source || "")
  if (fileUrl) urls.push(String(fileUrl))
  if (raw && !raw.includes("[object Object]")) {
    const dataUrl = /^(data:|plugin:|file:|blob:|https?:)/i.test(raw) ? raw : `data:image/png;base64,${raw}`
    if (!urls.includes(dataUrl)) urls.push(dataUrl)
  }
  if (!idle || !urls.length) {
    preview.classList.remove("visible")
    element("empty-preview").classList.remove("hidden")
    if (idle) idle.src = "preview-default.jpg"
    if (raw) showStatus("预览图数据无效", true)
    return
  }

  // 蜥蜴画在一直显示的 .empty-image 上。另一张 #preview 要等 onload 才露面，
  // plugin-data 地址再加 ?v= 时加载不会完成，onload 也不触发，所以结果图从来换不上去。
  // 直接改这张正在显示的图，失败再换成本地文件地址。
  let index = 0
  preview.classList.remove("visible")
  element("empty-preview").classList.remove("hidden")
  const paint = () => {
    idle.src = urls[index]
  }
  idle.onerror = () => {
    index += 1
    if (index < urls.length) {
      paint()
      return
    }
    idle.onerror = null
    idle.src = "preview-default.jpg"
    showStatus("预览图无法显示", true)
  }
  paint()
}

async function render() {
  suppressWatchUntil = Date.now() + 1500
  setBusy(true)
  setProgress(batchRunning ? element("progress-label").textContent : "读取 Photoshop")
  try {
    if (element("auto-seed").checked) randomSeed()
    const payload = await core.executeAsModal(
      () => captureWorkflowInput(),
      { commandName: "Send canvas to ComfyTV" },
    )
    const note = payload.captureNote
    delete payload.captureNote
    await showCapturedPreview(payload.canvasBase64)
    setProgress("等待 ComfyUI")
    sendWorkflowPayload(payload)
    showStatus(note || "已提交到 ComfyUI")
  } catch (error) {
    setProgress("失败")
    setMarquee(0, false)
    showStatus(error.message || String(error), true)
    throw error
  } finally {
    setBusy(false)
  }
}

function requestInterrupt() {
  try { sendSocket({ interrupt: true }) } catch (_) {}
  settleRender(new Error("已停止"))
}

async function renderBatch(totalOverride) {
  if (batchRunning) {
    batchStop = true
    requestInterrupt()
    showStatus("正在停止")
    return
  }
  const total = Number.isFinite(totalOverride) ? totalOverride : batchCount()
  if (!Number.isFinite(totalOverride)) element("batch-count").value = String(total)
  batchRunning = true
  batchStop = false
  setRenderLabel("停止")
  let finished = 0
  try {
    for (let index = 0; index < total; index += 1) {
      if (batchStop) break
      if (total > 1) setProgress(`第 ${index + 1} / ${total} 张`)
      const pending = armRenderWait()
      pending.catch(() => {})
      try {
        await render()
        await pending
      } catch (error) {
        settleRender(error)
        throw error
      }
      finished += 1
      if (total > 1) showStatus(`第 ${finished} / ${total} 张已完成`)
    }
    if (batchStop) showStatus(finished ? `已停止，完成 ${finished} 张` : "已停止")
    else if (total > 1) showStatus(`${total} 张已生成`)
  } catch (error) {
    if (batchStop || (error && error.message === "已停止")) {
      showStatus(finished ? `已停止，完成 ${finished} 张` : "已停止")
    } else {
      showStatus(error.message || String(error), true)
    }
  } finally {
    batchRunning = false
    batchStop = false
    setRenderLabel("渲染")
  }
}

async function sendLayer() {
  setBusy(true)
  try {
    const payloads = await core.executeAsModal(
      () => encodeActiveLayers(),
      { commandName: "Send active layers to ComfyTV" },
    )
    const names = []
    for (let index = 0; index < payloads.length; index += 1) {
      const result = await request("/comfytv/photoshop/layer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payloads[index]),
      })
      names.push(result.layer || result.name || payloads[index].layer)
    }
    showStatus(names.length > 1 ? `已发送 ${names.length} 个图层：${names.join("、")}` : `${names[0]} 已发送到 ComfyTV`)
  } catch (error) {
    showStatus(error.message || String(error), true)
  } finally {
    setBusy(false)
  }
}

function rectFromEdges(bounds) {
  const left = Number(bounds?.left)
  const top = Number(bounds?.top)
  const right = Number(bounds?.right)
  const bottom = Number(bounds?.bottom)
  if (![left, top, right, bottom].every(Number.isFinite)) return null
  const width = right - left
  const height = bottom - top
  if (width <= 0 || height <= 0) return null
  return { left, top, right, bottom, width, height }
}

function domBounds(layer) {
  return rectFromEdges(layer?.bounds)
}

function readPngBytes(fileData) {
  const bytes = fileData instanceof Uint8Array ? fileData : new Uint8Array(fileData)
  if (bytes.length < 26) return null
  if (bytes[0] !== 137 || bytes[1] !== 80 || bytes[2] !== 78 || bytes[3] !== 71) return null
  return bytes
}

function pngHeader(bytes) {
  const width = ((bytes[16] << 24) | (bytes[17] << 16) | (bytes[18] << 8) | bytes[19]) >>> 0
  const height = ((bytes[20] << 24) | (bytes[21] << 16) | (bytes[22] << 8) | bytes[23]) >>> 0
  if (width < 1 || height < 1) return null
  return { width, height, bitDepth: bytes[24], colorType: bytes[25] }
}

async function pngInfo(file) {
  if (!file) return null
  const bytes = readPngBytes(await file.read({ format: storage.formats.binary }))
  if (!bytes) return null
  return pngHeader(bytes)
}

function buildHuffman(lengths) {
  const counts = new Array(16).fill(0)
  for (let index = 0; index < lengths.length; index += 1) if (lengths[index]) counts[lengths[index]] += 1
  const nextCode = new Array(16).fill(0)
  let code = 0
  for (let bits = 1; bits <= 15; bits += 1) {
    code = (code + counts[bits - 1]) << 1
    nextCode[bits] = code
  }
  const root = { L: null, R: null }
  for (let symbol = 0; symbol < lengths.length; symbol += 1) {
    const length = lengths[symbol]
    if (!length) continue
    let bits = nextCode[length]
    nextCode[length] += 1
    let node = root
    for (let shift = length - 1; shift >= 0; shift -= 1) {
      const side = (bits >>> shift) & 1 ? "R" : "L"
      if (shift === 0) node[side] = symbol
      else {
        if (!node[side] || typeof node[side] !== "object") node[side] = { L: null, R: null }
        node = node[side]
      }
    }
  }
  return root
}

function inflateZlib(bytes, expected) {
  let position = bytes[0] === 0x78 ? 2 : 0
  let accumulator = 0
  let bits = 0
  const read = (count) => {
    while (bits < count) {
      accumulator |= bytes[position] << bits
      position += 1
      bits += 8
    }
    const value = accumulator & ((1 << count) - 1)
    accumulator >>>= count
    bits -= count
    return value
  }
  const align = () => {
    const extra = bits & 7
    if (extra) read(extra)
  }
  const readSymbol = (tree) => {
    let node = tree
    while (node && typeof node === "object") node = read(1) ? node.R : node.L
    return node
  }
  const fixedLengths = new Array(288).fill(8)
  for (let index = 144; index <= 255; index += 1) fixedLengths[index] = 9
  for (let index = 256; index <= 279; index += 1) fixedLengths[index] = 7
  const fixedLiteral = buildHuffman(fixedLengths)
  const fixedDistance = buildHuffman(new Array(32).fill(5))
  const codeOrder = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15]
  let output = new Uint8Array(expected > 0 ? expected : 65536)
  let outLength = 0
  const reserve = (extra) => {
    if (outLength + extra <= output.length) return
    let size = output.length
    while (size < outLength + extra) size *= 2
    const next = new Uint8Array(size)
    next.set(output)
    output = next
  }
  const pushOut = (value) => {
    reserve(1)
    output[outLength] = value & 255
    outLength += 1
  }
  const pushMatch = (distance, length) => {
    reserve(length)
    if (distance >= length) {
      output.copyWithin(outLength, outLength - distance, outLength - distance + length)
      outLength += length
      return
    }
    for (let index = 0; index < length; index += 1) {
      output[outLength] = output[outLength - distance]
      outLength += 1
    }
  }
  let finalBlock = 0
  while (!finalBlock) {
    finalBlock = read(1)
    const type = read(2)
    let literalTree = fixedLiteral
    let distanceTree = fixedDistance
    if (type === 0) {
      align()
      const size = bytes[position] | (bytes[position + 1] << 8)
      position += 4
      accumulator = 0
      bits = 0
      for (let index = 0; index < size; index += 1) pushOut(bytes[position + index])
      position += size
      continue
    }
    if (type === 2) {
      const literalCount = read(5) + 257
      const distanceCount = read(5) + 1
      const codeCount = read(4) + 4
      const codeLengths = new Array(19).fill(0)
      for (let index = 0; index < codeCount; index += 1) codeLengths[codeOrder[index]] = read(3)
      const codeTree = buildHuffman(codeLengths)
      const lengths = []
      while (lengths.length < literalCount + distanceCount) {
        const symbol = readSymbol(codeTree)
        if (symbol < 16) lengths.push(symbol)
        else if (symbol === 16) {
          const copy = lengths[lengths.length - 1]
          const repeat = read(2) + 3
          for (let index = 0; index < repeat; index += 1) lengths.push(copy)
        } else if (symbol === 17) {
          const repeat = read(3) + 3
          for (let index = 0; index < repeat; index += 1) lengths.push(0)
        } else {
          const repeat = read(7) + 11
          for (let index = 0; index < repeat; index += 1) lengths.push(0)
        }
      }
      literalTree = buildHuffman(lengths.slice(0, literalCount))
      distanceTree = buildHuffman(lengths.slice(literalCount, literalCount + distanceCount))
    } else if (type !== 1) {
      break
    }
    while (true) {
      const symbol = readSymbol(literalTree)
      if (symbol < 256) {
        pushOut(symbol)
        continue
      }
      if (symbol === 256) break
      const lengthIndex = symbol - 257
      const length = LENGTH_BASE[lengthIndex] + (LENGTH_EXTRA[lengthIndex] ? read(LENGTH_EXTRA[lengthIndex]) : 0)
      const distanceIndex = readSymbol(distanceTree)
      const distance = DIST_BASE[distanceIndex] + (DIST_EXTRA[distanceIndex] ? read(DIST_EXTRA[distanceIndex]) : 0)
      pushMatch(distance, length)
    }
  }
  return output.subarray(0, outLength)
}

function paethPredictor(left, up, upperLeft) {
  const estimate = left + up - upperLeft
  const leftDistance = Math.abs(estimate - left)
  const upDistance = Math.abs(estimate - up)
  const diagonalDistance = Math.abs(estimate - upperLeft)
  if (leftDistance <= upDistance && leftDistance <= diagonalDistance) return left
  if (upDistance <= diagonalDistance) return up
  return upperLeft
}

function pngAlphaInsets(bytes) {
  const header = pngHeader(bytes)
  if (!header || header.bitDepth !== 8 || (header.colorType !== 4 && header.colorType !== 6)) return null
  const parts = []
  let offset = 8
  while (offset + 12 <= bytes.length) {
    const length = ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0
    const type = String.fromCharCode(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7])
    if (type === "IDAT") parts.push(bytes.subarray(offset + 8, offset + 8 + length))
    if (type === "IEND") break
    offset += 12 + length
  }
  if (!parts.length) return null
  const channels = header.colorType === 6 ? 4 : 2
  const stride = header.width * channels
  const rowBytes = stride + 1
  const inflated = inflateZlib(concatBytes(parts), rowBytes * header.height)
  if (inflated.length < rowBytes * header.height) return null
  const pixels = new Uint8Array(stride * header.height)
  let minX = header.width
  let minY = header.height
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < header.height; y += 1) {
    const filter = inflated[y * rowBytes]
    const source = y * rowBytes + 1
    const dest = y * stride
    const previous = y > 0 ? dest - stride : -1
    for (let index = 0; index < stride; index += 1) {
      const raw = inflated[source + index]
      const left = index >= channels ? pixels[dest + index - channels] : 0
      const up = previous >= 0 ? pixels[previous + index] : 0
      const upperLeft = previous >= 0 && index >= channels ? pixels[previous + index - channels] : 0
      let value = raw
      if (filter === 1) value = (raw + left) & 255
      else if (filter === 2) value = (raw + up) & 255
      else if (filter === 3) value = (raw + ((left + up) >> 1)) & 255
      else if (filter === 4) value = (raw + paethPredictor(left, up, upperLeft)) & 255
      pixels[dest + index] = value
    }
    for (let x = 0; x < header.width; x += 1) {
      const alpha = pixels[dest + x * channels + (channels - 1)]
      if (!alpha) continue
      if (x < minX) minX = x
      if (y < minY) minY = y
      if (x > maxX) maxX = x
      if (y > maxY) maxY = y
    }
  }
  if (maxX < 0) return { left: 0, top: 0, right: 0, bottom: 0 }
  return {
    left: minX,
    top: minY,
    right: header.width - 1 - maxX,
    bottom: header.height - 1 - maxY,
  }
}

async function readPngAlphaInsets(file) {
  if (!file) return null
  const bytes = readPngBytes(await file.read({ format: storage.formats.binary }))
  if (!bytes) return null
  return pngAlphaInsets(bytes)
}

function layerById(document, id) {
  const count = Number(document.layers.length) || 0
  for (let index = 0; index < count; index += 1) {
    if (document.layers[index].id === id) return document.layers[index]
  }
  const active = document.activeLayers[0]
  return active?.id === id ? active : null
}

async function withPixelRuler(fn) {
  const preferences = app.preferences
  const previous = preferences?.rulerUnits
  try {
    const pixels = constants?.RulerUnits?.PIXELS
    if (preferences && pixels !== undefined) preferences.rulerUnits = pixels
    return await fn()
  } finally {
    if (preferences && previous !== undefined) {
      try { preferences.rulerUnits = previous } catch (_) {}
    }
  }
}

function newestLayer(document, previousIds) {
  const layers = document.layers
  const count = Number(layers.length) || 0
  for (let index = 0; index < count; index += 1) {
    const layer = layers[index]
    if (previousIds.has(layer.id) || layer.name === "ComfyTV Blend") continue
    return layer
  }
  return document.activeLayers[0]
}

async function selectLayer(layer) {
  await action.batchPlay([{
    _obj: "select",
    _target: [{ _ref: "layer", _id: layer.id }],
    makeVisible: false,
    _options: { dialogOptions: "dontDisplay" },
  }], { modalBehavior: "execute" })
}

async function moveLayer(layerId, dx, dy) {
  if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return
  await action.batchPlay([{
    _obj: "move",
    _target: [{ _ref: "layer", _id: layerId }],
    to: {
      _obj: "offset",
      horizontal: { _unit: "pixelsUnit", _value: dx },
      vertical: { _unit: "pixelsUnit", _value: dy },
    },
    _options: { dialogOptions: "dontDisplay" },
  }], { modalBehavior: "execute" })
}

async function withoutDialogs(fn) {
  const previous = app.displayDialogs
  try {
    app.displayDialogs = constants?.DisplayDialogs?.NO || "displayNoDialogs"
  } catch (_) {}
  try {
    return await fn()
  } finally {
    try { if (previous !== undefined) app.displayDialogs = previous } catch (_) {}
  }
}

async function centerPlacedOnCanvas() {
  await withoutDialogs(() => action.batchPlay([
    selectionCommand({ _enum: "ordinal", _value: "allEnum" }),
    {
      _obj: "align",
      _target: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }],
      using: { _enum: "alignDistributeSelector", _value: "ADSCentersV" },
      alignToCanvas: false,
      _options: { dialogOptions: "dontDisplay" },
    },
    {
      _obj: "align",
      _target: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }],
      using: { _enum: "alignDistributeSelector", _value: "ADSCentersH" },
      alignToCanvas: false,
      _options: { dialogOptions: "dontDisplay" },
    },
    selectionCommand({ _enum: "ordinal", _value: "none" }),
  ], { modalBehavior: "execute" }))
}

async function scaleLayer(layerId, percentW, percentH) {
  const command = {
    _obj: "transform",
    _target: [{ _ref: "layer", _id: layerId }],
    freeTransformCenterState: { _enum: "quadCenterState", _value: "QCSAverage" },
    width: { _unit: "percentUnit", _value: percentW },
    height: { _unit: "percentUnit", _value: percentH },
    linked: false,
    interfaceIconFrameDimmed: { _enum: "interpolationType", _value: "bicubicSharper" },
    _options: { dialogOptions: "dontDisplay" },
  }
  try {
    await action.batchPlay([command], { modalBehavior: "execute" })
  } catch (_) {
    delete command.interfaceIconFrameDimmed
    try {
      await action.batchPlay([command], { modalBehavior: "execute" })
    } catch (_) {
      delete command.linked
      await action.batchPlay([command], { modalBehavior: "execute" })
    }
  }
}

async function fitPlacedLayer(bounds) {
  if (!bounds) return ""
  const document = app.activeDocument
  const layer = document.activeLayers[0]
  if (!layer) return ""
  const layerId = layer.id
  const targetWidth = bounds.right - bounds.left
  const targetHeight = bounds.bottom - bounds.top
  if (targetWidth < 1 || targetHeight < 1) return ""
  try { await centerPlacedOnCanvas() } catch (_) {}

  let pngSize = null
  let insets = { left: 0, top: 0, right: 0, bottom: 0 }
  try { pngSize = await pngInfo(latestRenderFile) } catch (_) {}
  if (pngSize && (pngSize.colorType === 4 || pngSize.colorType === 6)) {
    try { insets = await readPngAlphaInsets(latestRenderFile) || insets } catch (_) {}
  }
  const layerNow = () => layerById(document, layerId) || document.activeLayers[0]
  const current = domBounds(layerNow())
  if (!current) return ""
  // 透明 PNG 的图层边界只包住不透明像素。整张图的外框才是要贴回的大小。
  const frameWidth = pngSize?.width || current.width
  const frameHeight = pngSize?.height || current.height
  const opaqueWidth = Math.max(1, frameWidth - insets.left - insets.right)
  const opaqueHeight = Math.max(1, frameHeight - insets.top - insets.bottom)
  const expectedWidth = targetWidth * opaqueWidth / frameWidth
  const expectedHeight = targetHeight * opaqueHeight / frameHeight
  const alreadyFit = Math.abs(current.width - expectedWidth) <= 1.5 && Math.abs(current.height - expectedHeight) <= 1.5
  if (!alreadyFit) {
    let percentW = expectedWidth / current.width * 100
    let percentH = expectedHeight / current.height * 100
    if (Math.abs(percentW - percentH) / Math.max(percentW, percentH) > 0.08) {
      const percent = Math.min(percentW, percentH)
      percentW = percent
      percentH = percent
    }
    if ([percentW, percentH].every(value => Number.isFinite(value) && value > 1 && value < 8000)) {
      await scaleLayer(layerId, percentW, percentH)
    }
  }
  const placed = domBounds(layerNow())
  if (!placed) return ""
  const goalLeft = bounds.left + insets.left * targetWidth / frameWidth
  const goalTop = bounds.top + insets.top * targetHeight / frameHeight
  await moveLayer(layerId, goalLeft - placed.left, goalTop - placed.top)
  const nudged = domBounds(layerNow())
  if (nudged) await moveLayer(layerId, goalLeft - nudged.left, goalTop - nudged.top)

  const sample = `${Math.round(targetWidth)}×${Math.round(targetHeight)}`
  const file = pngSize ? `，生成图 ${pngSize.width}×${pngSize.height}` : ""
  return `已按取样范围贴回 ${sample}${file}`
}

function findChannel(document, name) {
  try {
    const channels = document?.channels
    const count = Number(channels?.length) || 0
    for (let index = 0; index < count; index += 1) {
      if (channels[index]?.name === name) return true
    }
  } catch (_) {}
  return false
}

async function deleteNamedChannel(name) {
  if (!app.documents.length || !findChannel(app.activeDocument, name)) return
  await withoutDialogs(async () => {
    try {
      await action.batchPlay([{
        _obj: "delete",
        _target: [{ _ref: "channel", _name: name }],
        _options: { dialogOptions: "dontDisplay" },
      }], { modalBehavior: "execute" })
    } catch (_) {}
  })
}

async function rememberBlendSelection(hasSelection) {
  await deleteNamedChannel("ComfyTVBlend")
  if (!hasSelection) return
  await action.batchPlay([{
    _obj: "duplicate",
    _target: [{ _ref: "channel", _property: "selection" }],
    name: "ComfyTVBlend",
    _options: { dialogOptions: "dontDisplay" },
  }], { modalBehavior: "execute" })
}

async function maskPlacedLayer() {
  // 没框选时不会留下 ComfyTVBlend。此时“设置选区”不可用，会弹出对话框。
  if (!findChannel(app.activeDocument, "ComfyTVBlend")) return
  try {
    await withoutDialogs(() => action.batchPlay([
      selectionCommand({ _ref: "channel", _name: "ComfyTVBlend" }),
    ], { modalBehavior: "execute" }))
  } catch (_) {
    return
  }
  const bounds = await activeSelection(app.activeDocument)
  if (!bounds) return
  const size = Math.sqrt(Math.max(1, (bounds.right - bounds.left) * (bounds.bottom - bounds.top)))
  await action.batchPlay([
    {
      _obj: "expand",
      by: { _unit: "pixelsUnit", _value: size * 0.02 },
      selectionModifyEffectAtCanvasBounds: false,
      _options: { dialogOptions: "dontDisplay" },
    },
    {
      _obj: "feather",
      radius: { _unit: "pixelsUnit", _value: size * 0.01 },
      selectionModifyEffectAtCanvasBounds: false,
      _options: { dialogOptions: "dontDisplay" },
    },
    {
      _obj: "make",
      new: { _class: "channel" },
      at: { _ref: "channel", _enum: "channel", _value: "mask" },
      using: { _enum: "userMaskEnabled", _value: "revealSelection" },
      _options: { dialogOptions: "dontDisplay" },
    },
    selectionCommand({ _ref: "channel", _name: "ComfyTVBlend" }),
  ], { modalBehavior: "execute" })
  await deleteNamedChannel("ComfyTVBlend")
}

async function addResultLayer() {
  if (!latestRenderFile) {
    showStatus("还没有可添加的生成结果", true)
    return
  }
  if (!app.documents.length) {
    showStatus("请先打开 Photoshop 文档", true)
    return
  }
  element("add-layer").disabled = true
  showStatus("正在添加到图层")
  try {
    const placedNote = await core.executeAsModal(async () => {
      return withPixelRuler(async () => {
        const layerName = `ComfyTV ${renderCount}`
        const document = app.activeDocument
        const previousIds = new Set()
        for (let index = 0; index < document.layers.length; index += 1) previousIds.add(document.layers[index].id)
        try {
          // 没有选区时“取消选择”就是这条“设置”命令，Photoshop 会报当前不可用。
          if (await activeSelection(document)) {
            await withoutDialogs(() => action.batchPlay([
              selectionCommand({ _enum: "ordinal", _value: "none" }),
            ], { modalBehavior: "execute" }))
          }
        } catch (_) {}
        const ppi = Number(document.resolution) || lastDocumentPpi || 72
        try { await stampPngPpi(latestRenderFile, ppi) } catch (_) {}
      const token = await storage.localFileSystem.createSessionToken(latestRenderFile)
        const placedResult = await action.batchPlay([{
        _obj: "placeEvent",
        target: { _path: token, _kind: "local" },
        _options: { dialogOptions: "dontDisplay" },
      }], { modalBehavior: "execute" })
        const placedId = placedResult?.[0]?.layerID || placedResult?.[0]?.ID
        const placed = (placedId && layerById(document, placedId)) || newestLayer(document, previousIds)
        if (placed) {
          await selectLayer(placed)
          placed.name = layerName
        }
        const placedNote = await fitPlacedLayer(sentPlaceBounds() || fullDocumentBounds(document))
        try { await maskPlacedLayer() } catch (_) {}
        return placedNote
      })
    }, { commandName: "Add ComfyTV result" })
    showStatus(placedNote || "生成结果已添加为新图层")
  } catch (error) {
    showStatus(error.message || String(error), true)
  } finally {
    element("add-layer").disabled = false
    focusHistoryKeys()
  }
}

function closePrompt() {
  closeComposerMenus()
}

function syncDrawerButtons(openId) {
  element("settings-toggle").classList.toggle("active", openId === "settings-drawer")
}

function workflowListReady() {
  const select = element("workflow")
  return select.options.length > 1 || (select.options.length === 1 && select.value !== "")
}

function announceWorkflowList() {
  if (workflowListReady()) return
  const connected = socket && socket.readyState === WebSocket.OPEN
  showStatus(connected
    ? "工作流列表还没从 ComfyUI 同步过来"
    : "还没连上 ComfyUI，工作流列表是空的", true)
}

function setPreviewFit(contain) {
  element("preview").classList.toggle("contain", contain)
  element("empty-preview").classList.toggle("contain", contain)
  element("fit-toggle").classList.toggle("active", contain)
}

function toggleDrawer(id) {
  const drawer = element(id)
  const opening = drawer.classList.contains("hidden")
  document.querySelectorAll(".drawer").forEach((item) => item.classList.add("hidden"))
  if (opening) {
    drawer.classList.remove("hidden")
    closeComposerMenus()
  }
  syncDrawerButtons(opening ? id : "")
}

const referenceFiles = []
const COUNT_STEPS = [1, 2, 4, 8]
const RATIO_ORDER = ["1:1", "2:3", "3:2", "4:5", "5:4", "4:3", "3:4", "16:9", "9:16", "21:9", "9:21", "2:1", "1:2", "3:1", "1:3", "1:4", "4:1", "8:1", "1:8"]
const GPT_SIZE = {
  auto: { auto: "auto" },
  "1K": { "1:1": "1024x1024", "2:3": "1024x1536", "3:2": "1536x1024" },
  "2K": { "1:1": "2048x2048", "16:9": "2048x1152", "9:16": "1152x2048" },
  "4K": { "16:9": "3840x2160", "9:16": "2160x3840" },
}
const GPT_NODE_SIZES = ["auto", "1024x1024", "1024x1536", "1536x1024", "2048x2048", "2048x1152", "1152x2048", "3840x2160", "2160x3840", "Custom"]
const GPT_SIZE_ASPECT = {
  auto: "auto",
  "1024x1024": "1:1",
  "1024x1536": "2:3",
  "1536x1024": "3:2",
  "2048x2048": "1:1",
  "2048x1152": "16:9",
  "1152x2048": "9:16",
  "3840x2160": "16:9",
  "2160x3840": "9:16",
  Custom: "auto",
}
const RENDER_FAMILIES = {
  nanobanana: {
    label: "NanoBanana",
    short: "Nano",
    aspects: ["auto", "1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9", "1:4", "4:1", "8:1", "1:8"],
    resolutions: ["1K", "2K", "4K"],
    qualities: [{ value: "MINIMAL", label: "低" }, { value: "HIGH", label: "高" }],
    backgrounds: [],
    defaultResolution: "2K",
    defaultQuality: "MINIMAL",
  },
  pro: {
    label: "Pro",
    short: "Pro",
    aspects: ["auto", "1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"],
    resolutions: ["1K", "2K", "4K"],
    qualities: [],
    backgrounds: [],
    defaultResolution: "2K",
    defaultQuality: "",
  },
  gpt: {
    label: "GPT",
    short: "GPT",
    resolutions: ["auto", "1K", "2K", "4K"],
    qualities: [
      { value: "low", label: "低" },
      { value: "medium", label: "中" },
      { value: "high", label: "高" },
      { value: "xhigh", label: "超高" },
      { value: "max", label: "最高" },
    ],
    backgrounds: [
      { value: "auto", label: "自动" },
      { value: "opaque", label: "不透明" },
      { value: "transparent", label: "半透明" },
    ],
    defaultResolution: "auto",
    defaultQuality: "high",
    defaultBackground: "auto",
  },
}
let renderProfile = {
  family: "nanobanana",
  aspect: "auto",
  resolution: "2K",
  quality: "MINIMAL",
  background: "",
}

function gptSizeLabel(value) {
  return value === "auto" ? "auto" : String(value).replace("x", "×")
}

function gptResolution(raw) {
  const resolution = raw && raw.resolution
  if (GPT_NODE_SIZES.includes(resolution)) return resolution
  const mapped = (GPT_SIZE[resolution] || {})[raw && raw.aspect]
  return GPT_NODE_SIZES.includes(mapped) ? mapped : "auto"
}

function aspectChoices(profile) {
  if (profile.family === "gpt") return [GPT_SIZE_ASPECT[profile.resolution] || "auto"]
  return RENDER_FAMILIES[profile.family].aspects
}

function orderedAspects(values) {
  const rest = values.filter((value) => value !== "auto")
  return RATIO_ORDER.filter((value) => rest.includes(value)).concat(rest.filter((value) => !RATIO_ORDER.includes(value)))
}

function normalizeProfile(raw) {
  const familyId = RENDER_FAMILIES[raw && raw.family] ? raw.family : "nanobanana"
  const family = RENDER_FAMILIES[familyId]
  const resolution = familyId === "gpt"
    ? gptResolution(raw)
    : (family.resolutions.includes(raw && raw.resolution) ? raw.resolution : family.defaultResolution)
  const draft = { family: familyId, resolution }
  const aspects = aspectChoices(draft)
  const aspect = familyId === "gpt" ? aspects[0] : (aspects.includes(raw && raw.aspect) ? raw.aspect : aspects[0])
  const quality = family.qualities.some((item) => item.value === (raw && raw.quality)) ? raw.quality : (family.defaultQuality || "")
  const background = family.backgrounds.some((item) => item.value === (raw && raw.background)) ? raw.background : (family.defaultBackground || "")
  return { family: familyId, aspect, resolution, quality, background }
}

function profileGroupName(profile) {
  if (profile.family === "nanobanana") return `NanoBanana ${profile.resolution}`
  if (profile.family === "pro") return `NanoBanana Pro ${profile.resolution}`
  const background = { auto: "自动", opaque: "不透明", transparent: "半透明" }[profile.background] || "自动"
  return `GPT ${background}`
}

function profilePayload(profile) {
  const normalized = normalizeProfile(profile)
  const size = normalized.family === "gpt" ? normalized.resolution : ""
  return { ...normalized, group: profileGroupName(normalized), size }
}

function modeButtonLabel(profile) {
  if (profile.family === "gpt") return gptSizeLabel(profile.resolution)
  return `${optionLabel(profile.aspect)} · ${optionLabel(profile.resolution)}`
}

function familyFromModelName(name) {
  const text = String(name || "")
  if (text.includes("Pro")) return "pro"
  if (text.includes("GPT")) return "gpt"
  if (text.includes("Nano")) return "nanobanana"
  return ""
}

function syncProfileToModel() {
  const model = element("workflow")
  const option = model.options[model.selectedIndex]
  const family = familyFromModelName(option ? option.textContent : "")
  if (!family || family === renderProfile.family) return false
  renderProfile = normalizeProfile({ ...renderProfile, family })
  saveRenderProfile()
  const menu = element("mode-menu")
  if (menu && !menu.classList.contains("hidden")) fillModeSheet(menu)
  syncComposer()
  return true
}

function loadRenderProfile() {
  try {
    const saved = JSON.parse(localStorage.getItem(`${STORE_PREFIX}renderProfile`) || "")
    renderProfile = normalizeProfile(saved)
  } catch (_) {
    renderProfile = normalizeProfile(renderProfile)
  }
}

function saveRenderProfile() {
  localStorage.setItem(`${STORE_PREFIX}renderProfile`, JSON.stringify(renderProfile))
}

function pushRenderProfile() {
  if (!socket || socket.readyState !== WebSocket.OPEN) return
  try { sendSocket({ renderProfile: profilePayload(renderProfile) }) } catch (_) {}
}

function chooseRenderProfile(patch) {
  renderProfile = normalizeProfile({ ...renderProfile, ...patch })
  saveRenderProfile()
  pushRenderProfile()
  syncComposer()
  const menu = element("mode-menu")
  if (menu && !menu.classList.contains("hidden")) fillModeSheet(menu)
}

function ratioBox(token) {
  if (token === "auto") return { width: 16, height: 16 }
  const parts = String(token).split(":").map((item) => Number(item))
  if (parts.length !== 2 || !parts[0] || !parts[1]) return { width: 16, height: 16 }
  const scale = 18 / Math.max(parts[0], parts[1])
  return {
    width: Math.max(8, Math.round(parts[0] * scale)),
    height: Math.max(8, Math.round(parts[1] * scale)),
  }
}

function optionLabel(value) {
  return value === "auto" ? "自适应" : value
}

function appendChip(parent, label, on, onClick) {
  const chip = document.createElement("span")
  chip.className = on ? "mode-chip is-on" : "mode-chip"
  chip.setAttribute("role", "button")
  chip.tabIndex = 0
  chip.textContent = label
  chip.addEventListener("click", (event) => {
    event.stopPropagation()
    onClick()
  })
  parent.appendChild(chip)
}

function appendSection(menu, title) {
  const section = document.createElement("div")
  section.className = "mode-section"
  const heading = document.createElement("div")
  heading.className = "mode-section-title"
  heading.textContent = title
  section.appendChild(heading)
  menu.appendChild(section)
  return section
}

function fillModeSheet(menu) {
  const profile = normalizeProfile(renderProfile)
  renderProfile = profile
  menu.textContent = ""

  if (profile.family === "gpt") {
    const sizeSection = appendSection(menu, "尺寸")
    const sizeRow = document.createElement("div")
    sizeRow.className = "mode-chip-row"
    GPT_NODE_SIZES.forEach((value) => {
      appendChip(sizeRow, gptSizeLabel(value), profile.resolution === value, () => chooseRenderProfile({ resolution: value }))
    })
    sizeSection.appendChild(sizeRow)
  }

  if (profile.family !== "gpt") {
  const ratioSection = appendSection(menu, "比例")
  const layout = document.createElement("div")
  layout.className = "ratio-layout"
  const aspects = aspectChoices(profile)
  if (aspects.includes("auto")) {
    const auto = document.createElement("span")
    auto.className = profile.aspect === "auto" ? "ratio-auto is-on" : "ratio-auto"
    auto.setAttribute("role", "button")
    auto.tabIndex = 0
    const glyph = document.createElement("span")
    glyph.className = "ratio-glyph"
    const box = ratioBox("auto")
    glyph.style.width = `${box.width}px`
    glyph.style.height = `${box.height}px`
    const caption = document.createElement("span")
    caption.textContent = "自适应"
    auto.appendChild(glyph)
    auto.appendChild(caption)
    auto.addEventListener("click", (event) => {
      event.stopPropagation()
      chooseRenderProfile({ aspect: "auto" })
    })
    layout.appendChild(auto)
  }
  const grid = document.createElement("div")
  grid.className = "ratio-grid"
  orderedAspects(aspects).forEach((value) => {
    const cell = document.createElement("span")
    cell.className = profile.aspect === value ? "ratio-cell is-on" : "ratio-cell"
    cell.setAttribute("role", "button")
    cell.tabIndex = 0
    const glyph = document.createElement("span")
    glyph.className = "ratio-glyph"
    const box = ratioBox(value)
    glyph.style.width = `${box.width}px`
    glyph.style.height = `${box.height}px`
    const caption = document.createElement("span")
    caption.textContent = value
    cell.appendChild(glyph)
    cell.appendChild(caption)
    cell.addEventListener("click", (event) => {
      event.stopPropagation()
      chooseRenderProfile({ aspect: value })
    })
    grid.appendChild(cell)
  })
  layout.appendChild(grid)
  ratioSection.appendChild(layout)

  const resolutionSection = appendSection(menu, "分辨率")
  const resolutionRow = document.createElement("div")
  resolutionRow.className = "mode-chip-row"
  RENDER_FAMILIES[profile.family].resolutions.forEach((value) => {
    appendChip(resolutionRow, optionLabel(value), profile.resolution === value, () => chooseRenderProfile({ resolution: value }))
  })
  resolutionSection.appendChild(resolutionRow)
  }

  const qualities = RENDER_FAMILIES[profile.family].qualities
  if (qualities.length) {
    const qualitySection = appendSection(menu, "质量")
    const qualityRow = document.createElement("div")
    qualityRow.className = "mode-chip-row"
    qualities.forEach((item) => {
      appendChip(qualityRow, item.label, profile.quality === item.value, () => chooseRenderProfile({ quality: item.value }))
    })
    qualitySection.appendChild(qualityRow)
  }

  const backgrounds = RENDER_FAMILIES[profile.family].backgrounds
  if (backgrounds.length) {
    const backgroundSection = appendSection(menu, "输出背景")
    const backgroundRow = document.createElement("div")
    backgroundRow.className = "mode-chip-row"
    backgrounds.forEach((item) => {
      appendChip(backgroundRow, item.label, profile.background === item.value, () => chooseRenderProfile({ background: item.value }))
    })
    backgroundSection.appendChild(backgroundRow)
  }
}

function syncComposer() {
  const model = element("workflow")
  const modelText = model.options[model.selectedIndex] ? model.options[model.selectedIndex].textContent.trim() : ""
  element("model-label").textContent = modelText && model.value !== "" ? modelText : "模型"
  element("mode-label").textContent = modeButtonLabel(normalizeProfile(renderProfile))
  const count = batchCount()
  element("batch-count").value = String(count)
  element("count-label").textContent = `${count}x`
}

function syncPromptMirror() {
  const text = element("positive").value
  const mirror = element("positive-mirror")
  const empty = !String(text || "").trim()
  mirror.textContent = empty ? "描述你想要生成的内容" : text
  mirror.classList.toggle("is-empty", empty)
}

function closeComposerMenus() {
  element("model-menu").classList.add("hidden")
  element("mode-menu").classList.add("hidden")
  element("count-menu").classList.add("hidden")
  element("composer").classList.remove("menu-open")
}

function fillSelectMenu(menu, select) {
  menu.textContent = ""
  let count = 0
  for (let index = 0; index < select.options.length; index += 1) {
    const option = select.options[index]
    if (option.value === "") continue
    count += 1
    const item = document.createElement("span")
    item.className = "composer-option"
    item.setAttribute("role", "button")
    item.tabIndex = 0
    item.textContent = option.textContent
    if (option.selected) item.classList.add("is-selected")
    item.addEventListener("click", (event) => {
      event.stopPropagation()
      select.value = option.value
      select.dispatchEvent(new Event("change", { bubbles: true }))
      syncComposer()
      closeComposerMenus()
    })
    menu.appendChild(item)
  }
  if (!count) {
    const empty = document.createElement("span")
    empty.className = "composer-option"
    empty.textContent = "等待 ComfyUI 同步"
    menu.appendChild(empty)
  }
}

function fillCountMenu(menu) {
  menu.textContent = ""
  const current = batchCount()
  COUNT_STEPS.forEach((count) => {
    const item = document.createElement("span")
    item.className = "composer-option"
    item.setAttribute("role", "button")
    item.tabIndex = 0
    item.textContent = `${count}x`
    if (count === current) item.classList.add("is-selected")
    item.addEventListener("click", (event) => {
      event.stopPropagation()
      element("batch-count").value = String(count)
      saveSettings()
      syncComposer()
      closeComposerMenus()
    })
    menu.appendChild(item)
  })
}

function toggleComposerMenu(id) {
  const menu = element(id)
  const willOpen = menu.classList.contains("hidden")
  closeComposerMenus()
  if (!willOpen) return
  if (id === "model-menu") {
    if (!workflowListReady()) announceWorkflowList()
    fillSelectMenu(menu, element("workflow"))
  } else if (id === "mode-menu") {
    fillModeSheet(menu)
  } else {
    fillCountMenu(menu)
  }
  syncPromptMirror()
  menu.classList.remove("hidden")
  element("composer").classList.add("menu-open")
}

function showCanvasReference(url) {
  const card = element("ref-doc")
  if (!card || !url) return
  let img = card.querySelector("img")
  if (!img) {
    img = document.createElement("img")
    img.alt = ""
    card.appendChild(img)
  }
  img.src = String(url)
  card.classList.add("has-image")
}

function paintReferenceRow() {
  const row = element("ref-row")
  const add = element("ref-add")
  row.querySelectorAll(".ref-thumb").forEach((node) => node.remove())
  referenceFiles.forEach((file, index) => {
    const card = document.createElement("span")
    card.className = "ref-card ref-thumb has-image"
    card.setAttribute("role", "button")
    card.tabIndex = 0
    card.title = `写入 @参考图${index + 1}`
    const img = document.createElement("img")
    img.alt = ""
    img.src = file.src || ""
    card.appendChild(img)
    const remove = document.createElement("button")
    remove.type = "button"
    remove.className = "ref-remove"
    remove.textContent = "×"
    remove.title = "移除这张参考图"
    remove.addEventListener("click", (event) => {
      event.preventDefault()
      event.stopPropagation()
      referenceFiles.splice(index, 1)
      paintReferenceRow()
    })
    card.appendChild(remove)
    card.addEventListener("click", (event) => {
      event.stopPropagation()
      insertMention(`@参考图${index + 1}`)
      showStatus(`已写入 @参考图${index + 1}`)
    })
    row.insertBefore(card, add)
  })
}

async function referenceFromFile(file) {
  const binary = await file.read({ format: storage.formats.binary })
  const bytes = new Uint8Array(binary)
  if (!bytes.length) throw new Error("这张图片是空的")
  if (bytes.length > 25 * 1024 * 1024) throw new Error("参考图请小于 25MB")
  const name = String(file.name || "reference.png")
  if (!/\.(png|jpe?g|webp)$/i.test(name)) throw new Error("请选择 png、jpg 或 webp")
  const mime = /\.jpe?g$/i.test(name) ? "image/jpeg" : (/\.webp$/i.test(name) ? "image/webp" : "image/png")
  const base64 = bytesToBase64(bytes)
  return { name, base64, src: `data:${mime};base64,${base64}` }
}

async function addReferenceImage() {
  try {
    const picked = await storage.localFileSystem.getFileForOpening({ types: ["png", "jpg", "jpeg", "webp"] })
    const files = Array.isArray(picked) ? picked : (picked ? [picked] : [])
    if (!files.length) return
    let added = 0
    for (const file of files) {
      if (referenceFiles.length >= 6) {
        showStatus("参考图最多 6 张", true)
        break
      }
      referenceFiles.push(await referenceFromFile(file))
      added += 1
    }
    paintReferenceRow()
    if (added) showStatus(added > 1 ? `已添加 ${added} 张参考图` : `已添加参考图 ${referenceFiles[referenceFiles.length - 1].name}`)
  } catch (error) {
    const message = error && error.message ? error.message : "无法添加参考图"
    showStatus(/permission|denied|not allowed/i.test(message) ? "没有读取本地图片的权限，请完全退出 Photoshop 后再打开面板" : message, true)
  }
}

let activeStyleId = localStorage.getItem(`${STORE_PREFIX}promptStyle`) || "style-none"
let activeFilterId = localStorage.getItem(`${STORE_PREFIX}promptFilter`) || "filter-none"
let activeCustomName = ""

function libraryItems(kind) {
  const builtin = kind === "function"
    ? (typeof FILTER_LIBRARY === "undefined" ? [] : FILTER_LIBRARY)
    : (typeof STYLE_LIBRARY === "undefined" ? [] : STYLE_LIBRARY)
  return builtin.concat(readUserLibrary().filter((item) => item.library === kind))
}

function readUserLibrary() {
  try {
    const parsed = JSON.parse(localStorage.getItem(`${STORE_PREFIX}userLibrary`) || "[]")
    if (!Array.isArray(parsed)) return []
    return parsed.map((item) => {
      if (!item || !item.id || !String(item.name || "").trim() || !String(item.group || "").trim()) return null
      return {
        id: String(item.id),
        library: item.library === "function" ? "function" : "style",
        group: String(item.group).trim(),
        name: String(item.name).trim(),
        des: String(item.des || ""),
        prompt: String(item.prompt || ""),
        user: true,
      }
    }).filter(Boolean)
  } catch (_) {
    return []
  }
}

function writeUserLibrary(items) {
  localStorage.setItem(`${STORE_PREFIX}userLibrary`, JSON.stringify(items.slice(0, 80).map((item) => ({
    id: item.id,
    library: item.library,
    group: item.group,
    name: item.name,
    des: item.des || "",
    prompt: item.prompt || "",
  }))))
}

function activeCustomPreset() {
  if (!activeCustomName) return null
  return readPromptPresets().find((item) => item.name === activeCustomName) || null
}

function escapeRegExp(text) {
  return String(text || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function tidyPrompt(text) {
  return String(text || "").replace(/[ \t]{2,}/g, " ").replace(/[ \t]+\n/g, "\n").replace(/^\s+|\s+$/g, "")
}

function stripToken(text, name) {
  if (!name) return String(text || "")
  return String(text || "").replace(new RegExp(`(^|\\s)@${escapeRegExp(name)}(?=\\s|$)`, "g"), "$1")
}

function ensureToken(text, name) {
  const token = `@${name}`
  const source = String(text || "")
  if (new RegExp(`(?:^|\\s)${escapeRegExp(token)}(?=\\s|$)`).test(source)) return tidyPrompt(source)
  return tidyPrompt(`${token} ${source}`)
}

function placeKindToken(previousName, nextName) {
  const field = element("positive")
  let text = stripToken(field.value, previousName)
  if (nextName) text = ensureToken(text, nextName)
  field.value = tidyPrompt(text)
  syncPromptMirror()
}

function namedSelection(kind) {
  if (kind === "style") {
    const item = libraryItems("style").find((entry) => entry.id === activeStyleId)
    return item && item.prompt ? item.name : ""
  }
  if (kind === "function") {
    const item = libraryItems("function").find((entry) => entry.id === activeFilterId)
    return item && item.prompt ? item.name : ""
  }
  const custom = activeCustomPreset()
  return custom && (custom.prefix || custom.suffix) ? custom.name : ""
}

function composePrompt() {
  let text = String(element("positive").value || "")
  text = text.replace(/@参考图(\d+)/g, (_, raw) => `图片${Number(raw) + 2}`)
  const custom = activeCustomPreset()
  if (custom && custom.name) text = stripToken(text, custom.name)
  const named = libraryItems("style").concat(libraryItems("function"))
    .filter((item) => item && item.prompt && item.name)
    .sort((a, b) => b.name.length - a.name.length)
  named.forEach((item) => {
    text = text.replace(new RegExp(`@${escapeRegExp(item.name)}`, "g"), item.prompt)
  })
  text = tidyPrompt(text)
  if (custom && (custom.prefix || custom.suffix)) {
    text = [custom.prefix, text, custom.suffix].map((part) => String(part || "").trim()).filter(Boolean).join("\n")
  }
  return text
}

function mentionQuery(field) {
  const value = String(field.value || "")
  let end = value.length
  if (typeof field.selectionStart === "number" && (field.selectionStart > 0 || value.length === 0)) {
    end = field.selectionStart
  }
  const match = value.slice(0, end).match(/@([^\s@]*)$/)
  if (!match) return null
  return { start: end - match[0].length, end, query: match[1] }
}

function insertMention(token) {
  const field = element("positive")
  const value = String(field.value || "")
  const found = mentionQuery(field)
  if (found) field.value = `${value.slice(0, found.start)}${token} ${value.slice(found.end)}`
  else if (!new RegExp(`(?:^|\\s)${escapeRegExp(token)}(?=\\s|$)`).test(value)) field.value = tidyPrompt(`${value} ${token}`)
  syncPromptMirror()
  const menu = element("mention-menu")
  if (menu) menu.classList.add("hidden")
}

function paintMentionMenu() {
  const menu = element("mention-menu")
  const field = element("positive")
  if (!menu || !field) return
  const found = mentionQuery(field)
  if (!found) {
    menu.classList.add("hidden")
    return
  }
  const query = found.query.trim()
  const items = referenceFiles.map((_, index) => `参考图${index + 1}`).filter((label) => !query || label.includes(query))
  menu.textContent = ""
  if (!items.length) {
    const empty = document.createElement("div")
    empty.className = "mention-empty"
    empty.textContent = referenceFiles.length ? "没有匹配的参考图" : "先添加参考图，才能 @参考图1"
    menu.appendChild(empty)
  } else {
    items.forEach((label) => {
      const row = document.createElement("span")
      row.className = "mention-item"
      row.setAttribute("role", "button")
      row.tabIndex = 0
      row.textContent = `@${label}`
      const pick = (event) => {
        event.preventDefault()
        event.stopPropagation()
        insertMention(`@${label}`)
      }
      row.addEventListener("mousedown", pick)
      row.addEventListener("click", pick)
      menu.appendChild(row)
    })
  }
  menu.classList.remove("hidden")
}

function readPromptPresets() {
  try {
    const parsed = JSON.parse(localStorage.getItem(`${STORE_PREFIX}promptPresets`) || "[]")
    if (!Array.isArray(parsed)) return []
    return parsed.map((item) => {
      if (!item || !String(item.name || "").trim()) return null
      if (item.prefix || item.suffix) {
        return { name: String(item.name).trim(), prefix: String(item.prefix || ""), suffix: String(item.suffix || "") }
      }
      if (item.text) return { name: String(item.name).trim(), prefix: String(item.text), suffix: "" }
      return null
    }).filter(Boolean)
  } catch (_) {
    return []
  }
}

function writePromptPresets(items) {
  localStorage.setItem(`${STORE_PREFIX}promptPresets`, JSON.stringify(items.slice(0, 40).map((item) => ({
    name: String(item.name).trim(),
    prefix: String(item.prefix || ""),
    suffix: String(item.suffix || ""),
  }))))
}

function syncPresetButton() {
  const button = element("preset-open")
  const names = []
  const style = libraryItems("style").find((item) => item.id === activeStyleId)
  const filter = libraryItems("function").find((item) => item.id === activeFilterId)
  if (style && style.prompt) names.push(style.name)
  if (filter && filter.prompt) names.push(filter.name)
  const custom = activeCustomPreset()
  if (custom && (custom.prefix || custom.suffix)) names.push(custom.name)
  button.title = names.length ? `预设：${names.join("、")}` : "预设"
  button.classList.toggle("is-on", names.length > 0)
  paintPromptTags()
}

function paintLibrary(hostId, items, activeId, onPick) {
  const host = element(hostId)
  host.textContent = ""
  const groups = []
  items.forEach((item) => {
    let group = groups.find((entry) => entry.name === item.group)
    if (!group) {
      group = { name: item.group, items: [] }
      groups.push(group)
    }
    group.items.push(item)
  })
  groups.forEach((group) => {
    const title = document.createElement("div")
    title.className = "library-group"
    title.textContent = group.name
    host.appendChild(title)
    const grid = document.createElement("div")
    grid.className = "library-grid"
    group.items.forEach((item) => {
      const card = document.createElement("span")
      card.className = "library-card"
      if (item.id === activeId) card.classList.add("is-selected")
      card.setAttribute("role", "button")
      card.tabIndex = 0
      const name = document.createElement("strong")
      name.textContent = item.name
      card.appendChild(name)
      if (item.des) {
        const des = document.createElement("span")
        des.textContent = item.des
        card.appendChild(des)
      }
      card.addEventListener("click", () => onPick(item))
      if (item.user) {
        const remove = document.createElement("button")
        remove.type = "button"
        remove.className = "library-remove"
        remove.textContent = "删除"
        remove.addEventListener("click", (event) => {
          event.stopPropagation()
          writeUserLibrary(readUserLibrary().filter((entry) => entry.id !== item.id))
          if (activeStyleId === item.id) {
            activeStyleId = "style-none"
            localStorage.setItem(`${STORE_PREFIX}promptStyle`, activeStyleId)
          }
          if (activeFilterId === item.id) {
            activeFilterId = "filter-none"
            localStorage.setItem(`${STORE_PREFIX}promptFilter`, activeFilterId)
          }
          syncPresetButton()
          paintLibraries()
        })
        card.appendChild(remove)
      }
      grid.appendChild(card)
    })
    host.appendChild(grid)
  })
}

function paintLibraries() {
  paintLibrary("preset-tab-style", libraryItems("style"), activeStyleId, (item) => {
    const previous = namedSelection("style")
    activeStyleId = item.id
    localStorage.setItem(`${STORE_PREFIX}promptStyle`, item.id)
    placeKindToken(previous, item.prompt ? item.name : "")
    syncPresetButton()
    paintLibraries()
    showStatus(item.prompt ? `已把 @${item.name} 写入提示词` : "已取消风格")
  })
  paintLibrary("preset-tab-filter", libraryItems("function"), activeFilterId, (item) => {
    const previous = namedSelection("function")
    activeFilterId = item.id
    localStorage.setItem(`${STORE_PREFIX}promptFilter`, item.id)
    placeKindToken(previous, item.prompt ? item.name : "")
    syncPresetButton()
    paintLibraries()
    showStatus(item.prompt ? `已把 @${item.name} 写入提示词` : "已取消功能")
  })
}

function selectedPresetTags() {
  const tags = []
  const style = libraryItems("style").find((item) => item.id === activeStyleId)
  const filter = libraryItems("function").find((item) => item.id === activeFilterId)
  const custom = activeCustomPreset()
  if (style && style.prompt) tags.push({ kind: "style", name: style.name })
  if (filter && filter.prompt) tags.push({ kind: "function", name: filter.name })
  if (custom && (custom.prefix || custom.suffix)) tags.push({ kind: "custom", name: custom.name })
  return tags
}

function clearPresetTag(kind) {
  const previous = namedSelection(kind)
  if (kind === "style") {
    activeStyleId = "style-none"
    localStorage.setItem(`${STORE_PREFIX}promptStyle`, activeStyleId)
    paintLibraries()
  } else if (kind === "function") {
    activeFilterId = "filter-none"
    localStorage.setItem(`${STORE_PREFIX}promptFilter`, activeFilterId)
    paintLibraries()
  } else {
    activeCustomName = ""
    paintCustomPresets()
  }
  placeKindToken(previous, "")
  syncPresetButton()
}

function paintPromptTags() {
  const host = element("prompt-tags")
  if (!host) return
  host.textContent = ""
  selectedPresetTags().forEach((tag) => {
    const chip = document.createElement("span")
    chip.className = "prompt-tag"
    const label = document.createElement("span")
    label.textContent = `@${tag.name}`
    chip.appendChild(label)
    const remove = document.createElement("button")
    remove.type = "button"
    remove.title = "移除"
    remove.textContent = "×"
    remove.addEventListener("click", (event) => {
      event.stopPropagation()
      clearPresetTag(tag.kind)
    })
    chip.appendChild(remove)
    host.appendChild(chip)
  })
}

function customPresetCards() {
  const none = { id: "", group: "自定义", name: "无", des: "不使用自定义前后缀", prompt: "", user: false }
  const saved = readPromptPresets().map((item) => ({
    id: item.name,
    group: "自定义",
    name: item.name,
    des: [item.prefix, item.suffix].filter(Boolean).join(" / "),
    prompt: [item.prefix, item.suffix].filter(Boolean).join("\n"),
    user: false,
  }))
  return [none].concat(saved)
}

function paintCustomPresets() {
  const list = element("custom-preset-list")
  if (!list) return
  paintLibrary("custom-preset-list", customPresetCards(), activeCustomName, (item) => {
    const previous = namedSelection("custom")
    activeCustomName = item.id
    placeKindToken(previous, item.prompt ? item.name : "")
    paintCustomPresets()
    syncPresetButton()
    showStatus(item.prompt ? `已把 @${item.name} 写入提示词` : "已取消自定义预设")
  })
  list.querySelectorAll(".library-card").forEach((card) => {
    const name = card.querySelector("strong")
    const title = name ? name.textContent : ""
    if (!title || title === "无") return
    if (card.querySelector(".library-remove")) return
    const remove = document.createElement("button")
    remove.type = "button"
    remove.className = "library-remove"
    remove.textContent = "删除"
    remove.addEventListener("click", (event) => {
      event.stopPropagation()
      writePromptPresets(readPromptPresets().filter((entry) => entry.name !== title))
      if (activeCustomName === title) activeCustomName = ""
      paintCustomPresets()
      syncPresetButton()
    })
    card.appendChild(remove)
  })
}

function showPresetTab(name) {
  element("preset-tab-style").classList.toggle("hidden", name !== "style")
  element("preset-tab-filter").classList.toggle("hidden", name !== "filter")
  element("preset-tab-custom").classList.toggle("hidden", name !== "custom")
  if (name === "custom") paintCustomPresets()
  document.querySelectorAll(".preset-tab").forEach((tab) => {
    tab.classList.toggle("is-active", tab.dataset.presetTab === name)
  })
}

function togglePresetPanel() {
  const panel = element("preset-panel")
  const opening = panel.classList.contains("hidden")
  panel.classList.toggle("hidden", !opening)
  if (!opening) return
  closeComposerMenus()
  paintLibraries()
  paintCustomPresets()
}

function openPresetDialog() {
  element("preset-name-input").value = ""
  element("preset-prefix").value = ""
  element("preset-suffix").value = ""
  element("preset-dialog").classList.remove("hidden")
  element("preset-name-input").focus()
}

function closePresetDialog() {
  element("preset-dialog").classList.add("hidden")
}

function confirmPreset() {
  const prefix = element("preset-prefix").value.trim()
  const suffix = element("preset-suffix").value.trim()
  const name = element("preset-name-input").value.trim()
  if (!prefix && !suffix) {
    showStatus("前缀和后缀都是空的", true)
    return
  }
  if (!name) {
    showStatus("请先给预设起个名字", true)
    return
  }
  const items = readPromptPresets().filter((item) => item.name !== name)
  items.unshift({ name, prefix, suffix })
  writePromptPresets(items)
  const previous = namedSelection("custom")
  activeCustomName = name
  placeKindToken(previous, name)
  showPresetTab("custom")
  paintCustomPresets()
  syncPresetButton()
  closePresetDialog()
  showStatus(`已选用预设「${name}」`)
}

function paintToggle(button, on) {
  button.classList.toggle("active", on)
  button.setAttribute("aria-pressed", on ? "true" : "false")
  if (!button.dataset.label) button.dataset.label = button.title
  button.title = `${button.dataset.label}：${on ? "开" : "关"}`
}

function bindCheckToggle(buttonId, inputId, afterClick) {
  const button = element(buttonId)
  const input = element(inputId)
  const paint = () => paintToggle(button, input.checked)
  button.addEventListener("click", () => {
    input.checked = !input.checked
    input.dispatchEvent(new Event("change", { bubbles: true }))
    paint()
    if (afterClick) afterClick(input.checked)
  })
  input.addEventListener("change", paint)
  paint()
}

function scheduleLiveRender() {
  if (batchRunning) return
  if (!element("render-on-change").checked || element("render").disabled) return
  clearTimeout(liveTimer)
  liveTimer = setTimeout(() => {
    if (batchRunning || element("render").disabled) return
    renderBatch(1)
  }, 700)
}

function historyMarker(document) {
  const state = document.activeHistoryState
  if (!state) return ""
  return `${state.id ?? ""}:${state.name ?? ""}`
}

function startDocumentWatch() {
  if (watchTimer) return
  lastHistoryMarker = null
  lastSelectionKey = null
  watchTimer = setInterval(() => {
    watchDocument().catch(() => {})
  }, 400)
}

function stopDocumentWatch() {
  clearInterval(watchTimer)
  watchTimer = null
}

function applyLiveRender(enabled, announce) {
  paintToggle(element("live-toggle"), enabled)
  if (enabled) startDocumentWatch()
  else stopDocumentWatch()
  if (announce) showStatus(enabled ? "文档变化时会自动渲染" : "已关闭自动渲染")
}

async function watchDocument() {
  if (!element("render-on-change").checked || !app?.documents?.length) return
  if (batchRunning || Date.now() < suppressWatchUntil || element("render").disabled) return
  const document = app.activeDocument
  const marker = historyMarker(document)
  const selection = await activeSelection(document)
  const key = selection ? `${selection.left},${selection.top},${selection.right},${selection.bottom}` : ""
  if (lastHistoryMarker === null) {
    lastHistoryMarker = marker
    lastSelectionKey = key
    return
  }
  const historyChanged = marker !== lastHistoryMarker
  const selectionChanged = key !== lastSelectionKey
  const name = marker.slice(marker.indexOf(":") + 1)
  lastHistoryMarker = marker
  lastSelectionKey = key
  if (/ComfyTV|Mask Sent to AI/i.test(name)) return
  if (historyChanged || (selectionChanged && element("crop-selection").checked)) {
    suppressWatchUntil = Date.now() + 1200
    renderBatch(1)
  }
}

function mountEmbeddedComfy() {
  const view = document.getElementById("comfy-webview")
  if (!view) return
  let src = EMBEDDED_COMFY
  try { src = serverAddress() } catch (_) {}
  if ((view.getAttribute("src") || "") !== src) view.setAttribute("src", src)
}

async function openComfyUI() {
  try {
    const uxp = loadModule("uxp")
    const plugins = uxp.pluginManager && uxp.pluginManager.plugins
    const list = plugins ? Array.from(plugins) : []
    const info = uxp.entrypoints && uxp.entrypoints._pluginInfo
    const plugin = list.find((item) => item && (item.id === "com.comfytv.photoshop.uxp" || (info && item.id === info.id)))
    if (!plugin || typeof plugin.showPanel !== "function") {
      showStatus("打不开内嵌的 ComfyUI 面板", true)
      return
    }
    await plugin.showPanel(WEB_PANEL_ID)
    showStatus("已在 Photoshop 中打开 ComfyUI")
  } catch (error) {
    showStatus(error.message || String(error), true)
  }
}

function saveSettings() {
  const values = {
    positive: element("positive").value,
    negative: element("negative").value,
    seed: element("seed").value,
    maxRes: element("max-res").value,
    minRes: element("min-res").value,
    cropSelection: element("crop-selection").checked,
    cropPad: element("crop-pad").value,
    autoSeed: element("auto-seed").checked,
    liveRender: element("render-on-change").checked,
    batchCount: batchCount(),
  }
  Object.entries(values).forEach(([key, value]) => localStorage.setItem(`${STORE_PREFIX}${key}`, String(value)))
}

function restoreSettings() {
  element("server").value = localStorage.getItem(`${STORE_PREFIX}server`) || DEFAULT_SERVER
  const textIds = ["positive", "negative", "seed"]
  textIds.forEach((id) => {
    const saved = localStorage.getItem(`${STORE_PREFIX}${id}`)
    if (saved !== null) element(id).value = saved
  })
  const savedMax = localStorage.getItem(`${STORE_PREFIX}maxRes`) || localStorage.getItem(`${STORE_PREFIX}maxEdge`)
  const savedMin = localStorage.getItem(`${STORE_PREFIX}minRes`)
  if (savedMax !== null) element("max-res").value = savedMax
  if (savedMin !== null) element("min-res").value = savedMin
  const savedPad = localStorage.getItem(`${STORE_PREFIX}cropPad`)
  if (savedPad !== null) element("crop-pad").value = savedPad
  const checks = [
    ["crop-selection", "cropSelection", true],
    ["auto-seed", "autoSeed", false],
    ["render-on-change", "liveRender", false],
  ]
  checks.forEach(([id, key, fallback]) => {
    const saved = localStorage.getItem(`${STORE_PREFIX}${key}`)
    element(id).checked = saved === null ? fallback : saved === "true"
  })
  const savedBatch = Number.parseInt(localStorage.getItem(`${STORE_PREFIX}batchCount`) || "1", 10)
  element("batch-count").value = String(Number.isFinite(savedBatch) ? Math.max(1, Math.min(BATCH_MAX, savedBatch)) : 1)
  setPreviewFit(localStorage.getItem(`${STORE_PREFIX}fitContain`) === "true")
  loadRenderProfile()
  syncComposer()
}

function initialize() {
  paintIcons()
  if (typeof mountGlass === "function") mountGlass()
  window.addEventListener("resize", () => {
    if (element("progress-frame").classList.contains("active")) paintMarquee()
  })
  restoreSettings()
  element("settings-toggle").addEventListener("click", () => toggleDrawer("settings-drawer"))
  element("web-toggle").addEventListener("click", () => { openComfyUI() })
  document.querySelectorAll("[data-close]").forEach((button) => {
    button.addEventListener("click", () => {
      element(button.dataset.close).classList.add("hidden")
      syncDrawerButtons("")
    })
  })
  element("fit-toggle").addEventListener("click", () => {
    const contain = !element("preview").classList.contains("contain")
    setPreviewFit(contain)
    localStorage.setItem(`${STORE_PREFIX}fitContain`, String(contain))
  })
  bindCheckToggle("crop-toggle", "crop-selection", () => scheduleLiveRender())
  element("live-toggle").addEventListener("click", () => {
    const input = element("render-on-change")
    input.checked = !input.checked
    input.dispatchEvent(new Event("change", { bubbles: true }))
  })
  element("render-on-change").addEventListener("change", () => {
    applyLiveRender(element("render-on-change").checked, true)
  })
  applyLiveRender(element("render-on-change").checked, false)
  element("randomize").addEventListener("click", randomSeed)
  element("model-trigger").addEventListener("click", (event) => {
    event.stopPropagation()
    toggleComposerMenu("model-menu")
  })
  element("mode-trigger").addEventListener("click", (event) => {
    event.stopPropagation()
    toggleComposerMenu("mode-menu")
  })
  element("count-trigger").addEventListener("click", (event) => {
    event.stopPropagation()
    toggleComposerMenu("count-menu")
  })
  element("ref-doc").addEventListener("click", () => {
    showStatus("生成时使用当前 Photoshop 画面")
  })
  element("ref-add-btn").addEventListener("click", (event) => {
    event.preventDefault()
    event.stopPropagation()
    addReferenceImage()
  })
  document.addEventListener("click", (event) => {
    if (event.target.closest && event.target.closest(".composer-menu, #model-trigger, #mode-trigger, #count-trigger")) return
    closeComposerMenus()
  })
  element("preset-save-chip").addEventListener("click", openPresetDialog)
  element("preset-open").addEventListener("click", togglePresetPanel)
  element("preset-panel-close").addEventListener("click", (event) => {
    event.stopPropagation()
    element("preset-panel").classList.add("hidden")
  })
  document.querySelectorAll(".preset-tab").forEach((tab) => {
    tab.addEventListener("click", () => showPresetTab(tab.dataset.presetTab))
  })
  element("preset-dialog-close").addEventListener("click", closePresetDialog)
  element("preset-dialog-ok").addEventListener("click", confirmPreset)
  element("preset-name-input").addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return
    event.preventDefault()
    confirmPreset()
  })
  element("positive").addEventListener("input", paintMentionMenu)
  element("positive").addEventListener("keyup", paintMentionMenu)
  element("positive").addEventListener("click", paintMentionMenu)
  element("positive").addEventListener("keydown", (event) => {
    const menu = element("mention-menu")
    if (!menu || menu.classList.contains("hidden")) return
    if (event.key === "Escape") {
      menu.classList.add("hidden")
      return
    }
    if (event.key !== "Enter") return
    const first = menu.querySelector(".mention-item")
    if (!first) return
    event.preventDefault()
    first.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }))
  })
  syncPresetButton()
  ;["style", "function", "custom"].forEach((kind) => {
    const name = namedSelection(kind)
    if (name) placeKindToken("", name)
  })
  let suppressRenderClick = false
  element("render").addEventListener("click", () => {
    if (suppressRenderClick) {
      suppressRenderClick = false
      return
    }
    renderBatch()
  })
  element("render").addEventListener("contextmenu", (event) => {
    event.preventDefault()
    suppressRenderClick = true
    if (batchRunning) {
      renderBatch()
      return
    }
    randomSeed()
    if (!element("render").disabled) renderBatch()
  })
  element("send-layer").addEventListener("click", sendLayer)
  element("connect").addEventListener("click", connect)
  element("add-layer").addEventListener("click", addResultLayer)
  element("preview-hit").addEventListener("click", addResultLayer)
  element("empty-preview").addEventListener("click", addResultLayer)
  element("positive").addEventListener("input", scheduleLiveRender)
  element("negative").addEventListener("input", scheduleLiveRender)
  element("seed").addEventListener("change", scheduleLiveRender)
  element("workflow").addEventListener("change", (event) => {
    if (event.target.value === "") return
    syncProfileToModel()
    try {
      sendSocket({ workflow: Number(event.target.value) })
      pushRenderProfile()
      showStatus("已切换模型")
      scheduleLiveRender()
    } catch (error) {
      showStatus(error.message, true)
    }
  })
  document.querySelectorAll("[role='button']").forEach((button) => {
    button.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return
      event.preventDefault()
      button.click()
    })
  })
  document.querySelectorAll("textarea, input").forEach((control) => control.addEventListener("change", saveSettings))
  const stage = document.querySelector(".preview-stage")
  stage.addEventListener("mouseenter", focusHistoryKeys)
  stage.addEventListener("pointerdown", () => focusHistoryKeys(), true)
  stage.addEventListener("keydown", onHistoryKey)
  window.addEventListener("keydown", onHistoryKey, true)
  document.addEventListener("keydown", (event) => {
    const typing = typingTarget(event.target)
    if (!typing && event.ctrlKey && event.shiftKey && event.key === "Enter") {
      event.preventDefault()
      if (!element("render").disabled) renderBatch()
    }
    onHistoryKey(event)
  })
  window.addEventListener("beforeunload", () => {
    clearTimeout(reconnectTimer)
    clearTimeout(liveTimer)
    stopDocumentWatch()
    if (socket) socket.close()
  })
  const historyHover = element("history-hover")
  const historyStrip = element("history-strip")
  const historyHotspot = element("history-hotspot")
  historyHotspot.addEventListener("mouseenter", showHistoryCards)
  historyStrip.addEventListener("mouseenter", showHistoryCards)
  historyHotspot.addEventListener("mouseleave", scheduleHideHistory)
  historyStrip.addEventListener("mouseleave", scheduleHideHistory)
  historyStrip.addEventListener("click", (event) => {
    const card = historyCardFromEvent(event)
    if (!card) return
    selectHistory(Number(card.dataset.index)).catch((error) => showStatus(error.message, true))
  })
  historyStrip.addEventListener("wheel", onHistoryWheel, true)
  historyStrip.addEventListener("mousewheel", onHistoryWheel, true)
  historyStrip.addEventListener("scroll", () => {
    if (historyOpen) mountVisibleThumbs()
  })
  element("history-limit-close").addEventListener("click", dismissHistoryLimit)
  element("history-clean").addEventListener("click", () => {
    cleanOldRenders().catch((error) => showStatus(error.message, true))
  })
  element("history-open-folder").addEventListener("click", () => {
    openRenderFolder().catch((error) => showStatus(error.message, true))
  })
  restoreRenderHistory()
    .catch((error) => showStatus(error.message, true))
    .then(() => connect())
}

let panelBooted = false

function bootMain() {
  if (panelBooted || !document.getElementById("render")) return
  const main = document.querySelector('uxp-panel[panelid="com.comfytv.photoshop.panel"]')
  const web = document.querySelector('uxp-panel[panelid="' + WEB_PANEL_ID + '"]')
  if (main && web && window.getComputedStyle(main).display === "none" && window.getComputedStyle(web).display !== "none") return
  panelBooted = true
  initialize()
}

function boot() {
  const uxp = loadModule("uxp")
  try {
    if (uxp.entrypoints && typeof uxp.entrypoints.setup === "function") {
      uxp.entrypoints.setup({
        panels: {
          "com.comfytv.photoshop.panel": {
            create() { bootMain() },
            show() { bootMain() },
          },
          [WEB_PANEL_ID]: {
            create() { mountEmbeddedComfy() },
            show() { mountEmbeddedComfy() },
          },
        },
      })
    }
  } catch (error) {
    console.error(error)
  }
  const start = () => {
    bootMain()
    if (!panelBooted) setTimeout(bootMain, 0)
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start)
  else start()
}

boot()
