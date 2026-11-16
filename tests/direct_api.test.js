import test from "node:test"
import assert from "node:assert/strict"
import "../photoshop-uxp-plugin/direct-api.js"

const api = globalThis.ComfyDirectApi

function response(status, payload, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => headers[String(name).toLowerCase()] || null },
    async text() { return payload == null ? "" : JSON.stringify(payload) },
    async arrayBuffer() {
      const bytes = payload instanceof Uint8Array ? payload : new Uint8Array(payload || [])
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
    },
  }
}

function pngHeader(width, height) {
  const bytes = new Uint8Array(24)
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10], 0)
  bytes.set([0, 0, 0, 13, 73, 72, 68, 82], 8)
  const view = new DataView(bytes.buffer)
  view.setUint32(16, width)
  view.setUint32(20, height)
  return bytes
}

test("validates a Comfy API key without persisting it", async () => {
  let request
  const account = await api.validateApiKey("secret", {
    fetchImpl: async (url, options) => {
      request = { url, options }
      return response(200, { id: "customer-1" })
    },
  })
  assert.equal(account.id, "customer-1")
  assert.equal(request.url, "https://api.comfy.org/customers/me")
  assert.equal(request.options.headers["X-API-KEY"], "secret")
  assert.equal(request.options.headers["Idempotency-Key"], undefined)
})

test("enhances prompts with the OpenAI Responses API and current canvas", async () => {
  const calls = []
  const result = await api.enhancePrompt({
    apiKey: "secret",
    jobId: "prompt-job",
    prompt: "analyze this canvas",
    imageBase64: "YQ==",
    model: "gpt-5.6-sol",
  }, {
    attempts: 1,
    pollIntervalMs: 0,
    fetchImpl: async (url, options) => {
      calls.push({ url, options })
      if (calls.length === 1) return response(200, { id: "response-1", status: "queued", output: [] })
      return response(200, {
        id: "response-1",
        status: "completed",
        output: [{ type: "message", content: [{ type: "output_text", text: "优化后的提示词" }] }],
      }, { "x-comfy-credits-used": "1.25" })
    },
  })
  assert.equal(calls[0].url, "https://api.comfy.org/proxy/openai/v1/responses")
  const body = JSON.parse(calls[0].options.body)
  assert.equal(body.model, "gpt-5.6-sol")
  assert.equal(body.input[0].content[0].text, "analyze this canvas")
  assert.equal(body.input[0].content[1].image_url, "data:image/png;base64,YQ==")
  assert.equal(calls[1].url, "https://api.comfy.org/proxy/openai/v1/responses/response-1")
  assert.equal(calls[1].options.headers["Idempotency-Key"], undefined)
  assert.equal(result.text, "优化后的提示词")
  assert.equal(result.credits, "1.25")
})

test("builds Gemini image parts in compact media order", async () => {
  let body
  const result = await api.generate({
    apiKey: "secret",
    jobId: "job-1",
    batchIndex: 0,
    prompt: "edit",
    profile: { family: "nanobanana", aspect: "16:9", resolution: "2K", quality: "HIGH" },
    images: [
      { role: "canvas", base64: "YQ==" },
      { role: "mask", base64: "Yg==" },
    ],
    seed: 1379,
  }, {
    attempts: 1,
    fetchImpl: async (url, options) => {
      body = JSON.parse(options.body)
      assert.equal(url, "https://api.comfy.org/proxy/vertexai/gemini/gemini-3.1-flash-image")
      return response(200, { candidates: [{ content: { parts: [
        { thought: true, inlineData: { mimeType: "image/png", data: "ZA==" } },
        { inlineData: { mimeType: "image/png", data: "Yw==" } },
      ] } }] })
    },
  })
  assert.equal(body.contents[0].parts.length, 6)
  assert.match(body.contents[0].parts[2].text, /hidden binary editing mask/i)
  assert.equal(body.contents[0].parts[3].inlineData.data, "Yg==")
  assert.match(body.contents[0].parts[4].text, /hidden edit-permission map/i)
  assert.match(body.contents[0].parts[5].text, /User edit request:/i)
  assert.match(body.systemInstruction.parts[0].text, /no mask square/i)
  assert.equal(body.generationConfig.imageConfig.aspectRatio, "16:9")
  assert.equal(body.generationConfig.thinkingConfig.thinkingLevel, "HIGH")
  assert.equal(body.generationConfig.seed, 1379)
  assert.equal(result.images[0].base64, "Yw==")
  assert.equal(result.images.length, 1)
})

test("labels Gemini masks as control maps instead of visual references", () => {
  const parts = api._test.geminiImageParts([
    { role: "canvas", base64: "YQ==" },
    { role: "mask", base64: "Yg==" },
  ])
  assert.match(parts[2].text, /must never appear in the result/i)
  assert.equal(parts[3].inlineData.data, "Yg==")
  assert.match(parts[4].text, /no frame, box, boundary/i)
})

