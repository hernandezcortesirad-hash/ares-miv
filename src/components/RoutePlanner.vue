<script setup>
// Panel de rutas, en dos modos:
// - Astronauta: ruta CONFIRMADA. Todo sale de la API (/health, /openapi.json, /site,
//   POST /routes/plan). Si la API no envía un dato, se dice «sin dato».
// - Rover: ruta SIMULADA en el navegador sobre el relieve 3D (lib/roverPlanner.js), con reglas de
//   NASA/JPL citadas en config/rover.js. Siempre se etiqueta como simulada.
import {
  Atom,
  Bot,
  ChevronDown,
  CircleCheck,
  CircleSlash,
  Crosshair,
  Database,
  ExternalLink,
  FlaskConical,
  Footprints,
  Info,
  ListOrdered,
  LoaderCircle,
  Map as MapIcon,
  Mountain,
  NotebookText,
  Pencil,
  RotateCcw,
  RotateCw,
  Route,
  Ruler,
  Server,
  ServerOff,
  ShieldCheck,
  Timer,
  TriangleAlert,
  Wrench,
  X,
} from 'lucide-vue-next'
import { storeToRefs } from 'pinia'
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'

import { ROVER_RULES, ROVER_SOURCES, SIM_ASSUMPTIONS } from '@/config/rover'
import { API_URL } from '@/lib/api'
import { clampToRule, describeRange, EXAMPLES, useRoutesStore } from '@/stores/routes'

const emit = defineEmits(['fly-to-points', 'focus-area'])

const store = useRoutesStore()
const {
  mode,
  roverConstraints,
  terrainReady,
  activeMaxDistance,
  serverCapped,
  origin,
  destination,
  constraints,
  limits,
  rulesSource,
  fieldRules,
  studyArea,
  pickMode,
  backend,
  health,
  pending,
  notice,
  filters,
  canPlan,
  planBlockReason,
  directDistanceM,
  routes,
  filteredRoutes,
  selectedId,
  selectedRoute,
} = storeToRefs(store)

const isRover = computed(() => mode.value === 'rover')

/** Avisos que vienen de un clic en el mapa, no de un cálculo. */
const PICK_CODES = ['POINT_OUTSIDE_MAP', 'OUTSIDE_REACH']
const BACKEND_ICON = {
  mock: Server,
  checking: LoaderCircle,
  online: Server,
  degraded: Server,
  offline: ServerOff,
  error: ServerOff,
}
const STATUS_LABELS = {
  available: 'disponible',
  partial: 'parcial',
  estimated: 'estimado',
  unavailable: 'no disponible',
}
const STATUS_TONE = {
  available: 'bg-emerald-500/15 text-emerald-200',
  partial: 'bg-amber-500/15 text-amber-200',
  estimated: 'bg-amber-500/15 text-amber-200',
  unavailable: 'bg-white/10 text-white/50',
}

// --- Estado del backend (vive en el store; aquí solo se arranca y se muestra) ---
onMounted(() => store.checkHealth())
onBeforeUnmount(() => store.stopHealthChecks())
const backendLine = computed(
  () =>
    ({
      mock: ['text-violet-200', 'Modo simulación (sin backend)'],
      checking: ['text-white/60', 'Conectando con la API… (si estaba dormida, hasta ~1 min)'],
      online: ['text-emerald-300', 'API conectada'],
      degraded: ['text-emerald-300', 'API conectada · datos parciales'],
      offline: ['text-rose-300', 'API sin conexión'],
      error: ['text-amber-300', 'API con errores'],
    })[backend.value.state],
)

// --- Puntos ---
const POINT_LABELS = { origin: 'Punto de partida', destination: 'Destino' }
const POINT_LETTER = { origin: 'A', destination: 'B' }

/** Coordenadas escritas a mano (se muestran solo si el usuario abre «escribir»). */
const manual = reactive({ origin: false, destination: false })
const drafts = reactive({
  origin: { latitude: null, longitude: null },
  destination: { latitude: null, longitude: null },
})
watch(origin, (p) => p && Object.assign(drafts.origin, p), { immediate: true })
watch(destination, (p) => p && Object.assign(drafts.destination, p), { immediate: true })

// Rango de coordenadas: en EVA, el rectángulo con datos; en rover, todo Marte.
const coordRules = computed(() => {
  if (isRover.value) {
    return {
      latitude: { label: 'latitud', min: -90, max: 90 },
      longitude: { label: 'longitud', min: -180, max: 180 },
    }
  }
  const [w, s, e, n] = studyArea.value.bbox
  return {
    latitude: { label: 'latitud', min: s, max: n },
    longitude: { label: 'longitud', min: w, max: e },
  }
})
const coordMessage = ref(null)

// «Nueva ruta» o cambio de modo: se vacían los campos.
watch(
  () => store.resetCount,
  () => {
    Object.assign(drafts.origin, { latitude: null, longitude: null })
    Object.assign(drafts.destination, { latitude: null, longitude: null })
    coordMessage.value = null
  },
)

function coordOut(which, key) {
  const v = drafts[which][key]
  const rule = coordRules.value[key]
  return v != null && (v < rule.min || v > rule.max)
}

/** Al salir de un campo de coordenada: valida y, si están las dos y son válidas, fija el punto. */
function setCoord(which, key, el) {
  const rule = coordRules.value[key]
  const draft = drafts[which]
  const raw = el.value.trim()
  if (raw !== '' && !Number.isFinite(Number(raw))) {
    el.value = draft[key] ?? ''
    coordMessage.value = `La ${rule.label} no es un número. Permitido: de ${rule.min} a ${rule.max}.`
    return
  }
  draft[key] = raw === '' ? null : Number(raw)
  const bad = ['latitude', 'longitude'].filter((k) => coordOut(which, k))
  coordMessage.value = bad.length
    ? bad
        .map((k) => {
          const r = coordRules.value[k]
          return isRover.value
            ? `La ${r.label} ${draft[k]} no existe en Marte: usa un valor de ${r.min} a ${r.max}.`
            : `La ${r.label} ${draft[k]} está fuera de la zona con datos: usa un valor de ${r.min} a ${r.max}.`
        })
        .join(' ')
    : null
  const complete = draft.latitude != null && draft.longitude != null && !bad.length
  const point = complete ? { latitude: draft.latitude, longitude: draft.longitude } : null
  if (which === 'origin') origin.value = point
  else destination.value = point
}

