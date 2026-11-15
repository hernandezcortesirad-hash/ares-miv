<script setup>
import { onBeforeUnmount, onMounted, ref, toRaw, watch } from 'vue'

import { getBaseMap, ION_CONFIG } from '@/config/mars'
import {
  createMarsViewer,
  createRouteLayer,
  flyHome,
  flyToLandmark,
  introFlight,
  introStartView,
  loadTerrain3D,
  setBaseMap,
  sampleTerrainHeights,
  setTerrain3D,
  trackClick,
  trackCursor,
} from '@/lib/marsViewer'

const props = defineProps({
  baseMapId: { type: String, required: true },
  terrain3d: { type: Boolean, default: true },
  /** { origin, destination, routes, selectedId } — lo que dibuja la capa de rutas. */
  routeScene: { type: Object, default: null },
  /** Cursor en cruz mientras se elige un punto en el mapa. */
  picking: { type: Boolean, default: false },
  /**
   * Ritmo bajo de dibujo (mientras otra animación tapa el visor, p. ej. la transición de entrada):
   * Cesium sigue cargando el relieve pero deja el procesador libre para esa animación.
   */
  throttled: { type: Boolean, default: false },
})

const emit = defineEmits(['status', 'cursor', 'pick', 'intro-done'])

const container = ref(null)

// Objetos de Cesium fuera del sistema reactivo de Vue (envolverlos en proxies es caro y rompe cosas).
let viewer = null
let tileset = null
let cursor = null
let clicks = null
let routeLayer = null

/**
 * Pausa el dibujo de Cesium mientras otra animación tapa el visor (no se ve y cada fotograma
 * compite por el procesador); lo reanuda al terminar. La carga del relieve ya se hizo antes.
 */
function applyThrottle(on) {
  if (viewer && !viewer.isDestroyed()) viewer.useDefaultRenderLoop = !on
}
watch(
  () => props.throttled,
  (on) => applyThrottle(on),
)

const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

/** Al montar: Marte espera lejos (o directamente en la vista inicial si se pidió menos movimiento). */
function prepareIntro() {
  if (reducedMotion()) {
    flyHome(viewer, 0)
    emit('intro-done')
  } else {
    introStartView(viewer)
  }
}

/** Llamado por la vista al terminar el viaje por el sistema solar: acercamiento final a Marte. */
async function startIntro() {
  if (!viewer || reducedMotion()) return
  await introFlight(viewer)
  if (viewer) emit('intro-done')
}

function drawRoutes() {
  if (routeLayer && props.routeScene) routeLayer.draw(toRaw(props.routeScene))
}

onMounted(async () => {
  viewer = createMarsViewer(container.value, getBaseMap(props.baseMapId))
  cursor = trackCursor(viewer, (pos) => emit('cursor', pos))
  clicks = trackClick(viewer, (pos) => pos && emit('pick', pos))
  routeLayer = createRouteLayer(viewer)
  applyThrottle(props.throttled)
  drawRoutes()
  prepareIntro()

  emit('status', { mode: 'loading', message: 'Cargando relieve 3D…' })
  const result = await loadTerrain3D(viewer, ION_CONFIG)
  if (!viewer) return // desmontado durante la carga

  tileset = result.tileset ?? null
  if (tileset) setTerrain3D(viewer, tileset, props.terrain3d)
  emit('status', { mode: result.mode, message: result.message })
})

watch(
  () => props.baseMapId,
  (id) => viewer && setBaseMap(viewer, getBaseMap(id)),
)

watch(
  () => props.terrain3d,
  (enabled) => viewer && tileset && setTerrain3D(viewer, tileset, enabled),
)

// deep: el panel cambia rutas, selección y puntos por dentro del objeto.
watch(() => props.routeScene, drawRoutes, { deep: true })

onBeforeUnmount(() => {
  cursor?.destroy()
  clicks?.destroy()
  routeLayer?.destroy()
  viewer?.destroy()
  viewer = null
  tileset = null
  routeLayer = null
})

/**
 * Alturas del relieve 3D (para el simulador de rover). Si el relieve está oculto (mapa base
 * visible), se muestra un momento mientras se mide y luego se restaura. null = sin relieve 3D.
 */
async function sampleHeights(points, opts) {
  if (!viewer || !tileset) return null
  const wasShown = tileset.show
  tileset.show = true
  try {
    return await sampleTerrainHeights(viewer, points, opts)
  } finally {
    if (tileset) tileset.show = wasShown
  }
}

defineExpose({
  startIntro,
  sampleHeights,
  flyHome: () => viewer && flyHome(viewer),
  flyTo: (landmark) => viewer && flyToLandmark(viewer, landmark),
  /** points: [[lon, lat], …] */
  flyToPoints: (points) => routeLayer?.flyTo(points),
  /** Explorador animado: [lon, lat] o null para ocultarlo; kind 'eva' | 'rover'. */
  setMover: (lonLat, kind) => routeLayer?.setMover(lonLat, kind),
  /** Igual, pero solo si la cámara está lejos (más alta que minHeightM): no estorba de cerca. */
  flyToPointsIfFar: (points, minHeightM) => {
    if (viewer && viewer.camera.positionCartographic.height > minHeightM) routeLayer?.flyTo(points)
  },
})
</script>

<template>
  <div ref="container" class="h-full w-full" :class="{ 'cursor-crosshair': picking }" />
</template>
