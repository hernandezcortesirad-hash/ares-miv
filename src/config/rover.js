// Reglas del simulador de rutas de rover. Cada valor lleva su fuente; lo que no sale de NASA/JPL
// se marca como «supuesto del simulador». Verificadas el 15/11/2026.

export const ROVER_SOURCES = {
  components: {
    label: 'NASA · Perseverance rover components',
    url: 'https://science.nasa.gov/mission/mars-2020-perseverance/rover-components/',
  },
  mobility: {
    label: 'JPL Robotics · Mars 2020 mobility',
    url: 'https://robotics.jpl.nasa.gov/what-we-do/flight-projects/mars-2020-rover/m2020mobility/',
  },
  record: {
    label: 'JPL · PIA26645, récord de conducción en un sol',
    url: 'https://www.jpl.nasa.gov/images/pia26645-nasas-perseverance-breaks-own-rover-driving-record/',
  },
}

export const ROVER_RULES = {
  /** «Rover drivers avoid terrains that would tilt the rover more than 30 degrees.» */
  maxDriveTiltDeg: 30,
  /** «Designed to withstand a 45-degree tilt in any direction without tipping over.» (margen) */
  designTiltDeg: 45,
  /** 4.2 cm/s ≈ 152 m/h en terreno plano y duro (Perseverance y Curiosity). */
  topSpeedMPerH: 152,
  /** Media con navegación autónoma: Perseverance ~110 m/h; Curiosity 15–18 m/h. */
  autonavMPerH: { perseverance: 110, curiosity: [15, 18] },
  /** Récord de distancia en un sol (Perseverance, 19/06/2025). */
  recordSolM: 411.7,
  /** Rocas que puede superar (no se puede comprobar con el relieve disponible). */
  obstacleCm: 40,
}

/** Supuestos propios del simulador (no son reglas de la NASA). */
export const SIM_ASSUMPTIONS = {
  /** Límite de cálculo del navegador por ruta (mismo orden que el alcance EVA). */
  maxDistanceM: 10_000,
}
