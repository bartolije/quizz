import type { Quiz, QuestionReport, SessionMode, Team } from '@lya-quiz/shared'
import { sqlite } from './db.js'
import {
  restoreSession,
  type SessionState,
  type ParticipantState,
  type PendingAnswer,
} from './state.js'
import { logEvent, logError } from './logger.js'

// ─────────────────────────────────────────────────────────────
// Filet anti-restart : snapshot des sessions de jeu dans SQLite
// (Volume Railway) + restauration au démarrage du process.
//
// Sans lui, un redeploy / crash / OOM en pleine soirée perdait TOUT
// (PIN, participants, scores). Avec lui : les tokens des téléphones
// redeviennent valides au reboot → reconnexion transparente ; seule la
// question OUVERTE au moment du crash est rejouée (index décrémenté,
// réponses en vol abandonnées — le host relance la question).
//
// Écriture synchrone better-sqlite3 (~quelques dizaines de Ko) : négligeable.
// Points de sauvegarde : création, join, début/fin de question, changement
// de statut, équipes. Purge : fin de quiz + snapshots de plus de 12 h.
// ─────────────────────────────────────────────────────────────

const SNAPSHOT_MAX_AGE_MS = 12 * 60 * 60 * 1000 // 12 h

// Version du format — à incrémenter si la forme sérialisée change
const SNAPSHOT_VERSION = 1

interface SnapshotParticipant {
  id: string
  pseudo: string
  sessionToken: string
  score: number
  lastDelta: number
  correctTotal: number
  teamId?: string
}

interface Snapshot {
  v: number
  id: string
  pin: string
  hostKey?: string   // absent des snapshots antérieurs à 07/2026
  status: 'waiting' | 'running' | 'ended'
  currentQuestionIndex: number
  participants: SnapshotParticipant[]
  answers: [string, PendingAnswer][]
  currentShuffled: string[] | null
  results: QuestionReport[]
  lastQuestionResults: [string, { gained: number; correct: boolean }][] | null
  lastCorrectAnswers: string[] | null
  quiz: Quiz | null
  mode: SessionMode
  teams: Team[]
  teamsLocked: boolean
}

const upsertStmt = sqlite.prepare(
  'INSERT INTO session_snapshots (id, data, updated_at) VALUES (?, ?, ?) ' +
    'ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at',
)
const deleteStmt = sqlite.prepare('DELETE FROM session_snapshots WHERE id = ?')
const selectAllStmt = sqlite.prepare('SELECT id, data, updated_at FROM session_snapshots')

export function serializeSession(session: SessionState): string {
  // Question OUVERTE au moment du snapshot : on la considère comme « à rejouer »
  // (index décrémenté, réponses en vol abandonnées). Le scoring d'une question ne
  // tombe qu'à sa fermeture → aucun point n'est perdu, le host relance simplement
  // la question interrompue.
  const openQuestion = session.questionStartedAt !== null
  // Mode buzzer : une question buzzer non révélée est aussi « à rejouer » au boot
  // (pas de timer, mais l'état buzzer est transient → on la relance, index décrémenté).
  const openBuzzer = session.buzz !== null && session.buzz.phase !== 'revealed'

  const snap: Snapshot = {
    v: SNAPSHOT_VERSION,
    id: session.id,
    pin: session.pin,
    hostKey: session.hostKey,
    status: session.status,
    currentQuestionIndex: openQuestion || openBuzzer
      ? session.currentQuestionIndex - 1
      : session.currentQuestionIndex,
    participants: [...session.participants.values()].map((p) => ({
      id: p.id,
      pseudo: p.pseudo,
      sessionToken: p.sessionToken,
      score: p.score,
      lastDelta: p.lastDelta,
      correctTotal: p.correctTotal,
      ...(p.teamId !== undefined ? { teamId: p.teamId } : {}),
    })),
    answers: openQuestion ? [] : [...session.answers.entries()],
    currentShuffled: openQuestion ? null : session.currentShuffled,
    results: session.results,
    lastQuestionResults: openQuestion
      ? null
      : session.lastQuestionResults
        ? [...session.lastQuestionResults.entries()]
        : null,
    lastCorrectAnswers: openQuestion ? null : session.lastCorrectAnswers,
    quiz: session.quiz,
    mode: session.mode,
    teams: [...session.teams.values()],
    teamsLocked: session.teamsLocked,
  }
  return JSON.stringify(snap)
}

