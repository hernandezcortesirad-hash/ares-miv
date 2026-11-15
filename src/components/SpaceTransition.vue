<script setup>
// Transición login → visor: un viaje por el sistema solar dibujado en <canvas> (sin imágenes).
//   0.0–1.0 s  salida: las estrellas se estiran al acelerar y el Sol pasa por un lado
//   1.0–2.0 s  crucero interplanetario a máxima velocidad
//   2.0–3.2 s  aproximación: se frena y Marte crece en el centro
// Al final se funde con el Marte 3D real (que espera en el mismo punto de la pantalla) y emite
// 'arrive' para que empiece el acercamiento de la cámara, y 'done' cuando ya no se ve.
//
// Rendimiento: las estrellas se dibujan agrupadas (un trazo por grupo de brillo, no uno por
// estrella), el lienzo es opaco y la opacidad y el texto se cambian directamente en el DOM, sin
// pasar por Vue en cada fotograma.
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'

const props = defineProps({
  /**
   * Empezar el viaje. Mientras es false se muestra una pantalla quieta («Estableciendo enlace…»):
   * así la carga pesada del visor 3D no coincide con la animación y no la traba.
   */
  go: { type: Boolean, default: true },
})
const emit = defineEmits(['arrive', 'done'])

const TOTAL_MS = 3200
const ARRIVE_MS = 2500 // empieza el vuelo de la cámara mientras el lienzo se desvanece
const FADE_FROM_MS = 2600
const STAGES = [
  { until: 1000, text: 'Saliendo de la órbita terrestre' },
  { until: 2000, text: 'Crucero interplanetario' },
  { until: Infinity, text: 'Aproximación a Marte' },
]
const STAR_COUNT = 520
/** Grupos de brillo/grosor: cada uno se dibuja con un solo trazo por fotograma. */
const BANDS = [
  { maxNear: 0.35, alpha: 0.3, width: 0.7 },
  { maxNear: 0.6, alpha: 0.5, width: 1 },
  { maxNear: 0.82, alpha: 0.75, width: 1.4 },
  { maxNear: 1.01, alpha: 1, width: 1.9 },
]

const root = ref(null)
const canvas = ref(null)
const stageEl = ref(null)
let frame = 0
let arrived = false
let onResize = null
let stopWatch = null

const smooth = (x) => x * x * (3 - 2 * x) // suavizado 0–1
const clamp01 = (x) => Math.max(0, Math.min(1, x))

/** Velocidad de la nave (unidades de profundidad por segundo) según el momento. */
function speedAt(t) {
  if (t < 900) return 0.15 + 2.6 * smooth(t / 900)
  if (t < 1900) return 2.75
  return 0.15 + 2.6 * (1 - smooth(clamp01((t - 1900) / 1100)))
}

