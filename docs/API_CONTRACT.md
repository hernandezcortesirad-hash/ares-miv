# Contrato unificado de la API — ARES-MIV (v1)

> **Estado:** propuesta para aprobación del equipo. Une el contrato del frontend (PR #1 de
> `ares-miv`) con el del backend (`JuniRanger/ares-miv-geospatial-system`, `docs/API_CONTRACTS.md`).
> Qué se tomó de cada lado y por qué: [PROPUESTA_UNIFICACION.md](PROPUESTA_UNIFICACION.md).
>
> **Regla:** si algo de aquí cambia, se cambia primero este documento (por Pull Request) y
> después el código de los dos lados.

- **Base URL (desarrollo):** `http://localhost:8000/api/v1`
- **Formato:** JSON UTF-8, nombres en `snake_case`.
- **Documentación interactiva:** `http://localhost:8000/docs` (FastAPI). Debe coincidir con este documento.

---

## 0. Convenciones

### 0.1 Sistema de coordenadas (decisión del equipo)

| Concepto | Regla | Notas |
|---|---|---|
| Cuerpo y datum | **Mars 2000 (IAU)** | El mismo de NASA Trek y de los productos USGS |
| Latitud | Grados decimales, **planetocéntrica**, `[-90, 90]` | Ángulo medido desde el centro de Marte |
| Longitud | Grados decimales, **este positiva**, `[-180, 180]` | El Monte Sharp queda en ≈ `137.4`. Si una fuente usa `0–360`, se normaliza **al leerla** |
| Elevación | **Metros respecto al areoide** de Marte | Mismo datum que el DEM HiRISE de Gale y que `elev_geoid` de Curiosity. Negativo = bajo el nivel de referencia (en el Monte Sharp, ≈ −4 500 a −3 000 m) |
| Objetos JSON | Campos con nombre: `{"latitude": -4.8, "longitude": 137.4}` | Convención del backend, la más explícita |
| Geometrías GeoJSON | Orden `[longitude, latitude]` o `[longitude, latitude, elevation_m]` | RFC 7946 |
| Proyección interna | Libre (la nativa del DEM) | La API **solo** expone latitud/longitud; el backend convierte con `pyproj` |

