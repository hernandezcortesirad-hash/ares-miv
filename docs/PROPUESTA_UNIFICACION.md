# Propuesta: contrato unificado frontend ↔ backend

**Para:** equipo de ARES-MIV (frontend `ares-miv` y backend `ares-miv-geospatial-system`).
**Objetivo:** un solo contrato de API, un solo sistema de coordenadas y una infraestructura que
quepa en las 24 h del reto.
**Contrato resultante:** [API_CONTRACT.md](API_CONTRACT.md).

---

## 1. Decisiones que hay que aprobar

| # | Decisión propuesta | Motivo |
|---|---|---|
| D1 | **Prefijo `/api/v1`** | Versionar sin romper. En el backend es solo `API_PREFIX=/api/v1` |
| D2 | **Coordenadas: Mars 2000, latitud planetocéntrica, longitud este `[-180, 180]`, elevación sobre el areoide** | Es lo que usan NASA Trek, el DEM de USGS y la travesía de Curiosity. Ver §3 |
| D3 | **Campos `latitude` / `longitude`** (estilo backend) | Más explícitos; el frontend aún no los usa, cambiar es gratis |
| D4 | **Distancias siempre en metros** (`distance_m`, no `distance_km`) | Una sola unidad evita errores ×1000 |
| D5 | **Se mantiene la regla del backend: nunca inventar datos** (`null` + disponibilidad, `501` mientras no esté hecho) | Credibilidad ante el jurado |
| D6 | **Sin PostgreSQL/PostGIS en v1** (detalle en §4) | No lo necesita ninguna funcionalidad de la demo |
| D7 | **El contrato vive en el repositorio del backend** (`docs/API_CONTRACTS.md`) y el frontend enlaza a él | Un solo lugar de verdad; FastAPI genera `/docs` desde ese código |

---

## 2. Qué se tomó de cada contrato

