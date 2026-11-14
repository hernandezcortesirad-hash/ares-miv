<script setup>
import { computed, ref, watch } from 'vue'

const props = defineProps({
  /** Objeto `legend` del mapa base activo (ver config/mars.js). */
  legend: { type: Object, required: true },
})

const emit = defineEmits(['fly-to'])

const STORAGE_KEY = 'ares-miv:legend'

// Preferencias por visitante: si la leyenda está abierta y si ya vio la explicación.
function loadPrefs() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) ?? {}
  } catch {
    return {}
  }
}
const prefs = loadPrefs()
const open = ref(prefs.open ?? true)
// La primera vez se despliega «¿Por qué importa?» para que se entienda el mapa.
const showTips = ref(prefs.seenTips !== true)
const activeClass = ref(null)

watch([open, showTips], () => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ open: open.value, seenTips: true }))
  } catch {
    /* almacenamiento no disponible: no pasa nada */
  }
})

const gradientCss = computed(() =>
  props.legend.gradient ? `linear-gradient(to right, ${props.legend.gradient.join(', ')})` : '',
)

function swatchCss(colors) {
  return `linear-gradient(135deg, ${colors.join(', ')})`
}
</script>

<template>
  <!-- Minimizada: solo un botón -->
  <button
    v-if="!open"
    class="flex items-center gap-2 rounded-xl bg-mars-950/85 px-3 py-2 text-sm ring-1 ring-white/10 backdrop-blur transition hover:bg-mars-900"
    aria-label="Mostrar leyenda del mapa"
    @click="open = true"
  >
    <span
      v-if="legend.gradient"
      class="h-3 w-10 rounded-full"
      :style="{ background: gradientCss }"
    />
    <span>¿Cómo leer el mapa?</span>
  </button>

  <section
    v-else
    class="max-h-[calc(100vh-9rem)] w-80 max-w-[calc(100vw-2rem)] overflow-y-auto rounded-xl bg-mars-950/85 p-4 text-sm ring-1 ring-white/10 backdrop-blur"
    aria-label="Leyenda del mapa"
  >
    <header class="mb-3 flex items-start justify-between gap-2">
      <div>
        <h2 class="font-semibold">{{ legend.title }}</h2>
        <p class="text-xs text-white/50">{{ legend.subtitle }}</p>
      </div>
      <button
        class="-mt-1 -mr-1 rounded-lg px-2 py-1 text-white/50 hover:bg-white/10 hover:text-white"
        aria-label="Minimizar leyenda"
        title="Minimizar"
        @click="open = false"
      >
        —
      </button>
    </header>

    <!-- Mapas sin escala de color (p. ej. Viking) -->
    <p v-if="legend.note" class="leading-relaxed text-white/75">{{ legend.note }}</p>

    <template v-if="legend.gradient">
      <!-- Barra de color continua -->
      <div class="mb-1 h-3 w-full rounded-full ring-1 ring-white/10" :style="{ background: gradientCss }" />
      <div class="mb-4 flex justify-between font-mono text-[11px] text-white/50">
        <span>{{ legend.lowLabel }} · Bajo</span>
        <span>Medio</span>
        <span>Alto · {{ legend.highLabel }}</span>
      </div>

      <!-- Clases con ejemplo navegable -->
      <ul class="space-y-1">
        <li v-for="c in legend.classes" :key="c.id">
          <button
            class="group flex w-full items-start gap-3 rounded-lg p-2 text-left transition hover:bg-white/5"
            :class="{ 'bg-white/5': activeClass === c.id }"
            :title="`Volar a ${c.example.text}`"
            @click="activeClass = c.id; emit('fly-to', c.example.landmarkId)"
          >
            <span
              class="mt-0.5 h-5 w-5 shrink-0 rounded-md ring-1 ring-white/20"
              :style="{ background: swatchCss(c.swatch) }"
            />
            <span class="min-w-0 flex-1">
              <span class="block font-medium">{{ c.label }}</span>
              <span class="block text-xs text-white/60">{{ c.meaning }}</span>
              <span
                class="mt-0.5 inline-flex items-center gap-1 text-xs text-mars-300 group-hover:underline"
              >
                Ver ejemplo: {{ c.example.text }} →
              </span>
            </span>
          </button>
        </li>
      </ul>

      <!-- Mini introducción: por qué importa para la misión -->
      <div class="mt-3 border-t border-white/10 pt-3">
        <button
          class="flex w-full items-center justify-between text-xs font-semibold tracking-widest text-mars-300 uppercase"
          :aria-expanded="showTips"
          @click="showTips = !showTips"
        >
          ¿Por qué importa para la misión?
          <span class="transition" :class="{ 'rotate-180': showTips }">▾</span>
        </button>
        <ul v-if="showTips" class="mt-2 space-y-2">
          <li v-for="tip in legend.tips" :key="tip.title" class="flex gap-2">
            <span class="text-base leading-5" aria-hidden="true">{{ tip.icon }}</span>
            <span>
              <span class="block text-xs font-medium">{{ tip.title }}</span>
              <span class="block text-xs leading-relaxed text-white/60">{{ tip.text }}</span>
            </span>
          </li>
        </ul>
      </div>
    </template>
  </section>
</template>
