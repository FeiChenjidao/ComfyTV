import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

const source = readFileSync(new URL('../photoshop-uxp-plugin/main.js', import.meta.url), 'utf8')

function sliceBetween(startText, endText) {
  const start = source.indexOf(startText)
  const end = source.indexOf(endText, start)
  assert.ok(start >= 0 && end > start, `missing source section: ${startText}`)
  return source.slice(start, end)
}

function createState() {
  const values = new Map()
  const context = {
    STORE_PREFIX: 'comfytv.uxp.',
    HISTORY_ALL_CATEGORY: '__all__',
    HISTORY_UNCATEGORIZED_LABEL: '未分类',
    historyCategories: [
      { id: 'style', name: '风格稿' },
      { id: 'client', name: '客户稿' },
    ],
    selectedHistoryCategoryId: '',
    activeRenderHistoryCategoryId: null,
    historyPanelFilter: '__all__',
    renderHistory: [],
    historyPanelEditing: true,
    historyMutationBusy: false,
    historyPanelSelection: new Set(),
    historyPanelSelectionAnchor: '',
    historyPanelPage: 0,
    renderInFlight() { return false },
    scheduleDurableStateBackup() {},
    plainBounds(value) { return value || null },
    localStorage: {
      getItem(key) { return values.has(key) ? values.get(key) : null },
      setItem(key, value) { values.set(key, String(value)) },
    },
    document: {
      createElement() {
        return {
          value: '',
          textContent: '',
          selected: false,
          appendChild() {},
        }
      },
    },
    element(id) {
      if (id === 'history-panel-move-target') return { value: 'client' }
      return null
    },
    syncComposerWorkbench() {},
    paintHistoryPanel() {},
    showStatus() {},
    historyPanelPageCount() { return 1 },
    Math,
    Date,
    JSON,
    Set,
    String,
  }
  vm.createContext(context)
  vm.runInContext(sliceBetween('function historyKey()', 'async function historyFile'), context)
  vm.runInContext(sliceBetween('function historyPanelEntries()', 'function historyCardFromEvent'), context)
  vm.runInContext(sliceBetween('function toggleHistoryPanelSelection', 'function setHistoryPanelOpen'), context)
  return context
}

test('old history records migrate to uncategorized while categories persist', () => {
  const state = createState()
  state.localStorage.setItem('comfytv.uxp.renderHistory', JSON.stringify([
    { name: 'render-1.png', number: 1 },
    { name: 'render-2.png', number: 2, categoryId: 'style' },
    { name: 'render-3.png', number: 3, categoryId: 'missing' },
  ]))
  const items = state.readRenderHistory()
  assert.deepEqual(items.map((item) => item.categoryId), ['', 'style', ''])
})

test('layered history keeps its own canvas geometry and placement metadata', () => {
  const state = createState()
  state.renderHistory = [{
    name: 'render-10.png',
    number: 10,
    categoryId: 'style',
    placement: { bounds: { left: 20, top: 30, right: 620, bottom: 430 }, frame: null },
    layered: {
      canvas: { width: 1200, height: 800 },
      layers: [{ fileName: 'render-10-layer-00.png', name: 'subject', x: 100, y: 80, width: 400, height: 500, zIndex: 2 }],
    },
  }]
  state.saveRenderHistory()
  const restored = JSON.parse(JSON.stringify(state.readRenderHistory()[0]))
  assert.deepEqual(restored.placement.bounds, { left: 20, top: 30, right: 620, bottom: 430 })
  assert.deepEqual(restored.layered.canvas, { width: 1200, height: 800 })
  assert.deepEqual(restored.layered.layers[0], {
    fileName: 'render-10-layer-00.png',
    name: 'subject',
    x: 100,
    y: 80,
    width: 400,
    height: 500,
    zIndex: 2,
  })
})

test('history filtering keeps original indexes for preview selection', () => {
  const state = createState()
  state.renderHistory = [
    { name: 'a.png', categoryId: '' },
    { name: 'b.png', categoryId: 'style' },
    { name: 'c.png', categoryId: 'client' },
    { name: 'd.png', categoryId: 'style' },
  ]
  state.historyPanelFilter = 'style'
  assert.deepEqual(
    Array.from(state.historyPanelEntries(), (entry) => [entry.item.name, entry.index]),
    [['b.png', 1], ['d.png', 3]],
  )
})

test('shift selection spans the filtered history order and batch move changes category', () => {
  const state = createState()
  state.renderHistory = [
    { name: 'a.png', categoryId: '' },
    { name: 'b.png', categoryId: 'style' },
    { name: 'c.png', categoryId: '' },
    { name: 'd.png', categoryId: 'style' },
  ]
  state.toggleHistoryPanelSelection({ dataset: { name: 'b.png' } })
  state.toggleHistoryPanelSelection({ dataset: { name: 'd.png' } }, { shiftKey: true })
  assert.deepEqual([...state.historyPanelSelection], ['b.png', 'c.png', 'd.png'])
  state.moveSelectedRenderHistory()
  assert.deepEqual(state.renderHistory.map((item) => item.categoryId), ['', 'client', 'client', 'client'])
  assert.equal(state.historyPanelSelection.size, 0)
})

test('opening settings does not close the independent history panel', () => {
  const classes = new Set(['hidden'])
  const drawer = {
    classList: {
      add(value) { classes.add(value) },
      remove(value) { classes.delete(value) },
      contains(value) { return classes.has(value) },
    },
  }
  let historyCloseCalls = 0
  const context = {
    document: {
      querySelectorAll(selector) {
        assert.equal(selector, '.drawer')
        return [drawer]
      },
    },
    element(id) {
      assert.equal(id, 'settings-drawer')
      return drawer
    },
    setHistoryPanelOpen(open) {
      if (!open) historyCloseCalls += 1
    },
    closeComposerMenus() {},
    syncDrawerButtons() {},
    syncComposerOverlay() {},
  }
  vm.createContext(context)
  vm.runInContext(sliceBetween('function closeDrawers()', 'function syncComposerOverlay'), context)
  vm.runInContext(sliceBetween('function toggleDrawer(id)', 'const referenceFiles'), context)
  context.toggleDrawer('settings-drawer')
  assert.equal(classes.has('hidden'), false)
  assert.equal(historyCloseCalls, 0)
})
