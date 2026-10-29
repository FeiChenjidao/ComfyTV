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
const PLUGIN_VERSION = "0.2.1"
const clientId = `comfytv-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`

let socket = null
let reconnectTimer = null
let toastTimer = null
let latestRenderFile = null
let capturePreviewFile = null
let lastCaptureBounds = null
let lastSentFrame = null
let lastDocumentPpi = 72
let renderCount = 0
let watchTimer = null
let liveTimer = null
let lastHistoryMarker = null
let lastSelectionKey = null
let suppressWatchUntil = 0

function element(id) {
  return document.getElementById(id)
}

function normalizeServer(value) {
  const server = String(value || "").trim().replace(/\/$/, "")
  if (!/^http:\/\/(127\.0\.0\.1|localhost):8188$/i.test(server)) {
    throw new Error("当前版本仅允许 http://127.0.0.1:8188")
  }
  // UXP 的域名白名单不认 127.0.0.1 这种 IP，请求会被报成 Manifest entry not found。
  // localhost 和它是同一台机器、同一个端口。
  return "http://localhost:8188"
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
  if (busy) setConnection("读取图像", "busy")
  else if (socket?.readyState === WebSocket.OPEN) setConnection("已连接", "connected")
  else setConnection("未连接", "error")
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
  if (width <= GPT_MAX_EDGE && height <= GPT_MAX_EDGE && width * height <= GPT_MAX_PIXELS) return null
  const fitted = fitGptImageSize(width, height)
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

  return {
      captureNote: captureNote(sourceBounds, mode, frame),
    canvasBase64: canvas.encoded,
    maskBase64,
    configdata: {
      positive: element("positive").value,
      negative: element("negative").value,
      seed: String(validSeed()),
        // 面板上已经没有强度滑条。节点仍读取这个字段，固定传 63。
        slider: 63,
      pluginVer: PLUGIN_VERSION,
    },
    queue: true,
  }
  })
}

async function encodeActiveLayer() {
  if (!app.documents.length) throw new Error("请先打开 Photoshop 文档")
  const document = app.activeDocument
  const layer = document.activeLayers[0]
  if (!layer) throw new Error("请先选择一个图层")

  const selection = await activeSelection(document)
  const limit = fullDocumentBounds(document)
  const layerBounds = clampBounds(plainBounds(layer.boundsNoEffects || layer.bounds), limit)
  if (!layerBounds) throw new Error("当前图层没有可发送的像素")
  const sourceBounds = (selection && clampBounds(selection, layerBounds)) || layerBounds
  const image = await encodePixels({
    documentID: document.id,
    layerID: layer.id,
    sourceBounds,
    componentSize: 8,
    colorSpace: "RGB",
  })

  return {
    image_base64: image.encoded,
    document: document.name,
    layer: layer.name,
    bounds: sourceBounds,
    layer_bounds: image.sourceBounds || layerBounds,
    selection_bounds: selection,
  }
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
  // 画布、遮罩、排队分成三条消息。旧服务端单条上限 4MB，合在一起会把连接掐掉。
  sendSocket({ canvasBase64: payload.canvasBase64 })
  if (payload.maskBase64) sendSocket({ maskBase64: payload.maskBase64 })
  const rest = { queue: payload.queue }
  if (payload.configdata) rest.configdata = payload.configdata
  sendSocket(rest)
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

async function receiveRender(value) {
  const base64 = String(value || "").replace(/^data:image\/[^;]+;base64,/, "")
  if (!base64) return
  renderCount += 1
  const previous = latestRenderFile
  latestRenderFile = await writeDataFile(`render-${renderCount}.png`, base64)
  if (previous) {
    try { await previous.delete() } catch (_) {}
  }
  showPreview(base64, latestRenderFile.url)
  element("add-layer").disabled = false
  setProgress("完成")
  finishMarquee()
  showStatus("生成结果已收到")
}

function handleSocketMessage(event) {
  try {
    const message = JSON.parse(event.data)
    if (message.render) receiveRender(message.render).catch((error) => showStatus(error.message, true))
    if (message.render_status) {
      const status = String(message.render_status)
      setProgress(status)
      if (status === "genrating") setMarquee(0, true)
      else if (status === "genrated") finishMarquee()
      else if (status === "genrate_error") setMarquee(0, false)
    }
    if (message.progress !== undefined) {
      const percent = Number(message.progress)
      setProgress(`${percent}%`)
      if (!Number.isNaN(percent)) setMarquee(percent, true)
    }
    if (message.Send_workflow) updateOptions("workflow", message.Send_workflow)
    if (message.Send_rndrMode) updateOptions("render-mode", message.Send_rndrMode)
    if (message.alert) showStatus(String(message.alert), true)
  } catch (error) {
    showStatus(`无法解析 ComfyUI 消息：${error.message}`, true)
  }
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
  setProgress("读取 Photoshop")
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
  } finally {
    setBusy(false)
  }
}

