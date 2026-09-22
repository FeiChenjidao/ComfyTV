<script setup lang="ts">
import { marked } from 'marked'
import { computed, defineAsyncComponent, ref } from 'vue'

import { cn } from '@comfyorg/tailwind-utils'

import SanitizedHtml from '@agent/components/common/SanitizedHtml.vue'
import { api } from '@agent/scripts/api'
import type { AugmentedResultItem } from '@agent/utils/resultItem'
import {
  renderMarkdownToHtml,
  resolveMarkdownUrl
} from '@agent/utils/markdownRendererUtil'

import type { ReplyAsset } from '../../../utils/replyAssets'
import {
  classifyAssetUrl,
  replyAssetResultItem,
  tokenReplyAssets
} from '../../../utils/replyAssets'
import CodeBlock from './CodeBlock.vue'
import ReplyAssetGroup from './ReplyAssetGroup.vue'

const { text } = defineProps<{ text: string }>()
const apiBaseUrl = new URL(api.apiURL(''), window.location.origin).href
const normalizedBase = apiBaseUrl.replace(/\/+$/, '')

interface ProseSegment {
  type: 'prose'
  html: string
}
interface CodeSegment {
  type: 'code'
  code: string
  lang: string
}
interface AssetsSegment {
  type: 'assets'
  assets: ReplyAsset[]
}
type Segment = ProseSegment | CodeSegment | AssetsSegment

const segments = computed<Segment[]>(() => {
  const out: Segment[] = []
  let prose = ''
  const flushProse = () => {
    if (!prose) return
    out.push({
      type: 'prose',
      html: renderMarkdownToHtml(prose, apiBaseUrl)
    })
    prose = ''
  }
  for (const token of marked.lexer(text)) {
    if (token.type === 'code' && token.codeBlockStyle !== 'indented') {
      flushProse()
      out.push({
        type: 'code',
        code: token.text,
        lang: token.lang?.split(/\s+/)[0] || 'text'
      })
      continue
    }
    const assets = tokenReplyAssets(token)
    if (assets) {
      flushProse()
      const resolved = assets.map((asset) => ({
        ...asset,
        url: resolveMarkdownUrl(asset.url, normalizedBase)
      }))
      const prev = out.at(-1)
      if (prev?.type === 'assets') prev.assets.push(...resolved)
      else out.push({ type: 'assets', assets: resolved })
    } else {
      prose += token.raw
    }
  }
  flushProse()
  return out
})

const MediaLightbox = defineAsyncComponent(
  () => import('@agent/components/sidebar/tabs/queue/MediaLightbox.vue')
)

const proseItems = ref<AugmentedResultItem[]>([])
const proseIndex = ref(-1)

function onProseClick(event: MouseEvent): void {
  const image = event.target
  if (!(image instanceof HTMLImageElement)) return
  const asset = classifyAssetUrl(image.src) ?? {
    url: image.src,
    filename: image.alt || 'image',
    kind: 'image' as const
  }
  proseItems.value = [replyAssetResultItem({ ...asset, kind: 'image' })]
  proseIndex.value = 0
}

const proseClass = cn(
  'ctv:text-sm ctv:wrap-break-word ctv:text-base-foreground',
  'ctv:[&_img]:mt-2 ctv:[&_img]:block ctv:[&_img]:h-auto ctv:[&_img]:max-w-full ctv:[&_img]:cursor-pointer ctv:[&_img]:object-contain',
  'ctv:[&_a]:cursor-pointer ctv:[&_a]:text-primary-background ctv:[&_a]:underline',
  'ctv:[&_p]:my-0 ctv:[&_p]:pt-4 ctv:[&_p:first-child]:pt-0 ctv:[&_strong]:font-semibold',
  'ctv:[&_h1]:mt-0 ctv:[&_h1]:pt-4 ctv:[&_h1]:pb-2 ctv:[&_h1]:text-2xl ctv:[&_h1]:font-semibold',
  'ctv:[&_h2]:pt-3.5 ctv:[&_h2]:pb-1.5 ctv:[&_h2]:text-base ctv:[&_h2]:font-semibold ctv:[&_h3]:pt-2 ctv:[&_h3]:font-semibold',
  'ctv:[&_ol]:my-0 ctv:[&_ol]:list-decimal ctv:[&_ol]:pt-1 ctv:[&_ol]:pb-2 ctv:[&_ol]:pl-5',
  'ctv:[&_ul]:my-0 ctv:[&_ul]:list-disc ctv:[&_ul]:pt-1 ctv:[&_ul]:pb-2 ctv:[&_ul]:pl-5',
  'ctv:[&_:not(pre)>code]:rounded-sm ctv:[&_:not(pre)>code]:border ctv:[&_:not(pre)>code]:border-border-default ctv:[&_:not(pre)>code]:bg-secondary-background-hover ctv:[&_:not(pre)>code]:px-1.5 ctv:[&_:not(pre)>code]:py-0.5 ctv:[&_:not(pre)>code]:text-[0.875em]',
  'ctv:[&_blockquote]:my-2 ctv:[&_blockquote]:border-l-[3px] ctv:[&_blockquote]:border-border-default ctv:[&_blockquote]:py-1.5 ctv:[&_blockquote]:pl-3.5 ctv:[&_blockquote]:text-muted-foreground',
  'ctv:[&_table]:my-2 ctv:[&_table]:w-full ctv:[&_table]:border-collapse ctv:[&_table]:overflow-hidden ctv:[&_table]:rounded-lg ctv:[&_table]:bg-secondary-background',
  'ctv:[&_th]:border-b ctv:[&_th]:border-border-default ctv:[&_th]:bg-secondary-background-hover ctv:[&_th]:px-4 ctv:[&_th]:py-2.5 ctv:[&_th]:text-left ctv:[&_th]:font-semibold',
  'ctv:[&_td]:border-b ctv:[&_td]:border-border-default ctv:[&_td]:px-4 ctv:[&_td]:py-2.5'
)
</script>

<template>
  <div data-testid="markdown-stream" class="ctv:max-w-full ctv:min-w-0">
    <template v-for="(segment, index) in segments" :key="index">
      <CodeBlock
        v-if="segment.type === 'code'"
        :code="segment.code"
        :lang="segment.lang"
      />
      <ReplyAssetGroup
        v-else-if="segment.type === 'assets'"
        :assets="segment.assets"
      />
      <SanitizedHtml
        v-else
        :class="proseClass"
        :html="segment.html"
        @click="onProseClick"
      />
    </template>
    <MediaLightbox
      v-if="proseIndex !== -1"
      :all-gallery-items="proseItems"
      :active-index="proseIndex"
      @update:active-index="proseIndex = $event"
    />
  </div>
</template>
