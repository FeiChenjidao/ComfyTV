import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import cssInjectedByJs from 'vite-plugin-css-injected-by-js'
import Icons from 'unplugin-icons/vite'
import { resolve } from 'path'
import { existsSync, cpSync } from 'fs'

function copyNodeDocs() {
  return {
    name: 'copy-node-docs',
    closeBundle() {
      const src = resolve(__dirname, 'node-docs')
      const dest = resolve(__dirname, 'js/docs')
      if (existsSync(src)) {
        cpSync(src, dest, { recursive: true })
      }
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
    copyNodeDocs()
  ],
  resolve: {
    alias: [
      { find: '@jtydhr88/pentrado', replacement: resolve(__dirname, './packages/pentrado/src') },
      // The vendored Comfy Agent panel (src/agent/native) and its host shims
      // resolve '@agent/' to the shim tree, never to ComfyTV's own '@/'.
      { find: /^@agent\//, replacement: resolve(__dirname, './src/agent/host') + '/' },
      { find: '@comfyorg/tailwind-utils', replacement: resolve(__dirname, './src/agent/host/tailwind-utils.ts') },
      { find: '@comfyorg/ingest-types/zod', replacement: resolve(__dirname, './src/agent/host/ingest-types/zod.gen.ts') },
      { find: '@comfyorg/ingest-types', replacement: resolve(__dirname, './src/agent/host/ingest-types/index.ts') },
      { find: '@comfyorg/shared-frontend-utils/formatUtil', replacement: resolve(__dirname, './src/agent/host/utils/formatUtil.ts') },
      { find: /^shiki$/, replacement: resolve(__dirname, './src/agent/host/shiki.ts') },
      { find: /^@\//, replacement: resolve(__dirname, './src') + '/' }
    ]
  },
  build: {
    lib: {
      entry: resolve(__dirname, './src/main.ts'),
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
