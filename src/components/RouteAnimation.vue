<script setup>
// Animación del recorrido de la ruta seleccionada: un icono (astronauta o rover) avanza de A a B
// sobre la línea y la barra muestra el tiempo simulado. El tiempo sale de la ruta (API para el
// astronauta, velocidades de JPL para el rover): la animación solo lo acelera.
import { Bot, Footprints, Pause, Play, RotateCcw } from 'lucide-vue-next'
import { computed, onBeforeUnmount, ref, watch } from 'vue'

import { buildTimeline, pathInterpolator, stateAt } from '@/lib/routeTimeline'

const props = defineProps({
  /** Ruta seleccionada (modelo de la interfaz) o null. */
  route: { type: Object, default: null },
})
const emit = defineEmits(['move'])

/** Duración real de la animación a velocidad ×1 (s). */
const BASE_SECONDS = 15
const SPEEDS = [0.5, 1, 2, 4]

const timeline = computed(() => buildTimeline(props.route))
const interpolate = computed(() =>
  props.route?.geometry?.coordinates?.length ? pathInterpolator(props.route.geometry.coordinates) : null,
)
const isRover = computed(() => props.route?.kind === 'rover')

const simMin = ref(0)
const playing = ref(false)
const speed = ref(1)
let frame = 0
let last = 0

const state = computed(() => (timeline.value ? stateAt(timeline.value, simMin.value) : null))
const done = computed(() => timeline.value && simMin.value >= timeline.value.totalMin)
const restIndex = computed(() => {
  if (!timeline.value || state.value?.kind !== 'rest') return 0
  return timeline.value.phases.filter((p) => p.kind === 'rest' && p.t0 <= simMin.value).length
})

const statusText = computed(() => {
  if (!state.value) return ''
  if (done.value) return isRover.value ? 'El rover llegó a B' : 'El astronauta llegó a B'
  if (state.value.kind === 'rest') return `Descansando · parada ${restIndex.value}`
  return isRover.value ? 'Rover conduciendo' : 'Astronauta caminando'
})

/** Minutos simulados que pasan por cada segundo real. */
const minutesPerSecond = computed(() => (timeline.value ? (timeline.value.totalMin / BASE_SECONDS) * speed.value : 0))

function place() {
  if (!timeline.value || !interpolate.value) return emit('move', null, null)
  emit('move', interpolate.value(state.value.fraction), isRover.value ? 'rover' : 'eva')
}

function tick(now) {
  if (!playing.value) return
  const dt = last ? (now - last) / 1000 : 0
  last = now
  simMin.value = Math.min(timeline.value.totalMin, simMin.value + dt * minutesPerSecond.value)
  place()
  if (simMin.value >= timeline.value.totalMin) {
    playing.value = false
    return
  }
  frame = requestAnimationFrame(tick)
}

function play() {
  if (!timeline.value) return
  if (done.value) simMin.value = 0
  playing.value = true
  last = 0
  cancelAnimationFrame(frame)
  frame = requestAnimationFrame(tick)
}
function pause() {
  playing.value = false
  cancelAnimationFrame(frame)
}
function restart() {
  simMin.value = 0
  place()
  play()
}
function seek(event) {
  if (!timeline.value) return
  simMin.value = (Number(event.target.value) / 1000) * timeline.value.totalMin
  place()
}

// Ruta nueva o distinta: empieza desde A y se reproduce sola.
watch(
  () => props.route?.route_id,
  (id) => {
    pause()
    simMin.value = 0
    if (id && timeline.value) {
      place()
      play()
    } else {
      emit('move', null, null)
    }
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  pause()
  emit('move', null, null)
})

function fmtMin(min) {
  if (typeof min !== 'number') return '—'
  const total = Math.round(min) // igual que el resto de la interfaz (33.7 → 34 min)
  const h = Math.floor(total / 60)
  const m = total % 60
  return h ? `${h} h ${String(m).padStart(2, '0')} min` : `${m} min`
}
</script>

<template>
  <div
    v-if="route && timeline"
    class="w-[min(30rem,calc(100vw-2rem))] rounded-2xl bg-mars-950/90 px-3 py-2 text-xs shadow-lg ring-1 backdrop-blur-md"
    :class="isRover ? 'ring-cyan-400/30' : 'ring-amber-400/30'"
    role="group"
    aria-label="Animación del recorrido"
  >
    <div class="flex items-center gap-2">
      <span
        class="grid size-7 shrink-0 place-items-center rounded-full text-black"
        :class="isRover ? 'bg-cyan-400' : 'bg-amber-400'"
      >
        <component :is="isRover ? Bot : Footprints" class="size-4" aria-hidden="true" />
      </span>
      <div class="min-w-0 flex-1">
        <div class="flex items-baseline justify-between gap-2">
          <span class="truncate font-semibold">{{ statusText }}</span>
          <span class="shrink-0 font-mono tabular-nums">
            {{ fmtMin(simMin) }} <span class="text-white/45">/ {{ fmtMin(timeline.totalMin) }}</span>
          </span>
        </div>
        <input
          type="range"
          min="0"
          max="1000"
          :value="timeline.totalMin ? (simMin / timeline.totalMin) * 1000 : 0"
          class="mt-1 w-full"
          :class="isRover ? 'accent-cyan-400' : 'accent-amber-400'"
          aria-label="Posición en el recorrido"
          @input="seek"
        />
      </div>
    </div>
    <div class="mt-1 flex items-center justify-between gap-2">
      <span class="flex items-center gap-1">
        <button
          type="button"
          class="rounded-md p-1 ring-1 ring-white/15 hover:bg-white/10"
          :title="playing ? 'Pausar' : 'Reproducir'"
          :aria-label="playing ? 'Pausar' : 'Reproducir'"
          @click="playing ? pause() : play()"
        >
          <component :is="playing ? Pause : Play" class="size-3.5" aria-hidden="true" />
        </button>
        <button
          type="button"
          class="rounded-md p-1 ring-1 ring-white/15 hover:bg-white/10"
          title="Repetir desde A"
          aria-label="Repetir desde A"
          @click="restart"
        >
          <RotateCcw class="size-3.5" aria-hidden="true" />
        </button>
        <span class="ml-1 flex overflow-hidden rounded-md ring-1 ring-white/15">
          <button
            v-for="s in SPEEDS"
            :key="s"
            type="button"
            class="px-1.5 py-0.5 font-mono"
            :class="speed === s ? 'bg-white/15 text-white' : 'text-white/55 hover:bg-white/10'"
            @click="speed = s"
          >×{{ s }}</button>
        </span>
      </span>
      <span class="text-right text-[10px] text-white/45">
        Acelerado: 1 s ≈ {{ fmtMin(minutesPerSecond) }}
        · {{ isRover ? 'tiempo estimado (JPL)' : 'tiempo de la API' }}
      </span>
    </div>
  </div>
</template>
