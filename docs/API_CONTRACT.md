# Contrato de la API — se mantiene en el repositorio del backend

El contrato oficial frontend ↔ backend (**v1.1**) vive en un solo lugar:

**➡ [JuniRanger/ares-miv-geospatial-system · docs/API_CONTRACTS.md](https://github.com/JuniRanger/ares-miv-geospatial-system/blob/main/docs/API_CONTRACTS.md)**

Este archivo existía con la versión unificada v1.0, propuesta desde el frontend. Esa versión
quedó **incorporada en la v1.1 del backend** (decisión D7 de la
[propuesta de unificación](PROPUESTA_UNIFICACION.md)), así que aquí ya no se duplica para evitar
dos versiones distintas. La v1.0 sigue disponible en el historial de Git.

## Lo que usa el frontend hoy

| Endpoint | Dónde | Estado en el frontend |
|---|---|---|
| `POST /api/v1/routes/plan` | `src/lib/api.js` → `planRoute()` | Integrado (pestaña 🛰 Rutas, PR #2). `501` se muestra como "En desarrollo" |
| `GET /api/v1/health` | `src/lib/api.js` → `getHealth()` | Integrado (indicador de conexión del panel, PR #2) |
| `/site`, `/mars/terrain`, `/mars/layers`, `/mars/traverse/curiosity`, `/mars/images/near` | — | Pendiente |

Campos de la respuesta de ruta que pinta la interfaz: `route_id`, `risk_level`,
`geometry.coordinates`, `metrics.distance_m`, `metrics.est_total_time_min`,
`metrics.est_radiation_dose_mgy`, `warnings[]` (con `latitude`/`longitude`), `data_quality`.

## Reglas que no cambian

- Coordenadas: Mars 2000, latitud **planetocéntrica**, longitud **este** `[-180, 180]`,
  elevación en metros sobre el areoide.
- Errores: `{ "error": { "code", "message", "details?" } }`.
- Nunca se inventan datos: `null` + disponibilidad; lo estimado se marca `"estimated"`.

**Si algo del contrato cambia, se cambia primero en el repo del backend (por Pull Request) y
después se adapta el frontend.**
