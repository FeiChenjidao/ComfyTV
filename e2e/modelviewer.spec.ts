import { expect, test } from '@playwright/test'

test.describe('model viewer', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/modelviewer.html')
    await page.waitForFunction(() => (window as unknown as { uiReady?: boolean }).uiReady === true)
  })

  test('shows material modes and the texture inspector', async ({ page }) => {
    await expect(page.getByTitle('材质', { exact: true })).toBeVisible()
    const dataUrl = await page.locator('canvas').evaluate((canvas) =>
      (canvas as HTMLCanvasElement).toDataURL('image/png'))
    expect(dataUrl.length).toBeGreaterThan(1000)
    await page.getByTitle('材质检查器').click()
    await expect(page.getByText('漫反射').first()).toBeVisible()
    await expect(page.getByText('法线').first()).toBeVisible()
    await expect(page.getByText('未使用').first()).toBeVisible()
  })

  test('keeps the controls inside a narrow viewport', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 360 })
    await page.getByTitle('材质检查器').click()
    const viewport = page.locator('#app')
    const panel = page.locator('aside')
    const viewportBox = await viewport.boundingBox()
    const panelBox = await panel.boundingBox()
    expect(viewportBox).not.toBeNull()
    expect(panelBox).not.toBeNull()
    expect(panelBox!.x).toBeGreaterThanOrEqual(viewportBox!.x)
    expect(panelBox!.x + panelBox!.width).toBeLessThanOrEqual(viewportBox!.x + viewportBox!.width + 1)
  })
})
