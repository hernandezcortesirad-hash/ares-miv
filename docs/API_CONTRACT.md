# Contrato de la API — ARES-MIV backend (v1)

Este documento es el **acuerdo entre frontend y backend**. Si algo de aquí cambia, se cambia
primero este archivo (en un Pull Request) y después el código de los dos lados.

- **Base URL (desarrollo):** `http://localhost:8000/api/v1`
- **Formato:** JSON (UTF-8). Las rutas y capas geográficas se devuelven en **GeoJSON** (RFC 7946).
- **Documentación interactiva:** FastAPI la genera sola en `http://localhost:8000/docs`.
  Debe coincidir con este contrato.

---

## 0. Convenciones (leer antes de programar)

| Tema | Regla |
|---|---|
| Coordenadas | Grados decimales, **planetocéntricas**, longitud **este positiva** en `[-180, 180]`. Orden GeoJSON: `[lon, lat, elev]` |
| Elevación | Metros **respecto al areoide de Marte** (el mismo datum que el DEM HiRISE y que `elev_geoid` de Curiosity). Negativo = por debajo del nivel de referencia. En el Monte Sharp los valores rondan −4 500 a −3 000 m |
| Distancias | Metros (`_m`) · Tiempos en minutos (`_min`) · Ángulos en grados (`_deg`) · Dosis en mGy (`_mgy`) |
| Nombres JSON | `snake_case` |
| Zona de estudio | Solo se calculan rutas dentro del área cargada (ver `GET /site`). Fuera de ella → error `POINT_OUT_OF_AREA` |
| Datos estimados | Todo valor que sea **modelo y no medición** lleva `"estimated": true` y un campo `model` que explica de dónde sale |

### Formato de error (igual en todos los endpoints)

```json
{
  "error": {
    "code": "POINT_OUT_OF_AREA",
    "message": "El punto de destino está fuera de la zona de estudio (Monte Sharp).",
    "details": { "field": "end", "bbox": [137.30, -4.90, 137.50, -4.60] }
  }
}
```

| HTTP | `code` | Cuándo |
|---|---|---|
| 400 | `INVALID_REQUEST` | JSON mal formado |
| 422 | `VALIDATION_ERROR` | Tipos o rangos incorrectos (lo genera Pydantic; se re-envuelve en este formato) |
| 422 | `POINT_OUT_OF_AREA` | Un punto cae fuera del DEM cargado |
| 422 | `POINT_NOT_TRAVERSABLE` | El punto de inicio/fin está en terreno prohibido (p. ej. pendiente > límite) |
| 422 | `NO_FEASIBLE_ROUTE` | No existe ruta que cumpla las restricciones. `details` dice qué restricción la impide |
| 502 | `UPSTREAM_UNAVAILABLE` | Falló un servicio de la NASA (imágenes, travesía) y no hay caché |
| 500 | `INTERNAL_ERROR` | Error inesperado. **Nunca** devolver trazas de Python al cliente |

---

## 1. `GET /health`

Comprueba que el servidor está vivo **y que el DEM está cargado**.

```json
{ "status": "ok", "dem_loaded": true, "version": "1.0.0" }
```
Si el DEM no cargó: HTTP 503 con `"status": "degraded", "dem_loaded": false`.

---

## 2. `GET /site`

Describe la zona de estudio. El frontend lo usa para encuadrar la cámara, saber dónde se puede
hacer clic y mostrar las paradas científicas.

```json
{
  "id": "mount-sharp",
  "name": "Monte Sharp (Aeolis Mons), cráter Gale",
  "bbox": [137.30, -4.90, 137.50, -4.60],
  "dem": {
    "source": "MSL Gale Merged DEM 1m v3 (USGS / HiRISE)",
    "resolution_m": 2.0,
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
          "id": "boxwork-01",
          "name": "Retículas (boxwork)",
          "objective": "Estudiar las formaciones de retículas y su origen ligado al agua subterránea",
          "data_sources": ["HiRISE", "CRISM", "Curiosity Mastcam"],
          "nearest_sol": 5073
        }
      }
    ]
  }
}
```

> Las paradas científicas (`science_stops`) las define el equipo de ciencia en un archivo
> `backend/data/science_stops.geojson`; el backend solo lo sirve.

---

## 3. `GET /terrain/point?lat={lat}&lon={lon}`

Muestrea el terreno en un punto. Lo usa el frontend al mover el cursor y al hacer clic para
fijar A y B (muestra altitud y pendiente reales del DEM).

| Parámetro | Tipo | Obligatorio |
|---|---|---|
| `lat` | float `[-90, 90]` | sí |
| `lon` | float `[-180, 180]` | sí |

```json
{
  "lat": -4.8260,
  "lon": 137.3889,
  "elevation_m": -3472.1,
  "slope_deg": 11.8,
  "roughness_m": 0.42,
  "traversable": true,
  "radiation": {
    "dose_rate_mgy_per_day": 0.21,
    "estimated": true,
    "model": "Calibrado con Curiosity RAD en Gale; corregido por columna atmosférica según elevación"
  }
}
```
- `traversable` se evalúa con los **límites por defecto** de caminata (ver §4).
- Fuera de la zona → `422 POINT_OUT_OF_AREA`.

