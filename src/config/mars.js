// Datos de referencia del planeta y fuentes de mapas usados por el visor.

const TREK = 'https://trek.nasa.gov/tiles/Mars/EQ'
const TREK_SUFFIX = '1.0.0/default/default028mm/{z}/{y}/{x}.jpg'

/**
 * Mapas base servidos por NASA Trek (WMTS, malla geográfica 2x1 en el nivel 0,
 * CORS abierto). Funcionan sin token.
 */
export const BASE_MAPS = [
  {
    id: 'mola',
    name: 'Relieve MOLA (color)',
    description: 'Altimetría láser MGS MOLA, sombreado y coloreado por elevación (463 m/px).',
    url: `${TREK}/Mars_MGS_MOLA_ClrShade_merge_global_463m/${TREK_SUFFIX}`,
    maximumLevel: 7,
    credit: 'MGS MOLA · NASA/JPL/GSFC · vía NASA Trek',
    legend: {
      title: 'Elevación del terreno',
      subtitle: 'Altímetro láser MOLA (Mars Global Surveyor)',
      // Aproximación visual de la rampa de color del producto MOLA ClrShade de NASA Trek.
      gradient: ['#4b2a8a', '#2f52d6', '#27b4c4', '#4cc35a', '#e6dc4a', '#e8913a', '#c8423a', '#f4e8e8'],
      lowLabel: '≈ −8 km',
      highLabel: '≈ +21 km',
      classes: [
        {
          id: 'low',
          swatch: ['#4b2a8a', '#2f52d6'],
          label: 'Zonas bajas',
          meaning: 'Cuencas, cráteres profundos y llanuras del norte.',
          example: { landmarkId: 'hellas', text: 'Hellas Planitia, ≈ −7 km' },
        },
        {
          id: 'mid',
          swatch: ['#4cc35a', '#e6dc4a'],
          label: 'Altura media',
          meaning: 'Llanuras y tierras altas del sur.',
          example: { landmarkId: 'jezero', text: 'Cráter Jezero' },
        },
        {
          id: 'high',
          swatch: ['#c8423a', '#f4e8e8'],
          label: 'Zonas altas',
          meaning: 'Volcanes y mesetas elevadas.',
          example: { landmarkId: 'olympus', text: 'Monte Olimpo, ≈ +21 km' },
        },
      ],
      tips: [
        {
          icon: '⛰️',
          title: 'Pendientes',
          text: 'Si los colores cambian muy rápido en poco espacio, el terreno es empinado: peligroso para caminar con traje.',
        },
        {
          icon: '☢️',
          title: 'Radiación (estimada)',
          text: 'Las zonas bajas tienen más atmósfera encima, que frena parte de la radiación. Más alto = más exposición.',
        },
        {
          icon: '🌡️',
          title: 'No es un mapa térmico',
          text: 'Los colores indican altura, no temperatura. La capa térmica (THEMIS) se muestra en escala de grises.',
        },
      ],
    },
  },
  {
    id: 'viking',
    name: 'Mosaico Viking MDIM 2.1',
    description: 'Mosaico en color de los orbitadores Viking (232 m/px).',
    url: `${TREK}/Mars_Viking_MDIM21_ClrMosaic_global_232m/${TREK_SUFFIX}`,
    maximumLevel: 7,
    credit: 'Viking MDIM 2.1 · NASA/USGS · vía NASA Trek',
    legend: {
      title: 'Color aproximado real',
      subtitle: 'Mosaico de imágenes de los orbitadores Viking',
      note: 'Así se vería Marte a simple vista desde órbita. Los colores muestran el suelo y el polvo, no la altura. Para ver la altura, cambia al mapa «Relieve MOLA».',
    },
  },
]

export const DEFAULT_BASE_MAP_ID = 'mola'

export function getBaseMap(id) {
  return BASE_MAPS.find((m) => m.id === id) ?? BASE_MAPS[0]
}

/** Lugares de interés. Longitud este en [-180, 180]; range = distancia de cámara en metros. */
export const LANDMARKS = [
  { id: 'olympus', name: 'Monte Olimpo', lat: 18.65, lon: -133.8, range: 1_100_000 },
  { id: 'valles', name: 'Valles Marineris', lat: -13.9, lon: -59.2, range: 2_600_000 },
  { id: 'gale', name: 'Cráter Gale', lat: -5.4, lon: 137.8, range: 320_000 },
  // Zona de la caminata (bbox de /site en el contrato: 137.30–137.50 E, −4.90 a −4.60).
  { id: 'sharp', name: 'Monte Sharp (zona EVA)', lat: -4.75, lon: 137.4, range: 45_000 },
  { id: 'jezero', name: 'Cráter Jezero', lat: 18.38, lon: 77.58, range: 140_000 },
  { id: 'hellas', name: 'Hellas Planitia', lat: -42.4, lon: 70.5, range: 3_200_000 },
]