test("uses GPT multipart image array and custom dimensions", async () => {
  let request
  await api.generate({
    apiKey: "secret",
    jobId: "job-2",
    prompt: "edit",
    profile: { family: "gpt", size: "Custom", resolution: "Custom", customWidth: 1600, customHeight: 1200, quality: "xhigh", background: "transparent" },
    images: [{ base64: "YQ==" }, { base64: "Yg==" }],
  }, {
    attempts: 1,
    fetchImpl: async (url, options) => {
      request = { url, options }
      return response(200, { data: [{ b64_json: "Yw==" }] })
    },
  })
  assert.equal(request.url, "https://api.comfy.org/proxy/openai/images/edits")
  assert.equal(request.options.headers["X-API-KEY"], "secret")
  assert.equal(request.options.body.get("size"), "1600x1200")
  assert.equal(request.options.body.get("quality"), "xhigh")
  assert.equal(request.options.body.getAll("image[]").length, 2)
})

test("sends the selected GPT model", async () => {
  let body
  await api.generate({
    apiKey: "secret",
    jobId: "job-gpt-model",
    prompt: "edit",
    profile: { family: "gpt", model: "gpt-image-2", resolution: "auto", quality: "high", background: "opaque" },
    images: [{ base64: "YQ==" }],
  }, {
    attempts: 1,
    fetchImpl: async (_url, options) => {
      body = options.body
      return response(200, { data: [{ b64_json: "Yw==" }] })
    },
  })
  assert.equal(body.get("model"), "gpt-image-2")
  assert.equal(body.get("complexity"), null)
})

test("sends complexity for GPT Image 2.6", async () => {
  let body
  await api.generate({
    apiKey: "secret",
    jobId: "job-gpt-26",
    prompt: "edit",
    profile: { family: "gpt", model: "gpt-image-2.6-flare", resolution: "auto", quality: "max", complexity: "medium", background: "transparent" },
    images: [{ base64: "YQ==" }],
  }, {
    attempts: 1,
    fetchImpl: async (_url, options) => {
      body = options.body
      return response(200, { data: [{ b64_json: "Yw==" }] })
    },
  })
  assert.equal(body.get("model"), "gpt-image-2.6-flare")
  assert.equal(body.get("complexity"), "medium")
})

test("routes each Nano Banana model to its matching endpoint", async () => {
  const cases = [
    ["Gemini Nano Banana 2.1", "gemini-nano-banana-2.1"],
    ["Nano Banana 2 (Gemini 3.1 Flash Image)", "gemini-3.1-flash-image"],
    ["Nano Banana 2 Lite", "gemini-3.1-flash-lite-image"],
  ]
  for (const [model, endpoint] of cases) {
    let url = ""
    await api.generate({
      apiKey: "secret",
      jobId: `job-${endpoint}`,
      prompt: "edit",
      profile: { family: "nanobanana", model, resolution: "1K", quality: "MINIMAL" },
      images: [{ base64: "YQ==" }],
    }, {
      attempts: 1,
      fetchImpl: async (value) => {
        url = value
        return response(200, { candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: "Yw==" } }] } }] })
      },
    })
    assert.equal(url, `https://api.comfy.org/proxy/vertexai/gemini/${endpoint}`)
  }
})

test("reuses the idempotency key across retry attempts", async () => {
  const keys = []
  let calls = 0
  await api.generate({
    apiKey: "secret",
    jobId: "stable-job",
    prompt: "edit",
    profile: { family: "pro", resolution: "1K", aspect: "auto" },
    images: [{ base64: "YQ==" }],
  }, {
    attempts: 2,
    fetchImpl: async (_url, options) => {
      keys.push(options.headers["Idempotency-Key"])
      calls += 1
      return calls === 1
        ? response(503, { message: "busy" }, { "retry-after": "0.001" })
        : response(200, { candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: "Yw==" } }] } }] })
    },
  })
  assert.equal(keys.length, 2)
  assert.equal(keys[0], keys[1])
})

