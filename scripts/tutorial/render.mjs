import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { marked } from 'marked'
import { chromium } from 'playwright'
import { renderWechat } from './wechat.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const mdPath = path.resolve(args.find((a) => !a.startsWith('--')) ?? '')
const outIdx = args.indexOf('--out')
const outDir = path.resolve(outIdx >= 0 ? args[outIdx + 1] : path.join(path.dirname(mdPath), 'dist'))
const withImages = !args.includes('--no-images')
if (!fs.existsSync(mdPath)) {
  console.error('usage: node scripts/tutorial/render.mjs <file.md> [--out dir] [--no-images]')
  process.exit(1)
}

const mdDir = path.dirname(mdPath)
const name = path.basename(mdPath).replace(/\.md$/, '')
const CN_NUM = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 }

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const two = (n) => String(n).padStart(2, '0')
const cnToInt = (s) => (s.length === 1 ? CN_NUM[s] : s === '十' ? 10 : s.startsWith('十') ? 10 + CN_NUM[s[1]] : CN_NUM[s[0]] * 10 + (CN_NUM[s[2]] ?? 0))

function relocate(url) {
  if (!url || /^([a-z]+:|#|\/)/i.test(url)) return url
  return path.relative(outDir, path.resolve(mdDir, url)).split(path.sep).join('/')
}

const renderer = new marked.Renderer()
renderer.image = ({ href, text }) => `<img src="${esc(relocate(href))}" alt="${esc(text)}">`
renderer.link = function ({ href, tokens }) {
  return `<a href="${esc(relocate(href))}">${this.parser.parseInline(tokens)}</a>`
}
marked.use({ renderer })

const tokens = marked.lexer(fs.readFileSync(mdPath, 'utf8'))
const blockHtml = (tok) => marked.parser(Object.assign([tok], { links: tokens.links }))

let lesson = { kicker: '', title: '', num: '' }
const chapters = []
const out = []
let chapter = null
let step = null
let figure = 0
let afterHero = false

function block(cls, html, id = '') {
  const ctx = step ? `${chapter.label} · ${step.label}` : chapter ? chapter.label : ''
  out.push(`<div${id ? ` id="${id}"` : ''} class="block ${cls}${step ? ' in-step' : ''}" data-ctx="${esc(ctx)}">${html}</div>`)
}

for (const tok of tokens) {
  if (tok.type === 'space' || tok.type === 'hr') continue

  if (tok.type === 'heading' && tok.depth === 1) {
    const [kicker, title] = tok.text.includes('：') ? tok.text.split('：', 2) : ['', tok.text]
    const m = kicker.match(/第(.+?)课/)
    lesson = { kicker, title, num: m ? two(cnToInt(m[1])) : '' }
    out.push(`<header class="block hero" data-ctx="">
      ${lesson.num ? `<div class="hero-num" aria-hidden="true">${lesson.num}</div>` : ''}
      ${kicker ? `<div class="hero-kicker"><span></span>${esc(kicker)}</div>` : ''}
      <h1>${marked.parseInline(title)}</h1>
    </header>`)
    afterHero = true
    continue
  }

  if (tok.type === 'heading' && tok.depth === 2) {
    const m = tok.text.match(/^([一二三四五六七八九十]+)、\s*(.*)$/)
    const id = `ch-${chapters.length + 1}`
    const label = m ? m[2] : tok.text
    chapter = { id, label, num: m ? two(cnToInt(m[1])) : '' }
    chapters.push(chapter)
    step = null
    block('chapter-head keep', `
      <div class="part">${chapter.num ? `Part <em>${chapter.num}</em>` : '<em>✦</em> 总结'}</div>
      <h2>${marked.parseInline(label)}</h2>`, id)
    continue
  }

  if (tok.type === 'heading' && tok.depth >= 3) {
    const m = tok.text.match(/^第\s*(\d+)\s*步[：:]\s*(.*)$/)
    step = { label: m ? `第 ${m[1]} 步` : tok.text }
    block('step-head keep', `
      <span class="step-dot">${m ? `<em>${m[1]}</em>` : '•'}</span>
      <h3>${m ? `<small>第 ${m[1]} 步</small>` : ''}${marked.parseInline(m ? m[2] : tok.text)}</h3>`)
    continue
  }

  if (tok.type === 'paragraph' && tok.tokens.length === 1 && tok.tokens[0].type === 'image') {
    const img = tok.tokens[0]
    figure += 1
    block('figure', `<figure>
      <div class="frame"><img src="${esc(relocate(img.href))}" alt="${esc(img.text)}"></div>
      <figcaption><em>图 ${figure}</em>${esc(img.text)}</figcaption>
    </figure>`)
    continue
  }

  if (tok.type === 'paragraph' && tok.tokens.length === 1 && tok.tokens[0].type === 'strong') {
    block('substep keep', `<p><strong>${marked.parseInline(tok.tokens[0].text)}</strong></p>`)
    continue
  }

  if (tok.type === 'html' && /^<!--/.test(tok.text.trim())) {
    const m = tok.text.match(/TODO\(截图\)[：:]\s*([\s\S]*?)\s*-->/)
    if (m) block('shot-todo', `<div class="todo"><span>待补截图</span>${esc(m[1])}</div>`)
    continue
  }

  if (tok.type === 'blockquote') {
    const warn = /^\*\*注意\*\*/.test(tok.text)
    const inner = marked.parser(Object.assign(tok.tokens, { links: tokens.links })).replace(/<strong>注意<\/strong>[：:]?\s*/, '')
    block(`callout ${warn ? 'warn' : 'note'}`, `<div class="callout-box"><div class="callout-label">${warn ? '注意' : '提示'}</div>${inner}</div>`)
    continue
  }

  if (tok.type === 'code') {
    block('code', `<pre><code>${esc(tok.text)}</code><button class="copy" type="button">复制</button></pre>`)
    continue
  }

  if (tok.type === 'table') {
    block('table', `<div class="table-wrap">${blockHtml(tok)}</div>`)
    continue
  }

  const leadIn = tok.type === 'paragraph' && /[：:]\s*$/.test(tok.text) ? ' keep' : ''
  block((afterHero && !chapter && tok.type === 'paragraph' ? 'lead' : tok.type) + leadIn, blockHtml(tok))
}

step = null
block('end', `<em>✦</em> ${esc(lesson.kicker ? `${lesson.kicker}完` : '完')}`)

const toc = chapters
  .map((c) => `<a href="#${c.id}"><em>${c.num || '✦'}</em>${esc(c.label)}</a>`)
  .join('')

const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc([lesson.kicker, lesson.title].filter(Boolean).join(' · '))}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400;0,9..144,600;1,9..144,400;1,9..144,600&family=Noto+Serif+SC:wght@600;900&display=block" rel="stylesheet">
<style>${fs.readFileSync(path.join(here, 'style.css'), 'utf8')}</style>
</head>
<body>
<nav class="toc" aria-label="章节">
  <div class="toc-title">${esc(lesson.kicker || '目录')}</div>
  ${toc}
</nav>
<main id="article">
${out.join('\n')}
</main>
<div id="pages" data-brand="ComfyTV 图文教程" data-lesson="${esc(lesson.kicker)}"></div>
<script>${fs.readFileSync(path.join(here, 'page.js'), 'utf8')}</script>
</body>
</html>`

fs.mkdirSync(outDir, { recursive: true })
const htmlPath = path.join(outDir, `${name}.html`)
fs.writeFileSync(htmlPath, html)
console.log(`html  ${path.relative(process.cwd(), htmlPath)}`)

const wxPath = path.join(outDir, `${name}.wechat.html`)
fs.writeFileSync(wxPath, renderWechat(tokens, { relocate, title: [lesson.kicker, lesson.title].filter(Boolean).join(' · ') }))
console.log(`wx    ${path.relative(process.cwd(), wxPath)}`)

if (withImages) {
  const imgDir = path.join(outDir, name)
  fs.rmSync(imgDir, { recursive: true, force: true })
  fs.mkdirSync(imgDir, { recursive: true })
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1200, height: 1600 }, deviceScaleFactor: 2 })
  await page.goto(`${pathToFileURL(htmlPath).href}?mode=pages`)
  await page.waitForFunction(() => window.__pagesReady === true, null, { timeout: 60000 })
  const cards = page.locator('#pages .page')
  const count = await cards.count()
  for (let i = 0; i < count; i++) {
    const file = path.join(imgDir, `${name}-${two(i + 1)}.png`)
    await cards.nth(i).screenshot({ path: file })
  }
  await browser.close()
  console.log(`pages ${count} → ${path.relative(process.cwd(), imgDir)}`)
}
