<script setup>
import { onBeforeUnmount, onMounted, ref, toRaw, watch } from 'vue'

import { getBaseMap, ION_CONFIG } from '@/config/mars'
import {
  createMarsViewer,
  createRouteLayer,
  flyHome,
  flyToLandmark,
  loadTerrain3D,
  setBaseMap,
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
})

const emit = defineEmits(['status', 'cursor', 'pick'])

const container = ref(null)

// Objetos de Cesium fuera del sistema reactivo de Vue (envolverlos en proxies es caro y rompe cosas).
let viewer = null
let tileset = null
let cursor = null
let clicks = null
let routeLayer = null

function drawRoutes() {
  if (routeLayer && props.routeScene) routeLayer.draw(toRaw(props.routeScene))
}

onMounted(async () => {
  viewer = createMarsViewer(container.value, getBaseMap(props.baseMapId))
  cursor = trackCursor(viewer, (pos) => emit('cursor', pos))
  clicks = trackClick(viewer, (pos) => pos && emit('pick', pos))
  routeLayer = createRouteLayer(viewer)
  drawRoutes()
  flyHome(viewer, 0)

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

defineExpose({
  flyHome: () => viewer && flyHome(viewer),
  flyTo: (landmark) => viewer && flyToLandmark(viewer, landmark),
  /** points: [[lon, lat], …] */
  flyToPoints: (points) => routeLayer?.flyTo(points),
})
</script>

<template>
  <div ref="container" class="h-full w-full" :class="{ 'cursor-crosshair': picking }" />
</template>
