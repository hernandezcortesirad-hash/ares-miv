// Cliente único del backend ARES-MIV. Todos los componentes llaman a la API desde aquí.
//
// Regla: la interfaz solo muestra lo que devuelve la API. Este archivo traduce nombres y
// unidades (distancia_km → metros, horas → minutos…) pero NO calcula ni inventa nada: si la API
// no envía un dato, la interfaz no lo muestra o dice «sin dato».
//
// Endpoints usados:
//   GET  /openapi.json   límites y valores por defecto del formulario (esquema PeticionRuta)
//   GET  /health         estado del backend y de sus datasets y capas
//   GET  /site           zona con datos (bbox); hoy responde 501
//   POST /routes/plan    ruta
//   GET  /mars/terrain   comprobación de un punto (apagada: hoy responde 501)
import { distanceOnMarsM } from '@/config/mars'
import { mockPlanRoute } from '@/lib/routeMock'

// Por defecto, el backend desplegado en Render. Para usar uno local, pon en .env.local:
// VITE_API_URL=http://localhost:8000/api/v1
export const DEFAULT_API_URL = 'https://ares-miv-geospatial-system.onrender.com/api/v1'
export const API_URL = (import.meta.env.VITE_API_URL || DEFAULT_API_URL).replace(/\/+$/, '')
/** Raíz del servidor (donde vive /openapi.json), sin el prefijo /api/v1. */
const API_ROOT = API_URL.replace(/\/api\/v\d+$/, '')

// Solo para probar la interfaz sin backend. Las rutas simuladas se marcan como tales en la UI.
export const API_MOCK = import.meta.env.VITE_API_MOCK === 'true'

const DEFAULT_TIMEOUT_MS = 30_000

/** Error de la API. El backend responde { code, message, details? } (sin envoltura "error"). */
export class ApiError extends Error {
  constructor(status, code, message, details = null) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.details = details
  }

  /** 501: la funcionalidad existe en el contrato pero el backend aún no la implementa. */
  get notImplemented() {
    return this.status === 501
  }

  /** No hubo respuesta: backend apagado, URL equivocada o CORS sin configurar. */
  get offline() {
    return this.status === 0
  }
}

async function request(
  path,
  { method = 'GET', body, signal, timeoutMs = DEFAULT_TIMEOUT_MS, acceptStatuses = [] } = {},
) {
  const timeout = AbortSignal.timeout(timeoutMs)
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout
  const url = path.startsWith('http') ? path : `${API_URL}${path}`

  let res
  try {
    const init = { method, signal: combined }
    if (body !== undefined) {
      init.headers = { 'Content-Type': 'application/json' }
      init.body = JSON.stringify(body)
    }
    res = await fetch(url, init)
  } catch (err) {
    if (signal?.aborted) throw err // cancelado por el usuario
    const timedOut = timeout.aborted
    throw new ApiError(
      0,
      timedOut ? 'TIMEOUT' : 'BACKEND_OFFLINE',
      timedOut
        ? `El backend no respondió en ${Math.round(timeoutMs / 1000)} s.`
        : `No se pudo conectar con el backend (${API_URL}). ¿Está arrancado y con CORS activo?`,
    )
  }

  const data = await res.json().catch(() => null)
  if (!res.ok && !acceptStatuses.includes(res.status)) {
    // Formato actual del backend: { code, message, details }. Se acepta también la envoltura
    // { error: {...} } por si el backend vuelve a ella.
    const e = data?.error ?? data ?? {}
    throw new ApiError(
      res.status,
      e.code ?? `HTTP_${res.status}`,
      e.message ?? `El backend respondió ${res.status}.`,
      e.details ?? null,
    )
  }
  return data
}

// ---------------------------------------------------------------------------
// GET /health
// ---------------------------------------------------------------------------

/**
 * GET /health. Algunos despliegues responden 503 con status "degraded" mientras falten
 * datasets, aunque la API funcione: eso no es un error de conexión.
 * Espera hasta 60 s: en Render (plan gratuito) el servicio se duerme y tarda ~1 min en despertar.
 */
export function getHealth(opts) {
  return request('/health', { ...opts, timeoutMs: 60_000, acceptStatuses: [503] })
}

/**
 * ¿El backend tiene el ráster de pendiente? Las versiones del backend lo informan en sitios
 * distintos (datasets.slope_raster en Render, layers.slope_deg en local).
 * Devuelve 'available' | 'unavailable' | null (null = no lo informa: no se bloquea nada).
 */
export function slopeStatusFromHealth(h) {
  const flags = [h?.datasets?.slope_raster, h?.layers?.slope_deg].filter((v) => v != null)
  if (!flags.length) return null
  return flags.includes('available') ? 'available' : 'unavailable'
}

