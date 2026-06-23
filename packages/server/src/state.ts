import { v4 as uuid } from 'uuid'
import type { Quiz } from '@lya-quiz/shared'
import { SESSION_TOKEN_TTL_MS } from '@lya-quiz/shared'
import { SEED_QUIZ } from './seed-quiz.js'

export interface ParticipantState {
  id: string                // uuid stable, identifie le participant
  pseudo: string
  socketId: string          // socket.id courant, change à chaque reconnexion
  sessionToken: string      // uuid stable, stocké dans localStorage client
  connected: boolean
  score: number             // score cumulé
  lastDelta: number         // points gagnés à la dernière question fermée
  disconnectedAt?: number   // timestamp, pour cleanup après TTL
}

// Réponse en cours d'un participant à la question ouverte
export interface PendingAnswer {
  value: string | number
  submittedAt: number       // timestamp serveur
}

export interface SessionState {
  id: string
  pin: string
  status: 'waiting' | 'running' | 'ended'
  participants: Map<string, ParticipantState>    // clé = participantId
  tokenIndex: Map<string, string>                // sessionToken → participantId
  hostSocketIds: Set<string>                     // plusieurs onglets host possibles
  currentQuestionIndex: number                   // -1 = quiz pas encore démarré
  questionStartedAt: number | null               // null = aucune question ouverte
  answers: Map<string, PendingAnswer>            // réponses de la question courante (clé = participantId)
  questionTimer: ReturnType<typeof setTimeout> | null
  quiz: Quiz | null   // seedé en mémoire en S4, viendra de la DB en S8
}

// Toutes les sessions actives en mémoire
const sessions = new Map<string, SessionState>()

// Index PIN → sessionId pour join rapide
const pinIndex = new Map<string, string>()

export function generatePin(): string {
  // PIN 4 chiffres, pas déjà utilisé
  let pin: string
  do {
    pin = String(Math.floor(1000 + Math.random() * 9000))
  } while (pinIndex.has(pin))
  return pin
}

export function createSession(): SessionState {
  const id = uuid()
  const pin = generatePin()
  const session: SessionState = {
    id,
    pin,
    status: 'waiting',
    participants: new Map(),
    tokenIndex: new Map(),
    hostSocketIds: new Set(),
    currentQuestionIndex: -1,
    questionStartedAt: null,
    answers: new Map(),
    questionTimer: null,
    quiz: SEED_QUIZ,   // S4 : quiz de démo en mémoire (remplacé par la DB en S8)
  }
  sessions.set(id, session)
  pinIndex.set(pin, id)
  return session
}

export function getSessionByPin(pin: string): SessionState | undefined {
  const id = pinIndex.get(pin)
  return id ? sessions.get(id) : undefined
}

export function getSessionById(id: string): SessionState | undefined {
  return sessions.get(id)
}

// Toutes les sessions actives (import statique propre, remplace le placeholder S2)
export function getAllSessions(): SessionState[] {
  return [...sessions.values()]
}

export function deleteSession(id: string): void {
  const session = sessions.get(id)
  if (session) {
    pinIndex.delete(session.pin)
    sessions.delete(id)
  }
}

// Cleanup des participants déconnectés depuis plus de SESSION_TOKEN_TTL_MS
export function cleanupDisconnectedParticipants(session: SessionState): void {
  const now = Date.now()
  for (const [id, p] of session.participants) {
    if (!p.connected && p.disconnectedAt && now - p.disconnectedAt > SESSION_TOKEN_TTL_MS) {
      session.tokenIndex.delete(p.sessionToken)
      session.participants.delete(id)
    }
  }
}
