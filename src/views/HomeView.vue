<script setup>
import {
  Bot,
  Compass,
  Crosshair,
  Globe,
  Image,
  Layers,
  LoaderCircle,
  LogOut,
  MapPin,
  Mountain,
  RotateCcw,
  Route,
  Ruler,
  Satellite,
  Server,
  ServerOff,
  Timer,
  Trash2,
  TriangleAlert,
  User,
  X,
} from 'lucide-vue-next'
import { storeToRefs } from 'pinia'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'

import MapLegend from '@/components/MapLegend.vue'
import MarsGlobe from '@/components/MarsGlobe.vue'
import RouteAnimation from '@/components/RouteAnimation.vue'
import RoutePlanner from '@/components/RoutePlanner.vue'
import SpaceTransition from '@/components/SpaceTransition.vue'
import {
  BASE_MAPS,
  circleOnMars,
  DEFAULT_BASE_MAP_ID,
  getBaseMap,
  LANDMARKS,
} from '@/config/mars'
import { ROVER_RULES } from '@/config/rover'
import { clearSession, readSession } from '@/lib/session'
import { useRoutesStore } from '@/stores/routes'

const router = useRouter()
const operator = readSession()?.operator ?? ''

// --- Entrada al visor ---
// 1) SpaceTransition: viaje por el sistema solar (≈ 3 s) que tapa la carga del 3D.
// 2) Al «llegar», la cámara del visor se acerca a Marte desde lejos (≈ 4 s).
// 3) Al terminar el vuelo, la interfaz aparece. Si el aviso de fin del vuelo no llega (error,
//    pestaña en segundo plano), la interfaz se muestra igual a los 10 s.
const showTransition = ref(true)
/**
 * Solo DURANTE el viaje el visor pausa su dibujo (no se ve y así la animación va fluida). Antes,
 * mientras se muestra «Estableciendo enlace», el visor trabaja y carga Marte.
 */
const travelling = ref(false)
function onArrive() {
  travelling.value = false
  globe.value?.startIntro()
}
/**
 * El viaje empieza cuando el visor terminó de arrancar y de cargar el relieve (lo más pesado),
 * más una pausa corta para que se asiente; como mucho a los 2.5 s, aunque siga cargando.
 */
const travelGo = ref(false)
let travelTimer = null
const goTravel = () => {
  clearTimeout(travelTimer)
  if (travelGo.value) return
  travelGo.value = true
  travelling.value = true
}
onMounted(() => (travelTimer = setTimeout(goTravel, 2500)))
const introDone = ref(false)
let introFallback = null
onMounted(() => {
  document.title = 'ARES-MIV · Misión'
  introFallback = setTimeout(() => (introDone.value = true), 10_000)
})
watch(introDone, (done) => done && clearTimeout(introFallback))
onBeforeUnmount(() => {
  clearTimeout(introFallback)
  clearTimeout(travelTimer)
})

function logout() {
  clearSession()
  router.push({ name: 'login' })
}

const routesStore = useRoutesStore()
const { origin, destination, filteredRoutes, selectedId, pickMode } =
  storeToRefs(routesStore)

const tab = ref('explore') // 'explore' | 'routes'
const TABS = [
  { id: 'explore', label: 'Explorar', icon: Compass },
  { id: 'routes', label: 'Rutas', icon: Route },
]

// Solo se dibujan las rutas que pasan los filtros del panel.
const routeScene = computed(() => ({
  origin: origin.value,
  destination: destination.value,
  routes: filteredRoutes.value,
  selectedId: selectedId.value,
  area: routesStore.studyArea,
  // Círculo del alcance del modo activo alrededor del origen (el destino debe quedar dentro).
  reach: origin.value ? circleOnMars(origin.value, routesStore.activeMaxDistance) : null,
}))

function onPick(pos) {
  if (!pickMode.value) return
  // setPoint rechaza (con aviso) los clics fuera de la zona con datos del backend.
  routesStore.setPoint(pickMode.value, {
    latitude: Number(pos.lat.toFixed(6)),
    longitude: Number(pos.lon.toFixed(6)),
  })
}

