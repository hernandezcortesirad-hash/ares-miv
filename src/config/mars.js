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

export const HOME_VIEW = { lat: 10, lon: -90, height: 14_000_000 }

export const ION_CONFIG = {
  token: import.meta.env.VITE_CESIUM_ION_TOKEN ?? '',
  marsAssetId: Number(import.meta.env.VITE_MARS_ION_ASSET_ID) || 3644333,
}
