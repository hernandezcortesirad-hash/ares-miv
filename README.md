# ARES-MIV

Sistema de navegación y análisis geoespacial en 3D para Marte (Vue 3 + Vite + CesiumJS).

## Puesta en marcha

```sh
npm install
cp .env.example .env.local   # opcional: añade tu token de Cesium ion para el relieve 3D
npm run dev
```

- **Sin token**: Marte se muestra sobre el elipsoide `IAU_MARS_2000` con los mapas MOLA o Viking
  servidos por NASA Trek (sin relieve 3D).
- **Con token** (`CESIUM_ION_TOKEN`, gratis en https://ion.cesium.com/tokens): además se carga
  el terreno 3D de Marte desde Cesium ion (`MARS_ION_ASSET_ID`).

## Estructura

| Ruta | Contenido |
| --- | --- |
| `src/config/mars.js` | Mapas base, lugares de interés, vista inicial, configuración de ion |
| `src/lib/marsViewer.js` | Toda la lógica de Cesium (visor, capas, relieve, picking, cámara) |
| `src/components/MarsGlobe.vue` | Componente que monta el visor y expone `flyTo` / `flyHome` |
| `src/views/HomeView.vue` | Interfaz: panel de exploración, estado, coordenadas del cursor |

## Scripts

```sh
npm run dev     # servidor de desarrollo
npm run build   # compilación de producción (copia Cesium a dist/cesium)
npm run lint    # oxlint + eslint
```