| Tema | Backend (antes) | Frontend (PR #1) | **Unificado** |
|---|---|---|---|
| Prefijo | `/api` | `/api/v1` | **`/api/v1`** |
| Ruta | `POST /routes/plan` | `POST /routes` | **`POST /routes/plan`** (backend) |
| Puntos | `origin`/`destination` + `latitude`/`longitude` | `start`/`end` + `lat`/`lon` | **`origin`/`destination` + `latitude`/`longitude`** (backend) |
| Paradas científicas | — | `waypoints` | **`waypoints`** (frontend) |
| Límites numéricos | — (solo booleanos) | `constraints` | **`constraints`** numéricos (frontend) |
| Preferencias sí/no | `preferences` | `radiation_weight` | **`preferences`** (backend) + `minimize_radiation` |
| Perfil de elevación | lat/lon/elev | distancia/elev/pendiente cada 10 m | **ambos**: `distance_m` + lat/lon + elev + pendiente |
| Alertas | `warnings` sin posición | `alerts` con posición | **`warnings`** (nombre backend) **con posición y `distance_m`** |
| Calidad de datos | `data_quality` | `"estimated": true` | **`data_quality`** + valor `"estimated"` |
| Riesgo global | `risk_level` | — | **`risk_level`** (backend) |
| Terreno | `/mars/elevation` + `/mars/terrain` | `/terrain/point` | **solo `/mars/terrain`** con campos de ambos |
| Capas | `/mars/layers` (metadatos) | `/layers` (URLs y leyendas) | **`/mars/layers`** con los dos conjuntos de campos |
| Raster propio | `/mars/layers/{id}/raster` | `/tiles/{layer}/{z}/{x}/{y}` | **`/mars/layers/{id}/raster`** (backend, más simple) |
| Zona y paradas | — | `/site` | **`/site`** (frontend) |
| Curiosity e imágenes | — | `/traverse`, `/images/near` | **`/mars/traverse/curiosity`**, **`/mars/images/near`** |
| Errores | `{code, message}`; validación = `INVALID_REQUEST` 422 | `{code, message, details}` | **`{code, message, details?}`**; 400 `INVALID_REQUEST`, 422 `VALIDATION_ERROR` |
| Se eliminan | `/mars/texture`, `/mars/layers/{id}/data`, `/mars/elevation` | `/tiles/...` | — |

---

## 3. Sistema de coordenadas

### 3.1 Regla
- **Latitud planetocéntrica**, **longitud este positiva en `[-180, 180]`**, datum **Mars 2000**.
- **Elevación en metros sobre el areoide.**
- La API habla solo en latitud/longitud. Cada lado convierte **en el borde** (al leer un archivo
  o al dibujar), nunca en medio.

### 3.2 Por qué es crítico
Marte está achatado (radio ecuatorial 3 396,19 km, polar 3 376,20 km). En la latitud del Monte
Sharp (≈ −4,7°), la latitud **planetocéntrica** y la **planetográfica** difieren **0,055° =
3,26 km**. Si el backend calcula en una y el frontend dibuja en la otra, la ruta aparece a 3 km
de donde debe: fuera de la zona de caminata.

### 3.3 Prueba de aceptación de coordenadas
Antes de dar por buena la integración:
1. El backend sirve `GET /mars/traverse/curiosity`.
2. El frontend dibuja esos puntos sobre la capa HiRISE (`curiosity_hirise_mosaic`).
3. **Los puntos deben caer encima de las huellas del rover visibles en HiRISE** (error < 10 m).

Si quedan desplazados ~3 km en dirección norte-sur, hay una mezcla de latitudes. Esta prueba
valida a la vez el datum, la latitud y la longitud.

### 3.4 Tareas derivadas
- **Backend:** leer el CRS real del DEM con `gdalinfo` y anotarlo en `GET /site`
  (`dem.coordinate_reference_system`); convertir con `pyproj` a latitud planetocéntrica.
- **Frontend:** el visor usa hoy `Ellipsoid.MARS` (achatado), con el que Cesium interpreta las
  latitudes como planetográficas. Para la zona del Monte Sharp hay que **usar una esfera de
  3 396 190 m** (o convertir latitudes al dibujar) y comprobarlo con la prueba de §3.3.
- **Frontend:** dibujar la ruta **pegada al terreno** (`clampToGround`). La elevación del
  contrato es sobre el areoide y sirve para la gráfica, no para posicionar en 3D.

---

## 4. Infraestructura: PostgreSQL/PostGIS y demás

### 4.1 Propuesta: quitar PostgreSQL de la v1

| Pregunta | Respuesta |
|---|---|
| ¿Qué lo usa hoy? | Solo `GET /routes/{route_id}` (guardar rutas). El modelo `Route` está vacío |
| ¿Lo necesita la demo? | No. Las rutas se calculan al momento; guardarlas en memoria basta |
| ¿Qué cuesta mantenerlo? | Docker obligatorio, credenciales, migraciones, un servicio más que puede fallar en la demo |
| ¿Lo dice el propio plan del backend? | Sí: *"avoid optional infrastructure"* y *"prefer a small, testable implementation"* |

**Cambios propuestos en el backend:**
1. `GET /routes/{route_id}` usa un **diccionario en memoria** (máx. ~100 rutas, se borran las más
   antiguas). Se pierde al reiniciar: aceptable para la demo.
2. `docker-compose.yml`: el servicio `db` pasa a un **perfil opcional**
   (`profiles: ["db"]`). `docker compose up` arranca solo la API.
3. `app/database/` y `app/models/` se **conservan** pero no se importan desde `main.py`.
4. `requirements.txt` se divide:
   - **Núcleo:** `fastapi`, `uvicorn[standard]`, `pydantic`, `pydantic-settings`, `numpy`,
     `rasterio`, `pyproj`, `httpx`, `cachetools`, `pytest`.
   - **`requirements-db.txt` (opcional):** `sqlalchemy`, `psycopg[binary]`, `geoalchemy2`.
   - **Fuera:** `geopandas` y `shapely` hasta que una capa vectorial los necesite
     (`geopandas` es pesado de instalar en Windows).
5. `GET /health` devuelve `database_status: "disabled"`.

**Cuándo volver a meter PostgreSQL:** si después del reto se quieren guardar misiones entre
sesiones, compartir rutas entre usuarios o hacer consultas espaciales sobre muchas capas
vectoriales. Todo el código de `app/database/` queda listo para eso.

### 4.2 Otros cambios necesarios en el backend

| # | Cambio | Por qué | Esfuerzo |
|---|---|---|---|
| B1 | **Añadir `CORSMiddleware`** con orígenes desde `CORS_ORIGINS` (por defecto `http://localhost:5173`) | Sin esto el navegador **bloquea** al frontend | 5 min |
| B2 | `API_PREFIX=/api/v1` | D1 | 1 min |
| B3 | `ErrorDetail` con campo opcional `details: dict \| None`; validación → `VALIDATION_ERROR` + `details.fields` | §0.4 del contrato | 15 min |
| B4 | Adaptar `schemas/route.py` al nuevo `RoutePlanRequest` / `RouteResponse` | §4 del contrato | 30 min |
| B5 | Unificar `/mars/elevation` en `/mars/terrain`; quitar `/mars/texture` y `/layers/{id}/data` | Menos endpoints que mantener | 15 min |
| B6 | Nuevos endpoints como stubs `501`: `/site`, `/mars/traverse/curiosity`, `/mars/images/near` | El frontend puede integrarse ya | 30 min |
| B7 | Ampliar `LayerMetadata` (`category`, `tile_url`, `raster_url`, `bbox`, `max_level`, `legend`…) | §6 del contrato | 20 min |
| B8 | Arreglar enlaces del README (`../docs/` → `docs/`) y el texto `backend/.env` de `docker-compose.yml` | Hoy están rotos | 5 min |
| B9 | Rellenar o borrar los 4 archivos vacíos de `.github/instructions/` | Están vacíos | 5 min |
| B10 | Fijar versiones (`pip freeze > requirements.lock`) cuando funcione | Instalaciones reproducibles | 5 min |

### 4.3 Cambios en el frontend

| # | Cambio | Por qué |
|---|---|---|
| F1 | Cliente de API en `src/lib/api.js` con `VITE_API_URL` (por defecto `http://localhost:8000/api/v1`) | Un solo punto de llamada; muestra `501` como "en desarrollo" |
| F2 | Probar el visor con esfera de 3 396 190 m frente a `Ellipsoid.MARS` usando la prueba §3.3 | Evitar el desfase de 3,26 km |
| F3 | Dibujar rutas con `clampToGround`; usar `elevation_profile` para la gráfica | §3.4 |
| F4 | Sustituir `docs/API_CONTRACT.md` por un enlace al contrato del backend una vez aprobado | D7 |

---

## 5. Orden de trabajo sugerido (24 h)

| Bloque | Backend | Frontend |
|---|---|---|
| 0–2 h | B1, B2, B3, B8, §4.1 (sin Postgres) | F1 |
| 2–5 h | Recortar DEM (ver `BACKEND_SETUP.md`) y leer su CRS | Panel de capas con `/mars/layers` (Trek directo) |
| 5–8 h | `/mars/terrain`, `/site`, `/mars/traverse/curiosity` | Clic origen/destino + **prueba §3.3** |
| 8–14 h | A\* + `POST /routes/plan` (B4) | Ruta en 3D, gráfica de perfil, alertas |
| 14–18 h | `warnings`, radiación estimada, `/routes/{id}` en memoria | Paradas científicas y fotos (`/mars/images/near`) |
| 18–24 h | Tests, casos límite, ensayo de demo | Pulido UX, ensayo de demo |

---

## 6. Cómo aprobarla

1. Cada responsable comenta en este documento (Pull Request) qué cambia o qué aprueba.
2. Cuando D1–D7 estén aprobadas, se copia `API_CONTRACT.md` al repo del backend como
   `docs/API_CONTRACTS.md` (D7) y se abren los PR de B1–B10 y F1–F4.
