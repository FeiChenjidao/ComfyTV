// 公众号版：只用行内 style，复制进公众号编辑器不丢格式。
// 公众号粘贴时会删 <style>、class、id、position、伪元素、CSS 变量、背景图、网络字体，
// 外链也点不了，所以这里：样式全写进 style 属性；外链改成文末「参考链接」脚注；
// 页内锚点只留文字；列表用段落加前缀；三列以上的长表改成卡片，手机上好读。
// 本地图片公众号拿不到：预览里能看到，粘贴后要在编辑器里逐张重新上传。
import { Marked } from 'marked'

const C = {
  ink: '#1b1916', ink2: '#48433b', muted: '#8c8478', rule: '#e6ddd0',
  accent: '#c2412a', soft: '#f7efe9', paper2: '#f3eee6', warn: '#a8691a', warnSoft: '#f8eedb',
  code: '#1e1c19', codeInk: '#efe6d6',
}
const MONO = "Menlo, Consolas, 'Courier New', monospace"
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
// 值里的双引号会提前截断 style 属性，一律换成单引号
const st = (o) => Object.entries(o).map(([k, v]) => `${k.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}:${String(v).replace(/"/g, "'")}`).join(';')

export function renderWechat(tokens, { repoUrl = '', title = '', relocate = (u) => u } = {}) {
  const notes = []
  const noteOf = (href) => {
    let i = notes.indexOf(href)
    if (i < 0) { notes.push(href); i = notes.length - 1 }
    return i + 1
  }

  const md = new Marked({
    renderer: {
      strong({ tokens }) { return `<strong style="${st({ fontWeight: 'bold', color: C.ink })}">${this.parser.parseInline(tokens)}</strong>` },
      em({ tokens }) { return `<em style="font-style:italic">${this.parser.parseInline(tokens)}</em>` },
      codespan({ text }) {
        return `<code style="${st({ fontFamily: MONO, fontSize: '0.9em', color: C.accent, backgroundColor: C.paper2, padding: '1px 4px', borderRadius: '3px', wordBreak: 'break-all' })}">${esc(text)}</code>`
      },
      link({ href, tokens }) {
        const text = this.parser.parseInline(tokens)
        if (!href || href.startsWith('#')) return text
        const url = /^[a-z]+:/i.test(href) ? href : repoUrl ? repoUrl.replace(/\/?$/, '/') + href.replace(/^\.\//, '') : ''
        if (!url) return text
        return `<span style="color:${C.accent}">${text}</span><sup style="${st({ color: C.accent, fontSize: '11px' })}">[${noteOf(url)}]</sup>`
      },
      image({ href, text }) {
        return `<img src="${esc(relocate(href))}" alt="${esc(text)}" style="${st({ display: 'block', maxWidth: '100%', margin: '0 auto', borderRadius: '6px' })}">`
      },
      br() { return '<br>' },
      del({ tokens }) { return `<del>${this.parser.parseInline(tokens)}</del>` },
    },
  })
  const inline = (s) => md.parseInline(s)

  const P = st({ margin: '0 0 16px', fontSize: '15px', lineHeight: '1.85', color: C.ink2, letterSpacing: '0.5px' })
  const out = []
  let partNo = 0
  let afterHero = false
  let chapter = false
  let leadDone = false
  let figure = 0

  function list(tok, depth = 0) {
    tok.items.forEach((item, i) => {
      const mark = tok.ordered ? `${(tok.start || 1) + i}.` : depth ? '◦' : '•'
      const text = item.tokens.filter((t) => t.type !== 'list').map((t) => inline(t.text)).join('')
      out.push(`<p style="${st({ margin: '0 0 10px', paddingLeft: `${20 + depth * 18}px`, textIndent: '-16px', fontSize: '15px', lineHeight: '1.8', color: C.ink2, letterSpacing: '0.5px' })}"><span style="${st({ color: C.accent, fontWeight: 'bold', display: 'inline-block', width: '16px', textIndent: '0' })}">${mark}</span>${text}</p>`)
      item.tokens.filter((t) => t.type === 'list').forEach((t) => list(t, depth + 1))
    })
    out.push(`<p style="margin:0 0 6px"></p>`)
  }

  function code(text) {
    const lines = text.split('\n').map((l) => esc(l).replace(/ /g, '&nbsp;') || '&nbsp;')
    out.push(`<section style="${st({ margin: '0 0 18px', padding: '14px 16px', backgroundColor: C.code, borderRadius: '8px', overflowX: 'auto' })}"><code style="${st({ display: 'block', fontFamily: MONO, fontSize: '12.5px', lineHeight: '1.75', color: C.codeInk, whiteSpace: 'nowrap', backgroundColor: 'transparent' })}">${lines.join('<br>')}</code></section>`)
  }

  function table(tok) {
    const cells = tok.rows.flat()
    const long = tok.header.length >= 3 && cells.some((c) => c.text.length > 40)
    if (long) {
      // 卡片：第一列作标题，其余列各带列名
      for (const row of tok.rows) {
        const rest = row.slice(1).map((c, j) => `<p style="${st({ margin: '8px 0 0', fontSize: '14px', lineHeight: '1.8', color: C.ink2, letterSpacing: '0.3px' })}"><span style="${st({ display: 'inline-block', fontSize: '12px', color: C.muted, letterSpacing: '1px', marginRight: '6px' })}">${inline(tok.header[j + 1].text)}</span>${inline(c.text)}</p>`).join('')
        out.push(`<section style="${st({ margin: '0 0 12px', padding: '12px 14px', backgroundColor: C.paper2, borderLeft: `3px solid ${C.accent}`, borderRadius: '4px' })}"><p style="${st({ margin: '0', fontSize: '15px', fontWeight: 'bold', lineHeight: '1.6', color: C.ink })}">${inline(row[0].text)}</p>${rest}</section>`)
      }
      out.push(`<p style="margin:0 0 6px"></p>`)
      return
    }
    const th = st({ padding: '8px 6px', fontSize: '12px', color: C.muted, fontWeight: 'bold', textAlign: 'left', borderBottom: `1.5px solid ${C.ink}`, letterSpacing: '1px' })
    const td = st({ padding: '8px 6px', fontSize: '13.5px', lineHeight: '1.65', color: C.ink2, borderBottom: `1px solid ${C.rule}`, verticalAlign: 'top' })
    out.push(`<section style="margin:0 0 18px;overflow-x:auto"><table style="width:100%;border-collapse:collapse"><thead><tr>${tok.header.map((h) => `<th style="${th}">${inline(h.text)}</th>`).join('')}</tr></thead><tbody>${tok.rows.map((r) => `<tr>${r.map((c) => `<td style="${td}">${inline(c.text)}</td>`).join('')}</tr>`).join('')}</tbody></table></section>`)
  }

  for (const tok of tokens) {
    if (tok.type === 'space') continue
    if (tok.type === 'hr') continue

    if (tok.type === 'heading' && tok.depth === 1) {
      let kicker = ''
      let t = tok.text
      let m
      if (t.includes('：')) [kicker, t] = t.split('：', 2)
      else if ((m = t.match(/^(.+?)[（(](.+)[）)]\s*$/))) [kicker, t] = [m[1].trim(), m[2]]
      out.push(`<section style="margin:8px 0 24px">${kicker ? `<p style="${st({ margin: '0 0 6px', fontSize: '13px', color: C.accent, fontWeight: 'bold', letterSpacing: '3px' })}">— ${esc(kicker)}</p>` : ''}<h1 style="${st({ margin: '0', fontSize: '26px', lineHeight: '1.35', fontWeight: 'bold', color: C.ink, letterSpacing: '1px' })}">${inline(t)}</h1></section>`)
      afterHero = true
      continue
    }

    if (tok.type === 'heading' && tok.depth === 2) {
      const m = tok.text.match(/^([一二三四五六七八九十]+)、\s*(.*)$/)
      if (m) partNo += 1
      chapter = true
      const part = m
        ? `PART <span style="${st({ fontSize: '18px', color: C.accent, fontWeight: 'bold', fontStyle: 'italic' })}">${String(partNo).padStart(2, '0')}</span>`
        : `<span style="${st({ fontSize: '16px', color: C.accent })}">✦</span> 总结`
      out.push(`<section style="${st({ margin: '40px 0 18px', paddingBottom: '8px', borderBottom: `1px solid ${C.rule}` })}"><p style="${st({ margin: '0', fontSize: '12px', color: C.muted, letterSpacing: '2px' })}">${part}</p><h2 style="${st({ margin: '2px 0 0', fontSize: '21px', lineHeight: '1.4', fontWeight: 'bold', color: C.ink })}">${inline(m ? m[2] : tok.text)}</h2><section style="${st({ width: '40px', height: '3px', backgroundColor: C.ink, marginTop: '8px' })}"></section></section>`)
      continue
    }

    const stepM = tok.type === 'heading' && tok.depth >= 3 && tok.text.match(/^第\s*(\d+)\s*步[：:]\s*(.*)$/)
    if (stepM) {
      out.push(`<section style="${st({ margin: '30px 0 14px' })}"><p style="${st({ margin: '0 0 2px', fontSize: '12px', color: C.muted, letterSpacing: '2px' })}"><span style="${st({ display: 'inline-block', width: '22px', height: '22px', lineHeight: '22px', borderRadius: '11px', backgroundColor: C.accent, color: '#fff', textAlign: 'center', fontSize: '13px', fontWeight: 'bold', fontStyle: 'italic', marginRight: '8px', letterSpacing: '0' })}">${stepM[1]}</span>第 ${stepM[1]} 步</p><h3 style="${st({ margin: '0', fontSize: '17px', lineHeight: '1.45', fontWeight: 'bold', color: C.ink })}">${inline(stepM[2])}</h3></section>`)
      continue
    }

    if (tok.type === 'heading' && tok.depth === 3) {
      out.push(`<h3 style="${st({ margin: '28px 0 14px', paddingLeft: '10px', borderLeft: `4px solid ${C.accent}`, fontSize: '17px', lineHeight: '1.45', fontWeight: 'bold', color: C.ink })}">${inline(tok.text)}</h3>`)
      continue
    }

    if (tok.type === 'heading') {
      out.push(`<h4 style="${st({ margin: '20px 0 10px', fontSize: '15px', lineHeight: '1.5', fontWeight: 'bold', color: C.ink2 })}"><span style="color:${C.accent}">◆ </span>${inline(tok.text)}</h4>`)
      continue
    }

    if (tok.type === 'paragraph') {
      const langBar = tok.tokens.some((t) => t.type === 'link') && tok.tokens.every((t) => t.type === 'link' || (t.type === 'text' && t.text.replace(/[\s·|/]/g, '').length <= 6))
      if (afterHero && !chapter && langBar) continue
      if (tok.tokens.length === 1 && tok.tokens[0].type === 'image') {
        const img = tok.tokens[0]
        figure += 1
        out.push(`<section style="margin:0 0 18px">${inline(tok.text)}<p style="${st({ margin: '6px 0 0', fontSize: '12px', color: C.muted, textAlign: 'center' })}"><span style="${st({ color: C.accent, fontStyle: 'italic', fontWeight: 'bold', marginRight: '6px' })}">图 ${figure}</span>${esc(img.text)}</p></section>`)
        continue
      }
      if (tok.tokens.length === 1 && tok.tokens[0].type === 'strong') {
        out.push(`<p style="${st({ margin: '20px 0 10px', fontSize: '15.5px', fontWeight: 'bold', color: C.ink })}"><span style="color:${C.accent}">◆ </span>${inline(tok.tokens[0].text)}</p>`)
        continue
      }
      if (afterHero && !chapter && !leadDone) {
        leadDone = true
        out.push(`<p style="${st({ margin: '0 0 16px', padding: '2px 0 2px 12px', borderLeft: `3px solid ${C.accent}`, fontSize: '16px', lineHeight: '1.85', color: C.ink2, letterSpacing: '0.5px' })}">${inline(tok.text)}</p>`)
        continue
      }
      out.push(`<p style="${P}">${inline(tok.text)}</p>`)
      continue
    }

    if (tok.type === 'list') { list(tok); continue }
    if (tok.type === 'code') { code(tok.text); continue }
    if (tok.type === 'table') { table(tok); continue }

    if (tok.type === 'blockquote') {
      const warn = /^\*\*注意\*\*/.test(tok.text)
      const body = tok.tokens.filter((t) => t.type === 'paragraph').map((t) => `<p style="${st({ margin: '4px 0 0', fontSize: '14.5px', lineHeight: '1.8', color: C.ink2 })}">${inline(t.text.replace(/^\*\*注意\*\*[：:]?\s*/, ''))}</p>`).join('')
      out.push(`<section style="${st({ margin: '0 0 18px', padding: '12px 14px', borderRadius: '6px', backgroundColor: warn ? C.warnSoft : C.paper2, borderLeft: warn ? `3px solid ${C.warn}` : 'none' })}"><span style="${st({ display: 'inline-block', padding: '0 8px', borderRadius: '10px', fontSize: '11px', fontWeight: 'bold', letterSpacing: '2px', color: '#fff', backgroundColor: warn ? C.warn : C.ink })}">${warn ? '注意' : '提示'}</span>${body}</section>`)
      continue
    }
    // html 注释（含 TODO(截图) 占位）不进公众号
  }

  if (notes.length) {
    out.push(`<section style="${st({ margin: '36px 0 0', paddingTop: '12px', borderTop: `1px solid ${C.rule}` })}"><p style="${st({ margin: '0 0 8px', fontSize: '13px', fontWeight: 'bold', color: C.ink2, letterSpacing: '2px' })}">参考链接</p>${notes.map((u, i) => `<p style="${st({ margin: '0 0 4px', fontSize: '12px', lineHeight: '1.6', color: C.muted, wordBreak: 'break-all' })}">[${i + 1}] ${esc(u)}</p>`).join('')}</section>`)
  }

  const article = `<section style="${st({ padding: '0 4px', fontSize: '15px', color: C.ink2, lineHeight: '1.85', fontFamily: "-apple-system, BlinkMacSystemFont, 'PingFang SC', 'Microsoft YaHei', sans-serif" })}">${out.join('')}</section>`

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · 公众号版</title>
</head>
<body style="margin:0;background:#ece7de">
<div style="position:sticky;top:0;z-index:1;display:flex;gap:12px;align-items:center;justify-content:center;padding:12px;background:#1b1916;color:#efe6d6;font:14px sans-serif">
  <button id="copy" style="font:bold 14px sans-serif;padding:8px 18px;border:0;border-radius:6px;background:#c2412a;color:#fff;cursor:pointer">复制到公众号</button>
  <span id="msg">点按钮后，在公众号编辑器正文里 Ctrl+V</span>
</div>
<div style="max-width:420px;margin:24px auto;padding:20px 16px;background:#fff;box-shadow:0 2px 16px rgba(0,0,0,.08)">
<div id="wx">${article}</div>
</div>
<script>
document.getElementById('copy').onclick = async () => {
  const node = document.getElementById('wx')
  const msg = document.getElementById('msg')
  try {
    await navigator.clipboard.write([new ClipboardItem({
      'text/html': new Blob([node.innerHTML], { type: 'text/html' }),
      'text/plain': new Blob([node.innerText], { type: 'text/plain' }),
    })])
  } catch {
    const range = document.createRange()
    range.selectNodeContents(node)
    const sel = getSelection(); sel.removeAllRanges(); sel.addRange(range)
    document.execCommand('copy'); sel.removeAllRanges()
  }
  msg.textContent = '已复制，去公众号编辑器正文里 Ctrl+V'
}
</script>
</body>
</html>`
}
