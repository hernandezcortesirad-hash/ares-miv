// Todo lo que toca Cesium vive aquí; los componentes Vue solo llaman a estas funciones.
import {
  BoundingSphere,
  Cartesian2,
  Cartesian3,
  Cesium3DTileset,
  ClassificationType,
  Color,
  Credit,
  CustomDataSource,
  DistanceDisplayCondition,
  Ellipsoid,
  EllipsoidTerrainProvider,
  GeographicTilingScheme,
  Globe,
  HeadingPitchRange,
  HeightReference,
  ImageryLayer,
  Ion,
  LabelStyle,
  Math as CesiumMath,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  UrlTemplateImageryProvider,
  Viewer,
  VerticalOrigin,
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

/** Llama a onClick con la posición geográfica del clic izquierdo (o null fuera de Marte). */
export function trackClick(viewer, onClick) {
  const handler = new ScreenSpaceEventHandler(viewer.scene.canvas)
  handler.setInputAction((ev) => {
    if (!viewer.isDestroyed()) onClick(pickCartographic(viewer, ev.position))
  }, ScreenSpaceEventType.LEFT_CLICK)
  return { destroy: () => handler.destroy() }
}

// ---------------------------------------------------------------------------
// Rutas
// ---------------------------------------------------------------------------

export const RISK_COLORS = {
  low: '#34d399',
  moderate: '#fbbf24',
  high: '#f87171',
  unknown: '#94a3b8',
}

const SEVERITY_COLORS = { info: '#38bdf8', warning: '#fbbf24', critical: '#f87171' }

/** Capa de entidades para origen, destino, rutas y alertas. Se redibuja entera con draw(). */
export function createRouteLayer(viewer) {
  const source = new CustomDataSource('routes')
  viewer.dataSources.add(source)
  const { entities } = source

  function marker(id, { latitude, longitude }, label, color) {
    entities.add({
      id,
      position: Cartesian3.fromDegrees(longitude, latitude, 0, MARS),
      point: {
        pixelSize: 12,
        color: Color.fromCssColorString(color),
        outlineColor: Color.BLACK,
        outlineWidth: 2,
        heightReference: HeightReference.CLAMP_TO_GROUND,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
      label: label && {
        text: label,
        font: '600 13px system-ui, sans-serif',
        fillColor: Color.WHITE,
        outlineColor: Color.BLACK,
        outlineWidth: 3,
        style: LabelStyle.FILL_AND_OUTLINE,
        verticalOrigin: VerticalOrigin.BOTTOM,
        pixelOffset: new Cartesian2(0, -14),
        // De lejos los dos puntos coinciden y las etiquetas se pisan: solo se muestran de cerca.
        distanceDisplayCondition: new DistanceDisplayCondition(0, 300_000),
        heightReference: HeightReference.CLAMP_TO_GROUND,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    })
  }

  return {
    /**
     * @param {{ origin, destination, routes: object[], selectedId: string|null }} scene
     * La elevación de la respuesta es sobre el areoide: se ignora y la línea se pega al terreno.
     */
    draw({ origin, destination, routes = [], selectedId = null }) {
      entities.suspendEvents()
      entities.removeAll()

      for (const route of routes) {
        const coords = route.geometry?.coordinates
        if (!coords?.length) continue
        const selected = route.route_id === selectedId
        const color = Color.fromCssColorString(RISK_COLORS[route.risk_level] ?? RISK_COLORS.unknown)
        entities.add({
          id: `route:${route.route_id}`,
          polyline: {
            positions: coords.map(([lon, lat]) => Cartesian3.fromDegrees(lon, lat, 0, MARS)),
            width: selected ? 5 : 2.5,
            material: selected ? color : color.withAlpha(0.45),
            clampToGround: true,
            classificationType: ClassificationType.BOTH,
            zIndex: selected ? 1 : 0,
          },
        })
        if (selected) {
          route.warnings?.forEach((w, i) => {
            if (w.latitude == null || w.longitude == null) return
            marker(`warn:${route.route_id}:${i}`, w, '⚠', SEVERITY_COLORS[w.severity] ?? '#fbbf24')
          })
        }
      }

      if (origin) marker('origin', origin, 'Origen', '#60a5fa')
      if (destination) marker('destination', destination, 'Destino', '#f472b6')
      entities.resumeEvents()
    },

    /** Encuadra una ruta (o los dos puntos si aún no hay ruta). */
    flyTo(points) {
      const positions = points.map(([lon, lat]) => Cartesian3.fromDegrees(lon, lat, 0, MARS))
      if (!positions.length) return
      const sphere = BoundingSphere.fromPoints(positions)
      viewer.camera.flyToBoundingSphere(sphere, {
        offset: new HeadingPitchRange(0, CesiumMath.toRadians(-50), Math.max(sphere.radius * 3, 3000)),
        duration: 2,
      })
    },

    destroy() {
      if (!viewer.isDestroyed()) viewer.dataSources.remove(source, true)
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