// ---------------------------------------------------------------------------
// GET /openapi.json → límites y valores por defecto del formulario
// ---------------------------------------------------------------------------

/**
 * Lee del esquema de la API (PeticionRuta) el máximo y el valor por defecto de cada campo.
 * Devuelve { limits, defaults } en las unidades de la interfaz, o null si no se pudo leer.
 */
export async function getRouteRules(opts) {
  const spec = await request(`${API_ROOT}/openapi.json`, { ...opts, timeoutMs: 60_000 })
  const props = spec?.components?.schemas?.PeticionRuta?.properties
  if (!props) return null
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
  const kmToM = (v) => (v == null ? null : v * 1000)
  return {
    limits: {
      max_distance_m: kmToM(num(props.max_km?.maximum)),
      max_slope_deg: num(props.pendiente_max_deg?.maximum),
      max_speed_ms: num(props.velocidad_ms?.maximum),
    },
    defaults: {
      max_distance_m: kmToM(num(props.max_km?.default)),
      max_slope_deg: num(props.pendiente_max_deg?.default),
      speed_ms: num(props.velocidad_ms?.default),
      rest_min: num(props.descanso_min?.default),
    },
  }
}

// ---------------------------------------------------------------------------
// GET /site → zona con datos
// ---------------------------------------------------------------------------

/**
 * Zona de estudio del backend (SiteResponse: site_id, name, bbox, grid, dem, science_stops),
 * o null si el backend aún no la ofrece (501).
 */
export async function getSite(opts) {
  if (API_MOCK) return null
  try {
    return await request('/site', { ...opts, timeoutMs: 60_000 })
  } catch (err) {
    if (err instanceof ApiError && err.notImplemented) return null
    throw err
  }
}

// ---------------------------------------------------------------------------
// GET /mars/terrain — comprobación de un punto (preparada; hoy el backend responde 501)
// ---------------------------------------------------------------------------

// Apagada por defecto: hoy el backend responde 501 y cada llamada solo añadiría una línea roja
// en la consola. Cuando el backend implemente GET /mars/terrain, poner VITE_TERRAIN_CHECK=true.
// Aun activada, tras el primer 501 no se vuelve a preguntar en esta sesión, y mientras la
// primera consulta está en curso las demás la esperan («Ejemplo» fija los dos puntos a la vez).
const TERRAIN_CHECK = import.meta.env.VITE_TERRAIN_CHECK === 'true' && !API_MOCK
let terrainSupport = TERRAIN_CHECK ? 'unknown' : 'no' // 'unknown' | 'yes' | 'no'
let terrainProbe = null

/**
 * Datos del terreno en un punto planetocéntrico, o null si el backend aún no los ofrece.
 * Respuesta del backend (TerrainResponse): { latitude, longitude, elevation_m, slope_deg,
 * roughness_m, traversable, data_availability, … }. Los valores sin dato llegan como null.
 */
export async function getTerrainPoint({ latitude, longitude }, opts) {
  if (terrainSupport === 'unknown' && terrainProbe) await terrainProbe.catch(() => null)
  if (terrainSupport === 'no') return null
  const qs = new URLSearchParams({ latitude: String(latitude), longitude: String(longitude) })
  const call = request(`/mars/terrain?${qs}`, { ...opts, timeoutMs: 5_000 }).then(
    (data) => {
      terrainSupport = 'yes'
      return data
    },
    (err) => {
      if (err instanceof ApiError && err.notImplemented) {
        terrainSupport = 'no'
        return null
      }
      throw err
    },
  )
  if (terrainSupport === 'unknown') terrainProbe = call
  return call
}

// ---------------------------------------------------------------------------
// POST /routes/plan
// ---------------------------------------------------------------------------

/** Formulario de la interfaz → petición del backend (PeticionRuta, extra="forbid"). */
export function toBackendRequest(form) {
  return {
    origin: { latitude: form.origin.latitude, longitude: form.origin.longitude },
    destination: { latitude: form.destination.latitude, longitude: form.destination.longitude },
    max_km: form.max_distance_m / 1000,
    pendiente_max_deg: form.max_slope_deg,
    velocidad_ms: form.speed_ms,
    descanso_min: form.rest_min,
  }
}

const hToMin = (h) => (typeof h === 'number' ? h * 60 : null)
const kmToM = (km) => (typeof km === 'number' ? km * 1000 : null)

/**
 * Respuesta del backend (RouteResponse) → modelo de la interfaz.
 * Solo cambia nombres y unidades. Cada campo sale de la respuesta; lo que no venga queda null.
 * No se añade riesgo, alertas, dosis ni calidad de datos: la API no los envía.
 */
