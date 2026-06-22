import type { Participant, ParticipantScore } from '@lya-quiz/shared'
import type { SessionState, ParticipantState } from './state.js'

export function toParticipant(p: ParticipantState): Participant {
  return {
    id: p.id,
    pseudo: p.pseudo,
    connected: p.connected,
  }
}

export function getParticipantList(session: SessionState): Participant[] {
  return [...session.participants.values()].map(toParticipant)
}

export function getLeaderboard(session: SessionState): ParticipantScore[] {
  const sorted = [...session.participants.values()]
    .sort((a, b) => b.score - a.score)

  return sorted.map((p, index) => ({
    participantId: p.id,
    pseudo: p.pseudo,
    score: p.score,
    delta: 0,   // sera rempli en S5
    rank: index + 1,
  }))
}

export function isPseudoTaken(session: SessionState, pseudo: string): boolean {
  const normalized = pseudo.trim().toLowerCase()
  return [...session.participants.values()].some(
    (p) => p.pseudo.trim().toLowerCase() === normalized && p.connected,
  )
}
