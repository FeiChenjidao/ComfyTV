import test from "node:test"
import assert from "node:assert/strict"
import "../photoshop-uxp-plugin/updater.js"

const updater = globalThis.ComfyTvUpdater

function textResponse(status, value) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() { return String(value || "") },
    async arrayBuffer() { return new TextEncoder().encode(String(value || "")).buffer },
  }
}

test("compares stable plugin versions", () => {
  assert.equal(updater.compareVersions("0.3.5", "0.3.4"), 1)
  assert.equal(updater.compareVersions("v0.3.4", "0.3.4"), 0)
  assert.equal(updater.compareVersions("0.3.4-beta.1", "0.3.4"), -1)
})

test("selects the matching CCX and SHA256 release assets", () => {
  const info = updater.releaseInfo({
    tag_name: "v0.3.5",
    name: "ComfyTV Photoshop 0.3.5",
    html_url: "https://github.com/FeiChenjidao/ComfyTV-Photoshop/releases/tag/v0.3.5",
    assets: [
      { name: "ComfyTV-photoshop-0.3.5.ccx", browser_download_url: "https://example.test/plugin.ccx", size: 123 },
      { name: "ComfyTV-photoshop-0.3.5.ccx.sha256.txt", browser_download_url: "https://example.test/plugin.sha256.txt" },
    ],
  }, "0.3.4")
  assert.equal(info.state, "update")
  assert.equal(info.version, "0.3.5")
  assert.equal(info.installable, true)
  assert.equal(info.packageName, "ComfyTV-photoshop-0.3.5.ccx")
})

test("treats a repository without releases as a normal state", async () => {
  const result = await updater.checkForUpdate("0.3.4", {
    fetchImpl: async () => textResponse(404, "Not Found"),
  })
  assert.equal(result.state, "no_release")
})

test("reads the public static update manifest without GitHub API authentication", async () => {
  const result = await updater.checkForUpdate("0.3.4", {
    fetchImpl: async () => textResponse(200, JSON.stringify({
      schema: 1,
      published: true,
      version: "0.3.5",
      packageName: "ComfyTV-photoshop-0.3.5.ccx",
      packageUrl: "https://example.test/plugin.ccx",
      hashUrl: "https://example.test/plugin.sha256.txt",
      releaseUrl: "https://example.test/release",
    })),
  })
  assert.equal(result.state, "update")
  assert.equal(result.installable, true)
})

test("computes SHA256 without Web Crypto", async () => {
  const hash = await updater.sha256Hex(new TextEncoder().encode("abc"), null)
  assert.equal(hash, "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")
})

test("downloads and verifies the release package", async () => {
  const packageBytes = new TextEncoder().encode("verified ccx")
  const hash = await updater.sha256Hex(packageBytes, null)
  const result = await updater.downloadAndVerify({
    installable: true,
    packageName: "ComfyTV-photoshop-0.3.5.ccx",
    packageUrl: "https://example.test/plugin.ccx",
    hashUrl: "https://example.test/plugin.sha256.txt",
  }, {
    cryptoImpl: null,
    fetchImpl: async (url) => url.endsWith(".ccx")
      ? { ok: true, status: 200, async arrayBuffer() { return packageBytes.buffer } }
      : textResponse(200, `${hash}  ComfyTV-photoshop-0.3.5.ccx`),
  })
  assert.equal(result.sha256, hash)
  assert.equal(new TextDecoder().decode(result.bytes), "verified ccx")
})