export function deserializeSession(json: string): SessionState {
  const snap = JSON.parse(json) as Snapshot

  const participants = new Map<string, ParticipantState>()
  const tokenIndex = new Map<string, string>()
  for (const p of snap.participants) {
    participants.set(p.id, {
      id: p.id,
      pseudo: p.pseudo,
      socketId: '',        // plus aucun socket après un restart
      sessionToken: p.sessionToken,
      connected: false,    // les téléphones vont se reconnecter d'eux-mêmes
      score: p.score,
      lastDelta: p.lastDelta,
      correctTotal: p.correctTotal,
      ...(p.teamId !== undefined ? { teamId: p.teamId } : {}),
    })
    tokenIndex.set(p.sessionToken, p.id)
  }

  return {
    id: snap.id,
    pin: snap.pin,
    // Vieux snapshot sans hostKey : clé inconnaissable → le host recréera une
    // session proprement (pas de session pilotable par n'importe qui).
    hostKey: snap.hostKey ?? `perdu:${snap.id}`,
    status: snap.status,
    participants,
    tokenIndex,
    hostSocketIds: new Set(),
    currentQuestionIndex: snap.currentQuestionIndex,
    questionStartedAt: null, // jamais de question ouverte au restore (rejouée)
    answers: new Map(snap.answers),
    currentShuffled: snap.currentShuffled,
    results: snap.results,
    lastQuestionResults: snap.lastQuestionResults ? new Map(snap.lastQuestionResults) : null,
    lastCorrectAnswers: snap.lastCorrectAnswers,
    questionTimer: null,
    quiz: snap.quiz,
    mode: snap.mode,
    teams: new Map(snap.teams.map((t) => [t.id, t])),
    teamsLocked: snap.teamsLocked,
    buzz: null,               // aucune question buzzer active après un restart (rejouée)
    ownerBindings: new Map(), // bindings owner→participant refaits au (re)join
  }
}

// Sauvegarde (synchrone, ~ms). Ne doit JAMAIS faire tomber un handler → try/catch.
export function saveSessionSnapshot(session: SessionState): void {
  try {
    upsertStmt.run(session.id, serializeSession(session), Date.now())
  } catch (e) {
    logError('snapshot_save_failed', e, { sessionId: session.id })
  }
}

export function deleteSessionSnapshot(sessionId: string): void {
  try {
    deleteStmt.run(sessionId)
  } catch (e) {
    logError('snapshot_delete_failed', e, { sessionId })
  }
}

// Au boot : recharge les sessions actives récentes, purge le reste.
export function restoreSessionsAtBoot(): number {
  const now = Date.now()
  let restored = 0
  try {
    const rows = selectAllStmt.all() as { id: string; data: string; updated_at: number }[]
    for (const row of rows) {
      if (now - row.updated_at > SNAPSHOT_MAX_AGE_MS) {
        deleteStmt.run(row.id)
        continue
      }
      try {
        const session = deserializeSession(row.data)
        if (session.status === 'ended') {
          deleteStmt.run(row.id)
          continue
        }
        restoreSession(session)
        restored++
        logEvent('session_restored_from_snapshot', {
          sessionId: session.id,
          pin: session.pin,
          participants: session.participants.size,
          questionIndex: session.currentQuestionIndex,
        })
      } catch (e) {
        logError('snapshot_restore_failed', e, { sessionId: row.id })
        deleteStmt.run(row.id) // snapshot illisible → on purge, pas de crash-loop
      }
    }
  } catch (e) {
    logError('snapshot_boot_scan_failed', e)
  }
  return restored
}
