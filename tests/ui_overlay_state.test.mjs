import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const mainSource = readFileSync(new URL('../photoshop-uxp-plugin/main.js', import.meta.url), 'utf8')
const htmlSource = readFileSync(new URL('../photoshop-uxp-plugin/index.html', import.meta.url), 'utf8')

test('toolbar SVG icons stay outside native buttons for Photoshop UXP painting', () => {
  for (const id of ['settings-toggle', 'web-toggle', 'fit-toggle', 'history-toggle']) {
    assert.match(htmlSource, new RegExp(`<span id="${id}"[^>]*role="button"[^>]*tabindex="0"`))
    assert.doesNotMatch(htmlSource, new RegExp(`<button id="${id}"`))
  }
  assert.doesNotMatch(htmlSource, /class="btn-hit"/)
})

test('drawers and composer popovers are mutually exclusive', () => {
  const closeDrawersStart = mainSource.indexOf('function closeDrawers()')
  const toggleDrawerStart = mainSource.indexOf('function toggleDrawer(')
  const openPopoverStart = mainSource.indexOf('function openHostPopover(')
  assert.ok(closeDrawersStart >= 0)
  assert.ok(toggleDrawerStart > closeDrawersStart)
  assert.ok(openPopoverStart > toggleDrawerStart)

  const toggleDrawer = mainSource.slice(toggleDrawerStart, mainSource.indexOf('const referenceFiles', toggleDrawerStart))
  const openPopover = mainSource.slice(openPopoverStart, mainSource.indexOf('function mountComposerWorkbench', openPopoverStart))
  assert.match(toggleDrawer, /closeDrawers\(\)/)
  assert.match(toggleDrawer, /closeComposerMenus\(\)/)
  assert.match(openPopover, /closeDrawers\(\)[\s\S]*closeComposerMenus\(\)/)
})

test('settings opens on pointerdown instead of waiting for a delayed click', () => {
  assert.match(mainSource, /element\("settings-toggle"\)\.addEventListener\("pointerdown"/)
})
