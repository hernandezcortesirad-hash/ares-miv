<script setup>
import { storeToRefs } from 'pinia'
import { computed, ref } from 'vue'

import MapLegend from '@/components/MapLegend.vue'
import MarsGlobe from '@/components/MarsGlobe.vue'
import RoutePlanner from '@/components/RoutePlanner.vue'
import { BASE_MAPS, DEFAULT_BASE_MAP_ID, getBaseMap, LANDMARKS } from '@/config/mars'
import { useRoutesStore } from '@/stores/routes'

const routesStore = useRoutesStore()
const { origin, destination, filteredRoutes, selectedId, pickMode } = storeToRefs(routesStore)

const tab = ref('explore') // 'explore' | 'routes'

// Solo se dibujan las rutas que pasan los filtros del panel.
const routeScene = computed(() => ({
  origin: origin.value,
  destination: destination.value,
  routes: filteredRoutes.value,
  selectedId: selectedId.value,
}))

function onPick(pos) {
  if (!pickMode.value) return
  routesStore.setPoint(pickMode.value, {
    latitude: Number(pos.lat.toFixed(6)),
    longitude: Number(pos.lon.toFixed(6)),
  })
}

const globe = ref(null)
const baseMapId = ref(DEFAULT_BASE_MAP_ID)
const terrain3d = ref(true)
const status = ref({ mode: 'loading', message: 'Iniciando visor…' })
const cursor = ref(null)

const has3D = computed(() => status.value.mode === 'terrain3d')
// El mapa base solo se ve cuando el globo está visible (sin relieve 3D activo).
const baseMapVisible = computed(() => !has3D.value || !terrain3d.value)
const legend = computed(() => getBaseMap(baseMapId.value).legend)

function flyToLandmark(id) {
  const lm = LANDMARKS.find((l) => l.id === id)
  if (lm) globe.value?.flyTo(lm)
}

const statusStyle = computed(
  () =>
    ({
      loading: 'bg-amber-500/15 text-amber-300 ring-amber-400/30',
      terrain3d: 'bg-emerald-500/15 text-emerald-300 ring-emerald-400/30',
      imagery: 'bg-sky-500/15 text-sky-300 ring-sky-400/30',
    })[status.value.mode],
)

const statusLabel = computed(
  () => ({ loading: 'Cargando', terrain3d: 'Relieve 3D', imagery: 'Solo imagen' })[status.value.mode],
)

function fmtLat(v) {
  return `${Math.abs(v).toFixed(4)}° ${v >= 0 ? 'N' : 'S'}`
}
function fmtLon(v) {
  return `${Math.abs(v).toFixed(4)}° ${v >= 0 ? 'E' : 'O'}`
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
      @status="status = $event"
      @cursor="cursor = $event"
      @pick="onPick"
    />

    <!-- Cabecera -->
    <header
      class="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-4 p-4"
    >
      <div class="pointer-events-auto rounded-xl bg-mars-950/80 px-4 py-3 ring-1 ring-white/10 backdrop-blur">
        <h1 class="text-lg font-semibold tracking-wide">
          ARES<span class="text-mars-500">-MIV</span>
        </h1>
        <p class="text-xs text-white/60">Navegación y análisis geoespacial de Marte</p>
      </div>

      <div
        class="pointer-events-auto max-w-sm rounded-xl px-3 py-2 text-xs ring-1 backdrop-blur"
        :class="statusStyle"
        :title="status.message"
      >
        <span class="font-semibold">{{ statusLabel }}</span>
        <span v-if="status.message" class="block text-white/70">{{ status.message }}</span>
      </div>
    </header>

    <!-- Panel lateral: Explorar | Rutas -->
    <aside
      class="absolute top-28 left-4 flex max-h-[calc(100vh-13rem)] w-72 flex-col rounded-xl bg-mars-950/85 text-sm ring-1 ring-white/10 backdrop-blur"
    >
      <nav class="grid grid-cols-2 gap-1 border-b border-white/10 p-1.5 text-xs font-semibold" role="tablist">
        <button
          v-for="t in [
            ['explore', '🧭 Explorar'],
            ['routes', '🛰 Rutas'],
          ]"
          :key="t[0]"
          role="tab"
          :aria-selected="tab === t[0]"
          class="rounded-lg py-1.5 transition"
          :class="tab === t[0] ? 'bg-white/10 text-white' : 'text-white/60 hover:bg-white/5'"
          @click="tab = t[0]"
        >
          {{ t[1] }}
          <span
            v-if="t[0] === 'routes' && routesStore.routes.length"
            class="ml-1 rounded-full bg-mars-500 px-1.5 text-[10px]"
          >{{ routesStore.routes.length }}</span>
        </button>
      </nav>

      <div class="overflow-y-auto p-4">
      <!-- v-show: el panel de rutas conserva su estado (formulario, comprobación del backend) -->
      <RoutePlanner v-show="tab === 'routes'" @fly-to-points="globe?.flyToPoints($event)" />

      <div v-show="tab === 'explore'" class="space-y-4">
      <section>
        <h2 class="mb-2 text-xs font-semibold tracking-widest text-mars-300 uppercase">Vista</h2>
        <label
          class="flex items-center justify-between gap-2"
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
        <h2 class="mb-2 text-xs font-semibold tracking-widest text-mars-300 uppercase">
          Mapa base
        </h2>
        <div class="space-y-1">
          <label
            v-for="map in BASE_MAPS"
            :key="map.id"
            class="flex cursor-pointer items-start gap-2 rounded-lg p-2 hover:bg-white/5"
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
        <h2 class="mb-2 text-xs font-semibold tracking-widest text-mars-300 uppercase">
          Ir a…
        </h2>
        <div class="grid grid-cols-1 gap-1">
          <button
            class="rounded-lg px-2 py-1.5 text-left hover:bg-white/10"
            @click="globe?.flyHome()"
          >
            🌐 Vista global
          </button>
          <button
            v-for="lm in LANDMARKS"
            :key="lm.id"
            class="rounded-lg px-2 py-1.5 text-left hover:bg-white/10"
            @click="globe?.flyTo(lm)"
          >
            {{ lm.name }}
          </button>
        </div>
      </section>
      </div>
      </div>
    </aside>

    <!-- Aviso mientras se elige un punto -->
    <div
      v-if="pickMode"
      class="absolute top-28 left-1/2 -translate-x-1/2 rounded-full bg-mars-500 px-4 py-1.5 text-xs font-semibold shadow-lg"
    >
      Haz clic en el mapa para fijar el {{ pickMode === 'origin' ? 'origen' : 'destino' }}
      <button class="ml-2 text-white/80 hover:text-white" @click="pickMode = null">Cancelar</button>
    </div>

    <!-- Leyenda del mapa base activo -->
    <MapLegend
      v-if="legend && baseMapVisible"
      class="absolute right-4 bottom-10"
      :legend="legend"
      @fly-to="flyToLandmark"
    />

    <!-- Coordenadas bajo el cursor -->
    <footer
      class="pointer-events-none absolute bottom-10 left-4 rounded-xl bg-mars-950/80 px-4 py-2 font-mono text-xs ring-1 ring-white/10 backdrop-blur"
    >
      <template v-if="cursor">
        <span class="text-white/50">LAT</span> {{ fmtLat(cursor.lat) }}
        <span class="ml-3 text-white/50">LON</span> {{ fmtLon(cursor.lon) }}
        <span class="ml-3 text-white/50">ALT</span> {{ fmtHeight(cursor.height) }}
      </template>
      <span v-else class="text-white/50">Mueve el cursor sobre Marte</span>
    </footer>
  </main>
</template>
