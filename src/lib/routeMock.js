// Respuestas SIMULADAS de POST /routes/plan para probar la interfaz sin backend.
// Solo se usan con VITE_API_MOCK=true. No son datos de Marte: la geometría es una línea casi
// recta y la radiación es una regla de tres con la media de Curiosity RAD. Cada ruta lleva
// `mock: true` y la interfaz la etiqueta como "Simulada".
import { ApiError } from '@/lib/api'

const MARS_RADIUS_M = 3_396_190
const RAD_GALE_MGY_PER_DAY = 0.21 // Hassler et al., Science 2014
const WALK_SPEED_M_PER_MIN = 33 // ≈ 2 km/h con traje

function distanceM(a, b) {
  const toRad = Math.PI / 180
  const dLat = (b.latitude - a.latitude) * toRad
  const dLon = (b.longitude - a.longitude) * toRad
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.latitude * toRad) * Math.cos(b.latitude * toRad) * Math.sin(dLon / 2) ** 2
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

export async function mockPlanRoute(payload, { signal } = {}) {
  await wait(700, signal)
  const { origin, destination, constraints = {}, preferences = {}, profile = 'eva_walk' } = payload

  // Línea con una ligera curva (más curva si se minimiza la radiación, para que se note la diferencia).
  const bend = preferences.minimize_radiation ? 0.25 : 0.1
  const steps = 40
  const coords = []
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    const off = Math.sin(Math.PI * t) * bend
    const dLat = destination.latitude - origin.latitude
    const dLon = destination.longitude - origin.longitude
    coords.push([origin.longitude + dLon * t - dLat * off, origin.latitude + dLat * t + dLon * off])
  }

  let dist = 0
  const profilePts = coords.map(([lon, lat], i) => {
    if (i > 0) {
      dist += distanceM(
        { latitude: coords[i - 1][1], longitude: coords[i - 1][0] },
        { latitude: lat, longitude: lon },
      )
    }
    return { distance_m: dist, latitude: lat, longitude: lon, elevation_m: null, slope_deg: null }
  })

  const speed = profile === 'rover' ? WALK_SPEED_M_PER_MIN * 4 : WALK_SPEED_M_PER_MIN
  const walking = dist / speed
  const factor = preferences.minimize_radiation ? 0.85 : 1
  const dose = (RAD_GALE_MGY_PER_DAY * factor * walking) / (24 * 60)
  const maxDist = constraints.max_distance_m ?? 5000
  const maxDur = constraints.max_duration_min ?? 240

  const warnings = []
  if (dist > maxDist) {
    throw new ApiError(
      422,
      'NO_FEASIBLE_ROUTE',
      `Simulación: la ruta mide ${dist.toFixed(0)} m y el límite es ${maxDist} m.`,
      { blocking_constraint: 'max_distance_m' },
    )
  }
  if (walking >= maxDur * 0.8) {
    const mid = profilePts[Math.floor(profilePts.length / 2)]
    warnings.push({
      code: 'TIME_BUDGET',
      severity: walking >= maxDur * 0.95 ? 'critical' : 'warning',
      message: `Simulación: ${walking.toFixed(0)} min de ${maxDur} min disponibles.`,
      latitude: mid.latitude,
      longitude: mid.longitude,
      distance_m: mid.distance_m,
    })
  }

  return {
    route_id: `mock_${Math.random().toString(36).slice(2, 8)}`,
    status: 'completed',
    profile,
    risk_level: warnings.some((w) => w.severity === 'critical')
      ? 'high'
      : warnings.length
        ? 'moderate'
        : 'low',
    geometry: { type: 'LineString', coordinates: coords },
    metrics: {
      distance_m: dist,
      elevation_gain_m: null,
      elevation_loss_m: null,
      max_slope_deg: null,
      mean_slope_deg: null,
      est_walking_time_min: walking,
      est_total_time_min: walking,
      est_radiation_dose_mgy: dose,
    },
    elevation_profile: profilePts,
    stops: [],
    warnings,
    data_quality: {
      elevation: 'unavailable',
      slope: 'unavailable',
      roughness: 'unavailable',
      thermal: 'unavailable',
      radiation: 'estimated',
    },
    computation: null,
    mock: true,
  }
}
