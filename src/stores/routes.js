// Estado del planificador de rutas: formulario, estado del backend, rutas calculadas y filtros.
// Todas las coordenadas son PLANETOCÉNTRICAS (latitude) y longitud este [-180, 180]; la
// conversión al elipsoide de Cesium ocurre solo en lib/marsViewer.js.
//
// Regla: todo lo que se muestra sale de la API. Los únicos valores locales son respaldos que se
// usan mientras la API no los ofrece (límites antes de leer /openapi.json, zona con datos mientras
// GET /site responda 501), y la interfaz indica cuándo se están usando.
import { defineStore } from 'pinia'
import { computed, reactive, ref, shallowRef, watch } from 'vue'

import { distanceOnMarsM, STUDY_AREA } from '@/config/mars'
import { ROVER_RULES, SIM_ASSUMPTIONS } from '@/config/rover'
import { planRoverRoute, SimError } from '@/lib/roverPlanner'
import {
  API_MOCK,
  ApiError,
  getHealth,
  getRouteRules,
  getSite,
  getTerrainPoint,
  planRoute,
  SERVER_SAFE_DIRECT_M,
  slopeStatusFromHealth,
} from '@/lib/api'

const LABELS = { origin: 'origen', destination: 'destino' }

/** Cada cuánto se vuelve a consultar /health mientras el backend está sin conexión. */
const HEALTH_RETRY_MS = 30_000

/**
 * Respaldo hasta leer /openapi.json (son los mismos valores que publica hoy el esquema
 * PeticionRuta: max_km ≤ 10, pendiente ≤ 20, velocidad ≤ 1; por defecto 12°, 0.7 m/s, 10 min).
 */
const FALLBACK_LIMITS = { max_distance_m: 10_000, max_slope_deg: 20, max_speed_ms: 1 }
const FALLBACK_DEFAULTS = { max_slope_deg: 12, speed_ms: 0.7, rest_min: 10 }

/** "entre 0.1 y 1 m/s" o "al menos 1 min". */
export function describeRange({ min, max, unit }) {
  return max == null ? `al menos ${min}${unit}` : `entre ${min} y ${max}${unit}`
}

/** Recorta un número al rango de la regla. */
export function clampToRule(value, { min, max }) {
  return Math.min(max ?? Infinity, Math.max(min, value))
}

const fmtKm = (m) => `${(m / 1000).toFixed(2)} km`

/** ¿El punto { latitude, longitude } cae dentro del bbox [oeste, sur, este, norte]? */
function inBbox(bbox, p) {
  const [w, s, e, n] = bbox
  return !!p && p.longitude >= w && p.longitude <= e && p.latitude >= s && p.latitude <= n
}

// Ejemplos por modo. Astronauta: el de la documentación del backend (docs/ROUTE_PLANNING.md), en
// el Monte Sharp. Rover: el fondo del cráter Jezero, fuera de la zona de la API, para mostrar
// que la simulación funciona en cualquier punto de Marte.
export const EXAMPLES = {
  eva: {
    label: 'Gale',
    origin: { latitude: -4.8149309421, longitude: 137.372037868 },
    destination: { latitude: -4.8221853022, longitude: 137.3634338595 },
  },
  rover: {
    label: 'Jezero',
    origin: { latitude: 18.4, longitude: 77.45 },
    destination: { latitude: 18.42, longitude: 77.48 },
  },
}

