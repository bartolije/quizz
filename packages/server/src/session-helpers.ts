import type {
  Participant,
  ParticipantScore,
  Question,
  QuestionPublic,
  SessionMode,
  Team,
  TeamScore,
} from '@lya-quiz/shared'
import { questionPoints } from '@lya-quiz/shared'
import type { SessionState, ParticipantState } from './state.js'
import { getAllSessions } from './state.js'

export function toParticipant(p: ParticipantState): Participant {
  return {
    id: p.id,
    pseudo: p.pseudo,
    connected: p.connected,
    // exactOptionalPropertyTypes : n'ajouter la clé que si une équipe est définie
    ...(p.teamId ? { teamId: p.teamId } : {}),
    ...(p.manual ? { manual: true } : {}),
    ...(p.bonus ? { bonus: p.bonus } : {}),
  }
}

// Question "publique" envoyée aux clients : jamais les bonnes réponses.
// choicesOverride : pour 'ordering', les items MÉLANGÉS à réordonner.
export function toPublicQuestion(
  q: Question,
  index: number,
  total: number,
  choicesOverride?: string[],
): QuestionPublic {
  const choices = choicesOverride ?? q.choices
  return {
    id: q.id,
    text: q.text,
    type: q.type,
    ...(choices ? { choices } : {}),
    ...(q.mediaUrl ? { mediaUrl: q.mediaUrl } : {}),
    timeLimit: q.timeLimit,
    index,
    total,
    // Mode buzzer : difficulté / points / section / owner exposés pour l'affichage
    // TV+host (jamais correctAnswers — révélées seulement à buzz_question_ended).
    ...(q.difficulty ? { difficulty: q.difficulty } : {}),
    ...(q.points || q.difficulty ? { points: questionPoints(q) } : {}),
    ...(q.section ? { section: q.section } : {}),
    ...(q.ownerName ? { ownerName: q.ownerName } : {}),
  }
}

export function getParticipantList(session: SessionState): Participant[] {
  return [...session.participants.values()].map(toParticipant)
}

export function getLeaderboard(session: SessionState): ParticipantScore[] {
  // Tri par score décroissant ; à score égal, ordre stable par pseudo (affichage
  // déterministe). Rang "standard competition" : les ex æquo partagent le rang,
  // le suivant saute (ex. 1, 1, 3).
  const sorted = [...session.participants.values()].sort(
    (a, b) => b.score - a.score || a.pseudo.localeCompare(b.pseudo),
  )

  let rank = 0
  let prevScore: number | null = null
  return sorted.map((p, index) => {
    if (prevScore === null || p.score !== prevScore) {
      rank = index + 1 // saut de rang après des ex æquo
      prevScore = p.score
    }
    return {
      participantId: p.id,
      pseudo: p.pseudo,
      score: p.score,
      delta: p.lastDelta, // points gagnés à la dernière question fermée
      rank,
    }
  })
}

export function isPseudoTaken(session: SessionState, pseudo: string): boolean {
  const normalized = pseudo.trim().toLowerCase()
  return [...session.participants.values()].some(
    (p) => p.pseudo.trim().toLowerCase() === normalized && p.connected,
  )
}

// ─────────────────────────────────────────────────────────────
// Mode équipe
// ─────────────────────────────────────────────────────────────

// Classement des équipes : somme des scores (et deltas de la dernière question)
// des membres. Les joueurs sans équipe ne comptent pour personne. Rang
// "standard competition" (ex æquo partagés) comme le classement individuel.
export function getTeamLeaderboard(session: SessionState): TeamScore[] {
  const agg = new Map<string, { score: number; delta: number }>()
  for (const team of session.teams.values()) agg.set(team.id, { score: 0, delta: 0 })
  for (const p of session.participants.values()) {
    if (!p.teamId) continue
    const a = agg.get(p.teamId)
    if (!a) continue
    a.score += p.score
    a.delta += p.lastDelta
  }

  const sorted = [...session.teams.values()]
    .map((t) => ({ team: t, agg: agg.get(t.id) ?? { score: 0, delta: 0 } }))
    .sort((a, b) => b.agg.score - a.agg.score || a.team.name.localeCompare(b.team.name))

  let rank = 0
  let prevScore: number | null = null
  return sorted.map((row, index) => {
    if (prevScore === null || row.agg.score !== prevScore) {
      rank = index + 1
      prevScore = row.agg.score
    }
    return {
      teamId: row.team.id,
      name: row.team.name,
      color: row.team.color,
      score: row.agg.score,
      delta: row.agg.delta,
      rank,
    }
  })
}

// État équipe complet à diffuser (teams_updated) ou à embarquer dans session_joined/restored.
export function getTeamsPayload(session: SessionState): {
  mode: SessionMode
  teams: Team[]
  locked: boolean
  participants: Participant[]
} {
  return {
    mode: session.mode,
    teams: [...session.teams.values()],
    locked: session.teamsLocked,
    participants: getParticipantList(session),
  }
}

// Résolveurs socket → session/participant (mode équipe). NB: game.ts a ses propres
// variantes ; ici on les expose pour les handlers d'équipe.
export function findSessionByHostSocket(socketId: string): SessionState | undefined {
  return getAllSessions().find((s) => s.hostSocketIds.has(socketId))
}

export function findParticipantBySocket(
  socketId: string,
): { session: SessionState; participant: ParticipantState } | undefined {
  for (const session of getAllSessions()) {
    for (const p of session.participants.values()) {
      if (p.socketId === socketId) return { session, participant: p }
    }
  }
  return undefined
}