async function sendLayer() {
  setBusy(true)
  try {
    const payload = await core.executeAsModal(
      () => encodeActiveLayer(),
      { commandName: "Send active layer to ComfyTV" },
    )
    const result = await request("/comfytv/photoshop/layer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
    showStatus(`${result.layer || result.name || "当前图层"} 已发送到 ComfyTV`)
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

function inflateZlib(bytes) {
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
  const output = []
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
      for (let index = 0; index < size; index += 1) output.push(bytes[position + index])
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
        output.push(symbol)
        continue
      }
      if (symbol === 256) break
      const lengthIndex = symbol - 257
      const length = LENGTH_BASE[lengthIndex] + (LENGTH_EXTRA[lengthIndex] ? read(LENGTH_EXTRA[lengthIndex]) : 0)
      const distanceIndex = readSymbol(distanceTree)
      const distance = DIST_BASE[distanceIndex] + (DIST_EXTRA[distanceIndex] ? read(DIST_EXTRA[distanceIndex]) : 0)
      for (let index = 0; index < length; index += 1) output.push(output[output.length - distance])
    }
  }
  return new Uint8Array(output)
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
  const inflated = inflateZlib(concatBytes(parts))
  const channels = header.colorType === 6 ? 4 : 2
  const stride = header.width * channels
  const rowBytes = stride + 1
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
  }
}

function closePrompt() {
  element("prompt-card").classList.add("hidden")
  element("spark-button").classList.remove("active")
}

function syncDrawerButtons(openId) {
  element("settings-toggle").classList.toggle("active", openId === "settings-drawer")
  element("menu-button").classList.toggle("active", openId === "workflow-drawer")
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
    closePrompt()
    if (id === "workflow-drawer") announceWorkflowList()
  }
  syncDrawerButtons(opening ? id : "")
}

function togglePrompt() {
  const card = element("prompt-card")
  const opening = card.classList.contains("hidden")
  card.classList.toggle("hidden", !opening)
  element("spark-button").classList.toggle("active", opening)
  if (opening) {
    document.querySelectorAll(".drawer").forEach((item) => item.classList.add("hidden"))
    syncDrawerButtons("")
  }
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
  if (!element("render-on-change").checked || element("render").disabled) return
  clearTimeout(liveTimer)
  liveTimer = setTimeout(() => {
    if (!element("render").disabled) render()
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
  if (Date.now() < suppressWatchUntil || element("render").disabled) return
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
    render()
  }
}

function mountEmbeddedComfy() {
  const view = document.getElementById("comfy-webview")
  if (!view) return
  const current = view.getAttribute("src") || ""
  if (!current || current === "about:blank") view.setAttribute("src", EMBEDDED_COMFY)
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
    renderOnChange: element("render-on-change").checked,
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
    ["render-on-change", "renderOnChange", false],
  ]
  checks.forEach(([id, key, fallback]) => {
    const saved = localStorage.getItem(`${STORE_PREFIX}${key}`)
    element(id).checked = saved === null ? fallback : saved === "true"
  })
  setPreviewFit(localStorage.getItem(`${STORE_PREFIX}fitContain`) === "true")
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
  element("menu-button").addEventListener("click", () => toggleDrawer("workflow-drawer"))
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
  element("spark-button").addEventListener("click", togglePrompt)
  let suppressRenderClick = false
  element("render").addEventListener("click", () => {
    if (suppressRenderClick) {
      suppressRenderClick = false
      return
    }
    render()
  })
  element("render").addEventListener("contextmenu", (event) => {
    event.preventDefault()
    suppressRenderClick = true
    randomSeed()
    if (!element("render").disabled) render()
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
    try {
      sendSocket({ workflow: Number(event.target.value) })
      showStatus("已切换工作流")
      scheduleLiveRender()
    } catch (error) {
      showStatus(error.message, true)
    }
  })
  element("render-mode").addEventListener("change", (event) => {
    if (event.target.value === "") return
    try {
      sendSocket({ rndrMode: Number(event.target.value) })
      showStatus("已切换渲染模式")
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
  document.addEventListener("keydown", (event) => {
    const target = event.target
    const typing = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")
    if (!typing && event.ctrlKey && event.shiftKey && event.key === "Enter") {
      event.preventDefault()
      if (!element("render").disabled) render()
    }
  })
  window.addEventListener("beforeunload", () => {
    clearTimeout(reconnectTimer)
    clearTimeout(liveTimer)
    stopDocumentWatch()
    if (socket) socket.close()
  })
  connect()
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