export function fromBackendRoute(raw) {
  const tramos = Array.isArray(raw.tramos) ? raw.tramos : []
  return {
    // Identificador LOCAL de esta sesión (el backend no persiste rutas: GET /routes/{id} → 404).
    route_id: `local_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    geometry: { type: 'LineString', coordinates: Array.isArray(raw.puntos) ? raw.puntos : [] },
    metrics: {
      distance_m: kmToM(raw.distancia_km),
      max_slope_deg: raw.pendiente_max_en_ruta_deg ?? null,
      est_walking_time_min: hToMin(raw.tiempo_caminando_h),
      est_rest_time_min: hToMin(raw.tiempo_descanso_h),
      est_total_time_min: hToMin(raw.tiempo_total_h),
    },
    grid_resolution_m: raw.resolucion_m ?? null,
    segments: tramos.map((t) => ({
      index: t.tramo,
      distance_m: kmToM(t.km),
      walking_time_min: hToMin(t.horas_caminando),
      stop: t.parada
        ? { latitude: t.parada.lat, longitude: t.parada.lon, distance_m: kmToM(t.parada.km_acumulado) }
        : null,
    })),
    stops: tramos
      .filter((t) => t.parada)
      .map((t) => ({
        latitude: t.parada.lat,
        longitude: t.parada.lon,
        distance_m: kmToM(t.parada.km_acumulado),
      })),
    assumptions: Array.isArray(raw.supuestos) ? raw.supuestos : [],
    // Se pasa tal cual (ReferenciaNeutrones): la interfaz muestra sus campos sin reinterpretarlos.
    neutron_reference: raw.referencia_neutrones ?? null,
    mock: raw.mock === true,
  }
}

// El backend lee una ventana del ráster de radio max_km alrededor del origen: con 10 km son
// ~16 M de celdas y el servidor de Render (plan gratuito) se queda sin memoria y se reinicia,
// aunque los puntos estén a 600 m (medido: 5 km funciona, 8.8 km lo tumba). Por eso se pide un
// max_km ajustado a la distancia real y, si la ruta sale más larga, se sube por escalones (nunca
// directamente al máximo). El límite que ve el usuario no cambia.
// Pendiente en el backend: leer la ventana según la distancia real entre A y B.
// Escalones de max_km (× la línea recta). Con 1.4 casi todas las rutas caben al primer intento
// (el ejemplo de 0.67 km mide 1.01 km por el terreno); el mínimo evita reintentos en rutas cortas.
const MAX_KM_STEPS = [1.4, 1.8, 2.4]
const MIN_MAX_M = 1500

/**
 * Límite del SERVIDOR (no de la API): en Render gratuito, pedir max_km > 5 lo deja sin memoria y
 * se reinicia (medido: 5 km responde, 8.8 km lo tumba). Solo se aplica cuando la API es la de
 * Render; con un backend local (más memoria) se usan los límites de la API tal cual.
 * null = sin límite de servidor.
 */
export const SERVER_LIMITED = /\.onrender\.com/.test(API_URL)
export const SERVER_SAFE_MAX_M = SERVER_LIMITED ? 5000 : null
/** Separación A–B máxima con la que el primer intento (1.25×) cabe en ese límite. */
export const SERVER_SAFE_DIRECT_M = SERVER_LIMITED ? 4000 : null

// Medido en Render (plan gratuito): una ruta de ~1 km tarda ~3 s, pero una búsqueda de ~3 km
// llegó a 35 s antes de responder. 90 s cubre esos casos y el arranque en frío (~1 min).
export const PLAN_TIMEOUT_MS = 90_000

/** POST /routes/plan con el formulario de la interfaz; devuelve el modelo de la interfaz. */
export async function planRoute(form, opts) {
  const send = (maxDistanceM) => {
    const body = toBackendRequest({ ...form, max_distance_m: maxDistanceM })
    return API_MOCK
      ? mockPlanRoute(body, opts)
      : request('/routes/plan', { method: 'POST', body, timeoutMs: PLAN_TIMEOUT_MS, ...opts })
  }
  const direct = distanceOnMarsM(form.origin, form.destination)
  const ceiling = Math.min(form.max_distance_m, SERVER_SAFE_MAX_M ?? Infinity)
  const tries = [
    ...new Set(MAX_KM_STEPS.map((f) => Math.round(Math.min(ceiling, Math.max(MIN_MAX_M, direct * f))))),
  ]
  for (let i = 0; i < tries.length; i++) {
    try {
      return fromBackendRoute(await send(tries[i]))
    } catch (err) {
      const longer = err instanceof ApiError && err.code === 'ROUTE_DISTANCE_EXCEEDED'
      if (!longer || i === tries.length - 1) throw err
    }
  }
  throw new ApiError(0, 'ERROR', 'No se pudo calcular la ruta.')
}
