<script setup>
import { storeToRefs } from 'pinia'
import { computed, onMounted, ref } from 'vue'

import { API_MOCK, API_URL, getHealth } from '@/lib/api'
import { RISK_COLORS } from '@/lib/marsViewer'
import { useRoutesStore } from '@/stores/routes'

const emit = defineEmits(['fly-to-points'])

const store = useRoutesStore()
const {
  origin,
  destination,
  profile,
  constraints,
  preferences,
  pickMode,
  pending,
  notice,
  filters,
  canPlan,
  routes,
  filteredRoutes,
  selectedId,
  selectedRoute,
} = storeToRefs(store)

const RAD_GALE_MGY_PER_DAY = 0.21

const RISK_LABELS = { low: 'Bajo', moderate: 'Moderado', high: 'Alto', unknown: 'Sin evaluar' }
const SEVERITY_ICON = { info: 'ℹ️', warning: '⚠️', critical: '⛔' }
const QUALITY_LABELS = {
  available: 'disponible',
  partial: 'parcial',
  unavailable: 'sin dato',
  estimated: 'estimado',
}

// --- Estado del backend ---
const backend = ref({ state: API_MOCK ? 'mock' : 'checking' })
onMounted(async () => {
  if (API_MOCK) return
  try {
    const h = await getHealth()
    backend.value = { state: 'online', version: h?.api_version }
  } catch (err) {
    backend.value = { state: err.offline ? 'offline' : 'error', message: err.message }
  }
})
const backendBadge = computed(
  () =>
    ({
      mock: ['bg-violet-500/15 text-violet-200 ring-violet-400/30', 'Modo simulación (sin backend)'],
      checking: ['bg-white/5 text-white/60 ring-white/10', 'Comprobando backend…'],
      online: ['bg-emerald-500/15 text-emerald-200 ring-emerald-400/30', 'Backend conectado'],
      offline: ['bg-rose-500/15 text-rose-200 ring-rose-400/30', 'Backend sin conexión'],
      error: ['bg-amber-500/15 text-amber-200 ring-amber-400/30', 'Backend con errores'],
    })[backend.value.state],
)

// --- Coordenadas ---
function coordValue(point, key) {
  return point?.[key] ?? ''
}
function setCoord(which, key, raw) {
  const value = raw === '' ? null : Number(raw)
  const current = (which === 'origin' ? origin.value : destination.value) ?? {}
  const next = { latitude: current.latitude ?? null, longitude: current.longitude ?? null }
  next[key] = Number.isFinite(value) ? value : null
  const complete = next.latitude != null && next.longitude != null
  if (which === 'origin') origin.value = complete ? next : null
  else destination.value = complete ? next : null
}
function togglePick(which) {
  pickMode.value = pickMode.value === which ? null : which
}
function showPoints() {
  const pts = [origin.value, destination.value].filter(Boolean)
  emit(
    'fly-to-points',
    pts.map((p) => [p.longitude, p.latitude]),
  )
}

function useExample() {
  store.useExample()
  showPoints()
}

async function plan() {
  await store.plan()
  if (selectedRoute.value) selectRoute(selectedRoute.value)
}

function selectRoute(route) {
  selectedId.value = route.route_id
  const coords = route.geometry?.coordinates
  if (coords?.length) emit('fly-to-points', coords)
}

// --- Filtro de dosis en µGy (las dosis de una caminata son milésimas de mGy) ---
const maxDoseUgy = computed({
  get: () => (filters.value.maxDoseMgy == null ? '' : filters.value.maxDoseMgy * 1000),
  set: (v) => {
    filters.value.maxDoseMgy = v === '' || v == null ? null : Number(v) / 1000
  },
})

