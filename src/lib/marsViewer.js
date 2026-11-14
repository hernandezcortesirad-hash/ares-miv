// Todo lo que toca Cesium vive aquí; los componentes Vue solo llaman a estas funciones.
import {
  BoundingSphere,
  Cartesian3,
  Cesium3DTileset,
  Color,
  Credit,
  Ellipsoid,
  EllipsoidTerrainProvider,
  GeographicTilingScheme,
  Globe,
  HeadingPitchRange,
  ImageryLayer,
  Ion,
  Math as CesiumMath,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  UrlTemplateImageryProvider,
  Viewer,
} from 'cesium'

import { HOME_VIEW } from '@/config/mars'

// Debe fijarse antes de crear cualquier objeto de Cesium: las proyecciones, la cámara
// y las conversiones de coordenadas usan Ellipsoid.default internamente.
// Ellipsoid.MARS = IAU 2000 Mars (a = b = 3 396 190 m, c = 3 376 200 m).
Ellipsoid.default = Ellipsoid.MARS
const MARS = Ellipsoid.MARS

const SURFACE_COLOR = Color.fromCssColorString('#3b1d12')

function createBaseLayer(baseMap) {
  const provider = new UrlTemplateImageryProvider({
    url: baseMap.url,
    tilingScheme: new GeographicTilingScheme({ ellipsoid: MARS }),
    maximumLevel: baseMap.maximumLevel,
    credit: new Credit(baseMap.credit),
  })
  return new ImageryLayer(provider)
}

/** Crea el visor con Marte como planeta, sin widgets pensados para la Tierra. */
export function createMarsViewer(container, baseMap) {
  const viewer = new Viewer(container, {
    globe: new Globe(MARS),
    terrainProvider: new EllipsoidTerrainProvider({ ellipsoid: MARS }),
    baseLayer: createBaseLayer(baseMap),
    baseLayerPicker: false,
    geocoder: false,
    homeButton: false,
    sceneModePicker: false,
    navigationHelpButton: false,
    fullscreenButton: false,
    timeline: false,
    animation: false,
    infoBox: false,
    selectionIndicator: false,
  })

  const { scene } = viewer
  // La atmósfera, la niebla y la Luna de Cesium están calibradas para la Tierra.
  // (Con un elipsoide no terrestre Cesium ya omite algunos, por eso las comprobaciones.)
  if (scene.skyAtmosphere) scene.skyAtmosphere.show = false
  scene.globe.showGroundAtmosphere = false
  if (scene.fog) scene.fog.enabled = false
  if (scene.moon) scene.moon.show = false
  scene.backgroundColor = Color.BLACK
  scene.globe.baseColor = SURFACE_COLOR
  scene.globe.enableLighting = false
  scene.globe.depthTestAgainstTerrain = true
  scene.screenSpaceCameraController.minimumZoomDistance = 50

  return viewer
}

export function setBaseMap(viewer, baseMap) {
  const layers = viewer.imageryLayers
  const current = layers.get(0)
  layers.add(createBaseLayer(baseMap), 0)
  if (current) layers.remove(current, true)
}

/**
 * Carga el terreno 3D de Marte desde Cesium ion. Sin token, se queda con el elipsoide e imagen.
 * Devuelve { mode: 'terrain3d' | 'imagery', tileset?, message }.
 */
export async function loadTerrain3D(viewer, { token, marsAssetId }) {
  if (!token) {
    return {
      mode: 'imagery',
      message: 'Sin token de Cesium ion: se muestra la imagen sobre el elipsoide, sin relieve 3D.',
    }
  }

  Ion.defaultAccessToken = token
  try {
    const tileset = await Cesium3DTileset.fromIonAssetId(marsAssetId, {
      // Impide que la cámara atraviese el terreno.
      enableCollision: true,
    })
    if (viewer.isDestroyed()) {
      tileset.destroy()
      return { mode: 'imagery', message: '' }
    }
    viewer.scene.primitives.add(tileset)
    setTerrain3D(viewer, tileset, true)
    return { mode: 'terrain3d', tileset, message: 'Relieve 3D de Marte (Cesium ion) activo.' }
  } catch (err) {
    console.error('[ARES-MIV] No se pudo cargar el terreno 3D de Marte:', err)
    return {
      mode: 'imagery',
      message: `No se pudo cargar el relieve 3D (asset ${marsAssetId}): ${err?.message ?? err}`,
    }
  }
}

/** Alterna entre el terreno 3D (tileset) y el globo con mapa base. */
export function setTerrain3D(viewer, tileset, enabled) {
  tileset.show = enabled
  viewer.scene.globe.show = !enabled
}

/** Lat/lon (grados) y altura (m) del punto bajo una posición de pantalla, o null. */
export function pickCartographic(viewer, windowPosition) {
  const { scene } = viewer
  let cartesian
  if (scene.globe.show) {
    const ray = scene.camera.getPickRay(windowPosition)
    cartesian = ray && scene.globe.pick(ray, scene)
  } else if (scene.pickPositionSupported) {
    cartesian = scene.pickPosition(windowPosition)
  }
  if (!cartesian) return null

  const carto = MARS.cartesianToCartographic(cartesian)
  if (!carto) return null
  return {
    lat: CesiumMath.toDegrees(carto.latitude),
    lon: CesiumMath.toDegrees(carto.longitude),
    // Con el globo liso la altura no es significativa (sin modelo de elevación).
    height: scene.globe.show ? null : carto.height,
  }
}

/** Llama a onMove con la posición geográfica bajo el cursor (como mucho una vez por fotograma). */
export function trackCursor(viewer, onMove) {
  const handler = new ScreenSpaceEventHandler(viewer.scene.canvas)
  let pending = null
  let frame = 0
  handler.setInputAction((movement) => {
    pending = movement.endPosition
    if (frame) return
    frame = requestAnimationFrame(() => {
      frame = 0
      if (!viewer.isDestroyed()) onMove(pickCartographic(viewer, pending))
    })
  }, ScreenSpaceEventType.MOUSE_MOVE)

  return {
    destroy() {
      if (frame) cancelAnimationFrame(frame)
      handler.destroy()
    },
  }
}

export function flyHome(viewer, duration = 2) {
  viewer.camera.flyTo({
    destination: Cartesian3.fromDegrees(HOME_VIEW.lon, HOME_VIEW.lat, HOME_VIEW.height, MARS),
    duration,
  })
}

/** Vuela a un lugar con vista oblicua para apreciar el relieve. */
export function flyToLandmark(viewer, { lat, lon, range }) {
  const center = Cartesian3.fromDegrees(lon, lat, 0, MARS)
  viewer.camera.flyToBoundingSphere(new BoundingSphere(center, 0), {
    offset: new HeadingPitchRange(0, CesiumMath.toRadians(-35), range),
    duration: 3,
  })
}