const globe = ref(null)
const baseMapId = ref(DEFAULT_BASE_MAP_ID)
const terrain3d = ref(true)
const status = ref({ mode: 'loading', message: 'Iniciando visor…' })
// Relieve cargado (o sin relieve): a los 300 ms empieza el viaje de la transición de entrada.
watch(
  () => status.value.mode,
  (m) => m !== 'loading' && !travelGo.value && setTimeout(goTravel, 300),
)
const cursor = ref(null)

const has3D = computed(() => status.value.mode === 'terrain3d')

// El simulador de rover mide alturas en el relieve 3D a través del visor.
routesStore.setHeightSampler((points, opts) => globe.value?.sampleHeights(points, opts) ?? Promise.resolve(null))
watch(has3D, (ready) => (routesStore.terrainReady = ready), { immediate: true })
// El mapa base solo se ve cuando el globo está visible (sin relieve 3D activo).
const baseMapVisible = computed(() => !has3D.value || !terrain3d.value)
const legend = computed(() => getBaseMap(baseMapId.value).legend)

function flyToLandmark(id) {
  const lm = LANDMARKS.find((l) => l.id === id)
  if (lm) globe.value?.flyTo(lm)
}

// Chips de estado de la barra superior: ícono + color + texto corto (el detalle va en el title).
const VIEWER_CHIP = {
  loading: { icon: LoaderCircle, spin: true, tone: 'text-amber-300', label: 'Cargando relieve' },
  terrain3d: { icon: Mountain, tone: 'text-emerald-300', label: 'Relieve 3D' },
  imagery: { icon: Image, tone: 'text-sky-300', label: 'Solo imagen' },
}
const viewerChip = computed(() => VIEWER_CHIP[status.value.mode])

const BACKEND_CHIP = {
  mock: { icon: Server, tone: 'text-violet-300', label: 'Simulación' },
  checking: { icon: LoaderCircle, spin: true, tone: 'text-white/60', label: 'Backend…' },
  online: { icon: Server, tone: 'text-emerald-300', label: 'Backend' },
  degraded: { icon: Server, tone: 'text-amber-300', label: 'Backend parcial' },
  offline: { icon: ServerOff, tone: 'text-rose-300', label: 'Sin backend' },
  error: { icon: ServerOff, tone: 'text-amber-300', label: 'Backend con errores' },
}
const backendChip = computed(() => BACKEND_CHIP[routesStore.backend.state])
const backendTitle = computed(() => {
  const b = routesStore.backend
  if (b.state === 'offline' || b.state === 'error') return `${b.message ?? ''} Clic para reintentar.`
  if (b.state === 'online' || b.state === 'degraded') {
    return `API ${b.version ?? ''} · ráster de pendiente: ${b.slope ?? 'sin dato'}`
  }
  return ''
})

/** Clic en el chip del backend: abre Rutas y, si no hay conexión, vuelve a comprobar. */
function onBackendChip() {
  tab.value = 'routes'
  if (['offline', 'error'].includes(routesStore.backend.state)) routesStore.checkHealth()
}

// Segundos que lleva el cálculo en curso (en Render una ruta larga puede tardar ~1 min).
const now = ref(Date.now())
let tick = null
watch(
  () => routesStore.pending,
  (pending) => {
    clearInterval(tick)
    tick = pending ? setInterval(() => (now.value = Date.now()), 1000) : null
    now.value = Date.now()
  },
)
onBeforeUnmount(() => clearInterval(tick))
const elapsedS = computed(() =>
  routesStore.pendingSince ? Math.max(0, Math.round((now.value - routesStore.pendingSince) / 1000)) : 0,
)

/** Avisos que vienen de un clic en el mapa (no de un cálculo). */
const PICK_CODES = ['POINT_OUTSIDE_MAP', 'OUTSIDE_REACH']