/** Esquinas del rectángulo con datos, para encuadrarlo. */
const areaCorners = () => {
  const [w, s, e, n] = studyArea.value.bbox
  return [
    [w, s],
    [e, n],
  ]
}

function togglePick(which) {
  pickMode.value = pickMode.value === which ? null : which
  // Astronauta: si la cámara está lejos, se acerca sola al rectángulo para poder hacer clic.
  if (pickMode.value && !isRover.value) emit('focus-area', areaCorners())
}

function chooseMode(next) {
  store.setMode(next)
  if (next === 'eva') emit('focus-area', areaCorners())
}
function showPoints() {
  const pts = [origin.value, destination.value].filter(Boolean)
  emit(
    'fly-to-points',
    pts.map((p) => [p.longitude, p.latitude]),
  )
}
function useExample() {
  coordMessage.value = null
  store.useExample()
  showPoints()
}
function showStudyArea() {
  emit('fly-to-points', areaCorners())
}

// Separación A–B frente al alcance (barra).
const reachShare = computed(() =>
  directDistanceM.value == null ? 0 : Math.min(1, directDistanceM.value / activeMaxDistance.value),
)
const overReach = computed(() => directDistanceM.value != null && directDistanceM.value > activeMaxDistance.value)

// --- Ajustes (deslizadores: no admiten valores fuera de rango) ---
const distanceKm = computed({
  get: () => constraints.value.max_distance_m / 1000,
  set: (km) => (constraints.value.max_distance_m = Math.round(km * 1000)),
})
const roverDistanceKm = computed({
  get: () => roverConstraints.value.max_distance_m / 1000,
  set: (km) => (roverConstraints.value.max_distance_m = Math.round(km * 1000)),
})
const restDraft = ref(constraints.value.rest_min)
watch(() => constraints.value.rest_min, (v) => (restDraft.value = v))
const restMessage = ref(null)
/** Descanso: la API solo exige > 0 (sin máximo); se valida al salir del campo. */
function commitRest(el) {
  const rule = fieldRules.value.rest_min
  const value = Number(el.value)
  const previous = constraints.value.rest_min
  if (el.value.trim() === '' || !Number.isFinite(value)) {
    restMessage.value = `Valor no válido: se restauró ${previous} min.`
    el.value = String(previous)
    return
  }
  const next = clampToRule(value, rule)
  restMessage.value = next === value ? null : `Se ajustó a ${next} min (permitido: ${describeRange(rule)}).`
  constraints.value.rest_min = next
  el.value = String(next)
}
function resetConstraints() {
  store.resetConstraints()
  restMessage.value = null
}

// --- Cálculo y selección ---
function plan() {
  store.plan()
}
watch(
  () => routes.value[0]?.route_id,
  (id, prev) => {
    if (id && id !== prev) selectRoute(routes.value[0])
  },
)
function selectRoute(route) {
  selectedId.value = route.route_id
  const coords = route.geometry?.coordinates
  if (coords?.length) emit('fly-to-points', coords)
}

