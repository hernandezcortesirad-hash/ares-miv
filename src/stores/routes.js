// Estado del planificador de rutas: formulario, rutas calculadas en esta sesión y filtros.
import { defineStore } from 'pinia'
import { computed, reactive, ref, shallowRef } from 'vue'

import { ApiError, planRoute } from '@/lib/api'

const RISK_ORDER = { low: 0, moderate: 1, high: 2, unknown: 3 }

export const PROFILE_DEFAULTS = {
  eva_walk: { max_slope_deg: 15, max_distance_m: 5000, max_duration_min: 240 },
  rover: { max_slope_deg: 25, max_distance_m: 5000, max_duration_min: 240 },
}

// Coordenadas del ejemplo del contrato (§4), dentro de la zona del Monte Sharp.
export const EXAMPLE_POINTS = {
  origin: { latitude: -4.815, longitude: 137.372 },
  destination: { latitude: -4.826, longitude: 137.3889 },
}

export const useRoutesStore = defineStore('routes', () => {
  // --- Formulario (petición POST /routes/plan) ---
  const origin = ref(null) // { latitude, longitude }
  const destination = ref(null)
  const profile = ref('eva_walk')
  const constraints = reactive({ ...PROFILE_DEFAULTS.eva_walk, must_return_to_origin: false })
  const preferences = reactive({
    avoid_rough_terrain: true,
    consider_thermal_data: true,
    minimize_radiation: true,
  })

  /** 'origin' | 'destination' | null: qué punto fija el siguiente clic en el mapa. */
  const pickMode = ref(null)

  // --- Resultado ---
  const routes = ref([]) // respuestas completas del backend, la más reciente primero
  const selectedId = ref(null)
  const pending = ref(false)
  /** { kind: 'info' | 'error', code, message } del último intento. */
  const notice = ref(null)
  const controller = shallowRef(null)

  // --- Filtros de "Rutas planificadas" ---
  const filters = reactive({
    maxRisk: 'high', // muestra hasta este nivel (incluido)
    maxDoseMgy: null, // null = sin límite
    hideWithoutRadiation: false,
    sortBy: 'radiation', // 'radiation' | 'distance' | 'time' | 'recent'
  })

  const canPlan = computed(() => !!origin.value && !!destination.value && !pending.value)

  const filteredRoutes = computed(() => {
    const maxRisk = RISK_ORDER[filters.maxRisk]
    const list = routes.value.filter((r) => {
      const dose = r.metrics?.est_radiation_dose_mgy
      if (RISK_ORDER[r.risk_level] > maxRisk && r.risk_level !== 'unknown') return false
      if (dose == null) return !filters.hideWithoutRadiation
      return filters.maxDoseMgy == null || dose <= filters.maxDoseMgy
    })
    const key = {
      radiation: (r) => r.metrics?.est_radiation_dose_mgy ?? Infinity,
      distance: (r) => r.metrics?.distance_m ?? Infinity,
      time: (r) => r.metrics?.est_total_time_min ?? Infinity,
    }[filters.sortBy]
    return key ? [...list].sort((a, b) => key(a) - key(b)) : list
  })

  const selectedRoute = computed(
    () => routes.value.find((r) => r.route_id === selectedId.value) ?? null,
  )

  function setProfile(p) {
    profile.value = p
    Object.assign(constraints, PROFILE_DEFAULTS[p])
  }

  function setPoint(which, point) {
    if (which === 'origin') origin.value = point
    else destination.value = point
    pickMode.value = null
  }

  function useExample() {
    origin.value = { ...EXAMPLE_POINTS.origin }
    destination.value = { ...EXAMPLE_POINTS.destination }
  }

  function buildPayload() {
    return {
      origin: { ...origin.value },
      destination: { ...destination.value },
      waypoints: [],
      profile: profile.value,
      constraints: { ...constraints },
      preferences: { ...preferences },
    }
  }

  async function plan() {
    if (!canPlan.value) return
    controller.value?.abort()
    const ctrl = new AbortController()
    controller.value = ctrl
    pending.value = true
    notice.value = null
    try {
      const route = await planRoute(buildPayload(), { signal: ctrl.signal })
      route.request = buildPayload() // para mostrar con qué preferencias se calculó
      route.created_at = Date.now()
      routes.value = [route, ...routes.value.filter((r) => r.route_id !== route.route_id)]
      selectedId.value = route.route_id
    } catch (err) {
      if (ctrl.signal.aborted) return
      if (err instanceof ApiError && err.notImplemented) {
        notice.value = {
          kind: 'info',
          code: err.code,
          message:
            'En desarrollo: el backend todavía no calcula rutas ni radiación. La petición ya ' +
            'cumple el contrato; en cuanto se publique, este botón funcionará sin cambios.',
        }
      } else {
        notice.value = {
          kind: 'error',
          code: err.code ?? 'ERROR',
          message: err.message ?? String(err),
        }
      }
    } finally {
      if (controller.value === ctrl) {
        pending.value = false
        controller.value = null
      }
    }
  }

  function cancel() {
    controller.value?.abort()
    pending.value = false
  }

  function removeRoute(id) {
    routes.value = routes.value.filter((r) => r.route_id !== id)
    if (selectedId.value === id) selectedId.value = null
  }

  return {
    origin,
    destination,
    profile,
    constraints,
    preferences,
    pickMode,
    routes,
    selectedId,
    pending,
    notice,
    filters,
    canPlan,
    filteredRoutes,
    selectedRoute,
    setProfile,
    setPoint,
    useExample,
    plan,
    cancel,
    removeRoute,
  }
})
