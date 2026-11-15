// Línea de tiempo de un recorrido, para animarlo. Usa solo los datos de la ruta:
// - Astronauta (API): tramos con su tiempo caminando y paradas; el descanso por parada sale del
//   tiempo total de descanso que envía la API dividido entre el número de paradas.
// - Rover (simulada): distancia ÷ velocidad media autónoma de Perseverance (JPL), sin paradas.
import { MARS_RADIUS_M } from '@/config/mars'
import { ROVER_RULES } from '@/config/rover'

function haversineM([lon1, lat1], [lon2, lat2]) {
  const r = Math.PI / 180
  const h =
    Math.sin(((lat2 - lat1) * r) / 2) ** 2 +
    Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lon2 - lon1) * r) / 2) ** 2
  return 2 * MARS_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)))
}

/**
 * @returns {{ totalMin: number, phases: {kind:'walk'|'rest'|'drive', t0, t1, f0, f1}[] } | null}
 *   f0/f1 = fracción del recorrido (0–1) al empezar/terminar la fase.
 */
export function buildTimeline(route) {
  const total = route?.metrics?.distance_m
  if (!route?.geometry?.coordinates?.length || !(total > 0)) return null

  if (route.kind === 'rover') {
    const totalMin = (total / ROVER_RULES.autonavMPerH.perseverance) * 60
    return { totalMin, phases: [{ kind: 'drive', t0: 0, t1: totalMin, f0: 0, f1: 1 }] }
  }

  const segs = route.segments ?? []
  const stops = segs.filter((s) => s.stop).length
  const restEach = stops && route.metrics.est_rest_time_min ? route.metrics.est_rest_time_min / stops : 0
  if (!segs.length || segs.some((s) => typeof s.walking_time_min !== 'number' || typeof s.distance_m !== 'number')) {
    const totalMin = route.metrics.est_total_time_min ?? route.metrics.est_walking_time_min
    return totalMin > 0 ? { totalMin, phases: [{ kind: 'walk', t0: 0, t1: totalMin, f0: 0, f1: 1 }] } : null
  }

  const phases = []
  let t = 0
  let d = 0
  for (const s of segs) {
    phases.push({ kind: 'walk', t0: t, t1: t + s.walking_time_min, f0: d / total, f1: (d + s.distance_m) / total })
    t += s.walking_time_min
    d += s.distance_m
    if (s.stop && restEach > 0) {
      phases.push({ kind: 'rest', t0: t, t1: t + restEach, f0: d / total, f1: d / total })
      t += restEach
    }
  }
  return { totalMin: t, phases }
}

/** Estado en el minuto simulado t: { fraction (0–1), kind }. */
export function stateAt(timeline, t) {
  for (const p of timeline.phases) {
    if (t <= p.t1) {
      const k = p.t1 > p.t0 ? (t - p.t0) / (p.t1 - p.t0) : 1
      return { fraction: p.f0 + (p.f1 - p.f0) * Math.max(0, Math.min(1, k)), kind: p.kind }
    }
  }
  const last = timeline.phases.at(-1)
  return { fraction: 1, kind: last?.kind ?? 'walk' }
}

/** Función que devuelve [lon, lat] a una fracción (0–1) de la línea de la ruta. */
export function pathInterpolator(coordinates) {
  const cum = [0]
  for (let i = 1; i < coordinates.length; i++) cum.push(cum[i - 1] + haversineM(coordinates[i - 1], coordinates[i]))
  const len = cum.at(-1)
  return (fraction) => {
    if (coordinates.length === 1 || len === 0) return coordinates[0]
    const target = Math.max(0, Math.min(1, fraction)) * len
    let i = 1
    while (i < cum.length - 1 && cum[i] < target) i++
    const span = cum[i] - cum[i - 1] || 1
    const k = (target - cum[i - 1]) / span
    const [aLon, aLat] = coordinates[i - 1]
    const [bLon, bLat] = coordinates[i]
    return [aLon + (bLon - aLon) * k, aLat + (bLat - aLat) * k]
  }
}
