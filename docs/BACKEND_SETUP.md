# Backend ARES-MIV — infraestructura y puesta en marcha

Guía para quien vaya a programar el backend. El código vive en
**https://github.com/JuniRanger/ares-miv-geospatial-system**. El **contrato de la API** está en
[API_CONTRACT.md](API_CONTRACT.md) y las decisiones de unificación (coordenadas, PostgreSQL, CORS)
en [PROPUESTA_UNIFICACION.md](PROPUESTA_UNIFICACION.md). Este archivo explica **qué instalar y
qué datos bajar**.

## 1. Arquitectura

```
┌──────────────────────┐   HTTP/JSON    ┌───────────────────────────┐
│ Frontend (Vue+Cesium)│ ─────────────▶ │ Backend FastAPI :8000      │
│ localhost:5173       │ ◀───────────── │  ├─ A* sobre el DEM        │
└─────────┬────────────┘   GeoJSON      │  ├─ muestreo de terreno    │
          │                             │  └─ proxy+caché NASA       │
          │ teselas (directo)           └──────┬──────────┬─────────┘
          ▼                                    │          │
   NASA Trek WMTS                    DEM recortado    mars.nasa.gov
   (HiRISE, CTX, THEMIS…)            (archivo local)  (travesía + imágenes)
```

- Las **teselas de imagen** las pide el frontend directamente a NASA Trek: el backend no las toca.
- El backend hace lo que el navegador no puede: **leer el DEM en metros, calcular pendientes,
  ejecutar A\*** y unir travesía de Curiosity + imágenes.
- **No hace falta base de datos** para la primera versión: el DEM es un archivo y lo de la NASA
  se cachea en memoria/disco.

## 2. Qué instalar

| Herramienta | Versión | Para qué |
|---|---|---|
| **Python** | 3.12 o 3.13 | Backend. En Windows: https://www.python.org/downloads/ → marcar **"Add python.exe to PATH"** |
| **Git** | cualquiera reciente | Ya lo tenéis |
| **Node.js** | 22.18+ o 24.12+ | Para correr el frontend y probar la integración |
| QGIS (opcional) | 3.x | Ver el DEM y comprobar que el recorte es correcto |

> ⚠️ El equipo de quien creó el repo **no tiene Python instalado** todavía.

### Dependencias de Python núcleo (`requirements.txt` del repo backend, sin PostgreSQL)

```
fastapi
uvicorn[standard]
pydantic>=2
pydantic-settings
numpy
rasterio          # leer el GeoTIFF del DEM (trae GDAL incluido en las ruedas de Windows)
pyproj            # convertir lat/lon ↔ coordenadas del DEM
httpx             # llamar a las APIs de la NASA
cachetools        # caché en memoria con caducidad
pytest            # tests
```
Fijad versiones exactas con `pip freeze > requirements.lock` cuando todo funcione.

## 3. Datos que necesita el backend

### 3.1 DEM HiRISE del cráter Gale (el más importante)

| | |
|---|---|
| Producto | **Mars MSL Gale Merged DEM 1m v3** (Parker & Calef, USGS, 2016) |
| Página | https://astrogeology.usgs.gov/search/map/mars_msl_gale_merged_dem_1m |
| Descarga | `https://planetarymaps.usgs.gov/mosaic/Mars/MSL/MSL_Gale_DEM_Mosaic_1m_v3.tif` |
| Tamaño | **3,87 GB** (GeoTIFF) — verificado |

**No bajéis el archivo entero.** El servidor (S3) admite lectura parcial, así que GDAL puede
recortar solo la zona de la caminata leyendo por internet:

```bash
# 1) Ver proyección, tamaño y datum ANTES de recortar
gdalinfo /vsicurl/https://planetarymaps.usgs.gov/mosaic/Mars/MSL/MSL_Gale_DEM_Mosaic_1m_v3.tif

# 2) Recortar la zona y bajar a 2 m/px (ajustar -projwin a lo que diga gdalinfo)
gdalwarp -te <xmin> <ymin> <xmax> <ymax> -tr 2 2 -r bilinear \
  -co COMPRESS=DEFLATE -co TILED=YES \
  /vsicurl/https://planetarymaps.usgs.gov/mosaic/Mars/MSL/MSL_Gale_DEM_Mosaic_1m_v3.tif \
  data/processed/dem_mount_sharp_2m.tif
```
Hacedlo en un script versionado: `scripts/prepare_dem.py` (con rasterio) o `.sh` con GDAL,
para que cualquiera pueda regenerar el archivo. **Anotad el CRS que muestre `gdalinfo`**: va en
`GET /site` y decide la conversión de coordenadas (ver la propuesta, §3).

**Por qué 2 m y no 1 m:** una zona de 10 × 10 km a 1 m son 100 millones de celdas (~400 MB en
memoria) y A\* se vuelve lento. A 2 m son 25 millones: suficiente para una caminata y rápido.

**Dónde guardarlo:** en `data/processed/`. Añadid `data/**/*.tif` al `.gitignore` del backend
(hoy no está). **No subáis rásters a Git.** Compartid
el archivo recortado por Google Drive / OneDrive, o que cada uno lo regenere con el script.

