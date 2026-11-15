<script setup>
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'

import { readRemembered, writeRemembered, writeSession } from '@/lib/session'

const DEMO_OPERATOR = 'astro.operador@ares.mars'
const OPERATOR_RE =
  /^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?@[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?(?:\.[a-z]{2,})+$/i

const router = useRouter()

const remembered = readRemembered()
const operator = ref(remembered || DEMO_OPERATOR)
const code = ref('mola-7741')
const remember = ref(true)
const showCode = ref(false)
const operatorError = ref('')
const codeError = ref('')
const notice = ref('')
const phase = ref('')
const busy = ref(false)
const shake = ref(false)

onMounted(() => {
  document.title = 'ARES-MIV · Acceso Terminal'
})

function validate() {
  const id = operator.value.trim()
  operatorError.value = ''
  codeError.value = ''
  notice.value = ''

  if (!id) operatorError.value = 'IDENTIFICADOR REQUERIDO'
  else if (!OPERATOR_RE.test(id)) operatorError.value = 'FORMATO DE IDENTIFICADOR NO VÁLIDO'

  if (!code.value) codeError.value = 'CÓDIGO DE AUTORIZACIÓN REQUERIDO'
  else if (code.value.length < 6) codeError.value = 'CÓDIGO INSUFICIENTE — MÍNIMO 6 CARACTERES'

  return !operatorError.value && !codeError.value
}

function pulseReject() {
  shake.value = false
  requestAnimationFrame(() => {
    shake.value = true
  })
}

async function enter() {
  if (busy.value) return
  if (!validate()) {
    pulseReject()
    return
  }

  busy.value = true
  const id = operator.value.trim()
  writeRemembered(remember.value ? id : '')

  const steps = [
    'VERIFICANDO IDENTIDAD DE OPERADOR…',
    'ENLACE MOLA ESTABLE',
    'AUTORIZACIÓN ACEPTADA — ABRIENDO MISIÓN',
  ]
  for (const step of steps) {
    phase.value = step
    await new Promise((resolve) => setTimeout(resolve, 420))
  }

  writeSession(id)
  await router.push({ name: 'home' })
}

function recover() {
  const id = operator.value.trim()
  operatorError.value = ''
  notice.value = ''
  if (!id || !OPERATOR_RE.test(id)) {
    operatorError.value = 'INDICA UN IDENTIFICADOR VÁLIDO PARA RECUPERAR LA CLAVE'
    pulseReject()
    return
  }
  notice.value = `SEÑAL DE CONTINGENCIA ENVIADA A ${id}. VIGENCIA 15 MIN.`
}

// Respeta la base de la web (en GitHub Pages no es '/').
const baseUrl = import.meta.env.BASE_URL
</script>

<template>
  <div class="terminal">
    <div class="scene" aria-hidden="true">
      <img class="scene-image" :src="`${baseUrl}bg/login-background.jpg`" alt="" />
      <div class="vignette"></div>
    </div>

    <header class="topbar">
      <div class="brand">
        <svg class="mark" viewBox="0 0 32 32" aria-hidden="true">
          <rect x="1.2" y="1.2" width="29.6" height="29.6" rx="7" fill="#120806" stroke="#ff4d1a" stroke-width="1.6" />
          <circle cx="16" cy="16" r="5" fill="none" stroke="#ff5a22" stroke-width="1.5" />
          <ellipse cx="16" cy="16" rx="9.2" ry="3.3" fill="none" stroke="#ff5a22" stroke-width="1.4" transform="rotate(-28 16 16)" />
        </svg>
        <span class="brand-name">ARES<span>-MIV</span></span>
      </div>
    </header>

    <main class="stage">
      <form
        class="panel"
        :class="{ shake }"
        novalidate
        @submit.prevent="enter"
        @animationend="shake = false"
      >
        <span class="tick tick-tl" aria-hidden="true"></span>
        <span class="tick tick-tr" aria-hidden="true"></span>
        <span class="tick tick-bl" aria-hidden="true"></span>
        <span class="tick tick-br" aria-hidden="true"></span>

        <h1>ACCESO TERMINAL</h1>

        <div class="field">
          <label for="operator">Identificador de operador</label>
          <div class="control">
            <input
              id="operator"
              v-model="operator"
              type="text"
              name="username"
              autocomplete="username"
              spellcheck="false"
              placeholder="astro.operador@ares.mars"
              :disabled="busy"
              :aria-invalid="Boolean(operatorError)"
              aria-describedby="operator-error"
            />
            <svg class="glyph" viewBox="0 0 24 24" aria-hidden="true">
              <path
                d="M12 3.2 5.2 6.1v5.2c0 4.3 2.9 8.2 6.8 9.5 3.9-1.3 6.8-5.2 6.8-9.5V6.1L12 3.2Z"
                fill="none"
                stroke="currentColor"
                stroke-width="1.6"
                stroke-linejoin="round"
              />
              <circle cx="12" cy="10" r="2" fill="none" stroke="currentColor" stroke-width="1.5" />
              <path d="M9.2 15.2c.7-1.2 1.7-1.7 2.8-1.7s2.1.5 2.8 1.7" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
            </svg>
          </div>
          <p id="operator-error" class="error" role="alert">{{ operatorError }}</p>
        </div>

        <div class="field">
          <label for="code">Código de autorización</label>
          <div class="control">
            <input
              id="code"
              v-model="code"
              :type="showCode ? 'text' : 'password'"
              name="password"
              autocomplete="current-password"
              placeholder="••••••••"
              :disabled="busy"
              :aria-invalid="Boolean(codeError)"
              aria-describedby="code-error"
            />
            <button
              type="button"
              class="eye"
              :aria-pressed="showCode"
              :aria-label="showCode ? 'Ocultar código' : 'Mostrar código'"
              :disabled="busy"
              @click="showCode = !showCode"
            >
              <svg v-if="!showCode" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M2.5 12S6.2 6.5 12 6.5 21.5 12 21.5 12 17.8 17.5 12 17.5 2.5 12 2.5 12Z" fill="none" stroke="currentColor" stroke-width="1.6" />
                <circle cx="12" cy="12" r="2.4" fill="none" stroke="currentColor" stroke-width="1.6" />
              </svg>
              <svg v-else viewBox="0 0 24 24" aria-hidden="true">
                <path d="M3 4.5 20 18.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
                <path d="M9.2 7.2A9 9 0 0 1 12 6.5c5.8 0 9.5 5.5 9.5 5.5a16 16 0 0 1-3.2 3.4M6.1 8.6C3.9 10.2 2.5 12 2.5 12S6.2 17.5 12 17.5c1.1 0 2.1-.2 3-.6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
              </svg>
            </button>
          </div>
          <p id="code-error" class="error" role="alert">{{ codeError }}</p>
        </div>

        <div class="extras">
          <label class="remember">
            <input v-model="remember" type="checkbox" :disabled="busy" />
            <span class="box" aria-hidden="true"></span>
            <span>Recordar terminal</span>
          </label>
          <button type="button" class="recover" :disabled="busy" @click="recover">
            Recuperar clave
          </button>
        </div>

        <p v-if="notice" class="notice" role="status">{{ notice }}</p>
        <p v-else-if="phase" class="phase" role="status">{{ phase }}</p>

        <button class="submit" type="submit" :disabled="busy">
          <span>{{ busy ? 'ESTABLECIENDO ENLACE' : 'ACCESO A MISIÓN // INICIAR SESIÓN' }}</span>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M5 12h12M13 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </button>
      </form>
    </main>

    <footer class="telemetry">
      <div class="telemetry-left">
        <span class="live"><i></i>ARES-MIV TELEMETRÍA</span>
        <span class="sep">/</span>
        <span>BASE MOLA: EN LÍNEA</span>
        <span class="sep">/</span>
        <span>VIKING MDIM: CONECTADO</span>
      </div>
      <div class="telemetry-right">
        <span class="coords"><em>LAT:</em> 2.8233° N</span>
        <span class="coords"><em>LON:</em> 84.2429° W</span>
        <span class="engine">CESIUM ION<br />ENGINE</span>
      </div>
    </footer>
  </div>
</template>

<style scoped>
.terminal {
  --bg: #0a0a0c;
  --ink: #f4f6f8;
  --muted: #aeb6c2;
  --dim: #8b93a0;
  --accent: #ff4d1a;
  --accent-deep: #ff3410;
  --cyan: #3ec8ff;
  --panel: rgba(8, 11, 16, 0.8);
  position: relative;
  height: 100%;
  overflow: hidden;
  background: var(--bg);
  color: var(--ink);
  font-family: 'Rajdhani', 'Segoe UI', sans-serif;
}

.scene {
  position: absolute;
  inset: 0;
}

.scene-image {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: center;
  pointer-events: none;
  user-select: none;
}

.vignette {
  position: absolute;
  inset: 0;
  background:
    linear-gradient(to bottom, rgba(0, 0, 0, 0.72), transparent 14%),
    radial-gradient(ellipse at center, transparent 40%, rgba(0, 0, 0, 0.45) 100%);
  pointer-events: none;
}

.topbar {
  position: relative;
  z-index: 3;
  display: flex;
  align-items: center;
  height: 72px;
  padding: 0 28px;
}

.brand {
  display: flex;
  align-items: center;
  gap: 12px;
}

.mark {
  width: 34px;
  height: 34px;
  filter: drop-shadow(0 0 8px rgba(255, 77, 26, 0.45));
}

.brand-name {
  font-size: 22px;
  font-weight: 700;
  letter-spacing: 0.14em;
}

.brand-name span {
  color: #ff3b1f;
}

.stage {
  position: relative;
  z-index: 2;
  height: calc(100% - 72px - 42px);
}

.panel {
  position: absolute;
  top: 46%;
  right: max(5vw, 56px);
  width: min(420px, calc(100vw - 40px));
  transform: translateY(-50%);
  padding: 28px 26px 24px;
  background: var(--panel);
  border: 1px solid rgba(255, 90, 40, 0.28);
  border-radius: 4px;
  box-shadow:
    0 28px 70px rgba(0, 0, 0, 0.55),
    inset 0 1px 0 rgba(255, 255, 255, 0.05);
  backdrop-filter: blur(18px) saturate(1.2);
}

.panel h1 {
  margin: 0 0 22px;
  font-size: 26px;
  font-weight: 700;
  letter-spacing: 0.06em;
  line-height: 1;
}

.tick {
  position: absolute;
  width: 16px;
  height: 16px;
  pointer-events: none;
}

.tick-tl {
  top: -1px;
  left: -1px;
  border-top: 2px solid var(--accent);
  border-left: 2px solid var(--accent);
}

.tick-tr {
  top: -1px;
  right: -1px;
  border-top: 2px solid var(--cyan);
  border-right: 2px solid var(--cyan);
}

.tick-bl {
  bottom: -1px;
  left: -1px;
  border-bottom: 2px solid var(--cyan);
  border-left: 2px solid var(--cyan);
}

.tick-br {
  right: -1px;
  bottom: -1px;
  border-right: 2px solid rgba(62, 200, 255, 0.7);
  border-bottom: 2px solid rgba(62, 200, 255, 0.7);
}

.field {
  margin-bottom: 4px;
}

.field label {
  display: block;
  margin-bottom: 8px;
  color: #c5ccd6;
  font-family: 'Share Tech Mono', ui-monospace, monospace;
  font-size: 11px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

.control {
  position: relative;
}

.control input {
  width: 100%;
  height: 46px;
  padding: 0 44px 0 14px;
  color: #f7f8fa;
  font-family: 'Share Tech Mono', ui-monospace, monospace;
  font-size: 14px;
  background: rgba(4, 7, 12, 0.78);
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 7px;
  outline: none;
  transition:
    border-color 0.2s ease,
    box-shadow 0.2s ease;
}

.control input::placeholder {
  color: rgba(255, 255, 255, 0.28);
}

.control input:focus {
  border-color: rgba(255, 87, 34, 0.9);
  box-shadow: 0 0 0 3px rgba(255, 69, 0, 0.16);
}

.control input:disabled {
  opacity: 0.7;
}

.glyph,
.eye {
  position: absolute;
  top: 50%;
  right: 12px;
  width: 20px;
  height: 20px;
  color: #9aa3b0;
  transform: translateY(-50%);
}

.eye {
  display: grid;
  place-items: center;
  padding: 0;
  background: transparent;
  border: 0;
  cursor: pointer;
}

.eye svg {
  width: 20px;
  height: 20px;
}

.eye:hover {
  color: #fff;
}

.error {
  min-height: 16px;
  margin: 6px 0 6px;
  color: #ff6d4a;
  font-family: 'Share Tech Mono', ui-monospace, monospace;
  font-size: 10px;
  letter-spacing: 0.06em;
}

.extras {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin: 2px 0 14px;
}

.remember {
  display: inline-flex;
  gap: 8px;
  align-items: center;
  color: #d5dbe3;
  font-size: 14px;
  cursor: pointer;
  user-select: none;
}

.remember input {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  overflow: hidden;
  clip-path: inset(50%);
}

.box {
  display: grid;
  place-items: center;
  width: 16px;
  height: 16px;
  background: transparent;
  border: 1.5px solid rgba(255, 255, 255, 0.35);
  border-radius: 3px;
  transition:
    background 0.15s ease,
    border-color 0.15s ease,
    box-shadow 0.15s ease;
}

.remember input:checked + .box {
  background: var(--accent);
  border-color: var(--accent);
  box-shadow: 0 0 10px rgba(255, 77, 26, 0.45);
}

.remember input:checked + .box::after {
  content: '';
  width: 4px;
  height: 8px;
  margin-top: -1px;
  border-right: 2px solid #fff;
  border-bottom: 2px solid #fff;
  transform: rotate(40deg);
}

.remember input:focus-visible + .box {
  box-shadow: 0 0 0 3px rgba(255, 69, 0, 0.25);
}

.recover {
  padding: 0;
  color: #e85a42;
  font-family: inherit;
  font-size: 14px;
  background: none;
  border: 0;
  cursor: pointer;
}

.recover:hover {
  color: #ff8a70;
}

.notice,
.phase {
  margin: 0 0 12px;
  font-family: 'Share Tech Mono', ui-monospace, monospace;
  font-size: 11px;
  letter-spacing: 0.04em;
  line-height: 1.45;
}

.notice {
  color: #ffb199;
}

.phase {
  color: var(--cyan);
}

.submit {
  display: flex;
  gap: 10px;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 50px;
  color: #fff;
  font-family: inherit;
  font-size: 15px;
  font-weight: 700;
  letter-spacing: 0.05em;
  cursor: pointer;
  background: linear-gradient(180deg, #ff6a33 0%, #ff3c12 100%);
  border: 0;
  border-radius: 8px;
  box-shadow:
    0 10px 26px rgba(255, 60, 18, 0.38),
    inset 0 1px 0 rgba(255, 255, 255, 0.32);
  transition:
    filter 0.2s ease,
    transform 0.2s ease,
    box-shadow 0.2s ease;
}

.submit svg {
  width: 18px;
  height: 18px;
}

.submit:hover:not(:disabled) {
  filter: brightness(1.08);
  box-shadow:
    0 14px 34px rgba(255, 80, 30, 0.55),
    inset 0 1px 0 rgba(255, 255, 255, 0.4);
}

.submit:active:not(:disabled) {
  transform: translateY(1px);
}

.submit:disabled {
  cursor: progress;
  filter: saturate(0.9) brightness(0.95);
}

.telemetry {
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  z-index: 4;
  display: flex;
  gap: 16px;
  align-items: center;
  justify-content: space-between;
  height: 42px;
  padding: 0 18px;
  font-family: 'Share Tech Mono', ui-monospace, monospace;
  font-size: 11px;
  letter-spacing: 0.06em;
  background: rgba(5, 6, 8, 0.92);
  border-top: 1px solid rgba(255, 255, 255, 0.06);
}

.telemetry-left,
.telemetry-right {
  display: flex;
  gap: 12px;
  align-items: center;
  min-width: 0;
}

.live {
  display: inline-flex;
  gap: 8px;
  align-items: center;
  color: #ff5a2c;
}

.live i {
  width: 7px;
  height: 7px;
  background: #ff3b1f;
  border-radius: 50%;
  box-shadow: 0 0 8px #ff3b1f;
}

.sep {
  color: rgba(255, 255, 255, 0.28);
}

.telemetry-left span:not(.live, .sep) {
  color: #c8ced6;
}

.coords {
  color: #d5dbe3;
}

.coords em {
  color: #8e97a6;
  font-style: normal;
}

.engine {
  color: #46d2ff;
  font-size: 10px;
  line-height: 1.15;
  text-align: right;
  letter-spacing: 0.12em;
}

.shake {
  animation: shake 0.42s ease;
}

@keyframes shake {
  0%,
  100% { transform: translateY(-50%) translateX(0); }
  25% { transform: translateY(-50%) translateX(-6px); }
  75% { transform: translateY(-50%) translateX(6px); }
}

@keyframes drift {
  from { transform: scale(1.4) translate3d(0, 0, 0); }
  to { transform: scale(1.4) translate3d(-2%, -1%, 0); }
}

@media (max-width: 980px) {
  .panel {
    right: 50%;
    transform: translate(50%, -50%);
  }

  .shake {
    animation-name: shake-center;
  }

  .telemetry-left span:nth-child(n + 4) {
    display: none;
  }
}

@keyframes shake-center {
  0%,
  100% { transform: translate(50%, -50%) translateX(0); }
  25% { transform: translate(50%, -50%) translateX(-6px); }
  75% { transform: translate(50%, -50%) translateX(6px); }
}

@media (max-height: 760px) {
  .panel {
    top: 12px;
    transform: none;
  }

  .shake {
    animation-name: shake-flat;
  }
}

@keyframes shake-flat {
  0%,
  100% { transform: translateX(0); }
  25% { transform: translateX(-6px); }
  75% { transform: translateX(6px); }
}

@media (max-width: 980px) and (max-height: 760px) {
  .panel {
    right: 50%;
    transform: translateX(50%);
  }

  .shake {
    animation-name: shake-flat-center;
  }
}

@keyframes shake-flat-center {
  0%,
  100% { transform: translateX(50%); }
  25% { transform: translateX(calc(50% - 6px)); }
  75% { transform: translateX(calc(50% + 6px)); }
}

@media (prefers-reduced-motion: reduce) {
  .shake {
    animation: none;
  }
}
</style>