test("uploads and returns Seedream layer separation results", async () => {
  const source = pngHeader(1200, 900)
  const calls = []
  const result = await api.generate({
    apiKey: "secret",
    jobId: "job-seedream",
    prompt: "separate the character and effects",
    profile: { family: "seedream", model: "seedream 5.0 pro", resolution: "2K", quality: "fast" },
    images: [{ role: "canvas", base64: Buffer.from(source).toString("base64") }],
    seed: 42,
  }, {
    attempts: 1,
    fetchImpl: async (url, options = {}) => {
      calls.push({ url, options })
      if (url === "https://api.comfy.org/customers/storage") {
        return response(200, { upload_url: "https://upload.test/source", download_url: "https://download.test/source" })
      }
      if (url === "https://upload.test/source") return response(200, null)
      if (url === "https://api.comfy.org/proxy/byteplus/api/v3/images/generations") {
        return response(200, { data: [
          { url: "https://download.test/base", name: "background", z_index: 0 },
          { url: "https://download.test/layer", name: "character", z_index: 2, bounding_box: { absolute: [100, 120, 500, 720] } },
        ] })
      }
      if (url === "https://download.test/base") return response(200, pngHeader(1200, 900))
      if (url === "https://download.test/layer") return response(200, pngHeader(400, 600))
      throw new Error(`unexpected request ${url}`)
    },
  })

  const upload = calls.find((item) => item.url === "https://upload.test/source")
  assert.equal(upload.options.method, "PUT")
  assert.deepEqual(Array.from(upload.options.body), Array.from(source))
  const generation = calls.find((item) => item.url.includes("/proxy/byteplus/"))
  const body = JSON.parse(generation.options.body)
  assert.equal(body.model, "seedream-5-0-pro-260628")
  assert.equal(body.layer_decomposition, true)
  assert.equal(body.optimize_prompt_options.mode, "fast")
  assert.equal(result.images[0].base64, Buffer.from(source).toString("base64"))
  assert.deepEqual(result.layered.canvas, { width: 1200, height: 900 })
  assert.equal(result.layered.layers.length, 2)
  assert.deepEqual(result.layered.layers[1], {
    name: "character",
    base64: Buffer.from(pngHeader(400, 600)).toString("base64"),
    x: 100,
    y: 120,
    width: 400,
    height: 600,
    zIndex: 2,
  })
})

test("generates Seedream images with custom size and ignores the Photoshop mask", async () => {
  const source = pngHeader(2048, 2048)
  const calls = []
  let storageIndex = 0
  const result = await api.generate({
    apiKey: "secret",
    jobId: "job-seedream-image",
    prompt: "paint a cinematic scene",
    profile: { family: "seedreamImage", model: "seedream 5.5", customWidth: 2048, customHeight: 2048, background: "transparent" },
    images: [
      { role: "canvas", base64: Buffer.from(source).toString("base64") },
      { role: "mask", base64: Buffer.from(source).toString("base64") },
      { role: "reference", base64: Buffer.from(source).toString("base64") },
    ],
    seed: 99,
  }, {
    attempts: 1,
    fetchImpl: async (url, options = {}) => {
      calls.push({ url, options })
      if (url === "https://api.comfy.org/customers/storage") {
        storageIndex += 1
        return response(200, { upload_url: `https://upload.test/image-${storageIndex}`, download_url: `https://download.test/input-${storageIndex}` })
      }
      if (url.startsWith("https://upload.test/image-")) return response(200, null)
      if (url === "https://api.comfy.org/proxy/byteplus/api/v3/images/generations") {
        return response(200, { data: [{ url: "https://download.test/result" }] })
      }
      if (url === "https://download.test/result") return response(200, source)
      throw new Error(`unexpected request ${url}`)
    },
  })

  const generation = calls.find((item) => item.url.includes("/proxy/byteplus/"))
  const body = JSON.parse(generation.options.body)
  assert.equal(storageIndex, 2)
  assert.equal(body.model, "seedream-5-5-261028")
  assert.equal(body.size, "2048x2048")
  assert.equal(body.background, "transparent")
  assert.equal(body.image.length, 2)
  assert.equal(body.layer_decomposition, undefined)
  assert.equal(body.sequential_image_generation, undefined)
  assert.equal(result.images[0].base64, Buffer.from(source).toString("base64"))
})

test("reuses Seedream uploads across concurrent batch jobs", async () => {
  const source = pngHeader(2048, 2048)
  const uploadCache = new Map()
  let storageCount = 0
  let uploadCount = 0
  let generationCount = 0
  const fetchImpl = async (url) => {
    if (url === "https://api.comfy.org/customers/storage") {
      storageCount += 1
      return response(200, { upload_url: "https://upload.test/shared", download_url: "https://download.test/shared" })
    }
    if (url === "https://upload.test/shared") {
      uploadCount += 1
      return response(200, null)
    }
    if (url === "https://api.comfy.org/proxy/byteplus/api/v3/images/generations") {
      generationCount += 1
      return response(200, { data: [{ url: "https://download.test/result" }] })
    }
    if (url === "https://download.test/result") return response(200, source)
    throw new Error(`unexpected request ${url}`)
  }
  const baseJob = {
    apiKey: "secret",
    prompt: "paint a cinematic scene",
    profile: { family: "seedreamImage", model: "seedream 5.5", customWidth: 2048, customHeight: 2048 },
    images: [{ role: "canvas", base64: Buffer.from(source).toString("base64") }],
    uploadCache,
  }
  const [first, second] = await Promise.all([
    api.generate({ ...baseJob, jobId: "batch-1", batchIndex: 0, seed: 1 }, { attempts: 1, fetchImpl }),
    api.generate({ ...baseJob, jobId: "batch-2", batchIndex: 1, seed: 2 }, { attempts: 1, fetchImpl }),
  ])
  assert.equal(storageCount, 1)
  assert.equal(uploadCount, 1)
  assert.equal(generationCount, 2)
  assert.equal(first.images[0].base64, second.images[0].base64)
})

