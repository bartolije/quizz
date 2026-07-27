import type { Server, Socket } from 'socket.io'
import type {
  ClientToServerEvents,
  ServerToClientEvents,
  SessionMode,
} from '@lya-quiz/shared'
import { EVENTS, TEAM_PALETTE } from '@lya-quiz/shared'
import type { SessionState } from '../state.js'
import {
  findSessionByHostSocket,
  findParticipantBySocket,
  getTeamsPayload,
} from '../session-helpers.js'
import { logEvent } from '../logger.js'
import { saveSessionSnapshot } from '../session-snapshot.js'

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

// Répartit les joueurs sans équipe : chacun va dans l'équipe la moins remplie.
export function handleAutobalance(socket: QuizSocket, io: QuizServer): void {
  const session = findSessionByHostSocket(socket.id)
  if (!session) return
  const teamIds = [...session.teams.keys()]
  if (teamIds.length === 0) return

  const sizes = new Map<string, number>(teamIds.map((id) => [id, 0]))
  for (const p of session.participants.values()) {
    if (p.teamId && sizes.has(p.teamId)) sizes.set(p.teamId, (sizes.get(p.teamId) ?? 0) + 1)
  }
  for (const p of session.participants.values()) {
    if (p.teamId) continue
    let best = teamIds[0]!
    for (const id of teamIds) {
      if ((sizes.get(id) ?? 0) < (sizes.get(best) ?? 0)) best = id
    }
    p.teamId = best
    sizes.set(best, (sizes.get(best) ?? 0) + 1)
  }
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