> **Por qué importa:** en la latitud del Monte Sharp, confundir latitud planetocéntrica con
> planetográfica desplaza los puntos **3,26 km**: más que toda una caminata. Prueba de aceptación
> en la [propuesta](PROPUESTA_UNIFICACION.md#3-prueba-de-aceptación-de-coordenadas).

### 0.2 Unidades

Sufijo obligatorio en el nombre del campo: `_m` metros · `_min` minutos · `_deg` grados ·
`_mgy` miligray · `_ms` milisegundos. Las distancias van **siempre en metros** (nunca km).

### 0.3 Honestidad de los datos (regla del backend, se mantiene)

- **Nunca se inventan datos.** Si no hay dato válido, el campo vale `null` y su disponibilidad lo indica.
- Lo que sea **modelo y no medición** (p. ej. radiación) se marca `"estimated"` en `data_quality`
  o con `"estimated": true`, y lleva un campo `model` que explica de dónde sale.
- Una funcionalidad sin terminar responde `501 NOT_IMPLEMENTED`: el frontend lo muestra como
  "en desarrollo", no como error.

### 0.4 Formato de error (todos los endpoints)

```json
{
  "error": {
    "code": "POINT_OUT_OF_AREA",
    "message": "El destino está fuera de la zona de estudio (Monte Sharp).",
    "details": { "field": "destination", "bbox": [137.30, -4.90, 137.50, -4.60] }
  }
}
```
`details` es **opcional** (objeto o `null`).

| HTTP | `code` | Cuándo |
|---|---|---|
| 400 | `INVALID_REQUEST` | JSON mal formado |
| 404 | `RESOURCE_NOT_FOUND` | Recurso inexistente (ruta guardada, capa…) |
| 422 | `VALIDATION_ERROR` | Tipos o rangos inválidos. `details.fields` lista los campos con problema |
| 422 | `POINT_OUT_OF_AREA` | Un punto cae fuera del DEM cargado |
| 422 | `POINT_NOT_TRAVERSABLE` | Origen/destino/parada en terreno prohibido |
| 422 | `NO_FEASIBLE_ROUTE` | Ninguna ruta cumple las restricciones. `details.blocking_constraint` dice cuál |
| 500 | `INTERNAL_SERVER_ERROR` | Error inesperado. **Nunca** se envían trazas de Python |
| 501 | `NOT_IMPLEMENTED` | Endpoint aún no implementado |
| 502 | `UPSTREAM_UNAVAILABLE` | Falló un servicio de la NASA y no hay caché |
| 503 | `DATASET_UNAVAILABLE` | Falta un dato necesario (p. ej. el DEM no cargó) |

---

## Resumen de endpoints

| Método | Ruta | Prioridad | Qué hace |
|---|---|---|---|
| GET | `/health` | P0 | Estado del servidor y de los datos |
| GET | `/site` | P1 | Zona de estudio y paradas científicas |
| GET | `/mars/terrain` | P1 | Elevación, pendiente, rugosidad… en un punto |
| GET | `/mars/layers` | P1 | Catálogo de capas para el panel del frontend |
| GET | `/mars/traverse/curiosity` | P1 | Travesía real de Curiosity en la zona |
| POST | `/routes/plan` | **P2** | **Ruta A\*** con métricas, perfil y alertas |
| GET | `/routes/{route_id}` | P3 | Recupera una ruta ya calculada (en memoria) |
| GET | `/mars/layers/{layer_id}/raster` | P3 | PNG generado por el backend (pendiente, radiación) |
| GET | `/mars/images/near` | P3 | Fotos de Curiosity cerca de un punto |

**Eliminados respecto a los contratos anteriores:** `GET /mars/elevation` (incluido en
`/mars/terrain`), `GET /mars/texture` (el frontend usa las teselas de NASA Trek),
`GET /mars/layers/{id}/data` (sustituido por `/site` y `/mars/traverse/curiosity`).

---

## 1. `GET /health`

```json
{
  "status": "ok",
  "api_version": "1.0.0",
  "datasets": { "dem": "available", "science_stops": "available" },
  "database_status": "disabled"
}
```
- `status`: `"ok"` o `"degraded"` (si falta el DEM; en ese caso HTTP **503**).
- `datasets.*`: `"available"` | `"unavailable"`.
- `database_status`: `"disabled"` en v1 (no hay base de datos; ver propuesta).

---

## 2. `GET /site`

Zona de estudio. El frontend la usa para encuadrar la cámara, limitar dónde se puede hacer clic y
pintar las paradas científicas.

```json
{
  "site_id": "mount-sharp",
  "name": "Monte Sharp (Aeolis Mons), cráter Gale",
  "bbox": [137.30, -4.90, 137.50, -4.60],
  "dem": {
    "source": "MSL Gale Merged DEM 1m v3 (USGS / MRO HiRISE)",
    "resolution_m": 2.0,
    "coordinate_reference_system": "<WKT o código leído con gdalinfo>",
    "elevation_min_m": -4520.3,
    "elevation_max_m": -3015.8
  },
  "science_stops": {
    "type": "FeatureCollection",
    "features": [
      {
        "type": "Feature",
        "geometry": { "type": "Point", "coordinates": [137.3889, -4.8260, -3472.1] },
        "properties": {
          "stop_id": "boxwork-01",
          "name": "Retículas (boxwork)",
          "objective": "Estudiar las retículas y su relación con agua subterránea antigua",
          "data_sources": ["HiRISE", "CRISM", "Curiosity Mastcam"],
          "nearest_sol": 5073
        }
      }
    ]
  }
}
```
`bbox` = `[lon_min, lat_min, lon_max, lat_max]`. Las paradas salen de
`data/science_stops.geojson` (lo mantiene el equipo de ciencia). Los valores del ejemplo son
ilustrativos.

---

## 3. `GET /mars/terrain?latitude={lat}&longitude={lon}`

Muestreo del terreno en un punto: cursor, clic para fijar origen/destino, inspección.

```json
{
  "latitude": -4.8260,
  "longitude": 137.3889,
  "elevation_m": -3472.1,
  "slope_deg": 11.8,
  "roughness_m": 0.42,
  "thermal_inertia": null,
  "traversable": true,
  "radiation": {
    "dose_rate_mgy_per_day": 0.21,
    "estimated": true,
    "model": "Calibrado con Curiosity RAD en Gale; corregido por columna atmosférica según elevación"
  },
  "data_availability": {
    "elevation": true, "slope": true, "roughness": true, "thermal": false, "radiation": true
  }
}
```
- Cualquier medida puede ser `null`; `data_availability` lo explica.
- `thermal_inertia` en unidades SI de inercia térmica (J·m⁻²·K⁻¹·s⁻½) cuando exista.
- `traversable`: con los límites **por defecto** del perfil `eva_walk`; `null` si falta la pendiente.
- `radiation`: `null` si el modelo no está disponible.
- Fuera de la zona → `422 POINT_OUT_OF_AREA`.

---

## 4. `POST /routes/plan` — ruta A*

### Petición

```json
{
  "origin":      { "latitude": -4.8150, "longitude": 137.3720 },
  "destination": { "latitude": -4.8260, "longitude": 137.3889 },
  "waypoints": [
    { "latitude": -4.8201, "longitude": 137.3801, "stop_id": "boxwork-01", "stop_duration_min": 20 }
  ],
  "profile": "eva_walk",
  "constraints": {
    "max_slope_deg": 15,
    "max_distance_m": 5000,
    "max_duration_min": 240,
    "must_return_to_origin": false
  },
  "preferences": {
    "avoid_rough_terrain": true,
    "consider_thermal_data": true,
    "minimize_radiation": false
  }
}
```

| Campo | Tipo | Oblig. | Defecto | Notas |
|---|---|---|---|---|
| `origin`, `destination` | `{latitude, longitude}` | sí | — | |
| `waypoints` | lista (máx. 10) | no | `[]` | Paradas científicas, **en el orden dado** |
| `waypoints[].stop_id` | string | no | `null` | Id de `/site` si es una parada conocida |
| `waypoints[].stop_duration_min` | int ≥ 0 | no | `0` | Tiempo de trabajo en la parada |
| `profile` | `"eva_walk"` \| `"rover"` | no | `"eva_walk"` | Cambia velocidad y límites por defecto |
| `constraints.max_slope_deg` | float `(0, 45]` | no | 15 (eva) / 25 (rover) | Más empinado = **prohibido** |
| `constraints.max_distance_m` | float > 0 | no | 5000 | Si se supera → `NO_FEASIBLE_ROUTE` |
| `constraints.max_duration_min` | float > 0 | no | 240 | Incluye paradas. Soporte vital del traje |
| `constraints.must_return_to_origin` | bool | no | `false` | Añade el regreso y lo cuenta |
| `preferences.avoid_rough_terrain` | bool | no | `true` | Penaliza rugosidad alta |
| `preferences.consider_thermal_data` | bool | no | `true` | Penaliza inercia térmica baja (arena suelta) si hay dato |
| `preferences.minimize_radiation` | bool | no | `false` | Penaliza dosis estimada alta |

> Los valores por defecto (15°, 5 km, 240 min) son **parámetros de diseño a calibrar**, no
> normas de la NASA. Viven en la configuración del backend.

### Respuesta `200 OK`

```json
{
  "route_id": "rt_7f3c2a",
  "status": "completed",
  "profile": "eva_walk",
  "risk_level": "moderate",
  "geometry": {
    "type": "LineString",
    "coordinates": [[137.3720, -4.8150, -3501.2], [137.3731, -4.8158, -3498.7]]
  },
  "metrics": {
    "distance_m": 2384.5,
    "elevation_gain_m": 96.4,
    "elevation_loss_m": 41.0,
    "max_slope_deg": 13.7,
    "mean_slope_deg": 4.2,
    "est_walking_time_min": 71,
    "est_total_time_min": 91,
    "est_radiation_dose_mgy": 0.0133
  },
  "elevation_profile": [
    { "distance_m": 0.0,  "latitude": -4.8150, "longitude": 137.3720, "elevation_m": -3501.2, "slope_deg": 2.1 },
    { "distance_m": 10.0, "latitude": -4.8151, "longitude": 137.3721, "elevation_m": -3498.7, "slope_deg": 3.4 }
  ],
  "stops": [
    { "stop_id": "boxwork-01", "distance_m": 1290.0, "arrival_min": 39 }
  ],
  "warnings": [
    {
      "code": "STEEP_SLOPE",
      "severity": "warning",
      "message": "Pendiente de 13.7° durante 40 m, cerca del límite de 15°.",
      "latitude": -4.8203,
      "longitude": 137.3802,
      "distance_m": 1210.0,
      "length_m": 40.0
    }
  ],
  "data_quality": {
    "elevation": "available",
    "slope": "available",
    "roughness": "available",
    "thermal": "unavailable",
    "radiation": "estimated"
  },
  "computation": { "grid_resolution_m": 2.0, "nodes_expanded": 184233, "elapsed_ms": 812 }
}
```

**Reglas**
- `geometry.coordinates`: simplificada (máx. ~2 000 vértices), con elevación si existe.
- `elevation_profile`: **cada 10 m** de recorrido. `distance_m` es el eje X de la gráfica.
- Cada `warning` lleva **posición** (`latitude`/`longitude`) **y** `distance_m`: el frontend la
  pinta a la vez en el mapa 3D y en la gráfica. `length_m` es opcional (alertas de tramo).
- `metrics.est_radiation_dose_mgy`: `null` si no hay modelo.
- `risk_level`: `"low"` | `"moderate"` | `"high"` | `"unknown"`, a partir de los `warnings`.
- `data_quality.*`: `"available"` | `"partial"` | `"unavailable"` | `"estimated"`.

**Códigos de `warnings[].code`**

| `code` | Cuándo | `severity` |
|---|---|---|
| `STEEP_SLOPE` | Tramo con pendiente ≥ 80 % de `max_slope_deg` | `warning` |
| `ROUGH_TERRAIN` | Rugosidad alta (rocas, terreno roto) | `warning` |
| `LOOSE_TERRAIN` | Inercia térmica baja (arena suelta) | `warning` |
| `RADIATION_EXPOSURE` | Dosis estimada sobre el umbral | `warning` / `critical` |
| `TIME_BUDGET` | Tiempo total ≥ 80 % de `max_duration_min` (≥ 95 % = `critical`) | `warning` / `critical` |
| `FAR_FROM_ORIGIN` | Punto lejos de la base (regreso difícil) | `info` / `warning` |
| `DATA_GAP` | Tramo sin datos válidos del DEM | `warning` |

**Error de ruta imposible**
```json
{
  "error": {
    "code": "NO_FEASIBLE_ROUTE",
    "message": "No hay ruta con pendientes ≤ 15°. La mínima posible necesita 19.2°.",
    "details": { "blocking_constraint": "max_slope_deg", "min_required": 19.2 }
  }
}
```

---

## 5. `GET /routes/{route_id}`

Devuelve la misma respuesta que `POST /routes/plan`. En v1 las rutas se guardan **en memoria**
(se pierden al reiniciar el servidor). Si no existe → `404 RESOURCE_NOT_FOUND`.

---

## 6. `GET /mars/layers`

Catálogo de capas. Las teselas de imagen las sirve **NASA Trek directamente** al frontend; el
backend solo centraliza URLs, leyendas, créditos y disponibilidad.

```json
{
  "layers": [
    {
      "layer_id": "hirise-ortho",
      "name": "Imagen HiRISE (25 cm)",
      "description": "Mosaico HiRISE del área recorrida por Curiosity.",
      "category": "optical",
      "available": true,
      "source": "NASA/JPL/University of Arizona — MRO HiRISE (vía NASA Trek)",
      "units": null,
      "spatial_resolution": "0.25 m",
      "coordinate_reference_system": "Mars 2000",
      "tile_url": "https://trek.nasa.gov/tiles/Mars/EQ/curiosity_hirise_mosaic/1.0.0/default/default028mm/{z}/{y}/{x}.png",
      "tiling_scheme": "geographic",
      "bbox": [137.1224669, -4.9254743, 137.7298129, -4.2489588],
      "max_level": 16,
      "default_opacity": 1.0,
      "legend": null
    },
    {
      "layer_id": "slope",
      "name": "Pendiente calculada",
      "description": "Pendiente derivada del DEM HiRISE.",
      "category": "derived",
      "available": false,
      "source": "Cálculo propio a partir del DEM",
      "units": "deg",
      "spatial_resolution": "2 m",
      "coordinate_reference_system": "Mars 2000",
      "tile_url": null,
      "raster_url": "/api/v1/mars/layers/slope/raster",
      "tiling_scheme": null,
      "bbox": [137.30, -4.90, 137.50, -4.60],
      "max_level": null,
      "default_opacity": 0.6,
      "legend": { "type": "ramp", "unit": "deg", "stops": [[0, "#2bb3c0"], [15, "#e6dc4a"], [30, "#c8423a"]] }
    }
  ]
}
```
- `category` ∈ `optical | topographic | thermal | spectral | geologic | radiation | derived`.
- Una capa usa **`tile_url`** (teselas de Trek) **o** `raster_url` (PNG único del backend).
- `available: false` = planificada pero sin dato validado (regla de honestidad).

Capas Trek ya verificadas (formato y nivel máximo leídos de su `WMTSCapabilities.xml`):

| Capa Trek | Formato | Nivel máx. |
|---|---|---|
| `curiosity_hirise_mosaic` (HiRISE 25 cm) | png | 16 |
| `Gale_CTX_BlockAdj_dd` (CTX Gale) | png | 12 |
| `THEMIS_DayIR_ControlledMosaics_100m_v2_oct2018` | png | 9 |
| `Mars_MGS_MOLA_ClrShade_merge_global_463m` | jpg | 7 |

Las capas CRISM de Trek son de tipo *Feature* (no WMTS) y requieren otro método.

---

## 7. `GET /mars/layers/{layer_id}/raster`

PNG georreferenciado generado por el backend (p. ej. `slope`, `radiation`) que cubre exactamente
el `bbox` de la capa. Respuesta `image/png`. Si no existe → `404 RESOURCE_NOT_FOUND`.

---

## 8. `GET /mars/traverse/curiosity`

Travesía real de Curiosity **recortada a la zona de estudio**. Fuente:
`https://mars.nasa.gov/mmgis-maps/MSL/Layers/json/MSL_waypoints.json` (1 389 puntos hasta el
sol 5073, verificado). Caché de 24 h.

```json
{
  "type": "FeatureCollection",
  "features": [
    {
      "type": "Feature",
      "geometry": { "type": "Point", "coordinates": [137.388886, -4.82602331, -3472.085] },
      "properties": { "sol": 5073, "site": 125, "drive": 2490, "tilt_deg": 12.45, "dist_total_m": 38638.02 }
    }
  ]
}
```

---

## 9. `GET /mars/images/near?latitude={lat}&longitude={lon}&limit={n}`

Fotos en primera persona: waypoint de Curiosity más cercano → su `sol` → API pública de imágenes
en bruto de la NASA para ese sol.

| Parámetro | Tipo | Defecto |
|---|---|---|
| `latitude`, `longitude` | float | obligatorios |
| `limit` | int `[1, 50]` | `12` |
| `instruments` | csv | `NAV_LEFT_B,MAST_LEFT,MAST_RIGHT` |

```json
{
  "query": { "latitude": -4.8260, "longitude": 137.3889 },
  "nearest_waypoint": { "sol": 5073, "distance_m": 18.4, "latitude": -4.82602331, "longitude": 137.388886 },
  "images": [
    {
      "image_id": "NLB_…",
      "sol": 5073,
      "instrument": "NAV_LEFT_B",
      "taken_at": "2026-10-30T14:21:07Z",
      "url": "https://mars.nasa.gov/msl-raw-images/…",
      "credit": "NASA/JPL-Caltech"
    }
  ]
}
```
Las imágenes **no traen coordenadas**: se relacionan por sol. Mostrar `nearest_waypoint.distance_m`.

---

## Checklist de "hecho" por endpoint

- [ ] Modelos Pydantic de entrada y salida iguales a este documento
- [ ] Errores con el formato de §0.4 (sin trazas de Python)
- [ ] Al menos un test válido y uno de error
- [ ] Aparece correcto en `/docs`
- [ ] Ningún dato inventado: `null` + disponibilidad cuando falte