// --- Formato (null → «sin dato») ---
const NO_DATA = 'sin dato'
const fmtNum = (v, digits = 2, unit = '') => (typeof v === 'number' ? `${v.toFixed(digits)}${unit}` : NO_DATA)
const fmtCoord = (v) => fmtNum(v, 5, '°')
function fmtDistance(m) {
  if (typeof m !== 'number') return NO_DATA
  return m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${m.toFixed(0)} m`
}
function fmtMinutes(min) {
  if (typeof min !== 'number') return NO_DATA
  const h = Math.floor(min / 60)
  const m = Math.round(min % 60)
  return h ? `${h} h ${m} min` : `${m} min`
}
const fmtHours = (h) => fmtMinutes(h * 60)
function fmtDate(iso) {
  if (!iso) return NO_DATA
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toISOString().slice(0, 10)
}
function fmtCounts(value, deviation) {
  if (typeof value !== 'number') return NO_DATA
  return typeof deviation === 'number' ? `${value.toFixed(3)} ± ${deviation.toFixed(3)}` : value.toFixed(3)
}

/** Tiempo principal de cada ruta para la lista. */
function routeTime(route) {
  if (route.kind === 'rover') return fmtHours(route.metrics.distance_m / ROVER_RULES.autonavMPerH.perseverance)
  return fmtMinutes(route.metrics.est_total_time_min)
}
</script>

<template>
  <div class="space-y-5">
    <!-- 1 · Tipo de ruta -->
    <section>
      <h2 class="mb-2 text-[11px] font-semibold tracking-widest text-mars-300 uppercase">1 · Tipo de ruta</h2>
      <div class="grid grid-cols-2 gap-1.5" role="radiogroup" aria-label="Tipo de ruta">
        <button
          type="button"
          role="radio"
          :aria-checked="!isRover"
          class="rounded-xl p-2.5 text-left ring-1 transition"
          :class="!isRover ? 'bg-amber-400/10 ring-amber-300/60' : 'ring-white/10 hover:bg-white/5'"
          @click="chooseMode('eva')"
        >
          <span class="flex items-center gap-1.5 text-sm font-semibold">
            <Footprints class="size-4 text-amber-300" aria-hidden="true" /> Astronauta
          </span>
          <span class="mt-0.5 flex items-center gap-1 text-[11px] text-white/60">
            <ShieldCheck class="size-3" aria-hidden="true" /> Confirmada · API
          </span>
        </button>
        <button
          type="button"
          role="radio"
          :aria-checked="isRover"
          class="rounded-xl p-2.5 text-left ring-1 transition"
          :class="isRover ? 'bg-cyan-400/10 ring-cyan-300/60' : 'ring-white/10 hover:bg-white/5'"
          @click="chooseMode('rover')"
        >
          <span class="flex items-center gap-1.5 text-sm font-semibold">
            <Bot class="size-4 text-cyan-300" aria-hidden="true" /> Rover
          </span>
          <span class="mt-0.5 flex items-center gap-1 text-[11px] text-white/60">
            <FlaskConical class="size-3" aria-hidden="true" /> Simulada · aproximada
          </span>
        </button>
      </div>
      <p class="mt-2 text-[11px] leading-snug text-white/55">
        <template v-if="!isRover">
          Caminata con traje. La calcula tu API con el mapa de pendiente de 5 m, solo dentro del
          <span class="text-yellow-200">rectángulo amarillo</span> (cráter Gale).
        </template>
        <template v-else>
          Recorrido de rover en cualquier punto de Marte. Lo calcula el navegador midiendo el relieve 3D;
          es una estimación, no un dato de la API.
        </template>
      </p>

      <!-- Estado de la API (solo afecta a las rutas de astronauta) -->
      <div v-if="!isRover" class="mt-2 flex items-center justify-between gap-2 text-xs" :title="backend.message ?? API_URL">
        <span class="flex items-center gap-1.5" :class="backendLine[0]">
          <component
            :is="BACKEND_ICON[backend.state]"
            class="size-3.5"
            :class="{ 'animate-spin': backend.state === 'checking' }"
            aria-hidden="true"
          />
          {{ backendLine[1] }}
        </span>
        <button
          v-if="backend.state === 'offline' || backend.state === 'error'"
          type="button"
          class="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-semibold ring-1 ring-white/25 hover:bg-white/10"
          @click="store.checkHealth()"
        >
          <RotateCw class="size-3.5" aria-hidden="true" /> Reintentar
        </button>
      </div>
      <p v-else-if="!terrainReady" class="mt-2 flex items-center gap-1.5 text-xs text-amber-200">
        <TriangleAlert class="size-3.5" aria-hidden="true" /> Necesita el relieve 3D (token de Cesium).
      </p>
    </section>

    <!-- 2 · Puntos -->
    <section>
      <h2 class="mb-2 text-[11px] font-semibold tracking-widest text-mars-300 uppercase">2 · Puntos A y B</h2>
      <div class="space-y-2">
        <div
          v-for="which in ['origin', 'destination']"
          :key="which"
          class="rounded-xl p-2 ring-1"
          :class="pickMode === which ? 'bg-mars-500/10 ring-mars-400/60' : 'ring-white/10'"
        >
          <div class="flex items-center justify-between gap-2">
            <span class="flex min-w-0 items-center gap-2">
              <span
                class="grid size-6 shrink-0 place-items-center rounded-full text-[11px] font-bold text-black"
                :class="which === 'origin' ? 'bg-blue-400' : 'bg-pink-400'"
              >{{ POINT_LETTER[which] }}</span>
              <span class="min-w-0">
                <span class="block text-xs font-semibold">{{ POINT_LABELS[which] }}</span>
                <span class="block truncate font-mono text-[11px] text-white/55">
                  <template v-if="which === 'origin' ? origin : destination">
                    {{ fmtCoord((which === 'origin' ? origin : destination).latitude) }},
                    {{ fmtCoord((which === 'origin' ? origin : destination).longitude) }}
                  </template>
                  <template v-else>Sin fijar</template>
                </span>
              </span>
            </span>
            <button
              type="button"
              class="rounded-md p-1 text-white/45 hover:bg-white/10 hover:text-white"
              :class="{ 'bg-white/10 text-white': manual[which] }"
              :title="manual[which] ? 'Ocultar coordenadas' : 'Escribir coordenadas'"
              :aria-label="`Escribir coordenadas de ${POINT_LABELS[which]}`"
              @click="manual[which] = !manual[which]"
            >
              <Pencil class="size-3.5" aria-hidden="true" />
            </button>
          </div>

          <button
            type="button"
            class="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-semibold ring-1 transition"
            :class="
              pickMode === which
                ? 'bg-mars-500 text-white ring-mars-300'
                : 'text-white/80 ring-white/15 hover:bg-white/10'
            "
            @click="togglePick(which)"
          >
            <Crosshair class="size-4" :class="{ 'animate-pulse': pickMode === which }" aria-hidden="true" />
            {{ pickMode === which ? 'Haz clic en el mapa… (pulsa para cancelar)' : 'Elegir en el mapa' }}
          </button>

          <div v-if="manual[which]" class="mt-2 grid grid-cols-2 gap-1.5">
            <label class="text-[10px] text-white/50">
              Latitud ({{ coordRules.latitude.min }} a {{ coordRules.latitude.max }})
              <input
                type="number"
                step="0.0001"
                :min="coordRules.latitude.min"
                :max="coordRules.latitude.max"
                placeholder="ej. -4.815"
                :aria-invalid="coordOut(which, 'latitude')"
                class="mt-0.5 w-full rounded-md bg-white/5 px-2 py-1 font-mono text-xs text-white ring-1 focus:outline-none"
                :class="coordOut(which, 'latitude') ? 'text-rose-200 ring-rose-400/70' : 'ring-white/10 focus:ring-mars-500'"
                :value="drafts[which].latitude ?? ''"
                @change="setCoord(which, 'latitude', $event.target)"
              />
            </label>
            <label class="text-[10px] text-white/50">
              Longitud E ({{ coordRules.longitude.min }} a {{ coordRules.longitude.max }})
              <input
                type="number"
                step="0.0001"
                :min="coordRules.longitude.min"
                :max="coordRules.longitude.max"
                placeholder="ej. 137.372"
                :aria-invalid="coordOut(which, 'longitude')"
                class="mt-0.5 w-full rounded-md bg-white/5 px-2 py-1 font-mono text-xs text-white ring-1 focus:outline-none"
                :class="coordOut(which, 'longitude') ? 'text-rose-200 ring-rose-400/70' : 'ring-white/10 focus:ring-mars-500'"
                :value="drafts[which].longitude ?? ''"
                @change="setCoord(which, 'longitude', $event.target)"
              />
            </label>
          </div>
        </div>

        <p
          v-if="coordMessage"
          class="rounded-md bg-rose-500/10 px-2 py-1 text-[11px] text-rose-100 ring-1 ring-rose-400/30"
          role="status"
        >
          {{ coordMessage }}
        </p>

        <!-- Separación A–B frente al alcance -->
        <div class="rounded-lg bg-white/5 px-2.5 py-2 text-xs">
          <div class="flex items-center justify-between">
            <span class="flex items-center gap-1.5 text-white/60"><Ruler class="size-3.5" aria-hidden="true" /> Separación A–B</span>
            <span class="font-mono tabular-nums">
              <span :class="overReach ? 'text-rose-300' : 'text-white'">{{ directDistanceM == null ? '—' : fmtDistance(directDistanceM) }}</span>
              <span class="text-white/45"> / {{ fmtDistance(activeMaxDistance) }}</span>
            </span>
          </div>
          <div class="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/10">
            <div
              class="h-full rounded-full transition-all"
              :class="overReach ? 'bg-rose-400' : isRover ? 'bg-cyan-400' : 'bg-amber-400'"
              :style="{ width: `${reachShare * 100}%` }"
            />
          </div>
          <p class="mt-1 text-[10px] text-white/45">
            El destino debe quedar dentro del <span class="text-sky-300">círculo azul</span> alrededor de A.
          </p>
          <p
            v-if="serverCapped"
            class="mt-1.5 flex items-start gap-1 rounded-md bg-amber-500/10 px-1.5 py-1 text-[10px] text-amber-100"
          >
            <TriangleAlert class="mt-px size-3 shrink-0" aria-hidden="true" />
            Alcance reducido a {{ fmtDistance(activeMaxDistance) }}: el servidor actual de la API (Render gratuito) se
            reinicia por falta de memoria con rutas más largas. La API admite {{ fmtDistance(constraints.max_distance_m) }};
            para recorridos mayores usa el modo Rover.
          </p>
        </div>

        <div class="flex flex-wrap gap-1.5 text-xs">
          <button
            v-if="!isRover"
            class="flex flex-1 items-center justify-center gap-1 rounded-md px-2 py-1 text-yellow-200 ring-1 ring-yellow-300/30 hover:bg-yellow-400/10"
            @click="showStudyArea"
          >
            <MapIcon class="size-3.5" aria-hidden="true" /> Ir a la zona
          </button>
          <button
            class="flex-1 rounded-md px-2 py-1 ring-1 ring-white/15 hover:bg-white/10"
            :title="`Pone A y B de ejemplo en ${EXAMPLES[mode].label} y calcula la ruta`"
            @click="useExample"
          >
            Ejemplo ({{ EXAMPLES[mode].label }})
          </button>
          <button
            class="flex-1 rounded-md px-2 py-1 ring-1 ring-white/15 hover:bg-white/10 disabled:opacity-40"
            :disabled="!origin && !destination"
            @click="showPoints"
          >
            Ver A y B
          </button>
        </div>
      </div>
    </section>

    <!-- 3 · Ajustes -->
    <section>
      <details class="group" open>
        <summary class="mb-2 flex cursor-pointer list-none items-center justify-between text-[11px] font-semibold tracking-widest text-mars-300 uppercase">
          <span>3 · {{ isRover ? 'Ajustes del rover' : 'Ajustes de la caminata' }}</span>
          <ChevronDown class="size-4 transition group-open:rotate-180" aria-hidden="true" />
        </summary>

        <!-- Astronauta: valores que acepta la API -->
        <div v-if="!isRover" class="space-y-3 text-xs">
          <label class="block">
            <span class="flex items-baseline justify-between">
              <span class="text-white/75">Pendiente máxima</span>
              <span class="font-mono font-semibold">{{ constraints.max_slope_deg }}°</span>
            </span>
            <input v-model.number="constraints.max_slope_deg" type="range" min="1" :max="limits.max_slope_deg" step="1" class="w-full accent-amber-400" />
            <span class="flex justify-between text-[10px] text-white/40">
              <span>Más seguro</span><span>Más terreno transitable · máx. {{ limits.max_slope_deg }}°</span>
            </span>
          </label>
          <label class="block">
            <span class="flex items-baseline justify-between">
              <span class="text-white/75">Distancia máxima (círculo azul)</span>
              <span class="font-mono font-semibold">{{ distanceKm.toFixed(1) }} km</span>
            </span>
            <input v-model.number="distanceKm" type="range" min="0.5" :max="limits.max_distance_m / 1000" step="0.5" class="w-full accent-amber-400" />
            <span class="flex justify-between text-[10px] text-white/40"><span>0.5 km</span><span>máx. {{ limits.max_distance_m / 1000 }} km</span></span>
          </label>
          <label class="block">
            <span class="flex items-baseline justify-between">
              <span class="text-white/75">Velocidad al caminar</span>
              <span class="font-mono font-semibold">
                {{ constraints.speed_ms.toFixed(2) }} m/s <span class="font-normal text-white/45">≈ {{ (constraints.speed_ms * 3.6).toFixed(1) }} km/h</span>
              </span>
            </span>
            <input v-model.number="constraints.speed_ms" type="range" min="0.1" :max="limits.max_speed_ms" step="0.05" class="w-full accent-amber-400" />
            <span class="flex justify-between text-[10px] text-white/40"><span>0.1 m/s</span><span>máx. {{ limits.max_speed_ms }} m/s</span></span>
          </label>
          <label class="flex items-center justify-between gap-2">
            <span class="text-white/75">Descanso en cada parada</span>
            <span class="flex items-center gap-1">
              <input
                type="number"
                min="1"
                step="1"
                :value="restDraft"
                class="w-16 rounded-md bg-white/5 px-2 py-1 text-right font-mono ring-1 ring-white/10 focus:ring-mars-500 focus:outline-none"
                @change="commitRest($event.target)"
              />
              <span class="text-white/50">min</span>
            </span>
          </label>
          <p v-if="restMessage" class="rounded-md bg-amber-500/10 px-2 py-1 text-[11px] text-amber-100 ring-1 ring-amber-400/30" role="status">
            {{ restMessage }}
          </p>
          <div class="flex items-center justify-between text-[10px] text-white/40">
            <span class="flex items-center gap-1">
              <Info class="size-3" aria-hidden="true" />
              {{ rulesSource === 'api' ? 'Límites leídos de la API (/openapi.json)' : 'Límites aún sin leer de la API' }}
            </span>
            <button class="text-white/55 hover:text-white" @click="resetConstraints">Restablecer</button>
          </div>
        </div>

        <!-- Rover: reglas de NASA/JPL -->
        <div v-else class="space-y-3 text-xs">
          <label class="block">
            <span class="flex items-baseline justify-between">
              <span class="text-white/75">Pendiente máxima</span>
              <span class="font-mono font-semibold">{{ roverConstraints.max_slope_deg }}°</span>
            </span>
            <input
              v-model.number="roverConstraints.max_slope_deg"
              type="range"
              min="1"
              :max="ROVER_RULES.maxDriveTiltDeg"
              step="1"
              class="w-full accent-cyan-400"
            />
            <span class="flex justify-between text-[10px] text-white/40">
              <span>Más seguro</span><span>NASA: evitar más de {{ ROVER_RULES.maxDriveTiltDeg }}°</span>
            </span>
          </label>
          <label class="block">
            <span class="flex items-baseline justify-between">
              <span class="text-white/75">Alcance de la simulación (círculo azul)</span>
              <span class="font-mono font-semibold">{{ roverDistanceKm.toFixed(1) }} km</span>
            </span>
            <input
              v-model.number="roverDistanceKm"
              type="range"
              min="0.5"
              :max="SIM_ASSUMPTIONS.maxDistanceM / 1000"
              step="0.5"
              class="w-full accent-cyan-400"
            />
            <span class="flex justify-between text-[10px] text-white/40">
              <span>0.5 km</span><span>Límite de cálculo del simulador (no es regla NASA)</span>
            </span>
          </label>
          <div class="rounded-lg bg-white/5 p-2 text-[11px] leading-snug text-white/60">
            <p class="mb-1 font-semibold text-white/75">Reglas usadas (NASA/JPL)</p>
            <ul class="space-y-0.5">
              <li>Evitar inclinaciones de más de {{ ROVER_RULES.maxDriveTiltDeg }}° (soporta {{ ROVER_RULES.designTiltDeg }}° sin volcar).</li>
              <li>Velocidad máx. ~{{ ROVER_RULES.topSpeedMPerH }} m/h; autónomo ~{{ ROVER_RULES.autonavMPerH.perseverance }} m/h (Perseverance).</li>
              <li>Récord en un sol: {{ ROVER_RULES.recordSolM }} m.</li>
            </ul>
            <p class="mt-1 flex flex-wrap gap-x-2">
              <a
                v-for="s in ROVER_SOURCES"
                :key="s.url"
                :href="s.url"
                target="_blank"
                rel="noopener"
                class="inline-flex items-center gap-0.5 text-cyan-300 hover:underline"
              >{{ s.label }} <ExternalLink class="size-2.5" aria-hidden="true" /></a>
            </p>
          </div>
        </div>
      </details>
    </section>

    <!-- 4 · Calcular -->
    <section class="space-y-2">
      <button
        class="w-full rounded-lg px-3 py-2.5 text-sm font-semibold text-white shadow-lg transition disabled:cursor-not-allowed disabled:opacity-40"
        :class="isRover ? 'bg-cyan-600 shadow-cyan-500/20 hover:bg-cyan-600/90' : 'bg-mars-500 shadow-mars-500/20 hover:bg-mars-500/90'"
        :disabled="!canPlan"
        :aria-busy="pending"
        :title="planBlockReason ?? ''"
        @click="plan"
      >
        <span v-if="pending" class="inline-flex items-center gap-2">
          <LoaderCircle class="size-4 animate-spin" aria-hidden="true" />
          {{ isRover ? 'Simulando…' : 'Calculando ruta…' }}
        </span>
        <span v-else class="inline-flex items-center gap-2">
          <component :is="isRover ? Bot : Route" class="size-4" aria-hidden="true" />
          {{ isRover ? 'Simular ruta del rover' : 'Calcular ruta (API)' }}
        </span>
      </button>
      <template v-if="pending">
        <p class="text-center text-[11px] text-white/50">
          {{ isRover ? 'Midiendo el relieve 3D; puede tardar unos segundos.' : 'Las rutas largas pueden tardar hasta ~1 min.' }}
        </p>
        <button class="w-full text-xs text-white/60 hover:text-white" @click="store.cancel()">Cancelar</button>
      </template>
      <p v-else-if="planBlockReason" class="text-center text-[11px] text-white/45">{{ planBlockReason }}</p>
      <p v-else class="text-center text-[11px] text-white/45">Al poner B con un clic, la ruta se calcula sola.</p>

      <div
        v-if="notice"
        class="rounded-lg p-2 text-xs ring-1"
        :class="notice.kind === 'info' ? 'bg-sky-500/10 text-sky-100 ring-sky-400/30' : 'bg-rose-500/10 text-rose-100 ring-rose-400/30'"
        role="status"
      >
        <span class="flex items-center gap-1.5 font-semibold">
          <component
            :is="notice.kind === 'info' ? Wrench : PICK_CODES.includes(notice.code) ? Crosshair : TriangleAlert"
            class="size-3.5 shrink-0"
            aria-hidden="true"
          />
          {{ notice.kind === 'info' ? 'En desarrollo' : PICK_CODES.includes(notice.code) ? 'Punto no válido' : 'Ruta no autorizada' }}
        </span>
        <span class="block text-white/75">{{ notice.message }}</span>
        <code v-if="notice.kind === 'error'" class="mt-1 block text-[10px] text-white/45">{{ notice.code }}</code>
      </div>
    </section>

    <!-- Rutas -->
    <section>
      <h2 class="mb-2 flex items-center justify-between text-[11px] font-semibold tracking-widest text-mars-300 uppercase">
        <span class="flex items-center gap-1.5"><Route class="size-3.5" aria-hidden="true" /> Rutas</span>
        <span v-if="routes.length" class="font-mono text-white/50 normal-case">{{ routes.length }}</span>
      </h2>

      <p v-if="!routes.length" class="rounded-lg bg-white/5 p-2 text-xs text-white/50">
        Aún no hay rutas. Las que calcules aparecerán aquí para compararlas.
      </p>

      <template v-else>
        <label class="mb-2 flex items-center justify-between gap-2 text-xs">
          <span class="text-white/60">Ordenar por</span>
          <select v-model="filters.sortBy" class="rounded-md bg-mars-950 px-2 py-0.5 ring-1 ring-white/10 focus:ring-mars-500 focus:outline-none">
            <option value="recent">Más reciente</option>
            <option value="distance">Menor distancia</option>
            <option value="time">Menor tiempo</option>
            <option value="slope">Menor pendiente máx.</option>
          </select>
        </label>

        <ul class="space-y-1.5">
          <li v-for="route in filteredRoutes" :key="route.route_id">
            <div
              role="button"
              tabindex="0"
              class="w-full cursor-pointer rounded-lg p-2 text-left text-xs ring-1 transition"
              :class="route.route_id === selectedId ? 'bg-white/10 ring-mars-300/60' : 'ring-white/10 hover:bg-white/5'"
              @click="selectRoute(route)"
              @keydown.enter="selectRoute(route)"
            >
              <div class="flex items-center justify-between gap-2">
                <span class="flex items-center gap-1.5 font-semibold">
                  Ruta {{ routes.length - routes.indexOf(route) }}
                  <span
                    class="inline-flex items-center gap-0.5 rounded px-1 text-[10px] font-normal"
                    :class="route.kind === 'rover' ? 'bg-cyan-500/15 text-cyan-200' : 'bg-amber-500/15 text-amber-200'"
                  >
                    <component :is="route.kind === 'rover' ? FlaskConical : ShieldCheck" class="size-3" aria-hidden="true" />
                    {{ route.kind === 'rover' ? 'Simulada · rover' : 'Confirmada · API' }}
                  </span>
                  <span v-if="route.mock" class="rounded bg-violet-500/20 px-1 text-[10px] font-normal text-violet-200">Prueba</span>
                </span>
                <button
                  class="rounded p-0.5 text-white/40 hover:bg-white/10 hover:text-white"
                  title="Quitar de la lista"
                  aria-label="Quitar de la lista"
                  @click.stop="store.removeRoute(route.route_id)"
                >
                  <X class="size-3.5" aria-hidden="true" />
                </button>
              </div>
              <div class="mt-1.5 grid grid-cols-3 gap-1 font-mono tabular-nums text-white/80">
                <span class="inline-flex items-center gap-1" title="Distancia">
                  <Ruler class="size-3.5 text-white/40" aria-hidden="true" />{{ fmtDistance(route.metrics.distance_m) }}
                </span>
                <span class="inline-flex items-center gap-1" :title="route.kind === 'rover' ? 'Conducción autónoma (Perseverance, ~110 m/h)' : 'Tiempo total'">
                  <Timer class="size-3.5 text-white/40" aria-hidden="true" />{{ routeTime(route) }}
                </span>
                <span class="inline-flex items-center gap-1" title="Pendiente máxima en la ruta">
                  <Mountain class="size-3.5 text-white/40" aria-hidden="true" />{{ fmtNum(route.metrics.max_slope_deg, 1, '°') }}
                </span>
              </div>
            </div>
          </li>
        </ul>
      </template>
    </section>

    <!-- Detalle: ruta de astronauta (todo de la API) -->
    <template v-if="selectedRoute && selectedRoute.kind !== 'rover'">
      <section class="space-y-2 rounded-lg bg-white/5 p-2.5 text-xs">
        <div class="flex items-center justify-between gap-2">
          <h3 class="flex items-center gap-1.5 font-semibold text-amber-200">
            <ShieldCheck class="size-3.5" aria-hidden="true" /> Ruta confirmada · API
          </h3>
          <button
            type="button"
            class="inline-flex items-center gap-1 rounded-md bg-mars-500 px-2 py-1 text-[11px] font-semibold text-white hover:bg-mars-500/90"
            @click="store.startNewRoute()"
          >
            <RotateCcw class="size-3.5" aria-hidden="true" /> Nueva ruta
          </button>
        </div>
        <dl class="grid grid-cols-2 gap-x-2 gap-y-0.5 font-mono tabular-nums">
          <dt class="text-white/55">Distancia</dt>
          <dd class="text-right">{{ fmtDistance(selectedRoute.metrics.distance_m) }}</dd>
          <dt class="text-white/55">Caminando</dt>
          <dd class="text-right">{{ fmtMinutes(selectedRoute.metrics.est_walking_time_min) }}</dd>
          <dt class="text-white/55">Descanso</dt>
          <dd class="text-right">{{ fmtMinutes(selectedRoute.metrics.est_rest_time_min) }}</dd>
          <dt class="text-white/55">Total</dt>
          <dd class="text-right font-semibold">{{ fmtMinutes(selectedRoute.metrics.est_total_time_min) }}</dd>
          <dt class="text-white/55">Pendiente máx.</dt>
          <dd class="text-right">{{ fmtNum(selectedRoute.metrics.max_slope_deg, 1, '°') }}</dd>
          <dt class="text-white/55">Resolución</dt>
          <dd class="text-right">{{ fmtNum(selectedRoute.grid_resolution_m, 0, ' m') }}</dd>
          <dt class="text-white/55">Puntos de la línea</dt>
          <dd class="text-right">{{ selectedRoute.geometry.coordinates.length }}</dd>
        </dl>
        <p v-if="selectedRoute.request" class="font-mono text-[10px] leading-snug text-white/40">
          Pedida con: pendiente ≤ {{ selectedRoute.request.max_slope_deg }}° · {{ selectedRoute.request.speed_ms }} m/s ·
          descanso {{ selectedRoute.request.rest_min }} min
        </p>
      </section>

      <section class="space-y-1.5 rounded-lg bg-white/5 p-2.5 text-xs">
        <h3 class="flex items-center gap-1.5 font-semibold text-mars-300">
          <ListOrdered class="size-3.5" aria-hidden="true" /> Tramos y paradas
          <span class="font-mono font-normal text-white/45">({{ selectedRoute.segments.length }})</span>
        </h3>
        <p v-if="!selectedRoute.segments.length" class="text-white/50">La API no envió tramos.</p>
        <ol v-else class="space-y-1">
          <li v-for="seg in selectedRoute.segments" :key="seg.index" class="rounded-md bg-black/20 px-2 py-1 font-mono tabular-nums">
            <div class="flex justify-between">
              <span class="text-white/70">Tramo {{ seg.index }}</span>
              <span>{{ fmtDistance(seg.distance_m) }} · {{ fmtMinutes(seg.walking_time_min) }}</span>
            </div>
            <div class="text-[10px] text-white/45">
              <template v-if="seg.stop">
                Parada en {{ fmtCoord(seg.stop.latitude) }}, {{ fmtCoord(seg.stop.longitude) }} · a {{ fmtDistance(seg.stop.distance_m) }} del inicio
              </template>
              <template v-else>Sin parada (tramo final)</template>
            </div>
          </li>
        </ol>
      </section>

      <section class="space-y-1.5 rounded-lg bg-white/5 p-2.5 text-xs">
        <h3 class="flex items-center justify-between gap-2 font-semibold text-mars-300">
          <span class="flex items-center gap-1.5"><Atom class="size-3.5" aria-hidden="true" /> Referencia de neutrones</span>
          <span
            v-if="selectedRoute.neutron_reference"
            class="rounded px-1.5 py-0.5 text-[10px] font-normal"
            :class="STATUS_TONE[selectedRoute.neutron_reference.estado] ?? STATUS_TONE.unavailable"
          >{{ STATUS_LABELS[selectedRoute.neutron_reference.estado] ?? selectedRoute.neutron_reference.estado }}</span>
        </h3>
        <p v-if="!selectedRoute.neutron_reference" class="text-white/50">La API no envió referencia de neutrones.</p>
        <template v-else>
          <p v-if="selectedRoute.neutron_reference.mensaje" class="text-white/70">{{ selectedRoute.neutron_reference.mensaje }}</p>
          <ul class="space-y-0.5">
            <li class="flex items-start gap-1.5">
              <component :is="selectedRoute.neutron_reference.es_dosis ? CircleCheck : CircleSlash" class="mt-px size-3.5 shrink-0 text-white/50" aria-hidden="true" />
              {{ selectedRoute.neutron_reference.es_dosis ? 'La API indica que es una dosis.' : 'No es una dosis de radiación: son cuentas de neutrones.' }}
            </li>
            <li class="flex items-start gap-1.5">
              <component :is="selectedRoute.neutron_reference.usada_por_astar ? CircleCheck : CircleSlash" class="mt-px size-3.5 shrink-0 text-white/50" aria-hidden="true" />
              {{ selectedRoute.neutron_reference.usada_por_astar ? 'Se usó para trazar la ruta (A*).' : 'No se usó para trazar la ruta (A*).' }}
            </li>
          </ul>
          <dl class="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5">
            <dt class="text-white/55">Fuente</dt>
            <dd class="text-right">{{ selectedRoute.neutron_reference.fuente ?? NO_DATA }}</dd>
            <dt class="text-white/55">Producto</dt>
            <dd class="text-right font-mono text-[10px] break-all">{{ selectedRoute.neutron_reference.producto_id ?? NO_DATA }}</dd>
            <dt class="text-white/55">Periodo (UTC)</dt>
            <dd class="text-right font-mono">{{ fmtDate(selectedRoute.neutron_reference.fecha_inicio_utc) }} → {{ fmtDate(selectedRoute.neutron_reference.fecha_fin_utc) }}</dd>
            <dt class="text-white/55">Longitud solar</dt>
            <dd class="text-right font-mono">
              Ls {{ fmtNum(selectedRoute.neutron_reference.longitud_solar_inicio_deg, 0, '°') }} – {{ fmtNum(selectedRoute.neutron_reference.longitud_solar_fin_deg, 0, '°') }}
            </dd>
            <dt class="text-white/55">Resolución</dt>
            <dd class="text-right font-mono">
              <template v-if="selectedRoute.neutron_reference.resolucion_espacial_deg?.length === 2">
                {{ selectedRoute.neutron_reference.resolucion_espacial_deg[0] }}° × {{ selectedRoute.neutron_reference.resolucion_espacial_deg[1] }}°
              </template>
              <template v-else>{{ NO_DATA }}</template>
            </dd>
            <dt class="text-white/55">Unidad</dt>
            <dd class="text-right font-mono">{{ selectedRoute.neutron_reference.unidad ?? NO_DATA }}</dd>
          </dl>
          <div>
            <span class="text-white/60">Zonas ({{ selectedRoute.neutron_reference.zonas?.length ?? 0 }})</span>
            <p v-if="!selectedRoute.neutron_reference.zonas?.length" class="text-white/50">La API no envió zonas para esta ruta.</p>
            <ul v-else class="mt-1 space-y-1">
              <li v-for="(z, zi) in selectedRoute.neutron_reference.zonas" :key="zi" class="rounded-md bg-black/20 px-2 py-1 font-mono text-[10px] leading-relaxed tabular-nums">
                <div class="text-white/70">
                  Centro {{ fmtCoord(z.latitud_centro_areocentrica_deg) }}, {{ fmtCoord(z.longitud_centro_este_deg) }} · vecinas: {{ z.celdas_vecinas_disponibles ?? NO_DATA }}
                </div>
                <div>
                  Térmicos: {{ fmtCounts(z.termicos_cuentas_s, z.termicos_desviacion_cuentas_s) }}
                  <span class="text-white/45">· media vecinos {{ fmtNum(z.termicos_media_vecinos_cuentas_s, 3) }} · dif. {{ fmtNum(z.termicos_diferencia_vecinos_pct, 1, ' %') }} · intervalos {{ z.termicos_intervalos ?? NO_DATA }}</span>
                </div>
                <div>
                  Epitérmicos: {{ fmtCounts(z.epitermicos_cuentas_s, z.epitermicos_desviacion_cuentas_s) }}
                  <span class="text-white/45">· media vecinos {{ fmtNum(z.epitermicos_media_vecinos_cuentas_s, 3) }} · dif. {{ fmtNum(z.epitermicos_diferencia_vecinos_pct, 1, ' %') }} · intervalos {{ z.epitermicos_intervalos ?? NO_DATA }}</span>
                </div>
              </li>
            </ul>
          </div>
        </template>
      </section>

      <section class="space-y-1.5 rounded-lg bg-white/5 p-2.5 text-xs">
        <h3 class="flex items-center gap-1.5 font-semibold text-mars-300">
          <NotebookText class="size-3.5" aria-hidden="true" /> Supuestos del modelo
          <span class="font-mono font-normal text-white/45">({{ selectedRoute.assumptions.length }})</span>
        </h3>
        <p v-if="!selectedRoute.assumptions.length" class="text-white/50">La API no envió supuestos.</p>
        <ul v-else class="list-disc space-y-0.5 pl-4 text-white/65">
          <li v-for="(a, ai) in selectedRoute.assumptions" :key="ai">{{ a }}</li>
        </ul>
      </section>
    </template>

    <!-- Detalle: ruta de rover (simulada en el navegador) -->
    <template v-if="selectedRoute && selectedRoute.kind === 'rover'">
      <section class="space-y-2 rounded-lg bg-cyan-500/5 p-2.5 text-xs ring-1 ring-cyan-400/20">
        <div class="flex items-center justify-between gap-2">
          <h3 class="flex items-center gap-1.5 font-semibold text-cyan-200">
            <FlaskConical class="size-3.5" aria-hidden="true" /> Ruta simulada · rover
          </h3>
          <button
            type="button"
            class="inline-flex items-center gap-1 rounded-md bg-cyan-600 px-2 py-1 text-[11px] font-semibold text-white hover:bg-cyan-600/90"
            @click="store.startNewRoute()"
          >
            <RotateCcw class="size-3.5" aria-hidden="true" /> Nueva ruta
          </button>
        </div>
        <p class="text-[11px] text-white/55">
          Calculada en el navegador sobre el relieve 3D. Es una estimación: no la calcula ni la confirma la API.
        </p>
        <dl class="grid grid-cols-2 gap-x-2 gap-y-0.5 font-mono tabular-nums">
          <dt class="text-white/55">Distancia sobre el terreno</dt>
          <dd class="text-right">{{ fmtDistance(selectedRoute.metrics.distance_m) }}</dd>
          <dt class="text-white/55">Pendiente máx. (malla)</dt>
          <dd class="text-right">{{ fmtNum(selectedRoute.metrics.max_slope_deg, 1, '°') }}</dd>
          <dt class="text-white/55">Subida acumulada</dt>
          <dd class="text-right">{{ fmtNum(selectedRoute.metrics.elevation_gain_m, 0, ' m') }}</dd>
          <dt class="text-white/55">Bajada acumulada</dt>
          <dd class="text-right">{{ fmtNum(selectedRoute.metrics.elevation_loss_m, 0, ' m') }}</dd>
        </dl>

        <div>
          <span class="flex items-center gap-1.5 text-white/60"><Timer class="size-3.5" aria-hidden="true" /> Tiempo de conducción estimado</span>
          <dl class="mt-1 grid grid-cols-2 gap-x-2 gap-y-0.5 font-mono tabular-nums">
            <dt class="text-white/55">Perseverance autónomo</dt>
            <dd class="text-right">{{ fmtHours(selectedRoute.metrics.distance_m / ROVER_RULES.autonavMPerH.perseverance) }}</dd>
            <dt class="text-white/55">Curiosity autónomo</dt>
            <dd class="text-right">
              {{ fmtHours(selectedRoute.metrics.distance_m / ROVER_RULES.autonavMPerH.curiosity[1]) }} –
              {{ fmtHours(selectedRoute.metrics.distance_m / ROVER_RULES.autonavMPerH.curiosity[0]) }}
            </dd>
            <dt class="text-white/55">Mínimo (vel. máx.)</dt>
            <dd class="text-right">{{ fmtHours(selectedRoute.metrics.distance_m / ROVER_RULES.topSpeedMPerH) }}</dd>
            <dt class="text-white/55">Sols, cota optimista</dt>
            <dd class="text-right">≥ {{ Math.max(1, Math.ceil(selectedRoute.metrics.distance_m / ROVER_RULES.recordSolM)) }}</dd>
          </dl>
          <p class="mt-1 text-[10px] text-white/40">
            Velocidades medias con navegación autónoma (JPL). Los sols usan el récord de {{ ROVER_RULES.recordSolM }} m en un
            sol, así que la cifra real será mayor.
          </p>
        </div>

        <div class="rounded-md bg-black/20 p-2 text-[11px] text-white/55">
          <p class="mb-0.5 font-semibold text-white/70">Cómo se calculó</p>
          <ul class="list-disc space-y-0.5 pl-4">
            <li>Malla de {{ selectedRoute.grid.cells.toLocaleString('es') }} puntos cada {{ selectedRoute.grid.spacing_m.toFixed(0) }} m sobre el relieve 3D<template v-if="selectedRoute.grid.missing"> ({{ selectedRoute.grid.missing }} sin altura)</template>.</li>
            <li>Pasos con pendiente &gt; {{ selectedRoute.request?.max_slope_deg }}° prohibidos (NASA: evitar &gt; {{ ROVER_RULES.maxDriveTiltDeg }}°).</li>
            <li>La malla promedia el relieve: puede ocultar pendientes locales y no ve rocas (el rover supera rocas de hasta {{ ROVER_RULES.obstacleCm }} cm).</li>
          </ul>
        </div>
      </section>
    </template>

    <!-- Datos de la API (GET /health) -->
    <details v-if="health && !isRover" class="rounded-lg p-2.5 text-xs ring-1 ring-white/10">
      <summary class="flex cursor-pointer list-none items-center gap-1.5 font-semibold text-white/70">
        <Database class="size-3.5" aria-hidden="true" /> Datos disponibles en la API
        <span class="font-mono font-normal text-white/40">/health</span>
      </summary>
      <div v-for="group in ['datasets', 'layers']" :key="group" class="mt-1.5">
        <span class="text-white/50">{{ group === 'datasets' ? 'Datasets' : 'Capas' }}</span>
        <div v-if="health[group] && Object.keys(health[group]).length" class="mt-1 flex flex-wrap gap-1">
          <span
            v-for="(state, name) in health[group]"
            :key="name"
            class="rounded px-1.5 py-0.5 font-mono text-[10px]"
            :class="STATUS_TONE[state] ?? STATUS_TONE.unavailable"
          >{{ name }}: {{ STATUS_LABELS[state] ?? state }}</span>
        </div>
        <p v-else class="text-white/45">La API no envió {{ group }}.</p>
      </div>
      <p class="mt-1.5 font-mono text-[10px] text-white/40">API {{ health.api_version }} · {{ API_URL }}</p>
    </details>
  </div>
</template>