test("accepts a valid JPEG Seedream result and reports its real mime type", async () => {
  const jpeg = new Uint8Array([255, 216, 255, 224, 0, 16, 74, 70, 73, 70, 0, 1, 255, 217])
  const result = await api.generate({
    apiKey: "secret",
    jobId: "job-seedream-jpeg",
    prompt: "paint a cinematic scene",
    profile: { family: "seedreamImage", model: "seedream-4-5-251128", customWidth: 2048, customHeight: 2048 },
    images: [],
    seed: 99,
  }, {
    attempts: 1,
    fetchImpl: async (url) => {
      if (url === "https://api.comfy.org/proxy/byteplus/api/v3/images/generations") {
        return response(200, { data: [{ url: "https://download.test/result.jpg" }] })
      }
      if (url === "https://download.test/result.jpg") return response(200, jpeg, { "content-type": "image/jpeg" })
      throw new Error(`unexpected request ${url}`)
    },
  })

  assert.equal(result.images[0].mimeType, "image/jpeg")
  assert.equal(result.images[0].base64, Buffer.from(jpeg).toString("base64"))
})

test("validates Seedream custom dimensions per model", () => {
  assert.equal(api.validateSeedreamImageSize({ model: "seedream 5.5", customWidth: 960, customHeight: 960 }), "960x960")
  assert.equal(api.validateSeedreamImageSize({ model: "seedream 5.0 lite", customWidth: 2048, customHeight: 2048 }), "2048x2048")
  assert.equal(api.validateSeedreamImageSize({ model: "seedream 5.0 flash", resolution: "1K", customWidth: 800, customHeight: 1424 }), "800x1424")
  assert.throws(() => api.validateSeedreamImageSize({ model: "seedream 5.0 pro", resolution: "Custom", customWidth: 960, customHeight: 960 }), /1024/)
  assert.throws(() => api.validateSeedreamImageSize({ model: "seedream 5.5", customWidth: 3840, customHeight: 2160 }), /像素总量/)
})

test("maps authentication errors without exposing the key", async () => {
  await assert.rejects(
    api.validateApiKey("do-not-print", { fetchImpl: async () => response(401, { message: "unauthorized" }) }),
    (error) => error.code === "invalid_key" && !error.message.includes("do-not-print"),
  )
})

test("rejects invalid GPT custom sizes before sending", () => {
  assert.throws(() => api.validateGptSize({ size: "Custom", customWidth: 1001, customHeight: 1024 }), /16/)
  assert.equal(api.validateGptSize({ size: "Custom", customWidth: 1600, customHeight: 1200 }), "1600x1200")
})

test("fits captured GPT images to the shared custom-size limits", () => {
  const cases = [
    [2160, 3840],
    [320, 320],
    [8000, 1000],
    [1000, 8000],
    [16384, 16384],
  ]
  for (const [sourceWidth, sourceHeight] of cases) {
    const fitted = api.fitGptSize(sourceWidth, sourceHeight, { maxPixels: api.GPT_SIZE_LIMITS.inputMaxPixels })
    const pixels = fitted.width * fitted.height
    const ratio = Math.max(fitted.width, fitted.height) / Math.min(fitted.width, fitted.height)
    assert.equal(fitted.width % api.GPT_SIZE_LIMITS.step, 0)
    assert.equal(fitted.height % api.GPT_SIZE_LIMITS.step, 0)
    assert.ok(Math.min(fitted.width, fitted.height) >= api.GPT_SIZE_LIMITS.minEdge)
    assert.ok(Math.max(fitted.width, fitted.height) <= api.GPT_SIZE_LIMITS.maxEdge)
    assert.ok(pixels >= api.GPT_SIZE_LIMITS.minPixels)
    assert.ok(pixels <= api.GPT_SIZE_LIMITS.inputMaxPixels)
    assert.ok(ratio <= api.GPT_SIZE_LIMITS.maxRatio)
    assert.doesNotThrow(() => api.validateGptSize({
      size: "Custom",
      customWidth: fitted.width,
      customHeight: fitted.height,
    }))
  }
  assert.deepEqual(
    api.fitGptSize(3840, 2160, { maxPixels: api.GPT_SIZE_LIMITS.inputMaxPixels }),
    { width: 3840, height: 2160 },
  )
})
