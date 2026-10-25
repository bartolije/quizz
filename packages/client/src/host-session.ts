import type { Participant, SessionStatus, GameReport } from '@lya-quiz/shared'
import { getPw } from './admin-api'

// Identité de la session host, persistée pour survivre à un refresh (cf. S3 spec).
const HOST_KEY = 'lya_host_session'

export interface HostSession {
  sessionId: string
  pin: string
  // Secret du host (retourné par POST /api/sessions) : exigé par host_join —
  // le PIN affiché sur la TV ne suffit plus à prendre le contrôle de la partie.
  hostKey?: string
}

export function readHostSession(): HostSession | null {
  try {
    const raw = localStorage.getItem(HOST_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<HostSession>
    if (typeof parsed.sessionId === 'string' && typeof parsed.pin === 'string') {
      return {
        sessionId: parsed.sessionId,
        pin: parsed.pin,
        ...(typeof parsed.hostKey === 'string' ? { hostKey: parsed.hostKey } : {}),
      }
    }
    return null
  } catch {
    return null
  }
}

export function writeHostSession(s: HostSession): void {
  localStorage.setItem(HOST_KEY, JSON.stringify(s))
}

export function clearHostSession(): void {
  localStorage.removeItem(HOST_KEY)
}

// Erreur levée quand le serveur refuse la création (mot de passe admin absent/faux).
export const ADMIN_REQUIRED = 'admin_required'

// POST /api/sessions → crée une nouvelle session. Réservé à l'animateur : on
// envoie le mot de passe admin mémorisé par /admin sur ce navigateur.
export async function createHostSession(): Promise<HostSession> {
  const res = await fetch('/api/sessions', { method: 'POST', headers: { 'x-admin-password': getPw() } })
  if (res.status === 401 || res.status === 503) throw new Error(ADMIN_REQUIRED)
  if (!res.ok) throw new Error('Création de session impossible')
  const data = (await res.json()) as { pin: string; sessionId: string; hostKey: string }
  return { sessionId: data.sessionId, pin: data.pin, hostKey: data.hostKey }
}

export interface SessionInfo {
  pin: string
  sessionId: string
  status: SessionStatus
  participants: Participant[]
}

// GET /api/sessions/:id → résout pin + état initial (bootstrap one-shot pour
// /host/display ouvert via ?session=XXXX). null si la session n'existe plus.
export async function fetchSessionInfo(id: string): Promise<SessionInfo | null> {
  const res = await fetch(`/api/sessions/${encodeURIComponent(id)}`)
  if (!res.ok) return null
  return (await res.json()) as SessionInfo
}

// GET /api/sessions/:id/report → rapport de fin de partie (stats + classement).
export async function fetchReport(id: string): Promise<GameReport | null> {
  const res = await fetch(`/api/sessions/${encodeURIComponent(id)}/report`)
  if (!res.ok) return null
  return (await res.json()) as GameReport
}
