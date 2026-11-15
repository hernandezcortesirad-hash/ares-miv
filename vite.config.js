import process from 'node:process'
import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'
import tailwindcss from '@tailwindcss/vite'
import cesium from 'vite-plugin-cesium'

import marsTerrainHeights from './vite-plugins/marsTerrainHeights.js'

// https://vite.dev/config/
export default defineConfig({
  // En GitHub Pages la web vive en /<repo>/. Se usa base relativa ('./') y no '/<repo>/'
  // porque vite-plugin-cesium copiaría Cesium a dist/<repo>/cesium con una base absoluta.
  base: process.env.GITHUB_PAGES === 'true' ? './' : '/',
  // Además de VITE_*, expone CESIUM_ION_TOKEN y MARS_ION_ASSET_ID (nombres usados en Vercel).
  // Prefijos estrechos a propósito: todo lo que coincida acaba en el JS público.
  envPrefix: ['VITE_', 'CESIUM_ION_', 'MARS_ION_'],
  plugins: [
    vue(),
    vueDevTools(),
    tailwindcss(),
    // Alturas de Marte para las líneas pegadas al suelo (debe ir ANTES de cesium()).
    marsTerrainHeights(),
    // Copia Workers/Assets/Widgets de Cesium, define CESIUM_BASE_URL e inyecta widgets.css
    cesium(),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
})