onMounted(() => {
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
    emit('arrive')
    emit('done')
    return
  }
  const el = canvas.value
  const ctx = el.getContext('2d', { alpha: false })
  const dpr = Math.min(1.5, window.devicePixelRatio || 1)
  let W = 0
  let H = 0
  const resize = () => {
    W = el.clientWidth
    H = el.clientHeight
    el.width = Math.round(W * dpr)
    el.height = Math.round(H * dpr)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.lineCap = 'round'
  }
  resize()
  onResize = resize
  window.addEventListener('resize', resize)

  // Estrellas en un volumen delante de la cámara: (x, y) en [-1, 1], z en (0, 1].
  const stars = Array.from({ length: STAR_COUNT }, () => ({
    x: Math.random() * 2 - 1,
    y: Math.random() * 2 - 1,
    z: Math.random() * 0.95 + 0.05,
  }))

  let start = 0
  let prev = 0
  let lastStage = -1

  const draw = (now, still = false) => {
    const t = still ? 0 : now - start
    const dt = still ? 0 : Math.min(0.05, (now - prev) / 1000)
    prev = now
    const cx = W / 2
    const cy = H / 2
    const half = Math.min(W, H) * 0.45
    const step = speedAt(t) * dt * 0.35

    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, W, H)

    // Estrellas: un trazo por grupo; cada estrella añade su segmento (posición anterior → nueva).
    const paths = BANDS.map(() => new Path2D())
    for (const s of stars) {
      const zPrev = s.z
      s.z -= step
      if (s.z <= 0.02) {
        s.x = Math.random() * 2 - 1
        s.y = Math.random() * 2 - 1
        s.z = 1
        continue
      }
      const near = 1 - s.z
      const p = paths[BANDS.findIndex((b) => near < b.maxNear)]
      p.moveTo(cx + (s.x / zPrev) * half, cy + (s.y / zPrev) * half)
      p.lineTo(cx + (s.x / s.z) * half, cy + (s.y / s.z) * half)
    }
    ctx.strokeStyle = '#e8eefc'
    BANDS.forEach((b, i) => {
      ctx.globalAlpha = b.alpha
      ctx.lineWidth = b.width
      ctx.stroke(paths[i])
    })
    ctx.globalAlpha = 1

    // El Sol pasa por la izquierda al salir.
    const sunK = clamp01(t / 1300)
    if (sunK < 1) {
      const sx = W * (0.18 - 0.4 * smooth(sunK))
      const sy = H * 0.32
      const r = Math.min(W, H) * (0.18 + 0.25 * sunK)
      const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, r)
      g.addColorStop(0, `rgba(255, 244, 214, ${0.9 * (1 - sunK)})`)
      g.addColorStop(0.25, `rgba(255, 196, 102, ${0.45 * (1 - sunK)})`)
      g.addColorStop(1, 'rgba(255, 140, 40, 0)')
      ctx.fillStyle = g
      ctx.fillRect(sx - r, sy - r, r * 2, r * 2)
    }

    // Marte crece en el centro hasta el tamaño con el que lo muestra el visor 3D al llegar.
    const marsK = clamp01((t - 1500) / 1700)
    if (marsK > 0) {
      // ≈ tamaño en pantalla del Marte 3D a 60 000 km (introStartView), para que el fundido no se note.
      const r = 0.5 + H * 0.075 * smooth(marsK)
      const glow = ctx.createRadialGradient(cx, cy, r * 0.9, cx, cy, r * 2.4)
      glow.addColorStop(0, 'rgba(231, 111, 61, 0.35)')
      glow.addColorStop(1, 'rgba(231, 111, 61, 0)')
      ctx.fillStyle = glow
      ctx.fillRect(cx - r * 2.4, cy - r * 2.4, r * 4.8, r * 4.8)
      const body = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.35, r * 0.1, cx, cy, r)
      body.addColorStop(0, '#e9a074')
      body.addColorStop(0.6, '#b8562e')
      body.addColorStop(1, '#4a1a0c')
      ctx.fillStyle = body
      ctx.beginPath()
      ctx.arc(cx, cy, r, 0, Math.PI * 2)
      ctx.fill()
    }

    // Fotograma quieto (esperando a que el visor esté listo): el texto sigue en «Estableciendo enlace».
    if (still) return

    // Texto y opacidad directamente en el DOM (sin re-render de Vue por fotograma).
    const si = STAGES.findIndex((s) => t < s.until)
    if (si !== lastStage && stageEl.value) {
      lastStage = si
      stageEl.value.textContent = STAGES[si].text
    }
    if (root.value) {
      root.value.style.opacity = String(1 - smooth(clamp01((t - FADE_FROM_MS) / (TOTAL_MS - FADE_FROM_MS))))
    }
    if (!arrived && t >= ARRIVE_MS) {
      arrived = true
      emit('arrive')
    }
    if (t >= TOTAL_MS) {
      emit('done')
      return
    }
    frame = requestAnimationFrame(draw)
  }
  // Primer fotograma quieto (estrellas como puntos) hasta que llegue la orden de empezar.
  draw(performance.now(), true)
  const begin = () => {
    if (start) return
    stageEl.value?.classList.remove('animate-pulse')
    start = performance.now()
    prev = start
    frame = requestAnimationFrame(draw)
  }
  if (props.go) begin()
  else stopWatch = watch(() => props.go, (go) => go && begin())
})

onBeforeUnmount(() => {
  cancelAnimationFrame(frame)
  stopWatch?.()
  if (onResize) window.removeEventListener('resize', onResize)
})
</script>

<template>
  <div ref="root" class="pointer-events-none absolute inset-0 z-30 will-change-[opacity]" aria-hidden="true">
    <canvas ref="canvas" class="h-full w-full" />
    <div class="absolute inset-x-0 bottom-[16%] flex flex-col items-center gap-2 text-center">
      <p class="text-sm font-semibold tracking-[0.35em]">ARES<span class="text-mars-500">-MIV</span></p>
      <p ref="stageEl" class="animate-pulse font-mono text-[11px] tracking-[0.25em] text-white/60 uppercase">
        {{ go ? STAGES[0].text : 'Estableciendo enlace con Marte…' }}
      </p>
    </div>
  </div>
</template>
