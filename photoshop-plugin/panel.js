(function () {
  'use strict'

  var DEFAULT_SERVER = 'http://127.0.0.1:8188'
  var SERVER_KEY = 'comfytv.server'
  var fs = require('fs')

  function element(id) {
    return document.getElementById(id)
  }

  function normalizeServer(value) {
    var server = String(value || '').trim().replace(/\/$/, '')
    if (!/^http:\/\/(127\.0\.0\.1|localhost):8188$/i.test(server)) {
      throw new Error('Use http://127.0.0.1:8188')
    }
    return server
  }

  function setStatus(message, state) {
    element('status').textContent = message
    element('status-dot').className = 'status-dot' + (state ? ' ' + state : '')
  }

  function request(method, url, body) {
    return new Promise(function (resolve, reject) {
      var xhr = new XMLHttpRequest()
      xhr.open(method, url, true)
      xhr.timeout = 10000
      if (body) xhr.setRequestHeader('Content-Type', 'application/json')
      xhr.onload = function () {
        var payload = {}
        try {
          payload = JSON.parse(xhr.responseText || '{}')
        } catch (error) {
          reject(new Error('ComfyUI returned an invalid response'))
          return
        }
        if (xhr.status >= 200 && xhr.status < 300) resolve(payload)
        else reject(new Error(payload.error || 'HTTP ' + xhr.status))
      }
      xhr.onerror = function () { reject(new Error('Cannot connect to ComfyUI')) }
      xhr.ontimeout = function () { reject(new Error('ComfyUI connection timed out')) }
      xhr.send(body ? JSON.stringify(body) : null)
    })
  }

  function serverAddress() {
    return normalizeServer(element('server').value)
  }

  function connect() {
    try {
      var server = serverAddress()
      localStorage.setItem(SERVER_KEY, server)
      setStatus('Connecting...')
      return request('GET', server + '/comfytv/photoshop/status').then(function () {
        setStatus('Connected', 'connected')
      }).catch(function (error) {
        setStatus(error.message, 'error')
      })
    } catch (error) {
      setStatus(error.message, 'error')
      return Promise.resolve()
    }
  }

  function evalScript(script) {
    return new Promise(function (resolve) {
      window.__adobe_cep__.evalScript(script, resolve)
    })
  }

  function waitForExport(directory) {
    var started = Date.now()
    var previousSize = -1
    return new Promise(function (resolve, reject) {
      function check() {
        try {
          var files = fs.readdirSync(directory).filter(function (name) { return /\.png$/i.test(name) })
          if (files.length) {
            var path = directory + '/' + files[0]
            var size = fs.statSync(path).size
            if (size > 0 && size === previousSize) {
              resolve(path)
              return
            }
            previousSize = size
          }
        } catch (error) {
          reject(error)
          return
        }
        if (Date.now() - started >= 15000) {
          reject(new Error('Photoshop export timed out'))
          return
        }
        setTimeout(check, 100)
      }
      check()
    })
  }

  function removeExport(path, directory) {
    try { fs.unlinkSync(path) } catch (error) { /* temporary file cleanup */ }
    try { fs.rmdirSync(directory) } catch (error) { /* temporary folder cleanup */ }
  }

  function sendLayer() {
    var button = element('send')
    button.disabled = true
    setStatus('Exporting selected layer...')

    evalScript('comfytvExportActiveLayer()').then(function (rawResult) {
      var result = JSON.parse(rawResult)
      if (!result.ok) throw new Error(result.error)
      return waitForExport(result.export_dir).then(function (path) {
        var png
        try {
          png = fs.readFileSync(path).toString('base64')
        } finally {
          removeExport(path, result.export_dir)
        }

        setStatus('Sending layer...')
        return request('POST', serverAddress() + '/comfytv/photoshop/layer', {
          image_base64: png,
          document: result.document,
          layer: result.layer,
          bounds: result.bounds,
          layer_bounds: result.layer_bounds,
          selection_bounds: result.selection_bounds,
        })
      })
    }).then(function (result) {
      setStatus((result.layer || result.name) + ' sent', 'connected')
    }).catch(function (error) {
      setStatus(error.message || String(error), 'error')
    }).then(function () {
      button.disabled = false
    })
  }

  element('server').value = localStorage.getItem(SERVER_KEY) || DEFAULT_SERVER
  element('connect').addEventListener('click', connect)
  element('send').addEventListener('click', sendLayer)
  document.addEventListener('keydown', function (event) {
    var target = event.target
    var typing = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')
    if (!typing && event.ctrlKey && event.shiftKey && event.key === 'Enter') {
      event.preventDefault()
      if (!element('send').disabled) sendLayer()
    }
  })
  connect()
}())
