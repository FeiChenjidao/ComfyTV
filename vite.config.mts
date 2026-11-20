import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import cssInjectedByJs from 'vite-plugin-css-injected-by-js'
import Icons from 'unplugin-icons/vite'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync, cpSync } from 'fs'

const configDir = dirname(fileURLToPath(import.meta.url))

function copyNodeDocs() {
  return {
    name: 'copy-node-docs',
    closeBundle() {
      const src = resolve(configDir, 'node-docs')
      const dest = resolve(configDir, 'js/docs')
      if (existsSync(src)) {
        cpSync(src, dest, { recursive: true })
      }
    }
  }
}

function attachPhotoshopRuntimeBridge() {
  const statement = 'import "./photoshop-runtime-bridge.js";\n'
  return {
    name: 'attach-photoshop-runtime-bridge',
    renderChunk(code, chunk) {
      if (!chunk.isEntry || code.includes(statement.trim())) return null
      return { code: `${statement}${code}`, map: null }
    },
    closeBundle() {
      const bridgeSource = resolve(configDir, 'runtime/photoshop-runtime-bridge.js')
      const bridgeTarget = resolve(configDir, 'js/photoshop-runtime-bridge.js')
      if (!existsSync(bridgeSource)) throw new Error('Missing runtime/photoshop-runtime-bridge.js')
      cpSync(bridgeSource, bridgeTarget)
    }
  }
}

export default defineConfig({
  base: './',
  worker: {
    rollupOptions: {
      output: {
        entryFileNames: 'assets/[name]-[hash].mjs',
        chunkFileNames: 'assets/[name]-[hash].mjs'
      }
    }
  },
  plugins: [
    vue(),
    tailwindcss(),
    Icons({ compiler: 'vue3', autoInstall: false }),
    cssInjectedByJs(),
    copyNodeDocs(),
    attachPhotoshopRuntimeBridge()
  ],
  resolve: {
    alias: [
      { find: '@jtydhr88/pentrado', replacement: resolve(configDir, './packages/pentrado/src') },
      // The vendored Comfy Agent panel (src/agent/native) and its host shims
      // resolve '@agent/' to the shim tree, never to ComfyTV's own '@/'.
      { find: /^@agent\//, replacement: resolve(configDir, './src/agent/host') + '/' },
      { find: '@comfyorg/tailwind-utils', replacement: resolve(configDir, './src/agent/host/tailwind-utils.ts') },
      { find: '@comfyorg/ingest-types/zod', replacement: resolve(configDir, './src/agent/host/ingest-types/zod.gen.ts') },
      { find: '@comfyorg/ingest-types', replacement: resolve(configDir, './src/agent/host/ingest-types/index.ts') },
      { find: '@comfyorg/shared-frontend-utils/formatUtil', replacement: resolve(configDir, './src/agent/host/utils/formatUtil.ts') },
      { find: /^shiki$/, replacement: resolve(configDir, './src/agent/host/shiki.ts') },
      { find: /^@\//, replacement: resolve(configDir, './src') + '/' }
    ]
  },
  build: {
    lib: {
      entry: resolve(configDir, './src/main.ts'),
      formats: ['es'],
      fileName: 'main'
    },
    rollupOptions: {
      external: ['../../../scripts/app.js'],
      output: {
        dir: 'js',
        entryFileNames: 'main.js',
        chunkFileNames: 'assets/[name]-[hash].mjs',
        assetFileNames: 'assets/[name]-[hash][extname]'
      }
    },
    sourcemap: true,
    minify: false
  },
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
    __DISTRIBUTION__: JSON.stringify('localhost'),
    __IS_NIGHTLY__: 'false',
    __COMFYUI_FRONTEND_VERSION__: JSON.stringify('comfytv')
  }
})