---

## 4. `POST /routes` — cálculo de ruta A*

El endpoint principal. Calcula la ruta óptima para una **caminata de astronautas (EVA)** pasando,
en orden, por las paradas científicas indicadas.

### Petición

```json
{
  "start": { "lat": -4.8150, "lon": 137.3720 },
  "end":   { "lat": -4.8260, "lon": 137.3889 },
  "waypoints": [
    { "lat": -4.8201, "lon": 137.3801, "stop_id": "boxwork-01", "stop_duration_min": 20 }
  ],
  "profile": "eva_walk",
  "constraints": {
    "max_slope_deg": 15,
    "max_distance_m": 5000,
    "max_duration_min": 240,
    "must_return_to_start": false,
    "radiation_weight": 0.2
  }
}
```

| Campo | Tipo | Obligatorio | Por defecto | Notas |
|---|---|---|---|---|
| `start`, `end` | `{lat, lon}` | sí | — | |
| `waypoints` | lista | no | `[]` | Se visitan **en el orden dado**. Máx. 10 |
| `waypoints[].stop_duration_min` | int ≥ 0 | no | `0` | Tiempo de trabajo científico en la parada |
| `profile` | `"eva_walk"` \| `"rover"` | no | `"eva_walk"` | Cambia velocidad y límites por defecto |
| `constraints.max_slope_deg` | float `(0, 45]` | no | `15` (eva) / `25` (rover) | Celdas más empinadas = **prohibidas** |
| `constraints.max_distance_m` | float > 0 | no | `5000` | Si la mejor ruta lo supera → `NO_FEASIBLE_ROUTE` |
| `constraints.max_duration_min` | float > 0 | no | `240` | Incluye las paradas. Límite de soporte vital del traje |
| `constraints.must_return_to_start` | bool | no | `false` | Si `true`, se añade el regreso a `start` y cuenta en distancia y tiempo |
| `constraints.radiation_weight` | float `[0, 1]` | no | `0` | `0` = ignorar radiación; `1` = evitarla al máximo |

> Los valores por defecto (15°, 5 km, 240 min) son **parámetros de diseño a calibrar** por el
> equipo, no estándares oficiales de la NASA. Van en `backend/app/core/config.py`.

### Respuesta `200 OK` — un `Feature` GeoJSON

```json
{
  "type": "Feature",
  "geometry": {
    "type": "LineString",
    "coordinates": [
      [137.3720, -4.8150, -3501.2],
      [137.3731, -4.8158, -3498.7]
    ]
  },
  "properties": {
    "profile": "eva_walk",
    "metrics": {
      "distance_m": 2384.5,
      "elevation_gain_m": 96.4,
      "elevation_loss_m": 41.0,
      "max_slope_deg": 13.7,
      "mean_slope_deg": 4.2,
      "est_walking_time_min": 71,
      "est_total_time_min": 91,
      "radiation": {
        "est_dose_mgy": 0.0133,
        "estimated": true,
        "model": "Dosis de superficie RAD × tiempo total, corregida por elevación"
      }
    },
    "profile_samples": [
      { "distance_m": 0.0, "elevation_m": -3501.2, "slope_deg": 2.1 },
      { "distance_m": 10.0, "elevation_m": -3498.7, "slope_deg": 3.4 }
    ],
    "alerts": [
      {
        "id": "a1",
        "type": "steep_slope",
        "severity": "warning",
        "message": "Pendiente de 13.7° durante 40 m, cerca del límite de 15°.",
        "coordinates": [137.3802, -4.8203, -3460.0],
        "distance_m": 1210.0,
        "length_m": 40.0
      }
    ],
    "stops": [
      { "stop_id": "boxwork-01", "distance_m": 1290.0, "arrival_min": 39 }
    ],
    "computation": { "grid_resolution_m": 2.0, "nodes_expanded": 184233, "elapsed_ms": 812 }
  }
}
```

**Reglas de la respuesta**
- `geometry.coordinates` va **simplificada** (máx. ~2 000 vértices) pero siempre con elevación.
- `profile_samples` va **remuestreado cada 10 m**: es lo que dibuja la gráfica de perfil.
- Cada alerta tiene `coordinates` **y** `distance_m`. Con eso el frontend la pinta en el mapa 3D
  y en la gráfica a la vez.

**Tipos de alerta (`alerts[].type`)**

| `type` | Cuándo | `severity` |
|---|---|---|
| `steep_slope` | Tramo con pendiente ≥ 80 % del límite | `warning` (≥ 80 %) |
| `rough_terrain` | Rugosidad alta (rocas, terreno roto) | `warning` |
| `long_exposure` | Dosis estimada > umbral configurado | `warning` / `critical` |
| `time_budget` | Tiempo total ≥ 80 % de `max_duration_min` | `warning` / `critical` (≥ 95 %) |
| `far_from_start` | Punto de la ruta a más de X m de la base (regreso difícil) | `info` / `warning` |

### Errores específicos
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

## 5. `GET /traverse/curiosity`

