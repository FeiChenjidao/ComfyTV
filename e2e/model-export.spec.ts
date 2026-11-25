import { expect, test, type Download, type Page } from '@playwright/test'
import { unzipSync } from 'fflate'

async function downloadedBytes(download: Download) {
  const chunks: Buffer[] = []
  for await (const chunk of (await download.createReadStream())!) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks)
}

async function pngPixel(page: Page, bytes: Uint8Array) {
  return page.evaluate(async (data) => {
    const image = await createImageBitmap(new Blob([new Uint8Array(data)], { type: 'image/png' }))
    const canvas = document.createElement('canvas')
    canvas.width = image.width; canvas.height = image.height
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(image, 0, 0)
    return { width: image.width, height: image.height, pixel: [...ctx.getImageData(0, 0, 1, 1).data] }
  }, [...bytes])
}

test.beforeEach(async ({ page }) => {
  await page.goto('/modelviewer.html')
  await page.waitForFunction(() => (window as any).uiReady)
})

for (const format of ['glb', 'obj', 'stl', 'fbx'] as const) {
  test(`exports ${format.toUpperCase()} with texture data`, async ({ page }) => {
    const downloadPromise = page.waitForEvent('download')
    await page.evaluate((value) => (window as any).exportTexturedFixture(value), format)
    const download = await downloadPromise
    const bytes = await downloadedBytes(download)
    expect(download.suggestedFilename()).toBe(`textured_${format}.zip`)
    const files = unzipSync(bytes)
    expect(files[`textured.${format}`].length).toBeGreaterThan(100)
    const manifest = JSON.parse(new TextDecoder().decode(files['materials.json']))
    const maps = manifest.materials[0].maps
    for (const key of ['map', 'normalMap', 'aoMap', 'emissiveMap', 'roughnessMap', 'metalnessMap']) {
      expect(files[maps[key]]).toBeDefined()
    }
    expect(await pngPixel(page, files[maps.map])).toEqual({ width: 2, height: 2, pixel: [240, 64, 192, 255] })
    expect((await pngPixel(page, files[maps.roughnessMap])).pixel).toEqual([64, 64, 64, 255])
    expect((await pngPixel(page, files[maps.metalnessMap])).pixel).toEqual([192, 192, 192, 255])
    if (format === 'glb') {
      const materials = await page.evaluate((data) => (window as any).readExportedModel(data, 'glb'), [...files['textured.glb']])
      expect(materials.some((m: any) => m.textured && m.normalMap && m.roughnessMap && m.metalnessMap)).toBe(true)
    } else if (format === 'obj') {
      const obj = new TextDecoder().decode(files['textured.obj'])
      const mtl = new TextDecoder().decode(files['textured.mtl'])
      expect(obj).toContain('mtllib textured.mtl')
      expect(obj).toContain('usemtl Material_1')
      expect(obj).toContain('usemtl Material_2')
      expect(obj.split('\n').filter((line) => line.startsWith('f '))).toHaveLength(12)
      expect(obj).toContain('v 3.5 2.5 1.5')
      expect(obj).toContain('vt 0 0')
      expect(mtl).toContain(`map_Kd ${maps.map}`)
      expect(mtl).toContain(`map_Pm ${maps.metalnessMap}`)
      expect(mtl).toContain(`map_Pr ${maps.roughnessMap}`)
    } else if (format === 'fbx') {
      const materials = await page.evaluate((data) => (window as any).readExportedModel(data, 'fbx'), [...files['textured.fbx']])
      expect(materials.some((m: any) => m.textured && m.normalMap)).toBe(true)
    } else {
      expect(manifest.note).toContain('no UV coordinates')
    }
  })
}

test('offers all formats and preserves an uploaded texture when exporting from normal preview', async ({ page }) => {
  await page.getByTitle('材质检查器').click()
  const png = Buffer.from(await page.locator('canvas').first().evaluate((canvas) =>
    (canvas as HTMLCanvasElement).toDataURL('image/png').split(',')[1]), 'base64')
  await page.locator('input[type=file]').setInputFiles({ name: 'albedo.png', mimeType: 'image/png', buffer: png })
  await expect(page.getByText('albedo.png').first()).toBeVisible()
  await page.getByTitle('法线', { exact: true }).click()
  await page.getByTitle('导出模型', { exact: true }).click()
  for (const format of ['GLB', 'OBJ', 'STL', 'FBX']) await expect(page.getByRole('button', { name: format, exact: true })).toBeVisible()
  await page.screenshot({ path: 'test-results/model-export-menu.png' })
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'OBJ', exact: true }).click()
  const files = unzipSync(await downloadedBytes(await downloadPromise))
  expect(new TextDecoder().decode(files['viewer.mtl'])).toContain('map_Kd textures/')
  expect(Object.keys(files).some((name) => name.endsWith('.png'))).toBe(true)
})

test('downloads a custom texture at full resolution from the inspector', async ({ page }) => {
  await page.getByTitle('材质检查器').click()
  const button = page.getByRole('button', { name: '下载', exact: true })
  await expect(button).toBeDisabled()
  const png = Buffer.from(await page.evaluate(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 512; canvas.height = 384
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = 'rgb(200,100,50)'; ctx.fillRect(0, 0, 512, 384)
    return canvas.toDataURL('image/png').split(',')[1]
  }), 'base64')
  await page.locator('input[type=file]').setInputFiles({ name: 'albedo.png', mimeType: 'image/png', buffer: png })
  await expect(page.getByText('albedo.png').first()).toBeVisible()
  await page.getByTitle('法线', { exact: true }).click()
  const downloadPromise = page.waitForEvent('download')
  await button.click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toBe('albedo_map.png')
  expect(await pngPixel(page, await downloadedBytes(download))).toEqual({ width: 512, height: 384, pixel: [200, 100, 50, 255] })
  await page.screenshot({ path: 'test-results/model-texture-download.png' })
})

test('downloads the selected embedded texture channel from the inspector', async ({ page }) => {
  const fixtureDownload = page.waitForEvent('download')
  await page.evaluate(() => (window as any).exportTexturedFixture('glb'))
  const files = unzipSync(await downloadedBytes(await fixtureDownload))
  await page.route((url) => url.pathname === '/texture-fixture.glb', (route) => route.fulfill({
    contentType: 'model/gltf-binary', body: Buffer.from(files['textured.glb']),
  }))
  await page.goto('/modelviewer.html?model=/texture-fixture.glb')
  await page.waitForFunction(() => (window as any).uiReady)
  await page.getByTitle('材质检查器').click()
  await page.getByRole('button', { name: /金属度/ }).click()
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: '下载', exact: true }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toBe('texture-fixture_metalnessMap.png')
  expect(await pngPixel(page, await downloadedBytes(download))).toEqual({ width: 2, height: 2, pixel: [192, 192, 192, 255] })
})
