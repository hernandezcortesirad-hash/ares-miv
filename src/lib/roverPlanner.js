// Simulador de rutas de rover (APROXIMADO, calculado en el navegador).
//
// No es un dato de la API: se mide el relieve 3D de Cesium en una malla alrededor de A y B, se
// calcula la pendiente de cada paso entre celdas vecinas y se busca el camino con A*.
// - Pendiente > máximo (30°, regla NASA de conducción) → paso prohibido.
// - Coste de un paso = longitud × (1 + pendiente / máximo): se prefieren los tramos más planos
//   (ponderación propia del simulador).
// - Celdas sin altura (fuera del modelo) → prohibidas.
// La malla promedia el relieve: puede ocultar pendientes locales mayores y no ve rocas.
import { distanceOnMarsM, MARS_RADIUS_M } from '@/config/mars'

/**
 * Celdas por lado como máximo (≈ 2 500 alturas). Medido en el navegador: Cesium tarda ~1.5 s por
 * cada 400 alturas del relieve más detallado, así que 50 × 50 deja la simulación en segundos.
 * Para una ruta de 10 km la separación queda en ~300 m (se muestra en el resultado).
 */
const MAX_CELLS_SIDE = 50
/** Separación mínima entre muestras (m): por debajo el modelo 3D no aporta más detalle útil. */
const MIN_SPACING_M = 25

export class SimError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'SimError'
    this.code = code
  }
}

/** Montículo binario mínimo de [prioridad, índice]. */
class MinHeap {
  constructor() {
    this.items = []
  }
  get size() {
    return this.items.length
  }
  push(priority, value) {
    const a = this.items
    a.push([priority, value])
    let i = a.length - 1
    while (i > 0) {
      const p = (i - 1) >> 1
      if (a[p][0] <= a[i][0]) break
      ;[a[p], a[i]] = [a[i], a[p]]
      i = p
    }
  }
  pop() {
    const a = this.items
    const top = a[0]
    const last = a.pop()
    if (a.length) {
      a[0] = last
      let i = 0
      for (;;) {
        const l = 2 * i + 1
        const r = l + 1
        let m = i
        if (l < a.length && a[l][0] < a[m][0]) m = l
        if (r < a.length && a[r][0] < a[m][0]) m = r
        if (m === i) break
        ;[a[m], a[i]] = [a[i], a[m]]
        i = m
      }
    }
    return top
  }
}

/**
 * @param {object} p
 * @param {{latitude:number, longitude:number}} p.origin  planetocéntrico
 * @param {{latitude:number, longitude:number}} p.destination
 * @param {number} p.maxSlopeDeg
 * @param {number} p.maxDistanceM
 * @param {(points:[number,number][], opts) => Promise<Float64Array|null>} p.sampleHeights
 * @returns ruta en el modelo de la interfaz (kind: 'rover')
 */
