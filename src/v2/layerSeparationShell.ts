import { watch } from 'vue'

import MainPromptInput from '@/components/stages/MainPromptInput.vue'
import StagePresetBar from '@/components/stages/StagePresetBar.vue'
import { useStageNode } from '@/composables/stages/useStageNode'
import { t } from '@/i18n'
import { type ComfyNode } from '@/lib/comfyApp'
import CustomParamsV2 from '@/v2/CustomParamsV2.vue'
import FooterSelectsV2 from '@/v2/FooterSelectsV2.vue'
import LayerSeparationEditorV2 from '@/v2/LayerSeparationEditorV2.vue'
import { attachOutputToolbar } from '@/v2/outputToolbar'
import { createIslandGroup } from '@/v2/islands'
import { bindNodeDrag } from '@/v2/nodeDrag'
import { bindPanelCollapse, stageInfoLine } from '@/v2/panelCollapse'
import { bindShellChrome } from '@/v2/shellChrome'
import {
  bindProgressRing,
  bindPromptResize,
  createNodeScope,
  ensureMinSize,
  hideNativeWidgets,
  ICON_GRIP,
  RUN_BUTTON_HTML,
} from '@/v2/shellCommon'
import { installV2ShellCss } from '@/v2/shellCss'
import { bindWheelCapture } from '@/v2/wheelCapture'
import ParamsPanelV2 from '@/v2/ParamsPanelV2.vue'
import MediaStripV2 from '@/v2/MediaStripV2.vue'
import { V2_SHELLS } from '@/v2/registry'
import ServerSelectV2 from '@/v2/ServerSelectV2.vue'
import type { StageKind, StageVariant } from '@/stores/stageStore'

const ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="4" y="5" width="14" height="10" rx="1.5"/><rect x="6" y="9" width="14" height="10" rx="1.5"/><path d="M9 13h8"/></svg>`

function el(tag: string, cls: string, html?: string) {
  const e = document.createElement(tag)
  e.className = cls
  if (html != null) e.innerHTML = html
  return e
}

function attach(node: ComfyNode, kind: StageKind, variant: StageVariant) {
  installV2ShellCss()
  const anyNode = node as any
  const title = t('v2.ed.layerSeparation')

  const card = el('div', 'v2-card')
  bindWheelCapture(card)
  const handle = el('div', 'v2-label v2-handle', `${ICON_GRIP}${ICON}<span>${title}</span>`)
  card.appendChild(handle)
  bindNodeDrag(node, handle)

  const preview = el('div', 'v2-preview')
  preview.style.minHeight = '280px'
  const mediaAnchor = el('div', 'v2-mp-host')
  mediaAnchor.style.cssText = 'position:absolute;inset:0;display:flex;flex-direction:column;'
  const busy = el('div', 'v2-preview__busy',
    `<div class="v2-preview__spinner"></div><div class="v2-preview__busytext"><span></span><small></small></div>`)
  preview.append(mediaAnchor, busy)

  const panel = el('div', 'v2-panel')
  const refsAnchor = el('div', 'v2-panel__refs')
  const promptAnchor = el('div', 'v2-panel__prompthost')
  const presetAnchor = el('div', 'v2-panel__presets')
  const customAnchor = el('div', 'v2-panel__custom')
  const paramsAnchor = el('div', 'v2-panel__params')
  const footer = el('div', 'v2-panel__footer')
  const wfAnchor = el('div', 'v2-panel__selects')
  const serverAnchor = el('div', 'v2-panel__server')
  const run = el('button', 'v2-run', RUN_BUTTON_HTML) as HTMLButtonElement
  footer.append(wfAnchor, serverAnchor, run)
  panel.append(refsAnchor, promptAnchor, presetAnchor, customAnchor, paramsAnchor, footer)
  card.append(preview, panel)

  node.addDOMWidget('v2_shell', 'v2', card, {
    getMinHeight: () => 560,
    hideOnZoom: false,
    serialize: false,
  })
  ensureMinSize(node, 360, 580)

  const stageApi = useStageNode(node as any, kind, variant)
  const { state: stageState, onRunRequest, onCancelRequest, onAction } = stageApi
  const scope = createNodeScope(node)
  scope.run(() => bindProgressRing(card, stageState))
  attachOutputToolbar(node, card, kind, stageState, onAction)

  const islands = createIslandGroup()
  const mountApps = () => {
    islands.unmountAll()
    islands.mount(mediaAnchor, LayerSeparationEditorV2, { node, state: stageState })
    const specs: Array<[unknown, Record<string, unknown>, HTMLElement]> = [
      [MediaStripV2, { getNode: () => node, types: ['image'] }, refsAnchor],
      [MainPromptInput, { node }, promptAnchor],
      [StagePresetBar, { node }, presetAnchor],
      [CustomParamsV2, { node, state: stageState }, customAnchor],
      [ParamsPanelV2, {
        getNode: () => node,
        exclude: ['psd_file', 'selected_id', 'captured_image', 'captured_images'],
      }, paramsAnchor],
      [FooterSelectsV2, { getNode: () => node, linkKind: 'layer-separation', extra: [] }, wfAnchor],
      [ServerSelectV2, { getNode: () => node, state: stageState }, serverAnchor],
    ]
    for (const [comp, props, anchor] of specs) {
      islands.mountWhenVisible(card, anchor, comp as any, props)
    }
  }
  mountApps()

  const prevConfigure = anyNode.onConfigure
  anyNode.onConfigure = function (...args: unknown[]) {
    prevConfigure?.apply(this, args)
    queueMicrotask(mountApps)
  }

  const busyPct = busy.querySelector('.v2-preview__busytext span') as HTMLElement
  const busyLabel = busy.querySelector('.v2-preview__busytext small') as HTMLElement
  scope.run(() => {
    watch(
      () => [stageState.running, stageState.progress?.value, stageState.progress?.max, stageState.progress?.text] as const,
      ([running, v, m, text]) => {
        run.dataset.busy = running ? '1' : ''
        busy.dataset.show = running ? '1' : ''
        const max = Number(m) || 0
        const p = running && max > 0 ? Math.min(1, Math.max(0, (Number(v) || 0) / max)) : 0
        busyPct.textContent = p > 0 ? `${Math.round(p * 100)}%` : ''
        busyLabel.textContent = running && text ? String(text) : ''
      },
      { immediate: true },
    )
  })

  run.addEventListener('pointerdown', (e) => e.stopPropagation())
  run.addEventListener('click', (ev) => {
    ev.stopPropagation()
    if (stageState.running) void onCancelRequest()
    else void onRunRequest()
  })

  bindNodeDrag(node, preview)
  bindShellChrome(node, {
    scope, card, socketAnchor: preview, state: stageState,
    media: { source: 'batch', preferImageInput: true },
    lod: true,
  })
  bindPromptResize(node, promptAnchor, scope)
  bindPanelCollapse(node, {
    scope, panel, footer, run,
    info: () => stageInfoLine(node, stageState),
  })

  const prevRemoved = anyNode.onRemoved
  anyNode.onRemoved = function (...args: unknown[]) {
    islands.unmountAll()
    prevRemoved?.apply(this, args)
  }

  hideNativeWidgets(node)
  return stageApi
}

V2_SHELLS['ComfyTV.LayerSeparationStage'] = attach