### 3.2 Travesía real de Curiosity
- `https://mars.nasa.gov/mmgis-maps/MSL/Layers/json/MSL_waypoints.json` — 1 389 puntos con `sol`,
  `lat`, `lon`, `elev_geoid`, `tilt`, `dist_total_m` (verificado).
- `https://mars.nasa.gov/mmgis-maps/MSL/Layers/json/MSL_traverse.json` — línea del recorrido.

### 3.3 Imágenes en bruto de los rovers
- API: `https://mars.nasa.gov/api/v1/raw_image_items/`
- Ejemplo (Curiosity, sol 5073):
  `?order=sol%20desc&per_page=50&page=0&condition_1=msl:mission&condition_2=5073:sol:gte&condition_3=5073:sol:lte`
- 1,5 millones de imágenes de Curiosity. Las imágenes no traen coordenadas: se cruzan por `sol`.

### 3.4 Radiación (modelo, no medición)
No hay un mapa de radiación de superficie a esta escala. Modelo propuesto:
- **Punto de calibración:** Curiosity RAD midió en Gale una dosis absorbida de
  ~0,21 mGy/día (Hassler et al., *Science*, 2014).
- **Corrección por elevación:** a menor altura, más columna de atmósfera y menos dosis.
- Todo resultado se marca `"estimated": true` (ver contrato).

## 4. Dónde va cada cosa en el repo del backend

La estructura ya existe en `ares-miv-geospatial-system`. Qué rellenar en cada archivo:

| Archivo existente | Qué implementar |
|---|---|
| `app/main.py` | Añadir `CORSMiddleware`; dejar de depender de la base de datos |
| `app/config.py` | Nuevos ajustes: `DEM_PATH`, `CORS_ORIGINS`, límites EVA, TTL de caché |
| `app/schemas/*.py` | Modelos del contrato unificado (`route.py`, `terrain.py`, `common.py`…) |
| `app/services/elevation_service.py` | Cargar el GeoTIFF **una vez**; elevación, pendiente, rugosidad |
| `app/algorithms/terrain_cost.py` | Coste por celda a partir de pendiente, rugosidad, inercia térmica y radiación |
| `app/algorithms/astar.py` | A\* (`heapq` + `numpy`) sobre la malla de costes |
| `app/algorithms/risk_analysis.py` | Generar `warnings` con posición y `distance_m` |
| `app/services/route_service.py` | Orquestar: lat/lon → celdas → A\* → GeoJSON + métricas + perfil; guardar en memoria |
| `app/services/radiation_service.py` | Modelo de dosis estimada (§3.4) |
| `app/services/nasa_service.py` | Clientes `httpx` + caché: travesía de Curiosity e imágenes |
| Nuevos: `app/api/routes/site.py` | `GET /site` + `data/science_stops.geojson` |
| `scripts/prepare_dem.py` | Recorte del DEM (§3.1) |

## 5. Configuración (`.env` del repo backend)

```env
API_PREFIX=/api/v1
DEM_PATH=data/processed/dem_mount_sharp_2m.tif
SCIENCE_STOPS_PATH=data/science_stops.geojson
CORS_ORIGINS=http://localhost:5173
NASA_CACHE_TTL_S=86400
# Límites por defecto de caminata (parámetros de diseño, a calibrar)
EVA_MAX_SLOPE_DEG=15
EVA_MAX_DISTANCE_M=5000
EVA_MAX_DURATION_MIN=240
```

En el frontend, añadir a `.env.local`: `VITE_API_URL=http://localhost:8000/api/v1`.

## 6. Arrancar en local

```bash
git clone https://github.com/JuniRanger/ares-miv-geospatial-system.git
cd ares-miv-geospatial-system
python -m venv .venv
.venv\Scripts\activate          # Windows  (Linux/Mac: source .venv/bin/activate)
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```
Abrir http://localhost:8000/docs para probar los endpoints. Sin Docker ni PostgreSQL: con la
propuesta aprobada, la API arranca sola (`docker compose up` también, ya sin base de datos).

## 7. Notas técnicas para el A\*

1. **Cargar el DEM una sola vez** al arrancar (no en cada petición).
2. Precalcular la **pendiente** de todo el ráster (gradiente con numpy) y guardarla en memoria.
3. **Coste de cada paso** = distancia × factor de pendiente (+ `radiation_weight` × dosis).
   Subir cuesta más que bajar. Celdas con pendiente > `max_slope_deg` = infranqueables.
4. **Heurística**: distancia en línea recta (admisible → A\* sigue dando la ruta óptima).
5. Con paradas intermedias: A\* tramo a tramo (start→wp1→wp2→…→end) y concatenar.
6. Para validar: comparar las pendientes del DEM con el `tilt` que midió Curiosity en sus waypoints.
7. Peticiones pesadas: si A\* tarda > 1–2 s, ejecutarlo en un hilo
   (`await run_in_threadpool(...)`) para no bloquear el servidor.

## 8. Despliegue (cuando haga falta)

Para la demo basta con local. Si hay que publicarlo:
- **Frontend** → Vercel / Netlify / GitHub Pages (`npm run build` genera `dist/`).
- **Backend** → Render, Railway o Fly.io (Docker o Python). Ojo: el DEM recortado (cientos de MB)
  debe ir en un volumen o descargarse al arrancar, no en la imagen de Git.
