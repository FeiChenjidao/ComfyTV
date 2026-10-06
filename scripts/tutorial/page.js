(() => {
  const pagesMode = new URLSearchParams(location.search).get('mode') === 'pages'

  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.copy')
    if (!btn) return
    navigator.clipboard.writeText(btn.previousElementSibling.textContent).then(() => {
      btn.textContent = '已复制'
      setTimeout(() => { btn.textContent = '复制' }, 1400)
    })
  })

  if (!pagesMode) {
    const links = [...document.querySelectorAll('.toc a')]
    const heads = links.map((a) => document.querySelector(a.getAttribute('href')))
    const io = new IntersectionObserver((entries) => {
      for (const en of entries) {
        if (!en.isIntersecting) continue
        const i = heads.indexOf(en.target)
        links.forEach((a, j) => a.classList.toggle('active', j === i))
      }
    }, { rootMargin: '0px 0px -70% 0px' })
    heads.forEach((h) => h && io.observe(h))
    return
  }

  document.documentElement.dataset.mode = 'pages'
  const root = document.getElementById('pages')
  const blocks = [...document.querySelectorAll('#article > .block')]
  const pages = []

  function newPage() {
    const page = document.createElement('section')
    page.className = 'page'
    page.innerHTML = `
      <div class="page-top"><b>${root.dataset.brand}</b><span></span></div>
      <div class="page-body"></div>
      <div class="page-foot"><span>${root.dataset.lesson}</span><em></em></div>`
    root.appendChild(page)
    pages.push(page)
    return page.querySelector('.page-body')
  }

  const overflows = (body) => body.scrollHeight > body.clientHeight + 1

  function fitAlone(body, block) {
    const img = block.querySelector('.frame img')
    if (img) {
      const extra = block.offsetHeight - img.offsetHeight
      img.style.maxHeight = `${body.clientHeight - extra}px`
      img.style.width = 'auto'
      img.style.margin = '0 auto'
      block.querySelector('.frame').style.width = 'fit-content'
      block.querySelector('.frame').style.margin = '0 auto'
    }
    if (overflows(body)) block.style.zoom = String(body.clientHeight / block.scrollHeight)
  }

  async function paginate() {
    await document.fonts.ready
    await Promise.all([...document.images].map((img) => img.decode().catch(() => {})))

    let body = newPage()
    for (const block of blocks) {
      body.appendChild(block)
      if (!overflows(body)) continue
      if (body.children.length === 1) { fitAlone(body, block); continue }

      const carry = [block]
      block.remove()
      while (body.lastElementChild?.classList.contains('keep') && body.children.length > 1) {
        carry.unshift(body.lastElementChild)
        body.lastElementChild.remove()
      }
      body = newPage()
      carry.forEach((b) => body.appendChild(b))
      if (overflows(body)) fitAlone(body, block)
    }

    pages.forEach((page, i) => {
      const first = page.querySelector('.page-body > .block')
      page.querySelector('.page-top span').textContent = first?.dataset.ctx ?? ''
      page.querySelector('.page-foot em').innerHTML =
        `${String(i + 1).padStart(2, '0')}<small> / ${String(pages.length).padStart(2, '0')}</small>`
    })
    window.__pagesReady = true
  }

  paginate()
})()
