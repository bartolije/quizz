import type { Participant, SessionStatus } from '@lya-quiz/shared'
import { apiUrl } from './config'

// Identité de la session host, persistée pour survivre à un refresh (cf. S3 spec).
const HOST_KEY = 'lya_host_session'

export interface HostSession {
  sessionId: string
  pin: string
}

export function readHostSession(): HostSession | null {
  try {
    const raw = localStorage.getItem(HOST_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<HostSession>
    if (typeof parsed.sessionId === 'string' && typeof parsed.pin === 'string') {
      return { sessionId: parsed.sessionId, pin: parsed.pin }
    }
    return null
  } catch {
    return null
  }
}

export function writeHostSession(s: HostSession): void {
  localStorage.setItem(HOST_KEY, JSON.stringify(s))
}

// POST /api/sessions → crée une nouvelle session.
// apiUrl() : relatif en dev (proxy Vite), absolu vers Railway en prod.
export async function createHostSession(): Promise<HostSession> {
  const res = await fetch(apiUrl('/api/sessions'), { method: 'POST' })
  if (!res.ok) throw new Error('Création de session impossible')
  const data = (await res.json()) as { pin: string; sessionId: string }
  return { sessionId: data.sessionId, pin: data.pin }
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
  const res = await fetch(apiUrl(`/api/sessions/${encodeURIComponent(id)}`))
  if (!res.ok) return null
  return (await res.json()) as SessionInfo
}
