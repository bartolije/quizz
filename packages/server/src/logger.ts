import pino from 'pino'

// Logger structuré (JSON) — capturé par Railway (Deployments → Logs).
// Niveau pilotable par LOG_LEVEL (défaut info).
export const log = pino({ level: process.env['LOG_LEVEL'] ?? 'info' })

// Événement métier homogène : { evt, ...fields }. Filtrable dans Railway en
// cherchant le nom d'evt (ex. "question_closed") ou un sessionId.
export function logEvent(evt: string, fields: Record<string, unknown> = {}): void {
  log.info({ evt, ...fields }, evt)
}

export function logWarn(evt: string, fields: Record<string, unknown> = {}): void {
  log.warn({ evt, ...fields }, evt)
}

export function logError(evt: string, err: unknown, fields: Record<string, unknown> = {}): void {
  const e = err as { message?: string; stack?: string } | undefined
  log.error({ evt, err: e?.message ?? String(err), stack: e?.stack, ...fields }, evt)
}
