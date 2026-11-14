const AUTH_KEY = 'ares-miv:session'
const REMEMBER_KEY = 'ares-miv:terminal'

export function readSession() {
  try {
    const raw = sessionStorage.getItem(AUTH_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export function isAuthenticated() {
  return Boolean(readSession()?.operator)
}

export function writeSession(operator) {
  sessionStorage.setItem(
    AUTH_KEY,
    JSON.stringify({ operator, at: Date.now() }),
  )
}

export function clearSession() {
  sessionStorage.removeItem(AUTH_KEY)
}

export function readRemembered() {
  try {
    return localStorage.getItem(REMEMBER_KEY) || ''
  } catch {
    return ''
  }
}

export function writeRemembered(operator) {
  try {
    if (operator) localStorage.setItem(REMEMBER_KEY, operator)
    else localStorage.removeItem(REMEMBER_KEY)
  } catch {
    /* almacenamiento no disponible */
  }
}
