(function attachComfyTvUpdater(root) {
  "use strict"

  const UPDATE_MANIFEST = "https://raw.githubusercontent.com/FeiChenjidao/ComfyTV-Photoshop/main/latest.json"
  const RELEASE_PAGE = "https://github.com/FeiChenjidao/ComfyTV-Photoshop/releases"

  function normalizeVersion(value) {
    const match = String(value || "").trim().match(/^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/)
    if (!match) return null
    return {
      text: `${Number(match[1])}.${Number(match[2])}.${Number(match[3])}${match[4] ? `-${match[4]}` : ""}`,
      numbers: [Number(match[1]), Number(match[2]), Number(match[3])],
      prerelease: match[4] || "",
    }
  }

  function compareVersions(left, right) {
    const a = normalizeVersion(left)
    const b = normalizeVersion(right)
    if (!a || !b) throw new Error("版本号格式无效")
    for (let index = 0; index < 3; index += 1) {
      if (a.numbers[index] !== b.numbers[index]) return a.numbers[index] > b.numbers[index] ? 1 : -1
    }
    if (a.prerelease === b.prerelease) return 0
    if (!a.prerelease) return 1
    if (!b.prerelease) return -1
    return a.prerelease.localeCompare(b.prerelease)
  }

  function releaseVersion(release) {
    const fromTag = normalizeVersion(release && release.tag_name)
    if (fromTag) return fromTag.text
    const assets = Array.isArray(release && release.assets) ? release.assets : []
    for (const asset of assets) {
      const match = String(asset && asset.name || "").match(/^ComfyTV-photoshop-(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\.ccx$/i)
      if (match && normalizeVersion(match[1])) return normalizeVersion(match[1]).text
    }
    return ""
  }

  function releaseInfo(release, currentVersion) {
    if (!release || release.draft) throw new Error("更新信息无效")
    const version = releaseVersion(release)
    if (!version) throw new Error("Release 没有有效版本号")
    const assets = Array.isArray(release.assets) ? release.assets : []
    const expectedName = `ComfyTV-photoshop-${version}.ccx`.toLowerCase()
    const packageAsset = assets.find((asset) => String(asset && asset.name || "").toLowerCase() === expectedName)
      || assets.find((asset) => /\.ccx$/i.test(String(asset && asset.name || "")))
    const hashAsset = packageAsset && assets.find((asset) => String(asset && asset.name || "").toLowerCase() === `${String(packageAsset.name).toLowerCase()}.sha256.txt`)
    const comparison = compareVersions(version, currentVersion)
    return {
      state: comparison > 0 ? "update" : "current",
      currentVersion: normalizeVersion(currentVersion).text,
      version,
      name: String(release.name || `ComfyTV Photoshop ${version}`),
      notes: String(release.body || "").trim(),
      publishedAt: String(release.published_at || ""),
      releaseUrl: String(release.html_url || RELEASE_PAGE),
      packageName: packageAsset ? String(packageAsset.name || "") : "",
      packageUrl: packageAsset ? String(packageAsset.browser_download_url || "") : "",
      packageSize: packageAsset ? Number(packageAsset.size) || 0 : 0,
      hashUrl: hashAsset ? String(hashAsset.browser_download_url || "") : "",
      installable: Boolean(packageAsset && packageAsset.browser_download_url && hashAsset && hashAsset.browser_download_url),
    }
  }

  function manifestInfo(manifest, currentVersion) {
    if (!manifest || Number(manifest.schema) !== 1) throw new Error("更新清单版本不支持")
    if (manifest.published === false) {
      return { state: "no_release", currentVersion: normalizeVersion(currentVersion).text, releaseUrl: RELEASE_PAGE }
    }
    const version = normalizeVersion(manifest.version)
    if (!version) throw new Error("更新清单没有有效版本号")
    const comparison = compareVersions(version.text, currentVersion)
    const packageName = String(manifest.packageName || "")
    const packageUrl = String(manifest.packageUrl || "")
    const hashUrl = String(manifest.hashUrl || "")
    return {
      state: comparison > 0 ? "update" : "current",
      currentVersion: normalizeVersion(currentVersion).text,
      version: version.text,
      name: String(manifest.name || `ComfyTV Photoshop ${version.text}`),
      notes: String(manifest.notes || "").trim(),
      publishedAt: String(manifest.publishedAt || ""),
      releaseUrl: String(manifest.releaseUrl || RELEASE_PAGE),
      packageName,
      packageUrl,
      packageSize: Number(manifest.packageSize) || 0,
      hashUrl,
      installable: Boolean(packageName && packageUrl && hashUrl),
    }
  }

  async function checkForUpdate(currentVersion, options = {}) {
    const fetchImpl = options.fetchImpl || root.fetch
    if (typeof fetchImpl !== "function") throw new Error("当前 Photoshop 不支持网络更新检查")
    const response = await fetchImpl(`${UPDATE_MANIFEST}?time=${Date.now()}`, {
      method: "GET",
      cache: "no-store",
    })
    if (response.status === 404) {
      return { state: "no_release", currentVersion: normalizeVersion(currentVersion).text, releaseUrl: RELEASE_PAGE }
    }
    if (!response.ok) throw new Error(`更新服务器返回 ${response.status}`)
    let manifest
    try { manifest = JSON.parse(await response.text()) } catch (_) { throw new Error("更新信息格式错误") }
    return manifestInfo(manifest, currentVersion)
  }

  function parseSha256(value) {
    const match = String(value || "").match(/\b([a-fA-F0-9]{64})\b/)
    return match ? match[1].toLowerCase() : ""
  }

  function bytesToHex(bytes) {
    return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("")
  }

  function fallbackSha256(input) {
    const source = input instanceof Uint8Array ? input : new Uint8Array(input)
    const bitLength = source.length * 8
    const paddedLength = Math.ceil((source.length + 9) / 64) * 64
    const data = new Uint8Array(paddedLength)
    data.set(source)
    data[source.length] = 0x80
    const view = new DataView(data.buffer)
    const high = Math.floor(bitLength / 0x100000000)
    const low = bitLength >>> 0
    view.setUint32(paddedLength - 8, high, false)
    view.setUint32(paddedLength - 4, low, false)
    const constants = new Uint32Array([
      0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
      0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
      0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
      0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
      0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
      0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
      0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
      0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2,
    ])
    const hash = new Uint32Array([0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19])
    const words = new Uint32Array(64)
    const rotate = (value, bits) => (value >>> bits) | (value << (32 - bits))
    for (let offset = 0; offset < data.length; offset += 64) {
      for (let index = 0; index < 16; index += 1) words[index] = view.getUint32(offset + index * 4, false)
      for (let index = 16; index < 64; index += 1) {
        const s0 = rotate(words[index - 15], 7) ^ rotate(words[index - 15], 18) ^ (words[index - 15] >>> 3)
        const s1 = rotate(words[index - 2], 17) ^ rotate(words[index - 2], 19) ^ (words[index - 2] >>> 10)
        words[index] = (words[index - 16] + s0 + words[index - 7] + s1) >>> 0
      }
      let [a,b,c,d,e,f,g,h] = hash
      for (let index = 0; index < 64; index += 1) {
        const s1 = rotate(e, 6) ^ rotate(e, 11) ^ rotate(e, 25)
        const choice = (e & f) ^ (~e & g)
        const temp1 = (h + s1 + choice + constants[index] + words[index]) >>> 0
        const s0 = rotate(a, 2) ^ rotate(a, 13) ^ rotate(a, 22)
        const majority = (a & b) ^ (a & c) ^ (b & c)
        const temp2 = (s0 + majority) >>> 0
        h = g; g = f; f = e; e = (d + temp1) >>> 0; d = c; c = b; b = a; a = (temp1 + temp2) >>> 0
      }
      hash[0]=(hash[0]+a)>>>0; hash[1]=(hash[1]+b)>>>0; hash[2]=(hash[2]+c)>>>0; hash[3]=(hash[3]+d)>>>0
      hash[4]=(hash[4]+e)>>>0; hash[5]=(hash[5]+f)>>>0; hash[6]=(hash[6]+g)>>>0; hash[7]=(hash[7]+h)>>>0
    }
    const output = new Uint8Array(32)
    const outputView = new DataView(output.buffer)
    for (let index = 0; index < hash.length; index += 1) outputView.setUint32(index * 4, hash[index], false)
    return bytesToHex(output)
  }

  async function sha256Hex(input, cryptoImpl = root.crypto) {
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input)
    if (cryptoImpl && cryptoImpl.subtle && typeof cryptoImpl.subtle.digest === "function") {
      const digest = await cryptoImpl.subtle.digest("SHA-256", bytes)
      return bytesToHex(new Uint8Array(digest))
    }
    return fallbackSha256(bytes)
  }

  async function downloadAndVerify(update, options = {}) {
    if (!update || !update.installable) throw new Error("这个 Release 缺少 CCX 或 SHA256 文件")
    const fetchImpl = options.fetchImpl || root.fetch
    const [packageResponse, hashResponse] = await Promise.all([
      fetchImpl(update.packageUrl, { cache: "no-store" }),
      fetchImpl(update.hashUrl, { cache: "no-store" }),
    ])
    if (!packageResponse.ok) throw new Error(`更新包下载失败（${packageResponse.status}）`)
    if (!hashResponse.ok) throw new Error(`校验文件下载失败（${hashResponse.status}）`)
    const expectedHash = parseSha256(await hashResponse.text())
    if (!expectedHash) throw new Error("SHA256 校验文件无效")
    const bytes = new Uint8Array(await packageResponse.arrayBuffer())
    const actualHash = await sha256Hex(bytes, options.cryptoImpl)
    if (actualHash !== expectedHash) throw new Error("更新包 SHA256 校验失败，已停止安装")
    return { bytes, sha256: actualHash, name: update.packageName }
  }

  const api = {
    UPDATE_MANIFEST,
    RELEASE_PAGE,
    normalizeVersion,
    compareVersions,
    releaseInfo,
    manifestInfo,
    checkForUpdate,
    parseSha256,
    sha256Hex,
    downloadAndVerify,
  }

  root.ComfyTvUpdater = api
  if (typeof module !== "undefined" && module.exports) module.exports = api
})(typeof globalThis !== "undefined" ? globalThis : this)