export async function planRoverRoute({
  origin,
  destination,
  maxSlopeDeg,
  maxDistanceM,
  sampleHeights,
  signal,
  onProgress,
}) {
  const direct = distanceOnMarsM(origin, destination)
  if (direct > maxDistanceM) {
    throw new SimError(
      'DIRECT_DISTANCE_EXCEEDED',
      `Los puntos están a ${(direct / 1000).toFixed(2)} km y el simulador admite ${(maxDistanceM / 1000).toFixed(1)} km.`,
    )
  }

  // Malla en metros sobre un plano local (equirectangular centrado entre A y B).
  const latMid = ((origin.latitude + destination.latitude) / 2) * (Math.PI / 180)
  const mPerDegLat = (MARS_RADIUS_M * Math.PI) / 180
  const mPerDegLon = mPerDegLat * Math.cos(latMid)
  const toXY = (p) => [p.longitude * mPerDegLon, p.latitude * mPerDegLat]
  const [ax, ay] = toXY(origin)
  const [bx, by] = toXY(destination)
  const margin = Math.max(300, direct * 0.25)
  const x0 = Math.min(ax, bx) - margin
  const y0 = Math.min(ay, by) - margin
  const spanX = Math.abs(ax - bx) + 2 * margin
  const spanY = Math.abs(ay - by) + 2 * margin
  const spacing = Math.max(MIN_SPACING_M, Math.max(spanX, spanY) / (MAX_CELLS_SIDE - 1))
  const nx = Math.ceil(spanX / spacing) + 1
  const ny = Math.ceil(spanY / spacing) + 1

  const cellLonLat = (i) => {
    const cx = i % nx
    const cy = Math.floor(i / nx)
    return [(x0 + cx * spacing) / mPerDegLon, (y0 + cy * spacing) / mPerDegLat]
  }
  const points = Array.from({ length: nx * ny }, (_, i) => cellLonLat(i))

  const heights = await sampleHeights(points, { signal, onProgress })
  if (!heights) {
    throw new SimError('NO_TERRAIN', 'El relieve 3D no está disponible: actívalo para simular rutas de rover.')
  }
  const missing = heights.reduce((n, h) => n + (Number.isFinite(h) ? 0 : 1), 0)

  const cellOf = (x, y) =>
    Math.min(ny - 1, Math.max(0, Math.round((y - y0) / spacing))) * nx +
    Math.min(nx - 1, Math.max(0, Math.round((x - x0) / spacing)))
  const start = cellOf(ax, ay)
  const goal = cellOf(bx, by)
  if (!Number.isFinite(heights[start]) || !Number.isFinite(heights[goal])) {
    throw new SimError('NO_TERRAIN', 'El relieve 3D no tiene altura en el origen o en el destino.')
  }

  // A* en 8 direcciones.
  const NEIGHBORS = [
    [1, 0], [-1, 0], [0, 1], [0, -1],
    [1, 1], [1, -1], [-1, 1], [-1, -1],
  ]
  const gx = goal % nx
  const gy = Math.floor(goal / nx)
  const h = (i) => Math.hypot((i % nx) - gx, Math.floor(i / nx) - gy) * spacing
  const g = new Float64Array(nx * ny).fill(Infinity)
  const from = new Int32Array(nx * ny).fill(-1)
  const closed = new Uint8Array(nx * ny)
  const open = new MinHeap()
  g[start] = 0
  open.push(h(start), start)
  let blockedBySlope = 0

  while (open.size) {
    if (signal?.aborted) throw signal.reason ?? new DOMException('Cancelado', 'AbortError')
    const [, cur] = open.pop()
    if (closed[cur]) continue
    if (cur === goal) break
    closed[cur] = 1
    const cx = cur % nx
    const cy = Math.floor(cur / nx)
    for (const [dx, dy] of NEIGHBORS) {
      const qx = cx + dx
      const qy = cy + dy
      if (qx < 0 || qy < 0 || qx >= nx || qy >= ny) continue
      const nb = qy * nx + qx
      if (closed[nb] || !Number.isFinite(heights[nb])) continue
      const len = spacing * (dx && dy ? Math.SQRT2 : 1)
      const slope = (Math.atan(Math.abs(heights[nb] - heights[cur]) / len) * 180) / Math.PI
      if (slope > maxSlopeDeg) {
        blockedBySlope++
        continue
      }
      const cost = g[cur] + len * (1 + slope / maxSlopeDeg)
      if (cost < g[nb]) {
        g[nb] = cost
        from[nb] = cur
        open.push(cost + h(nb), nb)
      }
    }
  }

  if (from[goal] === -1 && goal !== start) {
    throw new SimError(
      'NO_FEASIBLE_ROUTE',
      `No hay camino en la malla con pendientes ≤ ${maxSlopeDeg}°` +
        (blockedBySlope ? ' (hay laderas más empinadas entre los puntos).' : '.'),
    )
  }

  // Reconstrucción y métricas (todas medidas sobre la malla del relieve 3D).
  const cells = []
  for (let i = goal; i !== -1; i = from[i]) cells.push(i)
  cells.reverse()
  let horizontal = 0
  let surface = 0
  let gain = 0
  let loss = 0
  let maxSlope = 0
  for (let k = 1; k < cells.length; k++) {
    const a = cells[k - 1]
    const b = cells[k]
    const len = spacing * (a % nx !== b % nx && Math.floor(a / nx) !== Math.floor(b / nx) ? Math.SQRT2 : 1)
    const dh = heights[b] - heights[a]
    horizontal += len
    surface += Math.hypot(len, dh)
    if (dh > 0) gain += dh
    else loss -= dh
    maxSlope = Math.max(maxSlope, (Math.atan(Math.abs(dh) / len) * 180) / Math.PI)
  }
  if (surface > maxDistanceM) {
    throw new SimError(
      'ROUTE_DISTANCE_EXCEEDED',
      `El camino encontrado mide ${(surface / 1000).toFixed(2)} km y el simulador admite ${(maxDistanceM / 1000).toFixed(1)} km.`,
    )
  }

  const coordinates = cells.map(cellLonLat)
  coordinates[0] = [origin.longitude, origin.latitude]
  coordinates[coordinates.length - 1] = [destination.longitude, destination.latitude]

  return {
    route_id: `rover_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    kind: 'rover',
    geometry: { type: 'LineString', coordinates },
    metrics: {
      distance_m: surface,
      horizontal_distance_m: horizontal,
      max_slope_deg: maxSlope,
      elevation_gain_m: gain,
      elevation_loss_m: loss,
    },
    grid: { spacing_m: spacing, cells: nx * ny, missing },
  }
}