// --- Formato ---
const fmtCoord = (v) => (v == null ? '—' : v.toFixed(4))
function fmtDistance(m) {
  if (m == null) return '—'
  return m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${m.toFixed(0)} m`
}
function fmtMinutes(min) {
  if (min == null) return '—'
  const h = Math.floor(min / 60)
  const m = Math.round(min % 60)
  return h ? `${h} h ${m} min` : `${m} min`
}
function fmtDose(mgy) {
  if (mgy == null) return 'sin dato'
  return `${(mgy * 1000).toFixed(1)} µGy`
}
function doseShareOfDay(mgy) {
  if (mgy == null) return null
  return ((mgy / RAD_GALE_MGY_PER_DAY) * 100).toFixed(1)
}
</script>

<template>
  <div class="space-y-4">
    <!-- Estado del backend -->
    <div
      class="rounded-lg px-2.5 py-1.5 text-xs ring-1"
      :class="backendBadge[0]"
      :title="backend.message ?? API_URL"
    >
      <span class="font-semibold">{{ backendBadge[1] }}</span>
      <span v-if="backend.state === 'offline'" class="block text-white/60">
        Puedes preparar la ruta; se enviará cuando el backend responda en
        <code class="text-white/80">{{ API_URL }}</code>.
      </span>
      <span v-if="backend.state === 'mock'" class="block text-white/60">
        Las rutas son líneas de prueba, no datos de Marte.
      </span>
    </div>

    <!-- Puntos -->
    <section>
      <h2 class="mb-2 text-xs font-semibold tracking-widest text-mars-300 uppercase">Puntos</h2>
      <div class="space-y-2">
        <div v-for="which in ['origin', 'destination']" :key="which">
          <div class="mb-1 flex items-center justify-between">
            <span class="flex items-center gap-1.5 text-xs text-white/70">
              <span
                class="inline-block h-2.5 w-2.5 rounded-full ring-1 ring-black"
                :class="which === 'origin' ? 'bg-blue-400' : 'bg-pink-400'"
              />
              {{ which === 'origin' ? 'Origen' : 'Destino' }}
            </span>
            <button
              class="rounded-md px-2 py-0.5 text-xs ring-1 transition"
              :class="
                pickMode === which
                  ? 'bg-mars-500 text-white ring-mars-300'
                  : 'text-white/70 ring-white/15 hover:bg-white/10'
              "
              @click="togglePick(which)"
            >
              {{ pickMode === which ? 'Haz clic en el mapa…' : '📍 Elegir en el mapa' }}
            </button>
          </div>
          <div class="grid grid-cols-2 gap-1.5">
            <input
              type="number"
              step="0.0001"
              min="-90"
              max="90"
              placeholder="Latitud"
              aria-label="Latitud"
              class="w-full rounded-md bg-white/5 px-2 py-1 font-mono text-xs ring-1 ring-white/10 focus:ring-mars-500 focus:outline-none"
              :value="coordValue(which === 'origin' ? origin : destination, 'latitude')"
              @change="setCoord(which, 'latitude', $event.target.value)"
            />
            <input
              type="number"
              step="0.0001"
              min="-180"
              max="180"
              placeholder="Longitud E"
              aria-label="Longitud este"
              class="w-full rounded-md bg-white/5 px-2 py-1 font-mono text-xs ring-1 ring-white/10 focus:ring-mars-500 focus:outline-none"
              :value="coordValue(which === 'origin' ? origin : destination, 'longitude')"
              @change="setCoord(which, 'longitude', $event.target.value)"
            />
          </div>
        </div>
        <div class="flex gap-1.5 text-xs">
          <button class="flex-1 rounded-md px-2 py-1 ring-1 ring-white/15 hover:bg-white/10" @click="useExample">
            Ejemplo Monte Sharp
          </button>
          <button
            class="flex-1 rounded-md px-2 py-1 ring-1 ring-white/15 hover:bg-white/10 disabled:opacity-40"
            :disabled="!origin && !destination"
            @click="showPoints"
          >
            Ver en el mapa
          </button>
        </div>
        <p class="text-[11px] leading-snug text-white/45">
          Latitud planetocéntrica, longitud este (Mars 2000), como fija el contrato.
        </p>
      </div>
    </section>

    <!-- Perfil y límites -->
    <section>
      <h2 class="mb-2 text-xs font-semibold tracking-widest text-mars-300 uppercase">Perfil</h2>
      <div class="mb-2 grid grid-cols-2 gap-1 rounded-lg bg-white/5 p-1 text-xs">
        <button
          v-for="p in [
            ['eva_walk', '🧑‍🚀 EVA a pie'],
            ['rover', '🚙 Rover'],
          ]"
          :key="p[0]"
          class="rounded-md py-1 transition"
          :class="profile === p[0] ? 'bg-mars-500 text-white' : 'text-white/70 hover:bg-white/10'"
          @click="store.setProfile(p[0])"
        >
          {{ p[1] }}
        </button>
      </div>
      <div class="space-y-2 text-xs">
        <label class="block">
          <span class="flex justify-between text-white/70">
            Pendiente máxima <span class="font-mono text-white">{{ constraints.max_slope_deg }}°</span>
          </span>
          <input
            v-model.number="constraints.max_slope_deg"
            type="range"
            min="5"
            max="45"
            step="1"
            class="w-full accent-mars-500"
          />
        </label>
        <div class="grid grid-cols-2 gap-1.5">
          <label>
            <span class="text-white/70">Distancia máx. (m)</span>
            <input
              v-model.number="constraints.max_distance_m"
              type="number"
              min="100"
              step="100"
              class="mt-0.5 w-full rounded-md bg-white/5 px-2 py-1 font-mono ring-1 ring-white/10 focus:ring-mars-500 focus:outline-none"
            />
          </label>
          <label>
            <span class="text-white/70">Tiempo máx. (min)</span>
            <input
              v-model.number="constraints.max_duration_min"
              type="number"
              min="10"
              step="10"
              class="mt-0.5 w-full rounded-md bg-white/5 px-2 py-1 font-mono ring-1 ring-white/10 focus:ring-mars-500 focus:outline-none"
            />
          </label>
        </div>
        <label class="flex cursor-pointer items-center justify-between">
          <span class="text-white/70">Volver al origen</span>
          <input v-model="constraints.must_return_to_origin" type="checkbox" class="h-4 w-4 accent-mars-500" />
        </label>
      </div>
    </section>

    <!-- Preferencias (radiación destacada) -->
    <section>
      <h2 class="mb-2 text-xs font-semibold tracking-widest text-mars-300 uppercase">Prioridades</h2>
      <label
        class="mb-1.5 flex cursor-pointer items-start gap-2 rounded-lg p-2 ring-1 transition"
        :class="
          preferences.minimize_radiation
            ? 'bg-yellow-400/10 ring-yellow-300/40'
            : 'ring-white/10 hover:bg-white/5'
        "
      >
        <input v-model="preferences.minimize_radiation" type="checkbox" class="mt-0.5 h-4 w-4 accent-yellow-400" />
        <span class="text-xs">
          <span class="font-semibold">☢ Minimizar radiación</span>
          <span class="block text-white/55">
            Prefiere tramos con menos dosis estimada. Es un modelo (calibrado con Curiosity RAD,
            ~0,21 mGy/día en Gale), no una medición.
          </span>
        </span>
      </label>
      <label class="flex cursor-pointer items-center justify-between px-2 py-1 text-xs">
        <span class="text-white/70">Evitar terreno rugoso</span>
        <input v-model="preferences.avoid_rough_terrain" type="checkbox" class="h-4 w-4 accent-mars-500" />
      </label>
      <label class="flex cursor-pointer items-center justify-between px-2 py-1 text-xs">
        <span class="text-white/70">Usar datos térmicos (arena suelta)</span>
        <input v-model="preferences.consider_thermal_data" type="checkbox" class="h-4 w-4 accent-mars-500" />
      </label>
    </section>

    <!-- Acción -->
    <section class="space-y-2">
      <button
        class="w-full rounded-lg bg-mars-500 px-3 py-2 text-sm font-semibold text-white shadow-lg shadow-mars-500/20 transition hover:bg-mars-500/90 disabled:cursor-not-allowed disabled:opacity-40"
        :disabled="!canPlan"
        :title="!origin || !destination ? 'Fija origen y destino primero' : ''"
        @click="plan"
      >
        <span v-if="pending" class="inline-flex items-center gap-2">
          <span class="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />
          Calculando ruta…
        </span>
        <span v-else>Calcular ruta</span>
      </button>
      <button v-if="pending" class="w-full text-xs text-white/60 hover:text-white" @click="store.cancel()">
        Cancelar
      </button>
      <p v-if="!origin || !destination" class="text-center text-[11px] text-white/45">
        Fija origen y destino para activar el botón.
      </p>

      <div
        v-if="notice"
        class="rounded-lg p-2 text-xs ring-1"
        :class="
          notice.kind === 'info'
            ? 'bg-sky-500/10 text-sky-100 ring-sky-400/30'
            : 'bg-rose-500/10 text-rose-100 ring-rose-400/30'
        "
        role="status"
      >
        <span class="font-semibold">{{ notice.kind === 'info' ? '🛠 En desarrollo' : '⚠ No se pudo calcular' }}</span>
        <span class="block text-white/75">{{ notice.message }}</span>
        <code v-if="notice.kind === 'error'" class="mt-1 block text-[10px] text-white/45">{{ notice.code }}</code>
      </div>
    </section>

    <!-- Rutas planificadas + filtros -->
    <section>
      <h2 class="mb-2 flex items-center justify-between text-xs font-semibold tracking-widest text-mars-300 uppercase">
        Rutas planificadas
        <span v-if="routes.length" class="font-mono text-white/50 normal-case">
          {{ filteredRoutes.length }}/{{ routes.length }}
        </span>
      </h2>

      <p v-if="!routes.length" class="rounded-lg bg-white/5 p-2 text-xs text-white/50">
        Aún no hay rutas. Cada ruta que calcules aparecerá aquí para compararlas y filtrarlas por
        riesgo y radiación.
      </p>

      <template v-else>
        <div class="mb-2 space-y-2 rounded-lg bg-white/5 p-2 text-xs">
          <div>
            <span class="text-white/60">Riesgo máximo</span>
            <div class="mt-1 grid grid-cols-3 gap-1">
              <button
                v-for="r in ['low', 'moderate', 'high']"
                :key="r"
                class="flex items-center justify-center gap-1 rounded-md py-0.5 ring-1 transition"
                :class="filters.maxRisk === r ? 'bg-white/15 ring-white/30' : 'ring-white/10 hover:bg-white/10'"
                @click="filters.maxRisk = r"
              >
                <span class="h-2 w-2 rounded-full" :style="{ background: RISK_COLORS[r] }" />
                {{ RISK_LABELS[r] }}
              </button>
            </div>
          </div>
          <label class="flex items-center justify-between gap-2">
            <span class="text-white/60">Dosis máx. (µGy)</span>
            <input
              v-model="maxDoseUgy"
              type="number"
              min="0"
              step="1"
              placeholder="sin límite"
              class="w-24 rounded-md bg-white/5 px-2 py-0.5 text-right font-mono ring-1 ring-white/10 focus:ring-mars-500 focus:outline-none"
            />
          </label>
          <label class="flex cursor-pointer items-center justify-between">
            <span class="text-white/60">Ocultar rutas sin dato de radiación</span>
            <input v-model="filters.hideWithoutRadiation" type="checkbox" class="h-4 w-4 accent-mars-500" />
          </label>
          <label class="flex items-center justify-between gap-2">
            <span class="text-white/60">Ordenar por</span>
            <select
              v-model="filters.sortBy"
              class="rounded-md bg-mars-950 px-2 py-0.5 ring-1 ring-white/10 focus:ring-mars-500 focus:outline-none"
            >
              <option value="radiation">Menor radiación</option>
              <option value="distance">Menor distancia</option>
              <option value="time">Menor tiempo</option>
              <option value="recent">Más reciente</option>
            </select>
          </label>
        </div>

        <p v-if="!filteredRoutes.length" class="p-2 text-center text-xs text-white/50">
          Ninguna ruta cumple los filtros.
        </p>

        <ul class="space-y-1.5">
          <li v-for="route in filteredRoutes" :key="route.route_id">
            <div
              role="button"
              tabindex="0"
              class="w-full cursor-pointer rounded-lg p-2 text-left text-xs ring-1 transition"
              :class="
                route.route_id === selectedId ? 'bg-white/10 ring-mars-300/60' : 'ring-white/10 hover:bg-white/5'
              "
              @click="selectRoute(route)"
              @keydown.enter="selectRoute(route)"
            >
              <div class="flex items-center justify-between gap-2">
                <span class="flex items-center gap-1.5 font-semibold">
                  <span class="h-2.5 w-2.5 rounded-full" :style="{ background: RISK_COLORS[route.risk_level] }" />
                  Riesgo {{ RISK_LABELS[route.risk_level]?.toLowerCase() }}
                </span>
                <span class="flex items-center gap-1">
                  <span v-if="route.mock" class="rounded bg-violet-500/20 px-1 text-[10px] text-violet-200">Simulada</span>
                  <span
                    v-if="route.request?.preferences?.minimize_radiation"
                    class="rounded bg-yellow-400/15 px-1 text-[10px] text-yellow-200"
                    title="Calculada minimizando radiación"
                  >☢ min.</span>
                  <button
                    class="rounded px-1 text-white/40 hover:bg-white/10 hover:text-white"
                    title="Quitar de la lista"
                    @click.stop="store.removeRoute(route.route_id)"
                  >✕</button>
                </span>
              </div>
              <div class="mt-1 grid grid-cols-3 gap-1 font-mono text-white/80">
                <span title="Distancia">📏 {{ fmtDistance(route.metrics?.distance_m) }}</span>
                <span title="Tiempo total estimado">⏱ {{ fmtMinutes(route.metrics?.est_total_time_min) }}</span>
                <span :title="route.data_quality?.radiation === 'estimated' ? 'Dosis estimada (modelo)' : ''">
                  ☢ {{ fmtDose(route.metrics?.est_radiation_dose_mgy) }}
                </span>
              </div>
            </div>
          </li>
        </ul>
      </template>
    </section>

    <!-- Detalle de la ruta seleccionada -->
    <section v-if="selectedRoute" class="space-y-2 rounded-lg bg-white/5 p-2 text-xs">
      <h3 class="font-semibold text-mars-300">Detalle de la ruta</h3>

      <div v-if="selectedRoute.metrics?.est_radiation_dose_mgy != null" class="rounded-md bg-yellow-400/10 p-2 ring-1 ring-yellow-300/30">
        <span class="font-semibold">☢ {{ fmtDose(selectedRoute.metrics.est_radiation_dose_mgy) }}</span>
        <span class="text-white/60">
          ({{ selectedRoute.metrics.est_radiation_dose_mgy.toFixed(4) }} mGy)
          {{ selectedRoute.data_quality?.radiation === 'estimated' ? '· estimada' : '' }}
        </span>
        <span class="block text-white/55">
          ≈ {{ doseShareOfDay(selectedRoute.metrics.est_radiation_dose_mgy) }} % de la dosis diaria media
          en Gale (0,21 mGy/día).
        </span>
      </div>
      <p v-else class="text-white/50">☢ Radiación: el backend no envió dato para esta ruta.</p>

      <div>
        <span class="text-white/60">Alertas</span>
        <p v-if="!selectedRoute.warnings?.length" class="text-white/50">Sin alertas.</p>
        <ul v-else class="mt-1 space-y-1">
          <li v-for="(w, i) in selectedRoute.warnings" :key="i" class="flex gap-1.5">
            <span>{{ SEVERITY_ICON[w.severity] ?? '⚠️' }}</span>
            <span>
              {{ w.message }}
              <span v-if="w.distance_m != null" class="text-white/45">· a {{ fmtDistance(w.distance_m) }}</span>
            </span>
          </li>
        </ul>
      </div>

      <div v-if="selectedRoute.data_quality">
        <span class="text-white/60">Calidad de los datos</span>
        <div class="mt-1 flex flex-wrap gap-1">
          <span
            v-for="(q, k) in selectedRoute.data_quality"
            :key="k"
            class="rounded px-1.5 py-0.5 text-[10px]"
            :class="{
              'bg-emerald-500/15 text-emerald-200': q === 'available',
              'bg-amber-500/15 text-amber-200': q === 'partial' || q === 'estimated',
              'bg-white/10 text-white/50': q === 'unavailable',
            }"
          >
            {{ k }}: {{ QUALITY_LABELS[q] ?? q }}
          </span>
        </div>
      </div>

      <p class="font-mono text-[10px] text-white/35">
        {{ selectedRoute.route_id }} · {{ fmtCoord(selectedRoute.request?.origin?.latitude) }},
        {{ fmtCoord(selectedRoute.request?.origin?.longitude) }} →
        {{ fmtCoord(selectedRoute.request?.destination?.latitude) }},
        {{ fmtCoord(selectedRoute.request?.destination?.longitude) }}
      </p>
    </section>
  </div>
</template>
