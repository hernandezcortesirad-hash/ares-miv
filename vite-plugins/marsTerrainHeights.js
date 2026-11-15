// Sustituye la tabla approximateTerrainHeights.json de Cesium por una con alturas de MARTE.
//
// Cesium dibuja las líneas «pegadas al suelo» (rutas, círculo de alcance, rectángulo) como un
// volumen entre una altura mínima y una máxima que lee de esa tabla, calculada con el relieve de
// la TIERRA. Se lee dentro de un web worker, así que no basta con cambiarla en el código de la app.
// En Marte falla: donde la Tierra tiene océano (≈ 0 m) y Marte relieve alto (+6 km cerca de
// Tharsis), el volumen no llega al suelo y la línea no se ve.
// Aquí cada tesela usa el rango de Marte: −12 km (Hellas ≈ −8 km) a +26 km (Monte Olimpo ≈ +22 km).
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

export const MARS_MIN_HEIGHT_M = -12_000
export const MARS_MAX_HEIGHT_M = 26_000

const SOURCE = 'node_modules/cesium/Build/Cesium/Assets/approximateTerrainHeights.json'
const ASSET_PATH = 'Assets/approximateTerrainHeights.json'

function buildMarsTable(root) {
  const earth = JSON.parse(fs.readFileSync(path.join(root, SOURCE), 'utf8'))
  const mars = {}
  for (const key of Object.keys(earth)) mars[key] = [MARS_MIN_HEIGHT_M, MARS_MAX_HEIGHT_M]
  return JSON.stringify(mars)
}

/** @param {{ cesiumBaseUrl?: string }} [opts] mismo cesiumBaseUrl que vite-plugin-cesium */
export default function marsTerrainHeights({ cesiumBaseUrl = 'cesium/' } = {}) {
  let root = process.cwd()
  let outDir = 'dist'
  let table = null
  const getTable = () => (table ??= buildMarsTable(root))

  return {
    name: 'ares-mars-terrain-heights',
    configResolved(config) {
      root = config.root
      outDir = path.resolve(config.root, config.build.outDir)
    },
    // Desarrollo: se registra antes que vite-plugin-cesium, así que responde primero.
    configureServer({ middlewares }) {
      middlewares.use(`/${cesiumBaseUrl}${ASSET_PATH}`, (_req, res) => {
        res.setHeader('Content-Type', 'application/json')
        res.setHeader('Access-Control-Allow-Origin', '*')
        res.end(getTable())
      })
    },
    // Compilación: después de que vite-plugin-cesium copie sus Assets, se sobrescribe la tabla.
    closeBundle: {
      sequential: true,
      order: 'post',
      handler() {
        const target = path.join(outDir, cesiumBaseUrl, ASSET_PATH)
        if (!fs.existsSync(path.dirname(target))) return
        fs.writeFileSync(target, getTable())
      },
    },
  }
}
