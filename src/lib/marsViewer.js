// Todo lo que toca Cesium vive aquí; los componentes Vue solo llaman a estas funciones.
import {
  ApproximateTerrainHeights,
  BoundingSphere,
  CallbackProperty,
  Cartesian2,
  Cartesian3,
  Cartographic,
  Cesium3DTileset,
  ClassificationType,
  Color,
  Credit,
  CustomDataSource,
  DistanceDisplayCondition,
  EasingFunction,
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
  PolylineDashMaterialProperty,
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

// Las líneas «pegadas al suelo» (rutas, círculo de alcance, rectángulo) se dibujan como un
// volumen entre una altura mínima y una máxima que Cesium toma de una tabla aproximada del relieve
// de la TIERRA (approximateTerrainHeights.json). En Marte eso falla: donde la Tierra tiene océano
// (≈ 0 m) y Marte tiene relieve alto (p. ej. +6 km cerca de Tharsis), el volumen no llega al suelo
// y la línea no se ve. Se usa el rango de alturas de Marte para todo el planeta: de −12 km (fondo
// de Hellas ≈ −8 km, con margen) a +26 km (Monte Olimpo ≈ +22 km, con margen).
// Esto cubre el hilo principal; los web workers de Cesium leen la tabla del servidor, que se
// sustituye en vite-plugins/marsTerrainHeights.js. Los dos deben usar los mismos valores.
ApproximateTerrainHeights._terrainHeights = {}
ApproximateTerrainHeights._initPromise = Promise.resolve()
ApproximateTerrainHeights._defaultMinTerrainHeight = -12_000
ApproximateTerrainHeights._defaultMaxTerrainHeight = 26_000

// ---------------------------------------------------------------------------
// Latitud planetocéntrica ↔ planetográfica
// ---------------------------------------------------------------------------
// Cesium trabaja sobre el elipsoide achatado, así que sus Cartographic usan latitud
// PLANETOGRÁFICA (geodésica). El backend y toda la app usan latitud PLANETOCÉNTRICA
// (la del DEM: proyección equirectangular sobre la esfera Mars 2000). En Gale (≈ −4.7°) la
// diferencia es ≈ 0.055° ≈ 3.3 km norte-sur.
// Regla: la conversión se hace SOLO en este archivo. Lo que entra (lon, lat) es planetocéntrico
// y se convierte al dibujar; lo que sale de un clic o del cursor se convierte de vuelta.
//
// Prueba de aceptación pendiente (contrato del backend): cuando exista
// GET /mars/traverse/curiosity, la travesía de Curiosity dibujada aquí debe caer sobre sus
// huellas en HiRISE con un error < 10 m.
const AXIS_RATIO_SQ = (MARS.radii.z / MARS.radii.x) ** 2 // c² / a²

/** Latitud planetográfica (grados) → planetocéntrica (grados). */
export function centricFromGraphic(latDeg) {
  return CesiumMath.toDegrees(Math.atan(AXIS_RATIO_SQ * Math.tan(CesiumMath.toRadians(latDeg))))
}

/** Latitud planetocéntrica (grados) → planetográfica (grados). */
export function graphicFromCentric(latDeg) {
  return CesiumMath.toDegrees(Math.atan(Math.tan(CesiumMath.toRadians(latDeg)) / AXIS_RATIO_SQ))
}

/** Posición de Cesium a partir de longitud este y latitud PLANETOCÉNTRICA (grados). */
export function toCartesian(lon, latCentric, height = 0) {
  return Cartesian3.fromDegrees(lon, graphicFromCentric(latCentric), height, MARS)
}

/** Posición de Cesium → { lat (planetocéntrica), lon, height } en grados/metros, o null. */
export function fromCartesian(cartesian) {
  const carto = MARS.cartesianToCartographic(cartesian)
  if (!carto) return null
  return {
    lat: centricFromGraphic(CesiumMath.toDegrees(carto.latitude)),
    lon: CesiumMath.toDegrees(carto.longitude),
    height: carto.height,
  }
}

/**
 * Altura del relieve 3D en cada punto [lon, lat planetocéntrica] (m sobre el elipsoide), o NaN
 * donde el modelo no tiene datos. Pide las teselas más detalladas por lotes.
 */
export async function sampleTerrainHeights(viewer, points, { signal, onProgress, batch = 1000 } = {}) {
  const { scene } = viewer
  if (!scene.sampleHeightSupported) return null
  const out = new Float64Array(points.length).fill(Number.NaN)
  for (let i = 0; i < points.length; i += batch) {
    if (signal?.aborted) throw signal.reason ?? new DOMException('Cancelado', 'AbortError')
    const slice = points
      .slice(i, i + batch)
      .map(([lon, lat]) => Cartographic.fromDegrees(lon, graphicFromCentric(lat)))
    const sampled = await scene.sampleHeightMostDetailed(slice)
    if (viewer.isDestroyed()) return null
    sampled.forEach((c, k) => {
      if (c && Number.isFinite(c.height)) out[i + k] = c.height
    })
    onProgress?.(Math.min(1, (i + batch) / points.length))
  }
  return out
}

/** Polilínea [lon, lat] densificada para que cada tramo siga la latitud y no el gran círculo. */
function densify(points, steps) {
  const out = []
  for (let i = 0; i < points.length - 1; i++) {
    const [lon0, lat0] = points[i]
    const [lon1, lat1] = points[i + 1]
    for (let k = 0; k < steps; k++) {
      const t = k / steps
      out.push([lon0 + (lon1 - lon0) * t, lat0 + (lat1 - lat0) * t])
    }
  }
  out.push(points.at(-1))
  return out
}

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

/**
 * Punto bajo una posición de pantalla: { lat (PLANETOCÉNTRICA), lon (este), height } en
 * grados y metros, o null fuera de Marte.
 */
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

  const pos = fromCartesian(cartesian)
  if (!pos) return null
  // Con el globo liso la altura no es significativa (sin modelo de elevación).
  if (scene.globe.show) pos.height = null
  return pos
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

// Un solo color para las rutas: la API no envía riesgo, así que el color no codifica nada más
// que «ruta» (la seleccionada se dibuja más gruesa y opaca).
const ROUTE_COLOR = '#fbbf24'
const ROVER_COLOR = '#22d3ee'

/** Icono redondo (SVG) para el explorador animado. */
function moverIcon(kind) {
  const astronaut = kind !== 'rover'
  const bg = astronaut ? '#f59e0b' : '#06b6d4'
  // Astronauta: casco con visor. Rover: cuerpo con mástil y ruedas.
  const glyph = astronaut
    ? '<circle cx="24" cy="21" r="10" fill="#fff"/><rect x="17" y="17" width="14" height="7" rx="3.5" fill="#1f2937"/><rect x="15" y="31" width="18" height="8" rx="4" fill="#fff"/>'
    : '<rect x="13" y="20" width="22" height="9" rx="2" fill="#fff"/><rect x="29" y="12" width="2.5" height="8" fill="#fff"/><rect x="26" y="10" width="8" height="4" rx="1" fill="#fff"/><circle cx="16" cy="33" r="3.5" fill="#fff"/><circle cx="24" cy="33" r="3.5" fill="#fff"/><circle cx="32" cy="33" r="3.5" fill="#fff"/>'
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48"><circle cx="24" cy="24" r="22" fill="${bg}" stroke="#000" stroke-width="3"/>${glyph}</svg>`
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

/** Capa de entidades para origen, destino, rutas y alertas. Se redibuja entera con draw(). */
export function createRouteLayer(viewer) {
  const source = new CustomDataSource('routes')
  viewer.dataSources.add(source)
  const { entities } = source

  // Explorador animado: capa aparte (draw() no la borra) y posición por callback, para moverlo
  // cada fotograma sin redibujar las rutas.
  const moverSource = new CustomDataSource('route-mover')
  viewer.dataSources.add(moverSource)
  let moverPos = null
  let moverKind = null
  const mover = moverSource.entities.add({
    id: 'mover',
    show: false,
    position: new CallbackProperty(() => moverPos, false),
    billboard: {
      image: moverIcon('eva'),
      width: 34,
      height: 34,
      heightReference: HeightReference.CLAMP_TO_GROUND,
      verticalOrigin: VerticalOrigin.CENTER,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    },
  })

  function marker(id, { latitude, longitude }, label, color) {
    entities.add({
      id,
      position: toCartesian(longitude, latitude),
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
    draw({ origin, destination, routes = [], selectedId = null, area = null, reach = null }) {
      entities.suspendEvents()
      entities.removeAll()

      // Alcance máximo desde el origen: el destino debe quedar dentro del círculo.
      if (reach) {
        entities.add({
          id: 'reach',
          polyline: {
            positions: reach.map(([lon, lat]) => toCartesian(lon, lat)),
            width: 1.5,
            material: new PolylineDashMaterialProperty({ color: Color.fromCssColorString('#60a5fa') }),
            clampToGround: true,
            classificationType: ClassificationType.BOTH,
          },
        })
      }

      // Contorno de la zona con datos del backend: solo se pueden fijar puntos dentro.
      if (area) {
        const [w, s, e, n] = area.bbox
        entities.add({
          id: 'study-area',
          polyline: {
            // Densificado: los lados siguen meridianos y paralelos, igual que isInStudyArea.
            positions: densify(
              [
                [w, s],
                [e, s],
                [e, n],
                [w, n],
                [w, s],
              ],
              24,
            ).map(([lon, lat]) => toCartesian(lon, lat)),
            width: 2,
            material: new PolylineDashMaterialProperty({ color: Color.fromCssColorString('#facc15') }),
            clampToGround: true,
            classificationType: ClassificationType.BOTH,
          },
        })
      }

      for (const route of routes) {
        const coords = route.geometry?.coordinates
        if (!coords?.length) continue
        const selected = route.route_id === selectedId
        // Confirmada (API): amarilla continua. Simulada (rover): cian discontinua.
        const rover = route.kind === 'rover'
        const color = Color.fromCssColorString(rover ? ROVER_COLOR : ROUTE_COLOR)
        const tint = selected ? color : color.withAlpha(0.45)
        entities.add({
          id: `route:${route.route_id}`,
          polyline: {
            positions: coords.map(([lon, lat]) => toCartesian(lon, lat)),
            width: selected ? 5 : 2.5,
            material: rover ? new PolylineDashMaterialProperty({ color: tint, dashLength: 20 }) : tint,
            clampToGround: true,
            classificationType: ClassificationType.BOTH,
            zIndex: selected ? 1 : 0,
          },
        })
        if (selected) {
          // Paradas de descanso que devuelve la API (tramos[].parada).
          route.stops?.forEach((s, i) => {
            marker(`stop:${route.route_id}:${i}`, s, `Descanso ${i + 1}`, '#a3e635')
          })
        }
      }

      if (origin) marker('origin', origin, 'Origen', '#60a5fa')
      if (destination) marker('destination', destination, 'Destino', '#f472b6')
      entities.resumeEvents()
    },

    /**
     * Encuadra una ruta (o los dos puntos si aún no hay ruta).
     * Con el relieve 3D el suelo de Gale está ≈ 4 km por debajo del elipsoide: si se encuadrara a
     * altura 0, la cámara miraría al aire y la ruta quedaría fuera de cuadro. Por eso se baja una
     * muestra de puntos hasta la superficie del relieve antes de calcular el encuadre.
     */
    async flyTo(points) {
      let positions = points.map(([lon, lat]) => toCartesian(lon, lat))
      if (!positions.length) return
      const { scene } = viewer
      // Solo vale la pena bajar a la superficie en encuadres cortos (rutas): en zonas grandes los
      // ~4 km de desnivel apenas cambian el encuadre y medirlos retrasa el vuelo varios segundos.
      const small = BoundingSphere.fromPoints(positions).radius < 15_000
      if (small && !scene.globe.show && scene.sampleHeightSupported) {
        // sampleHeightMostDetailed carga las teselas de la zona aunque la cámara esté lejos
        // (clampToHeight no: desde la vista global devolvía vacío y la cámara miraba al cielo).
        const step = Math.max(1, Math.floor(points.length / 12))
        const sample = points.filter((_, i) => i % step === 0 || i === points.length - 1)
        try {
          const heights = await sampleTerrainHeights(viewer, sample, { batch: sample.length })
          const grounded = heights
            ? sample.flatMap(([lon, lat], i) => (Number.isFinite(heights[i]) ? [toCartesian(lon, lat, heights[i])] : []))
            : []
          if (grounded.length) positions = grounded
        } catch {
          // Sin relieve en esa zona: se encuadra sobre el elipsoide.
        }
        if (viewer.isDestroyed()) return
      }
      const sphere = BoundingSphere.fromPoints(positions)
      viewer.camera.flyToBoundingSphere(sphere, {
        offset: new HeadingPitchRange(0, CesiumMath.toRadians(-50), Math.max(sphere.radius * 3.8, 3000)),
        duration: 2,
      })
    },

    /** Coloca el explorador animado en [lon, lat] (planetocéntrica), o lo oculta con null. */
    setMover(lonLat, kind = 'eva') {
      if (!lonLat) {
        mover.show = false
        viewer.scene.requestRender()
        return
      }
      if (kind !== moverKind) {
        moverKind = kind
        mover.billboard.image = moverIcon(kind)
      }
      moverPos = toCartesian(lonLat[0], lonLat[1])
      mover.show = true
      viewer.scene.requestRender()
    },

    destroy() {
      if (!viewer.isDestroyed()) {
        viewer.dataSources.remove(source, true)
        viewer.dataSources.remove(moverSource, true)
      }
    },
  }
}

/** Punto de partida de la entrada: Marte lejos (≈ 60 000 km) y girado respecto a la vista inicial. */
export function introStartView(viewer) {
  viewer.camera.setView({
    destination: toCartesian(HOME_VIEW.lon + 140, HOME_VIEW.lat - 15, 60_000_000),
  })
}

/**
 * Entrada cinematográfica: desde introStartView, la cámara se acerca hasta la vista inicial
 * mientras el planeta rota. Resuelve al terminar (o al instante si se cancela).
 */
export function introFlight(viewer, { duration = 4 } = {}) {
  return new Promise((resolve) => {
    viewer.camera.flyTo({
      destination: toCartesian(HOME_VIEW.lon, HOME_VIEW.lat, HOME_VIEW.height),
      duration,
      easingFunction: EasingFunction.QUARTIC_IN_OUT,
      complete: resolve,
      cancel: resolve,
    })
  })
}

export function flyHome(viewer, duration = 2) {
  viewer.camera.flyTo({
    destination: toCartesian(HOME_VIEW.lon, HOME_VIEW.lat, HOME_VIEW.height),
    duration,
  })
}

/** Vuela a un lugar con vista oblicua para apreciar el relieve. */
export function flyToLandmark(viewer, { lat, lon, range }) {
  const center = toCartesian(lon, lat)
  viewer.camera.flyToBoundingSphere(new BoundingSphere(center, 0), {
    offset: new HeadingPitchRange(0, CesiumMath.toRadians(-35), range),
    duration: 3,
  })
}