export const useRoutesStore = defineStore('routes', () => {
  // --- Modo ---
  // 'eva':   astronauta · ruta CONFIRMADA por la API (solo en la zona con datos de 5 m).
  // 'rover': rover · ruta SIMULADA en el navegador sobre el relieve 3D (cualquier punto de Marte).
  const mode = ref('eva')

  // Reglas del rover: pendiente máxima de conducción de la NASA (30°) y límite del simulador.
  const roverConstraints = reactive({
    max_slope_deg: ROVER_RULES.maxDriveTiltDeg,
    max_distance_m: SIM_ASSUMPTIONS.maxDistanceM,
  })

  /** El visor registra aquí cómo medir alturas del relieve 3D (lo usa el simulador). */
  const terrainReady = ref(false)
  let heightSampler = null
  function setHeightSampler(fn) {
    heightSampler = fn
  }
  /** Avance (0–1) del muestreo del relieve durante una simulación. */
  const simProgress = ref(0)

  // --- Reglas del formulario (de /openapi.json) ---
  const limits = ref({ ...FALLBACK_LIMITS })
  /** 'local' hasta leer el esquema de la API; 'api' después. */
  const rulesSource = ref('local')

  /** Rango de cada campo. Los mínimos son de la interfaz; los máximos, de la API. */
  const fieldRules = computed(() => ({
    max_slope_deg: { label: 'Pendiente máxima', min: 1, max: limits.value.max_slope_deg, unit: '°' },
    max_distance_m: { label: 'Distancia máx.', min: 100, max: limits.value.max_distance_m, unit: ' m' },
    speed_ms: { label: 'Velocidad', min: 0.1, max: limits.value.max_speed_ms, unit: ' m/s' },
    rest_min: { label: 'Descanso', min: 1, max: null, unit: ' min' },
  }))

  // --- Zona con datos (de GET /site; respaldo local mientras responda 501) ---
  const site = ref(null)
  const studyArea = computed(() =>
    site.value?.bbox?.length === 4
      ? { name: site.value.name ?? 'Zona del backend', bbox: site.value.bbox, source: 'api' }
      : { ...STUDY_AREA, source: 'local' },
  )
  const inArea = (p) => inBbox(studyArea.value.bbox, p)

  // --- Formulario (se traduce a POST /routes/plan en lib/api.js) ---
  const origin = ref(null) // { latitude, longitude }
  const destination = ref(null)
  // La distancia máxima arranca en el máximo que acepta la API (círculo de alcance completo).
  const defaults = ref({ ...FALLBACK_DEFAULTS })
  const constraints = reactive({ max_distance_m: FALLBACK_LIMITS.max_distance_m, ...FALLBACK_DEFAULTS })
  let constraintsTouched = false
  watch(constraints, () => (constraintsTouched = true), { deep: true, flush: 'sync' })

  /** 'origin' | 'destination' | null: qué punto fija el siguiente clic en el mapa. */
  const pickMode = ref(null)

  // --- Estado del backend (GET /health) ---
  /** state: 'mock' | 'checking' | 'online' | 'degraded' | 'offline' | 'error'. */
  const backend = ref({ state: API_MOCK ? 'mock' : 'checking', slope: null, message: null })
  /** Cuerpo de la última respuesta de /health (datasets y layers tal cual los envía la API). */
  const health = ref(null)
  let healthTimer = null
  let healthCtrl = null
  let apiInfoLoaded = false

  // --- Resultado ---
  const routes = ref([]) // rutas traducidas al modelo de la UI, la más reciente primero
  const selectedId = ref(null)
  const pending = ref(false)
  /** Momento (ms) en que empezó el cálculo en curso, para mostrar cuánto lleva. */
  const pendingSince = ref(null)
  /** { kind: 'info' | 'error', code, message } del último intento. */
  const notice = ref(null)
  const controller = shallowRef(null)

  // --- Orden de "Rutas planificadas" (solo con datos que envía la API) ---
  const filters = reactive({ sortBy: 'recent' }) // 'recent' | 'distance' | 'time' | 'slope'

  /** Distancia en línea recta origen → destino (m), o null si falta alguno. */
  const directDistanceM = computed(() =>
    origin.value && destination.value ? distanceOnMarsM(origin.value, destination.value) : null,
  )

  /**
   * Alcance del modo activo (radio del círculo azul). En astronauta, si la API está en un servidor
   * con poca memoria (Render gratuito), se limita a lo que ese servidor aguanta.
   */
  const activeMaxDistance = computed(() =>
    mode.value === 'rover'
      ? roverConstraints.max_distance_m
      : Math.min(constraints.max_distance_m, SERVER_SAFE_DIRECT_M ?? Infinity),
  )
  /** true si el alcance de astronauta está recortado por el servidor (no por la API). */
  const serverCapped = computed(
    () => mode.value === 'eva' && SERVER_SAFE_DIRECT_M != null && constraints.max_distance_m > SERVER_SAFE_DIRECT_M,
  )
  /** En modo rover se puede elegir cualquier punto; en EVA, solo dentro de la zona con datos. */
  const pointAllowed = (p) => mode.value === 'rover' || inArea(p)

  /** Por qué no se puede calcular ahora (texto para el usuario), o null si se puede. */
  const planBlockReason = computed(() => {
    if (!origin.value || !destination.value) return 'Fija el punto de partida y el destino.'
    if (mode.value === 'rover') {
      if (!terrainReady.value) {
        return 'El simulador mide el relieve 3D: necesita el relieve 3D de Cesium (token en .env.local).'
      }
      const d = directDistanceM.value
      return d > roverConstraints.max_distance_m
        ? `Los puntos están a ${fmtKm(d)} y el simulador admite ${fmtKm(roverConstraints.max_distance_m)}: acerca el destino.`
        : null
    }
    const b = backend.value
    if (b.state === 'checking') return 'Comprobando la conexión con el backend…'
    if (b.state === 'offline') {
      return 'Backend sin conexión: no se puede calcular. Arráncalo y pulsa «Reintentar».'
    }
    // Solo se bloquea si /health informa el ráster y dice que no está (si no lo informa, se intenta).
    if (b.slope != null && b.slope !== 'available') {
      return 'Según /health, el backend no tiene el ráster de pendiente: sin él no puede calcular rutas.'
    }
    for (const which of ['origin', 'destination']) {
      const p = which === 'origin' ? origin.value : destination.value
      if (!inArea(p)) return `El ${LABELS[which]} está fuera del rectángulo amarillo (zona con datos).`
    }
    const d = directDistanceM.value
    if (serverCapped.value && d > activeMaxDistance.value) {
      return `Los puntos están a ${fmtKm(d)}: el servidor actual de la API (Render gratuito) se reinicia por falta de memoria con más de ${fmtKm(activeMaxDistance.value)} en línea recta. Acerca B o usa el modo Rover.`
    }
    if (Number.isFinite(constraints.max_distance_m) && d > constraints.max_distance_m) {
      return `Los puntos están a ${fmtKm(d)} en línea recta y la distancia máxima es ${fmtKm(constraints.max_distance_m)}: acerca el destino (círculo azul) o súbela.`
    }
    return null
  })

  const canPlan = computed(() => !pending.value && !planBlockReason.value)

  const filteredRoutes = computed(() => {
    const key = {
      distance: (r) => r.metrics?.distance_m ?? Infinity,
      time: (r) => r.metrics?.est_total_time_min ?? Infinity,
      slope: (r) => r.metrics?.max_slope_deg ?? Infinity,
    }[filters.sortBy]
    return key ? [...routes.value].sort((a, b) => key(a) - key(b)) : routes.value
  })

  const selectedRoute = computed(
    () => routes.value.find((r) => r.route_id === selectedId.value) ?? null,
  )

  // --- Mensajes ---

  /** Revisa el formulario ANTES de llamar al backend; devuelve un mensaje o null si está bien. */
  function validateForm(form) {
    for (const which of ['origin', 'destination']) {
      if (!inArea(form[which])) {
        return `El ${LABELS[which]} está fuera de la zona con datos. Elige un punto dentro del rectángulo amarillo del mapa.`
      }
    }
    for (const [key, rule] of Object.entries(fieldRules.value)) {
      const v = form[key]
      if (typeof v !== 'number' || !Number.isFinite(v)) return `«${rule.label}» está vacío o no es un número.`
      if (v < rule.min || (rule.max != null && v > rule.max)) {
        return `«${rule.label}» debe estar ${describeRange(rule)}.`
      }
    }
    // El backend rechaza (422 DIRECT_DISTANCE_EXCEEDED) si la línea recta supera max_km.
    const direct = distanceOnMarsM(form.origin, form.destination)
    if (direct > form.max_distance_m) {
      return `Los puntos están a ${fmtKm(direct)} en línea recta y la distancia máxima es ${fmtKm(form.max_distance_m)}. Acerca el destino (debe quedar dentro del círculo azul) o sube la distancia máxima.`
    }
    return null
  }

  /**
   * Mensaje en español para cada error del backend. Siempre incluye el mensaje original de la
   * API; lo añadido solo indica qué puede hacer el usuario.
   */
  function explainError(err, form) {
    const d = err.details ?? {}
    const maxSlope = limits.value.max_slope_deg
    switch (err.code) {
      case 'NO_FEASIBLE_ROUTE':
        return `${err.message} Sube la pendiente máxima (la API acepta hasta ${maxSlope}°) o acerca los puntos.`
      case 'POINT_NOT_TRAVERSABLE':
        return d.slope_deg != null
          ? `${err.message} Mueve el punto a terreno más plano o sube la pendiente máxima.`
          : `${err.message} Mueve el punto hacia el interior de la zona.`
      case 'POINT_OUTSIDE_MAP':
        return `${err.message} Elige puntos dentro del rectángulo amarillo.`
      case 'DIRECT_DISTANCE_EXCEEDED':
      case 'ROUTE_DISTANCE_EXCEEDED':
        return serverCapped.value
          ? `${err.message} El camino rodea demasiado para el límite del servidor actual (Render gratuito): acerca los puntos o usa el modo Rover.`
          : `${err.message} Sube la distancia máxima (la API acepta hasta ${fmtKm(limits.value.max_distance_m)}) o acerca los puntos.`
      case 'SEARCH_LIMIT_EXCEEDED':
        return `${err.message} Acerca los puntos o sube la pendiente máxima.`
      case 'DATASET_UNAVAILABLE':
      case 'INVALID_DATASET':
        return err.message
      case 'VALIDATION_ERROR':
        return `${err.message} Pulsa «Restablecer» y vuelve a intentarlo.`
      case 'TIMEOUT': {
        const direct = distanceOnMarsM(form.origin, form.destination)
        return `${err.message} Los puntos están a ${fmtKm(direct)} en línea recta: acércalos o sube la pendiente máxima.`
      }
      case 'BACKEND_OFFLINE':
        return `${err.message} Pulsa «Reintentar» cuando el backend esté arrancado.`
      case 'HTTP_502':
      case 'HTTP_504':
        // Respuesta del proxy de Render, no del backend: el servicio se reinició o no respondió.
        return `El servidor respondió ${err.status} (el servicio de Render se reinició o no respondió a tiempo). Espera unos segundos, pulsa «Reintentar» y vuelve a calcular.`
      default:
        return err.message ?? String(err)
    }
  }

  // --- Backend ---

  function scheduleHealthRetry(ms = HEALTH_RETRY_MS) {
    clearTimeout(healthTimer)
    healthTimer = setTimeout(checkHealth, ms)
  }

  /** Lee una vez, tras conectar, las reglas del formulario (/openapi.json) y la zona (/site). */
  async function loadApiInfo() {
    if (apiInfoLoaded || API_MOCK) return
    apiInfoLoaded = true
    const [rules, siteData] = await Promise.allSettled([getRouteRules(), getSite()])
    if (rules.status === 'fulfilled' && rules.value) {
      const l = rules.value.limits
      limits.value = {
        max_distance_m: l.max_distance_m ?? FALLBACK_LIMITS.max_distance_m,
        max_slope_deg: l.max_slope_deg ?? FALLBACK_LIMITS.max_slope_deg,
        max_speed_ms: l.max_speed_ms ?? FALLBACK_LIMITS.max_speed_ms,
      }
      const dv = rules.value.defaults
      defaults.value = {
        max_slope_deg: dv.max_slope_deg ?? FALLBACK_DEFAULTS.max_slope_deg,
        speed_ms: dv.speed_ms ?? FALLBACK_DEFAULTS.speed_ms,
        rest_min: dv.rest_min ?? FALLBACK_DEFAULTS.rest_min,
      }
      rulesSource.value = 'api'
      // Si el usuario aún no tocó el formulario, se pone con los valores de la API.
      if (!constraintsTouched) {
        resetConstraints()
        constraintsTouched = false
      }
    } else {
      apiInfoLoaded = false // se reintentará en la siguiente comprobación de /health
    }
    if (siteData.status === 'fulfilled') site.value = siteData.value
  }

  /** Consulta /health. Si no hay conexión, se repite cada 30 s hasta que responda. */
  async function checkHealth() {
    if (API_MOCK) return
    clearTimeout(healthTimer)
    healthTimer = null
    healthCtrl?.abort()
    const ctrl = new AbortController()
    healthCtrl = ctrl
    backend.value = { state: 'checking', slope: null, message: null }
    try {
      const h = await getHealth({ signal: ctrl.signal })
      health.value = h
      backend.value = {
        state: h?.status === 'ok' ? 'online' : 'degraded',
        version: h?.api_version ?? null,
        slope: slopeStatusFromHealth(h),
        message: null,
      }
      loadApiInfo()
    } catch (err) {
      if (ctrl.signal.aborted) return
      const offline = err instanceof ApiError && err.offline
      backend.value = { state: offline ? 'offline' : 'error', slope: null, message: err.message }
      if (offline) scheduleHealthRetry()
    } finally {
      if (healthCtrl === ctrl) healthCtrl = null
    }
  }

  function stopHealthChecks() {
    clearTimeout(healthTimer)
    healthTimer = null
    healthCtrl?.abort()
    healthCtrl = null
  }

  // --- Puntos ---

  /**
   * Comprueba el punto con GET /mars/terrain si el backend lo ofrece. Hoy responde 501 y
   * getTerrainPoint devuelve null: no se hace nada (el 422 del cálculo explica el problema).
   */
  async function checkPoint(which, point) {
    if (backend.value.state === 'offline') return
    let terrain
    try {
      terrain = await getTerrainPoint(point)
    } catch {
      return // comprobación opcional: si falla, decide el backend al calcular
    }
    const current = which === 'origin' ? origin.value : destination.value
    if (!terrain || current !== point || terrain.traversable !== false) return
    notice.value = {
      kind: 'error',
      code: 'POINT_NOT_TRAVERSABLE',
      message:
        terrain.slope_deg != null
          ? `El ${LABELS[which]} tiene una pendiente de ${terrain.slope_deg.toFixed(1)}° según /mars/terrain: muévelo a terreno más plano.`
          : `Según /mars/terrain, el ${LABELS[which]} no es transitable: muévelo.`,
    }
  }

  watch(origin, (p) => mode.value === 'eva' && p && inArea(p) && checkPoint('origin', p))
  watch(destination, (p) => mode.value === 'eva' && p && inArea(p) && checkPoint('destination', p))

  function resetConstraints() {
    Object.assign(constraints, { max_distance_m: limits.value.max_distance_m, ...defaults.value })
  }

  /**
   * Fija un punto desde un clic en el mapa. Si el clic no vale, se queda en modo selección (para
   * volver a hacer clic) y se explica por qué:
   * - origen y destino deben caer dentro del rectángulo amarillo (zona con datos);
   * - el destino, además, dentro del círculo azul (distancia máxima desde el origen).
   * Tras fijar el origen se pasa directamente a elegir el destino (si el destino anterior quedó
   * fuera del nuevo círculo, se borra). Con los dos puntos puestos, la ruta se calcula sola: el
   * A* del backend busca el camino de menor coste según la pendiente del DEM.
   */
  function setPoint(which, point) {
    if (!pointAllowed(point)) {
      notice.value = {
        kind: 'error',
        code: 'POINT_OUTSIDE_MAP',
        message:
          'Las rutas de astronauta solo se confirman dentro del rectángulo amarillo (datos de 5 m). ' +
          'Haz clic dentro, o cambia a «Rover» para simular en cualquier punto de Marte.',
      }
      return false
    }
    const reach = activeMaxDistance.value
    if (which === 'destination' && origin.value) {
      const d = distanceOnMarsM(origin.value, point)
      if (d > reach) {
        notice.value = {
          kind: 'error',
          code: 'OUTSIDE_REACH',
          message: `Ese punto está a ${fmtKm(d)} del origen y el alcance es ${fmtKm(reach)}. Haz clic dentro del círculo azul.`,
        }
        return false
      }
    }
    notice.value = null
    if (which === 'origin') {
      origin.value = point
      if (destination.value && distanceOnMarsM(point, destination.value) > reach) {
        destination.value = null
      }
    } else {
      destination.value = point
    }
    if (!destination.value) {
      pickMode.value = 'destination'
      return true
    }
    pickMode.value = null
    tryPlan() // se traza la ruta sin tener que pulsar «Calcular ruta»
    return true
  }

  /** Pone A y B del ejemplo del modo activo y, si se puede, calcula la ruta. */
  function useExample() {
    const ex = EXAMPLES[mode.value]
    notice.value = null
    pickMode.value = null
    origin.value = { ...ex.origin }
    destination.value = { ...ex.destination }
    tryPlan()
  }

  /**
   * Calcula si se puede; si no, explica por qué no se autoriza la ruta (en vez de no hacer nada).
   * Se usa al poner B con un clic y con los ejemplos.
   */
  function tryPlan() {
    if (pending.value) return
    if (canPlan.value) {
      plan()
    } else if (planBlockReason.value) {
      notice.value = { kind: 'error', code: 'NOT_AUTHORIZED', message: planBlockReason.value }
    }
  }

  function buildPayload() {
    return {
      origin: { ...origin.value },
      destination: { ...destination.value },
      ...constraints,
    }
  }

  // --- Cálculo ---

  async function plan() {
    // Doble clic o envío mientras otro cálculo sigue en marcha: se ignora.
    if (pending.value || !canPlan.value) return
    if (mode.value === 'rover') return simulateRover()
    const form = buildPayload()
    const problem = validateForm(form)
    if (problem) {
      // No se envía: el backend respondería 422 y el navegador lo mostraría como error.
      notice.value = { kind: 'error', code: 'FORMULARIO', message: problem }
      return
    }
    controller.value?.abort() // por si quedara una petición anterior colgada
    const ctrl = new AbortController()
    controller.value = ctrl
    pending.value = true
    pendingSince.value = Date.now()
    notice.value = null
    try {
      const route = await planRoute(form, { signal: ctrl.signal })
      route.kind = 'eva'
      route.request = form // parámetros con los que se pidió (para mostrarlos junto a la respuesta)
      route.created_at = Date.now()
      routes.value = [route, ...routes.value.filter((r) => r.route_id !== route.route_id)]
      selectedId.value = route.route_id
    } catch (err) {
      if (ctrl.signal.aborted) return
      if (err instanceof ApiError && err.code === 'BACKEND_OFFLINE') {
        // Si la API respondía hasta ahora, lo más probable es que el servidor se reiniciara a mitad
        // del cálculo (Render responde entonces sin cabeceras CORS y el navegador lo bloquea).
        const wasUp = ['online', 'degraded'].includes(backend.value.state)
        backend.value = { state: 'offline', slope: null, message: err.message }
        scheduleHealthRetry(wasUp ? 10_000 : HEALTH_RETRY_MS)
        if (wasUp) {
          notice.value = {
            kind: 'error',
            code: 'SERVER_RESTARTED',
            message:
              'El servidor de la API dejó de responder durante el cálculo: probablemente se reinició ' +
              'por falta de memoria (pasa con rutas largas en Render). Se reconecta solo en unos ' +
              'segundos; después prueba con A y B más cerca.',
          }
          return
        }
      } else if (err instanceof ApiError && (err.status === 502 || err.status === 504)) {
        backend.value = { state: 'error', slope: null, message: `El servidor respondió ${err.status} al calcular.` }
      }
      if (err instanceof ApiError && err.notImplemented) {
        notice.value = { kind: 'info', code: err.code, message: err.message }
      } else {
        notice.value = { kind: 'error', code: err.code ?? 'ERROR', message: explainError(err, form) }
      }
    } finally {
      if (controller.value === ctrl) {
        pending.value = false
        controller.value = null
      }
    }
  }

  /** Ruta de rover simulada en el navegador (no usa la API). */
  async function simulateRover() {
    controller.value?.abort()
    const ctrl = new AbortController()
    controller.value = ctrl
    pending.value = true
    pendingSince.value = Date.now()
    simProgress.value = 0
    notice.value = null
    const request = {
      origin: { ...origin.value },
      destination: { ...destination.value },
      ...roverConstraints,
    }
    try {
      const route = await planRoverRoute({
        origin: request.origin,
        destination: request.destination,
        maxSlopeDeg: request.max_slope_deg,
        maxDistanceM: request.max_distance_m,
        sampleHeights: (pts, opts) => (heightSampler ? heightSampler(pts, opts) : Promise.resolve(null)),
        signal: ctrl.signal,
        onProgress: (f) => (simProgress.value = f),
      })
      route.request = request
      route.created_at = Date.now()
      routes.value = [route, ...routes.value]
      selectedId.value = route.route_id
    } catch (err) {
      if (ctrl.signal.aborted) return
      notice.value = {
        kind: 'error',
        code: err instanceof SimError ? err.code : 'SIM_ERROR',
        message:
          err instanceof SimError && err.code === 'NO_FEASIBLE_ROUTE'
            ? `${err.message} Prueba con otros puntos: el terreno entre ellos es demasiado empinado para el rover.`
            : (err.message ?? String(err)),
      }
    } finally {
      if (controller.value === ctrl) {
        pending.value = false
        controller.value = null
      }
    }
  }

  /** Cambia entre astronauta (confirmada) y rover (simulada); empieza con los puntos vacíos. */
  function setMode(next) {
    if (next === mode.value) return
    cancel()
    mode.value = next
    origin.value = null
    destination.value = null
    notice.value = null
    pickMode.value = null
    resetCount.value++
  }

  function cancel() {
    controller.value?.abort()
    controller.value = null
    pending.value = false
  }

  function removeRoute(id) {
    routes.value = routes.value.filter((r) => r.route_id !== id)
    if (selectedId.value === id) selectedId.value = null
  }

  /** Cambia cada vez que se empieza una ruta nueva (el panel lo usa para vaciar los campos). */
  const resetCount = ref(0)

  /**
   * «Nueva ruta»: borra la ruta trazada que se está viendo, quita los puntos A y B y deja el
   * mapa listo para hacer clic en el nuevo origen. Si había un cálculo en curso, se cancela.
   */
  function startNewRoute() {
    cancel()
    if (selectedId.value) removeRoute(selectedId.value)
    origin.value = null
    destination.value = null
    notice.value = null
    pickMode.value = 'origin'
    resetCount.value++
  }

  return {
    mode,
    setMode,
    roverConstraints,
    terrainReady,
    setHeightSampler,
    simProgress,
    activeMaxDistance,
    serverCapped,
    origin,
    destination,
    constraints,
    limits,
    rulesSource,
    fieldRules,
    site,
    studyArea,
    inArea,
    pickMode,
    backend,
    health,
    routes,
    selectedId,
    pending,
    pendingSince,
    notice,
    filters,
    canPlan,
    planBlockReason,
    directDistanceM,
    filteredRoutes,
    selectedRoute,
    checkHealth,
    stopHealthChecks,
    resetConstraints,
    setPoint,
    useExample,
    plan,
    cancel,
    removeRoute,
    resetCount,
    startNewRoute,
  }
})
