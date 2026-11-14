<script setup>
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'

import { getBaseMap, ION_CONFIG } from '@/config/mars'
import {
  createMarsViewer,
  flyHome,
  flyToLandmark,
  loadTerrain3D,
  setBaseMap,
  setTerrain3D,
  trackCursor,
} from '@/lib/marsViewer'

const props = defineProps({
  baseMapId: { type: String, required: true },
  terrain3d: { type: Boolean, default: true },
})

const emit = defineEmits(['status', 'cursor'])

const container = ref(null)

// Objetos de Cesium fuera del sistema reactivo de Vue (envolverlos en proxies es caro y rompe cosas).
let viewer = null
let tileset = null
let cursor = null

onMounted(async () => {
  viewer = createMarsViewer(container.value, getBaseMap(props.baseMapId))
  cursor = trackCursor(viewer, (pos) => emit('cursor', pos))
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

onBeforeUnmount(() => {
  cursor?.destroy()
  viewer?.destroy()
  viewer = null
  tileset = null
})

defineExpose({
  flyHome: () => viewer && flyHome(viewer),
  flyTo: (landmark) => viewer && flyToLandmark(viewer, landmark),
})
</script>

<template>
  <div ref="container" class="h-full w-full" />
</template>
