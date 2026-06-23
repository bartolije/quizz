import { apiUrl } from './config'

// Remonte les erreurs JS du client (téléphone/host) vers le serveur (S10).
// Throttle simple pour éviter le spam si un écran boucle sur une erreur.
const MAX_PER_MIN = 10
let windowStart = Date.now()
let sent = 0

function post(level: string, message: string, stack?: string, extra?: Record<string, unknown>): void {
  const now = Date.now()
  if (now - windowStart > 60_000) {
    windowStart = now
    sent = 0
  }
  if (sent >= MAX_PER_MIN || !message) return
  sent++

  void fetch(apiUrl('/api/client-log'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    keepalive: true,
    body: JSON.stringify({
      level,
      message: message.slice(0, 500),
      stack: stack?.slice(0, 2000),
      context: { path: window.location.pathname, ua: navigator.userAgent, ...extra },
    }),
  }).catch(() => {
    /* ne jamais logger l'échec du log (éviter les boucles) */
  })
}

export function reportClientError(
  message: string,
  stack?: string,
  extra?: Record<string, unknown>,
): void {
  post('error', message, stack, extra)
}

// Branche les handlers globaux. Appelé une fois au démarrage (main.tsx).
export function installErrorReporting(): void {
  window.addEventListener('error', (e) => {
    post('error', e.message || 'window.onerror', (e.error as Error | undefined)?.stack)
  })
  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason as { message?: string; stack?: string } | undefined
    post('error', r?.message ?? String(e.reason), r?.stack)
  })
}
