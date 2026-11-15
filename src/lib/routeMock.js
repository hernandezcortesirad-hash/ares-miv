// Respuestas SIMULADAS de POST /routes/plan para probar la interfaz sin backend.
// Solo se usan con VITE_API_MOCK=true. Devuelven el MISMO formato que el backend real
// (distancia_km, puntos, tramos…) para que pasen por la misma traducción de api.js.
// No son datos de Marte: la geometría es una línea casi recta y la pendiente es 0.
// Cada respuesta lleva `mock: true` y la interfaz la etiqueta como "Simulada".
import { ApiError } from '@/lib/api'

const MARS_RADIUS_M = 3_396_190

function distanceM(a, b) {
  const toRad = Math.PI / 180
  const dLat = (b[1] - a[1]) * toRad
  const dLon = (b[0] - a[0]) * toRad
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a[1] * toRad) * Math.cos(b[1] * toRad) * Math.sin(dLon / 2) ** 2
  return 2 * MARS_RADIUS_M * Math.asin(Math.sqrt(h))
}

function wait(ms, signal) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => {
      clearTimeout(t)
      reject(signal.reason)
    })
  })
}

/** Recibe la petición YA en formato backend (ver toBackendRequest en api.js). */
export async function mockPlanRoute(body, { signal } = {}) {
  await wait(700, signal)
  const { origin, destination, max_km, velocidad_ms, descanso_min } = body

  const steps = 40
  const coords = []
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    const off = Math.sin(Math.PI * t) * 0.1
    const dLat = destination.latitude - origin.latitude
    const dLon = destination.longitude - origin.longitude
    coords.push([origin.longitude + dLon * t - dLat * off, origin.latitude + dLat * t + dLon * off])
  }
  let dist = 0
  for (let i = 1; i < coords.length; i++) dist += distanceM(coords[i - 1], coords[i])

  if (dist > max_km * 1000) {
    throw new ApiError(
      422,
      'ROUTE_DISTANCE_EXCEEDED',
      `Simulación: la ruta mide ${(dist / 1000).toFixed(2)} km y el límite es ${max_km} km.`,
      { route_distance_km: dist / 1000 },
    )
  }

  const walkingH = dist / velocidad_ms / 3600
  return {
    distancia_km: dist / 1000,
    resolucion_m: 5,
    pendiente_max_en_ruta_deg: 0,
    puntos: coords,
    tramos: [{ tramo: 1, km: dist / 1000, horas_caminando: walkingH, parada: null }],
    tiempo_caminando_h: walkingH,
    tiempo_descanso_h: 0,
    tiempo_total_h: walkingH,
    supuestos: [`Simulación sin backend: no es una ruta calculada sobre Marte (descanso ${descanso_min} min).`],
    mock: true,
  }
}
