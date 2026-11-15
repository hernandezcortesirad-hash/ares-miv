import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'
import tailwindcss from '@tailwindcss/vite'
import cesium from 'vite-plugin-cesium'

import marsTerrainHeights from './vite-plugins/marsTerrainHeights.js'

// https://vite.dev/config/
export default defineConfig({
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