Travesía **real** de Curiosity recortada a la zona de estudio. Sirve como referencia ("por aquí ya
pasó un rover") y para validar las pendientes del A* con las que midió el rover.

Fuente: `https://mars.nasa.gov/mmgis-maps/MSL/Layers/json/MSL_waypoints.json` (verificado:
1 389 puntos hasta el sol 5073). El backend lo **descarga y cachea** (TTL 24 h).

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

## 6. `GET /images/near?lat={lat}&lon={lon}&limit={n}`

**Imágenes en primera persona** de lo que vio Curiosity cerca de un punto. El backend:
1. busca el waypoint de Curiosity más cercano al punto (§5);
2. toma su `sol`;
3. consulta la API pública de imágenes en bruto de la NASA para ese sol.

| Parámetro | Tipo | Por defecto | Notas |
|---|---|---|---|
| `lat`, `lon` | float | — | obligatorios |
| `limit` | int `[1, 50]` | `12` | |
| `instruments` | csv | `NAV_LEFT_B,MAST_LEFT,MAST_RIGHT` | Navcam y Mastcam: las más útiles para "qué voy a ver" |

```json
{
  "query": { "lat": -4.8260, "lon": 137.3889 },
  "nearest_waypoint": { "sol": 5073, "distance_m": 18.4, "coordinates": [137.388886, -4.82602331] },
  "images": [
    {
      "id": "NLB_...",
      "sol": 5073,
      "instrument": "NAV_LEFT_B",
      "taken_at": "2026-10-30T14:21:07Z",
      "url": "https://mars.nasa.gov/msl-raw-images/proj/msl/redops/ods/surface/sol/05073/opgs/edr/ncam/....JPG",
      "credit": "NASA/JPL-Caltech"
    }
  ]
}
```
- Las imágenes **no traen coordenadas propias**: la relación es por sol. Si en ese sol el rover
  se movió, pueden ser de puntos cercanos. Mostrar `nearest_waypoint.distance_m` en la interfaz.
- Cachear por `sol` (las imágenes de un sol pasado no cambian).

---

## 7. `GET /layers`

Catálogo de capas para el panel del frontend. Las teselas las sirve **NASA Trek directamente**
(el backend no las procesa); este endpoint centraliza URLs, leyendas y créditos.

```json
{
  "layers": [
    {
      "id": "hirise-ortho",
      "name": "Imagen HiRISE (25 cm)",
      "category": "optical",
      "tile_url": "https://trek.nasa.gov/tiles/Mars/EQ/curiosity_hirise_mosaic/1.0.0/default/default028mm/{z}/{y}/{x}.png",
      "tiling_scheme": "geographic",
      "bbox": [137.1224669, -4.9254743, 137.7298129, -4.2489588],
      "max_level": 16,
      "default_opacity": 1.0,
      "credit": "NASA/JPL/University of Arizona — MRO HiRISE",
      "legend": null
    },
    {
      "id": "slope",
      "name": "Pendiente calculada",
      "category": "derived",
      "tile_url": "http://localhost:8000/api/v1/tiles/slope/{z}/{x}/{y}.png",
      "tiling_scheme": "geographic",
      "legend": { "type": "ramp", "unit": "deg", "stops": [[0, "#2bb3c0"], [15, "#e6dc4a"], [30, "#c8423a"]] }
    }
  ]
}
```
`category` ∈ `optical | topographic | thermal | spectral | geologic | radiation | derived`.

> El `max_level` y el formato de cada capa Trek salen de su `WMTSCapabilities.xml`
> (`https://trek.nasa.gov/tiles/Mars/EQ/<capa>/1.0.0/WMTSCapabilities.xml`). Ya verificados:
>
> | Capa Trek | Formato | Nivel máx. |
> |---|---|---|
> | `curiosity_hirise_mosaic` (HiRISE 25 cm) | png | 16 |
> | `Gale_CTX_BlockAdj_dd` (CTX Gale) | png | 12 |
> | `THEMIS_DayIR_ControlledMosaics_100m_v2_oct2018` | png | 9 |
> | `Mars_MGS_MOLA_ClrShade_merge_global_463m` | jpg | 7 |
> | `Gale_DEM_SMG_1m` (DEM **coloreado**, solo visual) | png | — |
>
> Las capas CRISM de Trek son de tipo *Feature* (no teselas WMTS): requieren otro método.

---

## 8. (Fase 2) `GET /tiles/{layer}/{z}/{x}/{y}.png`

Teselas generadas por el backend a partir del DEM: `slope` (pendiente) y `radiation`
(dosis estimada). Esquema geográfico 2×1 en nivel 0, 256×256 px, igual que NASA Trek.
Respuesta `image/png`; fuera de la zona → PNG transparente. Opcional para la primera entrega:
se puede empezar precalculando un PNG único de la zona.

---

## Checklist de "hecho" para cada endpoint

- [ ] Modelo Pydantic de entrada y salida igual a este documento
- [ ] Errores en el formato de §0 (nunca trazas de Python)
- [ ] Al menos un test con un caso válido y uno de error
- [ ] Aparece correcto en `/docs`