/**
 * Cobertura real del ráster de pendiente que usa el backend (map_mart/slope_5m.tif, DEM HiRISE
 * de Gale a 5 m), leída de sus metadatos: [lon_min, lat_min, lon_max, lat_max].
 * Fuera de este rectángulo el backend responde 422 POINT_OUTSIDE_MAP. Dentro hay zonas sin dato
 * (≈ 18 % del rectángulo, bordes del DEM). Cuando el backend implemente GET /site, leerlo de ahí.
 */
export const STUDY_AREA = {
  name: 'Cráter Gale · DEM HiRISE 5 m',
  bbox: [137.1242, -5.0986, 137.6805, -4.1297],
}

/** Radio de la esfera Mars 2000, el mismo que declara el CRS del DEM del backend. */
export const MARS_RADIUS_M = 3_396_190

/** Distancia en línea recta (gran círculo) entre dos puntos { latitude, longitude }, en metros. */
export function distanceOnMarsM(a, b) {
  const toRad = Math.PI / 180
  const dLat = (b.latitude - a.latitude) * toRad
  const dLon = (b.longitude - a.longitude) * toRad
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.latitude * toRad) * Math.cos(b.latitude * toRad) * Math.sin(dLon / 2) ** 2
  return 2 * MARS_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** Puntos [lon, lat] de un círculo de radio radiusM alrededor de center (para dibujarlo). */
export function circleOnMars(center, radiusM, steps = 90) {
  const toRad = Math.PI / 180
  const lat1 = center.latitude * toRad
  const lon1 = center.longitude * toRad
  const d = radiusM / MARS_RADIUS_M
  const pts = []
  for (let i = 0; i <= steps; i++) {
    const brg = (2 * Math.PI * i) / steps
    const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(brg))
    const lon2 =
      lon1 + Math.atan2(Math.sin(brg) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2))
    pts.push([lon2 / toRad, lat2 / toRad])
  }
  return pts
}

export function isInStudyArea({ latitude, longitude }) {
  const [w, s, e, n] = STUDY_AREA.bbox
  return longitude >= w && longitude <= e && latitude >= s && latitude <= n
}

export const HOME_VIEW = { lat: 10, lon: -90, height: 14_000_000 }

// Token PÚBLICO de Cesium ion, a propósito en el código: así cualquier despliegue (Vercel,
// GitHub Pages, un clon) muestra el relieve 3D sin configurar nada. Está limitado en ion:
// solo scope assets:read, solo el asset Cesium Mars y solo desde ares-miv.vercel.app,
// hernandezcortesirad-hash.github.io y localhost:5173. Para otra URL, añádela en ion o
// define CESIUM_ION_TOKEN (tiene prioridad; también vale el nombre antiguo VITE_CESIUM_ION_TOKEN).
const PUBLIC_ION_TOKEN =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJub25jZSI6IlFWVnlpS1BoUnRrcW5mMkIiLCJqdGkiOiIxZmUxYjQ0OS01ZjAwLTRiZmYtOTQ0Zi1kYmFkZDFlY2UwOTMiLCJpZCI6NTQ5NTMzLCJzdWIiOiJJcmFkIEhlcm7DoW5kZXogQ29ydGVzIiwiaXNzIjoiaHR0cHM6Ly9hcGkuY2VzaXVtLmNvbSIsImF1ZCI6ImFyZXMtbWl2LXdlYiIsImlhdCI6MTc5NDc2NDUzOH0.sfzmLYe-6y_ETB4TbT6w_l5QXMtJJXnPGGSrxYOXEVk'

export const ION_CONFIG = {
  token:
    import.meta.env.CESIUM_ION_TOKEN || import.meta.env.VITE_CESIUM_ION_TOKEN || PUBLIC_ION_TOKEN,
  marsAssetId:
    Number(import.meta.env.MARS_ION_ASSET_ID || import.meta.env.VITE_MARS_ION_ASSET_ID) || 3644333,
}
