(function attachComfyDirectApi(root) {
  "use strict"

  const API_ROOT = "https://api.comfy.org"
  const USAGE_SOURCE = "comfytv-photoshop"
  const RETRY_STATUS = new Set([408, 429, 500, 502, 503, 504])
  const DEFAULT_TIMEOUT_MS = 8 * 60 * 1000
  const VALIDATION_TIMEOUT_MS = 15 * 1000
  const GPT_SIZE_LIMITS = Object.freeze({
    minPixels: 655360,
    maxPixels: 8294400,
    inputMaxPixels: 8294400,
    minEdge: 480,
    maxEdge: 3840,
    maxRatio: 3,
    step: 16,
  })
  const GEMINI_SYSTEM_PROMPT = [
    "You are an expert image-generation engine. You must ALWAYS produce an image.",
    "Interpret all user input, regardless of format, intent, or abstraction, as literal visual directives for image composition.",
    "If a prompt is conversational or lacks specific visual details, creatively invent a concrete visual scenario that depicts the concept.",
    "Prioritize generating the visual representation above any text, formatting, or conversational requests.",
    "Treat every image-role label as authoritative.",
    "A binary editing mask is a hidden pixel-aligned control map for the Photoshop canvas, never a visible reference image.",
    "Only the white mask area may be changed. The black mask area must preserve the corresponding Photoshop-canvas content as closely as possible.",
    "The mask has no subject, composition, color, texture, frame, or shape meaning. Never render, copy, trace, describe, or stylize any part of it.",
    "The final image must contain no mask square, rectangle, border, outline, white or black field, selection boundary, crop box, or mask-shaped artifact.",
  ].join("\n")

  class DirectApiError extends Error {
    constructor(code, message, status, details) {
      super(message)
      this.name = "DirectApiError"
      this.code = code || "unknown"
      this.status = Number(status) || 0
      this.details = details || ""
    }
  }

  function fitGptSize(sourceWidth, sourceHeight, options = {}) {
    const limits = GPT_SIZE_LIMITS
    const maxPixels = Math.min(limits.maxPixels, Math.max(limits.minPixels, Number(options.maxPixels) || limits.maxPixels))
    let width = Math.max(1, Number(sourceWidth) || 1)
    let height = Math.max(1, Number(sourceHeight) || 1)
    if (width / height > limits.maxRatio) width = height * limits.maxRatio
    else if (height / width > limits.maxRatio) height = width * limits.maxRatio

    let scale = Math.min(1, limits.maxEdge / Math.max(width, height), Math.sqrt(maxPixels / (width * height)))
    if (width * height * scale * scale < limits.minPixels) {
      scale = Math.max(scale, Math.sqrt(limits.minPixels / (width * height)))
    }
    if (Math.min(width, height) * scale < limits.minEdge) {
      scale = Math.max(scale, limits.minEdge / Math.min(width, height))
    }
    scale = Math.min(scale, limits.maxEdge / Math.max(width, height), Math.sqrt(maxPixels / (width * height)))
    width *= scale
    height *= scale

    const aspect = width / height
    const snap = (value) => Math.max(limits.step, Math.round(value / limits.step) * limits.step)
    const snapUp = (value) => Math.max(limits.step, Math.ceil(value / limits.step) * limits.step)
    const snapDown = (value) => Math.max(limits.step, Math.floor(value / limits.step) * limits.step)
    let fittedWidth = snap(width)
    let fittedHeight = snap(fittedWidth / aspect)
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const pixels = fittedWidth * fittedHeight
      const edge = Math.max(fittedWidth, fittedHeight)
      const shortEdge = Math.min(fittedWidth, fittedHeight)
      const ratio = edge / shortEdge
      if (pixels < limits.minPixels || shortEdge < limits.minEdge) {
        const grow = Math.max(Math.sqrt(limits.minPixels / pixels), limits.minEdge / shortEdge)
        const nextWidth = snapUp(fittedWidth * grow)
        fittedWidth = nextWidth > fittedWidth ? nextWidth : fittedWidth + limits.step
        fittedHeight = snap(fittedWidth / aspect)
        continue
      }
      if (pixels > maxPixels || edge > limits.maxEdge || ratio > limits.maxRatio + 1e-6) {
        const shrink = Math.min(Math.sqrt(maxPixels / pixels), limits.maxEdge / edge, limits.maxRatio / ratio)
        const nextWidth = snapDown(Math.max(limits.step, fittedWidth * shrink))
        fittedWidth = nextWidth < fittedWidth ? nextWidth : Math.max(limits.step, fittedWidth - limits.step)
        fittedHeight = snap(fittedWidth / aspect)
        continue
      }
      break
    }
    return {
      width: Math.min(limits.maxEdge, fittedWidth),
      height: Math.min(limits.maxEdge, fittedHeight),
    }
  }

  function cleanBase64(value) {
    return String(value || "").replace(/^data:[^;]+;base64,/i, "").replace(/\s+/g, "")
  }

  function base64Bytes(value) {
    const clean = cleanBase64(value)
    const binary = atob(clean)
    const bytes = new Uint8Array(binary.length)
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
    return bytes
  }

  function bytesBase64(value) {
    const bytes = value instanceof Uint8Array ? value : new Uint8Array(value || [])
    let binary = ""
    const chunk = 0x8000
    for (let offset = 0; offset < bytes.length; offset += chunk) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk))
    }
    return btoa(binary)
  }

  function pngSize(value) {
    const bytes = value instanceof Uint8Array ? value : new Uint8Array(value || [])
    if (bytes.length < 24 || bytes[0] !== 137 || bytes[1] !== 80 || bytes[2] !== 78 || bytes[3] !== 71) return null
    const read = (offset) => (((bytes[offset] << 24) >>> 0) + (bytes[offset + 1] << 16) + (bytes[offset + 2] << 8) + bytes[offset + 3]) >>> 0
    return { width: read(16), height: read(20) }
  }

  function requestId(jobId, batchIndex) {
    const base = String(jobId || `direct-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`)
    return `${base}-${Number(batchIndex) || 0}`.replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 240)
  }

  function extractMessage(payload, fallback) {
    if (!payload) return fallback
    if (typeof payload === "string") return payload.slice(0, 600) || fallback
    const value = payload.error?.message || payload.error || payload.detail || payload.message || payload.reason
    if (typeof value === "string" && value.trim()) return value.trim().slice(0, 600)
    return fallback
  }

  function mapHttpError(status, payload) {
    const detail = extractMessage(payload, "")
    if (/content|safety|moderation|blocked|policy/i.test(detail)) {
      return new DirectApiError("content_blocked", "请求内容被模型安全策略拦截", status)
    }
    if (status === 401) return new DirectApiError("invalid_key", "API Key 无效或已经失效", status)
    if (status === 402) return new DirectApiError("insufficient_balance", "Comfy API 余额不足", status)
    if (status === 403) return new DirectApiError("forbidden", "当前 API Key 没有调用权限", status)
    if (status === 408) return new DirectApiError("timeout", "请求超时，请稍后重试", status)
    if (status === 429) return new DirectApiError("rate_limited", "请求过于频繁，请稍后重试", status)
    if (status === 400 || status === 404 || status === 409 || status === 422) {
      return new DirectApiError("invalid_request", detail || "生成参数不被 API 接受", status)
    }
    if (status >= 500) return new DirectApiError("server_error", "Comfy API 暂时不可用，请稍后重试", status)
    return new DirectApiError("http_error", extractMessage(payload, `Comfy API 请求失败（${status}）`), status)
  }

  function mapNetworkError(error) {
    if (error instanceof DirectApiError) return error
    if (error && (error.name === "AbortError" || /aborted|abort/i.test(String(error.message || "")))) {
      return new DirectApiError("aborted", "已停止")
    }
    if (/timeout/i.test(String(error?.message || ""))) return new DirectApiError("timeout", "请求超时，请稍后重试")
    return new DirectApiError("network", "无法连接 Comfy API，请检查网络")
  }

  function abortError() {
    const error = new Error("Aborted")
    error.name = "AbortError"
    return error
  }

  function delay(ms, signal) {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(abortError())
        return
      }
      const timer = setTimeout(resolve, ms)
      if (signal) signal.addEventListener("abort", () => {
        clearTimeout(timer)
        reject(abortError())
      }, { once: true })
    })
  }

  function retryDelay(response, attempt) {
    const retryAfter = Number(response?.headers?.get?.("retry-after"))
    if (Number.isFinite(retryAfter) && retryAfter > 0) return Math.min(30000, retryAfter * 1000)
    return Math.min(8000, 700 * (2 ** attempt))
  }

  function linkedController(externalSignal, timeoutMs) {
    const controller = new AbortController()
    let timedOut = false
    const abort = () => controller.abort()
    if (externalSignal) externalSignal.addEventListener("abort", abort, { once: true })
    const timer = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, timeoutMs || DEFAULT_TIMEOUT_MS)
    return {
      signal: controller.signal,
      timedOut: () => timedOut,
      dispose() {
        clearTimeout(timer)
        if (externalSignal) externalSignal.removeEventListener("abort", abort)
      },
    }
  }

  async function responsePayload(response) {
    const text = await response.text()
    if (!text) return {}
    try { return JSON.parse(text) } catch (_) { return text }
  }

  async function fetchWithRetry(path, options) {
    const fetchImpl = options.fetchImpl || fetch
    const attempts = Math.max(1, Number(options.attempts) || 3)
    const timeout = linkedController(options.signal, options.timeoutMs)
    try {
      for (let attempt = 0; attempt < attempts; attempt += 1) {
        try {
          const request = options.buildRequest()
          const response = await fetchImpl(`${API_ROOT}${path}`, { ...request, signal: timeout.signal })
          if (response.ok) return { response, payload: await responsePayload(response) }
          const payload = await responsePayload(response)
          if (!RETRY_STATUS.has(response.status) || attempt === attempts - 1) throw mapHttpError(response.status, payload)
          options.onRetry?.({ attempt: attempt + 1, status: response.status })
          await delay(retryDelay(response, attempt), timeout.signal)
        } catch (error) {
          if (error instanceof DirectApiError) throw error
          if (timeout.signal.aborted) {
            if (timeout.timedOut() && !options.signal?.aborted) throw new DirectApiError("timeout", "请求超时，请稍后重试")
            throw mapNetworkError(error)
          }
          if (attempt === attempts - 1) throw mapNetworkError(error)
          options.onRetry?.({ attempt: attempt + 1, status: 0 })
          await delay(retryDelay(null, attempt), timeout.signal)
        }
      }
      throw new DirectApiError("network", "无法连接 Comfy API，请检查网络")
    } finally {
      timeout.dispose()
    }
  }

  async function fetchAbsolute(url, options = {}) {
    const fetchImpl = options.fetchImpl || fetch
    const timeout = linkedController(options.signal, options.timeoutMs)
    try {
      const response = await fetchImpl(String(url || ""), { ...(options.request || {}), signal: timeout.signal })
      if (!response.ok) throw new DirectApiError("storage_error", `文件传输失败（${response.status}）`, response.status)
      return response
    } catch (error) {
      if (timeout.signal.aborted) {
        if (timeout.timedOut() && !options.signal?.aborted) throw new DirectApiError("timeout", "文件传输超时，请稍后重试")
        throw mapNetworkError(error)
      }
      throw mapNetworkError(error)
    } finally {
      timeout.dispose()
    }
  }

  function authHeaders(apiKey, idempotencyKey, json) {
    const headers = {
      "X-API-KEY": String(apiKey || "").trim(),
      "Comfy-Usage-Source": USAGE_SOURCE,
      "Idempotency-Key": idempotencyKey,
    }
    if (json) headers["Content-Type"] = "application/json"
    return headers
  }

  async function validateApiKey(apiKey, options = {}) {
    const key = String(apiKey || "").trim()
    if (!key) throw new DirectApiError("missing_key", "请先输入 Comfy API Key")
    const result = await fetchWithRetry("/customers/me", {
      ...options,
      attempts: 1,
      timeoutMs: Number.isFinite(options.timeoutMs) ? options.timeoutMs : VALIDATION_TIMEOUT_MS,
      buildRequest: () => ({ method: "GET", headers: { "X-API-KEY": key, "Comfy-Usage-Source": USAGE_SOURCE } }),
    })
    return result.payload || {}
  }

  function validateGptSize(profile) {
    const size = String(profile?.size || profile?.resolution || "auto")
    if (size !== "Custom") return size
    const width = Number(profile.customWidth)
    const height = Number(profile.customHeight)
    if (!Number.isInteger(width) || !Number.isInteger(height) || width % GPT_SIZE_LIMITS.step || height % GPT_SIZE_LIMITS.step) {
      throw new DirectApiError("invalid_request", "GPT 自定义宽高必须是 16 的倍数")
    }
    if (Math.min(width, height) < GPT_SIZE_LIMITS.minEdge || Math.max(width, height) > GPT_SIZE_LIMITS.maxEdge) {
      throw new DirectApiError("invalid_request", "GPT 自定义宽高必须在 480 到 3840 之间")
    }
    if (Math.max(width, height) / Math.min(width, height) > GPT_SIZE_LIMITS.maxRatio) {
      throw new DirectApiError("invalid_request", "GPT 自定义尺寸的长宽比不能超过 3:1")
    }
    const pixels = width * height
    if (pixels < GPT_SIZE_LIMITS.minPixels || pixels > GPT_SIZE_LIMITS.maxPixels) {
      throw new DirectApiError("invalid_request", "GPT 自定义尺寸总像素必须在 655,360 到 8,294,400 之间")
    }
    return `${width}x${height}`
  }

  function geminiImageParts(images) {
    const parts = []
    ;(images || []).filter((image) => image && image.base64).forEach((image, index) => {
      const number = index + 1
      const role = String(image.role || "reference")
      if (role === "canvas") {
        parts.push({ text: "Image " + number + " is the Photoshop canvas and the only base image to edit. Preserve everything outside the requested change." })
      } else if (role === "mask") {
        parts.push({ text: "Image " + number + " is a hidden binary editing mask aligned pixel-for-pixel with Image 1. It is not picture content and must never appear in the result. White pixels only grant permission to edit the corresponding Image 1 pixels; black pixels mean preserve Image 1. The mask shape and boundary carry no visual or compositional meaning." })
      } else if (role === "style") {
        parts.push({ text: "Image " + number + " is a style reference. Use only its visual style, color, material, and lighting; do not copy its subject or composition." })
      } else {
        parts.push({ text: "Image " + number + " is an additional reference image. Use it only for the user's requested visual information." })
      }
      parts.push({
        inlineData: {
          mimeType: image.mimeType || "image/png",
          data: cleanBase64(image.base64),
        },
      })
      if (role === "mask") {
        parts.push({ text: "Control reminder: the preceding image was only a hidden edit-permission map. Ignore its visible appearance completely. Return a clean, normal full image with no frame, box, boundary, black/white patch, or mask-shaped artifact." })
      }
    })
    return parts
  }

  function parseGemini(payload) {
    const results = []
    const texts = []
    const candidates = Array.isArray(payload?.candidates) ? payload.candidates : []
    candidates.forEach((candidate) => {
      if (String(candidate?.finishReason || "").toUpperCase() === "IMAGE_PROHIBITED_CONTENT") return
      const parts = candidate?.content?.parts || candidate?.parts || []
      parts.forEach((part) => {
        const inline = part.inlineData || part.inline_data
        if (part.thought !== true && inline?.data && String(inline.mimeType || inline.mime_type || "").startsWith("image/")) {
          results.push({ base64: cleanBase64(inline.data), mimeType: inline.mimeType || inline.mime_type || "image/png" })
        }
        if (part.text) texts.push(String(part.text))
      })
    })
    if (!results.length) {
      const blocked = candidates.some((candidate) => String(candidate?.finishReason || "").toUpperCase() === "IMAGE_PROHIBITED_CONTENT")
      throw new DirectApiError(blocked ? "content_blocked" : "invalid_response", blocked
        ? "请求内容被模型安全策略拦截"
        : (texts.join("\n").trim() || "Comfy API 没有返回图像"))
    }
    const text = texts.join("\n").trim()
    return results.map((item) => ({ ...item, text }))
  }

  function parseGpt(payload) {
    const data = Array.isArray(payload?.data) ? payload.data : []
    const results = data.filter((item) => item?.b64_json || item?.b64Json).map((item) => ({
      base64: cleanBase64(item.b64_json || item.b64Json),
      mimeType: "image/png",
      text: String(item.revised_prompt || item.revisedPrompt || ""),
    }))
    if (!results.length) {
      const hasUrl = data.some((item) => item?.url)
      throw new DirectApiError("invalid_response", hasUrl
        ? "API 只返回了临时下载地址；当前安全策略要求返回内联图像"
        : "Comfy API 没有返回图像")
    }
    return results
  }

  function geminiBody(job) {
    const profile = job.profile || {}
    const imageConfig = { imageSize: profile.resolution || "2K" }
    if (profile.aspect && profile.aspect !== "auto") imageConfig.aspectRatio = profile.aspect
    const generationConfig = { responseModalities: ["IMAGE"], imageConfig }
    const seed = Number(job.seed)
    if (Number.isFinite(seed) && seed >= 0) generationConfig.seed = Math.floor(seed)
    if (profile.family === "nanobanana") {
      generationConfig.thinkingConfig = { thinkingLevel: profile.quality || "MINIMAL" }
      generationConfig.temperature = 1
      generationConfig.topP = 0.95
    }
    return {
      contents: [{ role: "user", parts: [...geminiImageParts(job.images), { text: "User edit request:\n" + String(job.prompt || "") }] }],
      generationConfig,
      systemInstruction: { parts: [{ text: GEMINI_SYSTEM_PROMPT }] },
    }
  }

  function gptForm(job) {
    const form = new FormData()
    const images = (job.images || []).filter((image) => image && image.base64)
    images.forEach((image, index) => {
      const field = images.length === 1 ? "image" : "image[]"
      const mimeType = image.mimeType || "image/png"
      form.append(field, new Blob([base64Bytes(image.base64)], { type: mimeType }), `image_${index + 1}.png`)
    })
    form.append("model", String(job.profile?.model || "gpt-image-2.5-flare"))
    form.append("prompt", String(job.prompt || ""))
    form.append("quality", String(job.profile?.quality || "high"))
    form.append("background", String(job.profile?.background || "auto"))
    form.append("n", "1")
    form.append("size", validateGptSize(job.profile || {}))
    form.append("moderation", "low")
    return form
  }

  async function uploadSeedreamImage(job, options, idempotencyKey) {
    const canvas = (job.images || []).find((item) => item?.role === "canvas" && item.base64)
    if (!canvas) throw new DirectApiError("invalid_request", "Seedream 图层分离需要 Photoshop 画布")
    const created = await fetchWithRetry("/customers/storage", {
      fetchImpl: options.fetchImpl,
      signal: job.signal,
      timeoutMs: job.timeoutMs || options.timeoutMs,
      attempts: options.attempts || 3,
      onRetry: options.onRetry,
      buildRequest: () => ({
        method: "POST",
        headers: authHeaders(job.apiKey, `${idempotencyKey}-upload`, true),
        body: JSON.stringify({ file_name: "photoshop-seedream.png", content_type: "image/png" }),
      }),
    })
    const uploadUrl = String(created.payload?.upload_url || "")
    const downloadUrl = String(created.payload?.download_url || "")
    if (!uploadUrl || !downloadUrl) throw new DirectApiError("invalid_response", "Comfy API 没有返回图片上传地址")
    await fetchAbsolute(uploadUrl, {
      fetchImpl: options.fetchImpl,
      signal: job.signal,
      timeoutMs: job.timeoutMs || options.timeoutMs,
      request: {
        method: "PUT",
        headers: { "Content-Type": "image/png" },
        body: base64Bytes(canvas.base64),
      },
    })
    return { canvas, downloadUrl }
  }

  async function downloadSeedreamLayer(item, index, job, options) {
    const url = String(item?.url || "")
    if (!url) throw new DirectApiError("invalid_response", `Seedream 第 ${index + 1} 个图层没有下载地址`)
    const response = await fetchAbsolute(url, {
      fetchImpl: options.fetchImpl,
      signal: job.signal,
      timeoutMs: job.timeoutMs || options.timeoutMs,
    })
    const bytes = new Uint8Array(await response.arrayBuffer())
    const dimensions = pngSize(bytes)
    if (!dimensions) throw new DirectApiError("invalid_response", `Seedream 第 ${index + 1} 个图层不是有效 PNG`)
    const absolute = Array.isArray(item?.bounding_box?.absolute) ? item.bounding_box.absolute : null
    const left = absolute && Number.isFinite(Number(absolute[0])) ? Math.round(Number(absolute[0])) : 0
    const top = absolute && Number.isFinite(Number(absolute[1])) ? Math.round(Number(absolute[1])) : 0
    const right = absolute && Number.isFinite(Number(absolute[2])) ? Math.round(Number(absolute[2])) : left + dimensions.width
    const bottom = absolute && Number.isFinite(Number(absolute[3])) ? Math.round(Number(absolute[3])) : top + dimensions.height
    return {
      name: String(item?.name || (index === 0 ? "background" : `layer ${index}`)).slice(0, 120),
      base64: bytesBase64(bytes),
      x: index === 0 ? 0 : left,
      y: index === 0 ? 0 : top,
      width: index === 0 ? dimensions.width : Math.max(1, right - left),
      height: index === 0 ? dimensions.height : Math.max(1, bottom - top),
      zIndex: Number.isFinite(Number(item?.z_index)) ? Math.round(Number(item.z_index)) : index,
    }
  }

  async function generateSeedream(job, options, idempotencyKey) {
    const uploaded = await uploadSeedreamImage(job, options, idempotencyKey)
    const response = await fetchWithRetry("/proxy/byteplus/api/v3/images/generations", {
      fetchImpl: options.fetchImpl,
      signal: job.signal,
      timeoutMs: job.timeoutMs || options.timeoutMs,
      attempts: options.attempts || 3,
      onRetry: options.onRetry,
      buildRequest: () => ({
        method: "POST",
        headers: authHeaders(job.apiKey, idempotencyKey, true),
        body: JSON.stringify({
          model: "seedream-5-0-pro-260628",
          prompt: String(job.prompt || "").trim() || null,
          image: uploaded.downloadUrl,
          size: String(job.profile?.resolution || "auto"),
          seed: Math.max(0, Math.min(2147483647, Math.floor(Number(job.seed) || 0))),
          response_format: "url",
          output_format: "png",
          layer_decomposition: true,
          watermark: false,
          optimize_prompt_options: { mode: job.profile?.quality === "fast" ? "fast" : "standard" },
        }),
      }),
    })
    if (response.payload?.error?.message) throw new DirectApiError("server_error", String(response.payload.error.message))
    const items = Array.isArray(response.payload?.data) ? response.payload.data.filter((item) => item?.url) : []
    if (items.length < 2) throw new DirectApiError("invalid_response", "Seedream 没有返回可分离的图层")
    const layers = []
    for (let index = 0; index < items.length; index += 1) {
      layers.push(await downloadSeedreamLayer(items[index], index, job, options))
    }
    layers.sort((left, right) => left.zIndex - right.zIndex)
    const canvas = pngSize(base64Bytes(uploaded.canvas.base64)) || { width: layers[0].width, height: layers[0].height }
    return {
      images: [{ base64: cleanBase64(uploaded.canvas.base64), mimeType: "image/png", text: "" }],
      layered: { canvas, layers },
      credits: response.response?.headers?.get?.("x-comfy-credits-used") || "",
      idempotencyKey,
    }
  }

  async function generate(job, options = {}) {
    const apiKey = String(job?.apiKey || "").trim()
    if (!apiKey) throw new DirectApiError("missing_key", "请先在设置中保存 Comfy API Key")
    const prompt = String(job?.prompt || "").trim()
    const profile = job.profile || {}
    if (!prompt && profile.family !== "seedream") throw new DirectApiError("invalid_request", "提示词不能为空")
    const idempotencyKey = requestId(job.jobId, job.batchIndex)
    const common = {
      fetchImpl: options.fetchImpl,
      signal: job.signal,
      timeoutMs: job.timeoutMs || options.timeoutMs,
      attempts: options.attempts || 3,
      onRetry: options.onRetry,
    }
    if (profile.family === "seedream") return generateSeedream(job, options, idempotencyKey)
    let response
    if (profile.family === "gpt") {
      response = await fetchWithRetry("/proxy/openai/images/edits", {
        ...common,
        buildRequest: () => ({ method: "POST", headers: authHeaders(apiKey, idempotencyKey, false), body: gptForm(job) }),
      })
    } else {
      const selected = String(profile.model || "")
      const model = selected === "Gemini Nano Banana 2.1"
        ? "gemini-nano-banana-2.1"
        : selected === "Nano Banana 2 Lite"
          ? "gemini-3.1-flash-lite-image"
          : selected === "Nano Banana 2 (Gemini 3.1 Flash Image)"
            ? "gemini-3.1-flash-image"
            : profile.family === "pro"
              ? "gemini-3-pro-image-preview"
              : "gemini-3.1-flash-image"
      response = await fetchWithRetry(`/proxy/vertexai/gemini/${model}`, {
        ...common,
        buildRequest: () => ({ method: "POST", headers: authHeaders(apiKey, idempotencyKey, true), body: JSON.stringify(geminiBody(job)) }),
      })
    }
    const images = profile.family === "gpt" ? parseGpt(response.payload) : parseGemini(response.payload)
    const credits = response.response?.headers?.get?.("x-comfy-credits-used") || ""
    return { images, credits, idempotencyKey }
  }

  const api = {
    API_ROOT,
    DirectApiError,
    GPT_SIZE_LIMITS,
    fitGptSize,
    validateApiKey,
    validateGptSize,
    generate,
    _test: { geminiBody, geminiImageParts, gptForm, parseGemini, parseGpt, mapHttpError, requestId, pngSize },
  }

  root.ComfyDirectApi = api
  if (typeof module !== "undefined" && module.exports) module.exports = api
})(typeof globalThis !== "undefined" ? globalThis : this)