function fmtLat(v) {
  return `${Math.abs(v).toFixed(4)}° ${v >= 0 ? 'N' : 'S'}`
}
function fmtLon(v) {
  return `${Math.abs(v).toFixed(4)}° ${v >= 0 ? 'E' : 'O'}`
}
function fmtKm(m) {
  return m == null ? '—' : `${(m / 1000).toFixed(2)} km`
}
function fmtMin(min) {
  if (min == null) return '—'
  const h = Math.floor(min / 60)
  const m = Math.round(min % 60)
  return h ? `${h} h ${m} min` : `${m} min`
}
function fmtHeight(h) {
  if (h == null) return '—'
  return Math.abs(h) >= 1000 ? `${(h / 1000).toFixed(2)} km` : `${h.toFixed(0)} m`
}
</script>

<template>
  <main class="relative h-full w-full">
    <MarsGlobe
      ref="globe"
      class="absolute inset-0"
      :base-map-id="baseMapId"
      :terrain3d="terrain3d"
      :route-scene="routeScene"
      :picking="!!pickMode"
      :throttled="travelling"
      @status="status = $event"
      @intro-done="introDone = true"
      @cursor="cursor = $event"
      @pick="onPick"
    />

    <!-- Barra superior -->
    <header
      class="absolute inset-x-0 top-0 z-10 flex h-14 items-center gap-3 border-b border-white/10 bg-mars-950/85 px-4 backdrop-blur-md transition duration-700 ease-out"
      :class="introDone ? 'translate-y-0 opacity-100' : '-translate-y-full opacity-0'"
    >
      <!-- Marca -->
      <div class="flex min-w-0 items-center gap-2.5">
        <span class="grid size-8 shrink-0 place-items-center rounded-lg bg-mars-500/15 text-mars-300 ring-1 ring-mars-500/40">
          <Satellite class="size-4.5" aria-hidden="true" />
        </span>
        <div class="min-w-0 leading-tight">
          <h1 class="text-sm font-semibold tracking-wider">ARES<span class="text-mars-500">-MIV</span></h1>
          <p class="hidden truncate text-[11px] text-white/50 lg:block">Navegación y análisis geoespacial de Marte</p>
        </div>
      </div>

      <!-- Secciones -->
      <nav class="mx-auto flex items-center gap-1 rounded-xl bg-white/5 p-1 ring-1 ring-white/10" role="tablist">
        <button
          v-for="t in TABS"
          :key="t.id"
          role="tab"
          :aria-selected="tab === t.id"
          class="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition"
          :class="tab === t.id ? 'bg-mars-500 text-white shadow shadow-mars-500/30' : 'text-white/60 hover:bg-white/10 hover:text-white'"
          @click="tab = t.id"
        >
          <component :is="t.icon" class="size-4" aria-hidden="true" />
          {{ t.label }}
          <span
            v-if="t.id === 'routes' && routesStore.routes.length"
            class="rounded-full px-1.5 font-mono text-[10px] tabular-nums"
            :class="tab === t.id ? 'bg-white/25' : 'bg-mars-500 text-white'"
          >{{ routesStore.routes.length }}</span>
        </button>
      </nav>

      <!-- Estado y sesión -->
      <div class="flex items-center gap-2 text-xs">
        <span
          class="flex items-center gap-1.5 rounded-lg bg-white/5 px-2.5 py-1.5 ring-1 ring-white/10"
          :title="status.message"
        >
          <component
            :is="viewerChip.icon"
            class="size-4"
            :class="[viewerChip.tone, { 'animate-spin': viewerChip.spin }]"
            aria-hidden="true"
          />
          <span class="hidden md:inline">{{ viewerChip.label }}</span>
        </span>
        <button
          type="button"
          class="flex items-center gap-1.5 rounded-lg bg-white/5 px-2.5 py-1.5 ring-1 ring-white/10 hover:bg-white/10"
          :title="backendTitle"
          @click="onBackendChip"
        >
          <component
            :is="backendChip.icon"
            class="size-4"
            :class="[backendChip.tone, { 'animate-spin': backendChip.spin }]"
            aria-hidden="true"
          />
          <span class="hidden md:inline">{{ backendChip.label }}</span>
        </button>

        <span class="mx-1 hidden h-6 w-px bg-white/10 sm:block" aria-hidden="true" />

        <span v-if="operator" class="hidden items-center gap-1.5 text-white/60 lg:flex" :title="operator">
          <User class="size-4" aria-hidden="true" />
          <span class="max-w-40 truncate font-mono text-[11px]">{{ operator }}</span>
        </span>
        <button
          type="button"
          class="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-white/60 ring-1 ring-white/10 hover:bg-rose-500/15 hover:text-rose-200 hover:ring-rose-400/30"
          title="Cerrar terminal"
          @click="logout"
        >
          <LogOut class="size-4" aria-hidden="true" />
          <span class="hidden sm:inline">Salir</span>
        </button>
      </div>
    </header>

    <!-- Panel lateral -->
    <aside
      class="absolute top-[4.5rem] left-4 flex max-h-[calc(100vh-9.5rem)] w-80 flex-col rounded-xl bg-mars-950/85 text-sm ring-1 ring-white/10 backdrop-blur-md transition delay-150 duration-700 ease-out"
      :class="introDone ? 'translate-x-0 opacity-100' : '-translate-x-8 opacity-0 pointer-events-none'"
    >
      <div class="overflow-y-auto p-4">
        <!-- v-show: el panel de rutas conserva su estado (formulario, comprobación del backend) -->
        <RoutePlanner
          v-show="tab === 'routes'"
          @fly-to-points="globe?.flyToPoints($event)"
          @focus-area="globe?.flyToPointsIfFar($event, 150_000)"
        />

        <div v-show="tab === 'explore'" class="space-y-5">
          <section>
            <h2 class="mb-2 flex items-center gap-1.5 text-[11px] font-semibold tracking-widest text-mars-300 uppercase">
              <Mountain class="size-3.5" aria-hidden="true" /> Vista
            </h2>
            <label
              class="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 hover:bg-white/5"
              :class="has3D ? 'cursor-pointer' : 'cursor-not-allowed opacity-50'"
              :title="has3D ? '' : 'Requiere token de Cesium ion (ver .env.example)'"
            >
              <span>Relieve 3D</span>
              <input
                type="checkbox"
                class="h-4 w-4 accent-mars-500"
                :checked="has3D && terrain3d"
                :disabled="!has3D"
                @change="terrain3d = $event.target.checked"
              />
            </label>
          </section>

          <section :class="{ 'opacity-50': !baseMapVisible }">
            <h2 class="mb-2 flex items-center gap-1.5 text-[11px] font-semibold tracking-widest text-mars-300 uppercase">
              <Layers class="size-3.5" aria-hidden="true" /> Mapa base
            </h2>
            <div class="space-y-1">
              <label
                v-for="map in BASE_MAPS"
                :key="map.id"
                class="flex cursor-pointer items-start gap-2 rounded-lg p-2 ring-1 transition"
                :class="baseMapId === map.id ? 'bg-white/5 ring-mars-500/40' : 'ring-transparent hover:bg-white/5'"
                :title="map.description"
              >
                <input
                  v-model="baseMapId"
                  type="radio"
                  name="basemap"
                  :value="map.id"
                  class="mt-0.5 accent-mars-500"
                />
                <span>{{ map.name }}</span>
              </label>
            </div>
            <p v-if="!baseMapVisible" class="mt-1 text-xs text-white/50">
              Desactiva el relieve 3D para ver el mapa base.
            </p>
          </section>

          <section>
            <h2 class="mb-2 flex items-center gap-1.5 text-[11px] font-semibold tracking-widest text-mars-300 uppercase">
              <MapPin class="size-3.5" aria-hidden="true" /> Ir a…
            </h2>
            <div class="grid grid-cols-1 gap-0.5">
              <button
                class="flex items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-white/10"
                @click="globe?.flyHome()"
              >
                <Globe class="size-4 text-white/50" aria-hidden="true" /> Vista global
              </button>
              <button
                v-for="lm in LANDMARKS"
                :key="lm.id"
                class="flex items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-white/10"
                @click="globe?.flyTo(lm)"
              >
                <MapPin class="size-4 text-mars-300/70" aria-hidden="true" /> {{ lm.name }}
              </button>
            </div>
          </section>
        </div>
      </div>
    </aside>

    <!-- Aviso mientras se elige un punto -->
    <div
      v-if="pickMode"
      class="absolute top-[4.5rem] left-1/2 flex max-w-md -translate-x-1/2 items-start gap-3 rounded-2xl bg-mars-500 px-4 py-2 text-xs shadow-lg"
    >
      <Crosshair class="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <div class="font-semibold">
        <template v-if="pickMode === 'destination' && origin">Haz clic dentro del círculo azul para fijar el destino (B)</template>
        <template v-else-if="routesStore.mode === 'rover'">
          Haz clic en cualquier punto de Marte para fijar {{ pickMode === 'origin' ? 'el punto de partida (A)' : 'el destino (B)' }}
        </template>
        <template v-else>
          Haz clic dentro del rectángulo amarillo para fijar {{ pickMode === 'origin' ? 'el punto de partida (A)' : 'el destino (B)' }}
        </template>
        <!-- Por qué se rechazó el último clic -->
        <span v-if="PICK_CODES.includes(routesStore.notice?.code)" class="mt-1 block font-normal text-white/90" role="status">
          {{ routesStore.notice.message }}
        </span>
      </div>
      <button class="shrink-0 font-semibold text-white/80 hover:text-white" @click="pickMode = null">Cancelar</button>
    </div>

    <!-- Cálculo en curso / resultado fallido (el detalle completo está en la pestaña Rutas) -->
    <div
      v-else-if="routesStore.pending"
      class="absolute top-[4.5rem] left-1/2 flex max-w-md -translate-x-1/2 items-center gap-3 rounded-2xl bg-mars-950/90 px-4 py-2 text-xs shadow-lg ring-1 ring-white/15 backdrop-blur-md"
      role="status"
    >
      <LoaderCircle class="size-4 shrink-0 animate-spin text-mars-300" aria-hidden="true" />
      <span>
        <template v-if="routesStore.mode === 'rover'">
          <span class="font-semibold">
            Simulando la ruta del rover…
            <span class="font-mono font-normal tabular-nums text-white/60">{{ Math.round(routesStore.simProgress * 100) }} %</span>
          </span>
          <span class="block text-white/60">Midiendo el relieve 3D entre A y B (estimación, no es dato de la API).</span>
        </template>
        <template v-else>
          <span class="font-semibold">
            Trazando la ruta (API)… <span class="font-mono font-normal tabular-nums text-white/60">{{ elapsedS }} s</span>
          </span>
          <span class="block text-white/60">
            Buscando el camino que evita las pendientes fuertes. Las rutas largas pueden tardar hasta ~1 min.
          </span>
        </template>
      </span>
      <button class="shrink-0 font-semibold text-white/70 hover:text-white" @click="routesStore.cancel()">Cancelar</button>
    </div>
    <div
      v-else-if="routesStore.notice?.kind === 'error' && !PICK_CODES.includes(routesStore.notice.code)"
      class="absolute top-[4.5rem] left-1/2 flex max-w-md -translate-x-1/2 items-start gap-3 rounded-2xl bg-rose-950/90 px-4 py-2 text-xs shadow-lg ring-1 ring-rose-400/40 backdrop-blur-md"
      role="status"
    >
      <TriangleAlert class="mt-0.5 size-4 shrink-0 text-rose-300" aria-hidden="true" />
      <span>
        <span class="font-semibold">Ruta no autorizada</span>
        <span class="block text-white/80">{{ routesStore.notice.message }}</span>
      </span>
      <button class="shrink-0 text-white/60 hover:text-white" title="Cerrar" @click="routesStore.notice = null">
        <X class="size-4" aria-hidden="true" />
      </button>
    </div>

    <!-- Ruta trazada: resumen y acciones -->
    <div
      v-else-if="routesStore.selectedRoute"
      class="absolute top-[4.5rem] left-1/2 flex -translate-x-1/2 items-center gap-3 rounded-2xl bg-mars-950/90 py-1.5 pr-1.5 pl-4 text-xs shadow-lg ring-1 ring-white/15 backdrop-blur-md"
    >
      <span class="flex items-center gap-1.5 font-semibold">
        <template v-if="routesStore.selectedRoute.kind === 'rover'">
          <Bot class="size-4 text-cyan-300" aria-hidden="true" /> Ruta simulada · rover
        </template>
        <template v-else>
          <Route class="size-4 text-amber-300" aria-hidden="true" /> Ruta confirmada · API
        </template>
      </span>
      <span class="flex items-center gap-3 font-mono tabular-nums text-white/75">
        <span class="inline-flex items-center gap-1" title="Distancia">
          <Ruler class="size-3.5 text-white/40" aria-hidden="true" />{{ fmtKm(routesStore.selectedRoute.metrics?.distance_m) }}
        </span>
        <span class="inline-flex items-center gap-1" title="Tiempo total estimado">
          <Timer class="size-3.5 text-white/40" aria-hidden="true" />{{
            routesStore.selectedRoute.kind === 'rover'
              ? fmtMin((routesStore.selectedRoute.metrics.distance_m / ROVER_RULES.autonavMPerH.perseverance) * 60)
              : fmtMin(routesStore.selectedRoute.metrics?.est_total_time_min)
          }}
        </span>
      </span>
      <button
        type="button"
        class="rounded-lg p-1.5 text-white/60 ring-1 ring-white/10 hover:bg-rose-500/15 hover:text-rose-200 hover:ring-rose-400/30"
        title="Borrar esta ruta del mapa"
        aria-label="Borrar ruta"
        @click="routesStore.removeRoute(routesStore.selectedRoute.route_id)"
      >
        <Trash2 class="size-4" aria-hidden="true" />
      </button>
      <button
        type="button"
        class="inline-flex items-center gap-1.5 rounded-lg bg-mars-500 px-3 py-1.5 font-semibold text-white shadow shadow-mars-500/30 hover:bg-mars-500/90"
        title="Borra esta ruta y haz clic en el mapa para el nuevo origen"
        @click="routesStore.startNewRoute()"
      >
        <RotateCcw class="size-4" aria-hidden="true" /> Nueva ruta
      </button>
    </div>

    <!-- Recorrido animado de la ruta seleccionada -->
    <RouteAnimation
      class="absolute bottom-10 left-1/2 -translate-x-1/2"
      :route="routesStore.selectedRoute"
      @move="(lonLat, kind) => globe?.setMover(lonLat, kind)"
    />

    <!-- Leyenda del mapa base activo -->
    <MapLegend
      v-if="legend && baseMapVisible"
      class="absolute right-4 bottom-10"
      :legend="legend"
      @fly-to="flyToLandmark"
    />

    <!-- Coordenadas bajo el cursor -->
    <footer
      class="pointer-events-none absolute bottom-10 left-4 flex items-center gap-3 rounded-xl bg-mars-950/80 px-4 py-2 font-mono text-xs tabular-nums ring-1 ring-white/10 backdrop-blur-md transition delay-300 duration-700"
      :class="introDone ? 'opacity-100' : 'opacity-0'"
    >
      <Crosshair class="size-3.5 text-white/40" aria-hidden="true" />
      <template v-if="cursor">
        <span><span class="text-white/45">LAT</span> {{ fmtLat(cursor.lat) }}</span>
        <span><span class="text-white/45">LON</span> {{ fmtLon(cursor.lon) }}</span>
        <span><span class="text-white/45">ALT</span> {{ fmtHeight(cursor.height) }}</span>
      </template>
      <span v-else class="text-white/50">Mueve el cursor sobre Marte</span>
    </footer>

    <!-- Transición de entrada (tras el login): viaje por el sistema solar hasta Marte -->
    <SpaceTransition v-if="showTransition" :go="travelGo" @arrive="onArrive" @done="showTransition = false" />
  </main>
</template>
