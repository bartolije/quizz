import type { Server, Socket } from 'socket.io'
import type {
  ClientToServerEvents,
  ServerToClientEvents,
  SessionMode,
} from '@lya-quiz/shared'
import { EVENTS, TEAM_PALETTE, TEAM_DRAW_NAMES } from '@lya-quiz/shared'
import type { SessionState } from '../state.js'
import {
  findSessionByHostSocket,
  findParticipantBySocket,
  getTeamsPayload,
} from '../session-helpers.js'
import { logEvent } from '../logger.js'
import { saveSessionSnapshot } from '../session-snapshot.js'
import { shuffle } from './buzzer.js'

type QuizSocket = Socket<ClientToServerEvents, ServerToClientEvents>
type QuizServer = Server<ClientToServerEvents, ServerToClientEvents>

const MAX_TEAMS = 6

// Source de vérité unique de l'état équipe → rediffusée à toute la room à chaque
// changement (mode, équipes, lock, assignations) + snapshot (survit à un restart).
function broadcastTeams(session: SessionState, io: QuizServer): void {
  saveSessionSnapshot(session)
  io.to(session.id).emit(EVENTS.TEAMS_UPDATED, getTeamsPayload(session))
}

// ── HOST ──────────────────────────────────────────────────────

// Basculer solo/équipe. Uniquement avant le démarrage (sinon le scoring cumulé
// deviendrait incohérent en cours de partie).
export function handleSetMode(
  socket: QuizSocket,
  payload: { mode: SessionMode },
  io: QuizServer,
): void {
  const session = findSessionByHostSocket(socket.id)
  if (!session || session.status !== 'waiting') return
  session.mode = payload.mode === 'team' ? 'team' : 'solo'
  logEvent('team_mode_changed', { sessionId: session.id, mode: session.mode })
  broadcastTeams(session, io)
}

export function handleAddTeam(
  socket: QuizSocket,
  payload: { name: string },
  io: QuizServer,
): void {
  const session = findSessionByHostSocket(socket.id)
  if (!session || session.status !== 'waiting') return
  const name = payload.name.trim().slice(0, 24)
  if (!name || session.teams.size >= MAX_TEAMS) return
  const id = crypto.randomUUID()
  const color = TEAM_PALETTE[session.teams.size % TEAM_PALETTE.length]!
  session.teams.set(id, { id, name, color })
  logEvent('team_added', { sessionId: session.id, teamId: id, name })
  broadcastTeams(session, io)
}

export function handleRemoveTeam(
  socket: QuizSocket,
  payload: { teamId: string },
  io: QuizServer,
): void {
  const session = findSessionByHostSocket(socket.id)
  if (!session || session.status !== 'waiting') return
  if (!session.teams.delete(payload.teamId)) return
  // Les membres de l'équipe supprimée repassent "sans équipe"
  for (const p of session.participants.values()) {
    if (p.teamId === payload.teamId) delete p.teamId
  }
  broadcastTeams(session, io)
}

export function handleLockTeams(
  socket: QuizSocket,
  payload: { locked: boolean },
  io: QuizServer,
): void {
  const session = findSessionByHostSocket(socket.id)
  if (!session) return
  session.teamsLocked = !!payload.locked
  broadcastTeams(session, io)
}

export function handleAssignParticipant(
  socket: QuizSocket,
  payload: { participantId: string; teamId: string | null },
  io: QuizServer,
): void {
  const session = findSessionByHostSocket(socket.id)
  if (!session) return
  const p = session.participants.get(payload.participantId)
  if (!p) return
  if (payload.teamId === null) {
    delete p.teamId
  } else {
    if (!session.teams.has(payload.teamId)) return
    p.teamId = payload.teamId
  }
  broadcastTeams(session, io)
}

// Équipe la moins remplie (la première en cas d'égalité) — undefined si aucune équipe.
export function smallestTeamId(session: SessionState): string | undefined {
  let best: string | undefined
  let bestSize = Infinity
  for (const id of session.teams.keys()) {
    let size = 0
    for (const p of session.participants.values()) if (p.teamId === id) size++
    if (size < bestSize) {
      best = id
      bestSize = size
    }
  }
  return best
}

// Répartit les joueurs sans équipe : chacun va dans l'équipe la moins remplie.
export function handleAutobalance(socket: QuizSocket, io: QuizServer): void {
  const session = findSessionByHostSocket(socket.id)
  if (!session || session.teams.size === 0) return
  for (const p of session.participants.values()) {
    if (!p.teamId) p.teamId = smallestTeamId(session)!
  }
  broadcastTeams(session, io)
}

// Tirage au sort (avant le démarrage) : remplace les équipes par `count` équipes
// aux noms/couleurs auto, y répartit TOUS les joueurs au hasard (tailles à ±1,
// déconnectés compris : un téléphone en veille revient) et verrouille.
export function handleDrawTeams(
  socket: QuizSocket,
  payload: { count: number },
  io: QuizServer,
): void {
  const session = findSessionByHostSocket(socket.id)
  if (!session || session.status !== 'waiting') return
  const count = Math.min(MAX_TEAMS, Math.max(2, Math.round(Number(payload?.count)) || 2))
  session.mode = 'team'
  session.teams.clear()
  for (let i = 0; i < count; i++) {
    const id = crypto.randomUUID()
    session.teams.set(id, { id, name: TEAM_DRAW_NAMES[i]!, color: TEAM_PALETTE[i]! })
  }
  const ids = [...session.teams.keys()]
  shuffle([...session.participants.values()]).forEach((p, i) => {
    p.teamId = ids[i % count]!
  })
  session.teamsLocked = true
  logEvent('teams_drawn', { sessionId: session.id, count, players: session.participants.size })
  broadcastTeams(session, io)
}

// ── PARTICIPANT ───────────────────────────────────────────────

// Rejoindre/quitter une équipe — seulement en mode équipe, avant le démarrage,
// et si le host n'a pas verrouillé.
export function handleJoinTeam(
  socket: QuizSocket,
  payload: { teamId: string | null },
  io: QuizServer,
): void {
  const ctx = findParticipantBySocket(socket.id)
  if (!ctx) return
  const { session, participant } = ctx
  if (session.mode !== 'team' || session.status !== 'waiting' || session.teamsLocked) return
  if (payload.teamId === null) {
    delete participant.teamId
  } else {
    if (!session.teams.has(payload.teamId)) return
    participant.teamId = payload.teamId
  }
  broadcastTeams(session, io)
}
