import type {
  Participant,
  ParticipantScore,
  Question,
  QuestionPublic,
} from '@lya-quiz/shared'
import type { SessionState, ParticipantState } from './state.js'

export function toParticipant(p: ParticipantState): Participant {
  return {
    id: p.id,
    pseudo: p.pseudo,
    connected: p.connected,
  }
}

// Question "publique" envoyée aux clients : jamais les bonnes réponses.
export function toPublicQuestion(
  q: Question,
  index: number,
  total: number,
): QuestionPublic {
  return {
    id: q.id,
    text: q.text,
    type: q.type,
    ...(q.choices ? { choices: q.choices } : {}),
    timeLimit: q.timeLimit,
    index,
    total,
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
    delta: p.lastDelta,   // points gagnés à la dernière question (ex æquo/rang affinés en S5)
    rank: index + 1,
  }))
}

export function isPseudoTaken(session: SessionState, pseudo: string): boolean {
  const normalized = pseudo.trim().toLowerCase()
  return [...session.participants.values()].some(
    (p) => p.pseudo.trim().toLowerCase() === normalized && p.connected,
  )
}
