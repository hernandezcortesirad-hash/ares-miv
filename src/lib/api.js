// Cliente único del backend ARES-MIV (contrato: docs/API_CONTRACT.md).
// Todos los componentes llaman a la API desde aquí, nunca con fetch suelto.
import { mockPlanRoute } from '@/lib/routeMock'

export const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:8000/api/v1').replace(
  /\/+$/,
  '',
)

// Solo para probar la interfaz sin backend. Las rutas simuladas se marcan como tales en la UI.
export const API_MOCK = import.meta.env.VITE_API_MOCK === 'true'

const DEFAULT_TIMEOUT_MS = 30_000

/** Error de la API con el formato del contrato: { error: { code, message, details? } }. */
export class ApiError extends Error {
  constructor(status, code, message, details = null) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.details = details
  }

  /** 501: la funcionalidad existe en el contrato pero el backend aún no la implementa. */
  get notImplemented() {
    return this.status === 501
  }

  /** No hubo respuesta: backend apagado, URL equivocada o CORS sin configurar. */
  get offline() {
    return this.status === 0
  }
}

async function request(path, { method = 'GET', body, signal, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const timeout = AbortSignal.timeout(timeoutMs)
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout

  let res
  try {
    res = await fetch(`${API_URL}${path}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: combined,
    })
  } catch (err) {
    if (signal?.aborted) throw err // cancelado por el usuario
    const timedOut = timeout.aborted
    throw new ApiError(
      0,
      timedOut ? 'TIMEOUT' : 'BACKEND_OFFLINE',
      timedOut
        ? 'El backend tardó demasiado en responder.'
        : `No se pudo conectar con el backend (${API_URL}). ¿Está arrancado y con CORS activo?`,
    )
  }

  const data = await res.json().catch(() => null)
  if (!res.ok) {
    const e = data?.error ?? {}
    throw new ApiError(
      res.status,
      e.code ?? `HTTP_${res.status}`,
      e.message ?? `El backend respondió ${res.status}.`,
      e.details ?? null,
    )
  }
  return data
}

export function getHealth(opts) {
  return request('/health', { ...opts, timeoutMs: 5_000 })
}

/** POST /routes/plan — ver §4 del contrato. */
export function planRoute(payload, opts) {
  if (API_MOCK) return mockPlanRoute(payload, opts)
  return request('/routes/plan', { method: 'POST', body: payload, ...opts })
}
