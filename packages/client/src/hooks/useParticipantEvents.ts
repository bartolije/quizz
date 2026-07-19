import { useEffect } from 'react'
import type { ServerToClientEvents } from '@lya-quiz/shared'
import { EVENTS } from '@lya-quiz/shared'
import { socket } from '../socket'
import { useQuizStore } from '../store/quiz-store'
import { vibrate } from '../haptics'

type QStarted = Parameters<ServerToClientEvents['question_started']>[0]
type QEnded = Parameters<ServerToClientEvents['question_ended']>[0]
type PJoin = Parameters<ServerToClientEvents['participant_joined']>[0]
type PLeft = Parameters<ServerToClientEvents['participant_left']>[0]
type Status = Parameters<ServerToClientEvents['session_status_changed']>[0]
type Leaderboard = Parameters<ServerToClientEvents['leaderboard_update']>[0]
type Restored = Parameters<ServerToClientEvents['session_restored']>[0]
type TeamsUpdated = Parameters<ServerToClientEvents['teams_updated']>[0]
type QuizErr = Parameters<ServerToClientEvents['quiz_error']>[0]
type BuzzStarted = Parameters<ServerToClientEvents['buzz_question_started']>[0]
type BuzzStateP = Parameters<ServerToClientEvents['buzz_state']>[0]
type BuzzEnded = Parameters<ServerToClientEvents['buzz_question_ended']>[0]

/**
 * Branche les listeners temps réel du participant pendant la partie.
 * Monté une seule fois par le shell participant (ParticipantApp). On lit le
 * store via getState() dans les handlers → pas de stale closure, pas de
 * re-subscription. StrictMode-safe (on/off appariés).
 */
export function useParticipantEvents(): void {
  useEffect(() => {
    const store = useQuizStore.getState
    const onStarted = (p: QStarted) => {
      vibrate(80) // nouvelle question (Android ; no-op iOS)
      store().onQuestionStarted(p.question, p.timeElapsed)
    }
    const onEnded = (p: QEnded) => {
      vibrate([60, 40, 60]) // fin de question
      store().onQuestionEnded(p)
    }
    const onJoin = (p: PJoin) => store().setParticipantJoined(p.participant)
    const onLeft = (p: PLeft) => store().setParticipantLeft(p.participantId)
    const onStatus = (p: Status) => {
      if (p.status === 'running' && store().sessionStatus !== 'running') vibrate(60) // « c'est parti ! »
      store().onStatusChanged(p.status)
    }
    const onLeaderboard = (p: Leaderboard) => store().onLeaderboard(p.scores, p.final, p.teamScores)
    const onRestored = (p: Restored) => store().onSessionRestored(p)
    const onTeams = (p: TeamsUpdated) => store().onTeamsUpdated(p)
    // Mode buzzer
    const onBuzzStarted = (p: BuzzStarted) => {
      vibrate(80) // nouvelle question (Android)
      store().onBuzzQuestionStarted(p.question, p.buzz)
    }
    const onBuzzState = (p: BuzzStateP) => {
      // Vibration quand JE prends la parole (mon buzz a gagné). p peut être null
      // (thème terminé → retour au sélecteur) : le tél revient en écran d'attente.
      if (p?.lockedBy?.participantId === store().myId) vibrate([40, 30, 40])
      store().onBuzzState(p)
    }
    const onBuzzEnded = (p: BuzzEnded) => store().onBuzzQuestionEnded(p)
    // Session perdue EN PLEINE PARTIE (restart serveur → rejoin_session répond
    // INVALID_TOKEN). Sans ce listener, le téléphone restait gelé pour toujours :
    // ParticipantApp n'écoute cette erreur que pendant la phase de reprise (myId
    // null). Guard sur myId pour ne pas doubler ce chemin-là.
    const onFatal = (e: QuizErr) => {
      if (e.code !== 'INVALID_TOKEN' && e.code !== 'SESSION_ENDED' && e.code !== 'KICKED') return
      if (!store().myId) return
      localStorage.removeItem('lya_quiz_token')
      store().onSessionLost(
        e.code === 'KICKED'
          ? "Tu as été retiré de la partie par l'animateur."
          : e.code === 'SESSION_ENDED'
            ? 'Cette session est terminée.'
            : 'La partie a été réinitialisée côté serveur. Re-rejoins avec le PIN affiché à l’écran.',
      )
    }

    socket.on(EVENTS.QUESTION_STARTED, onStarted)
    socket.on(EVENTS.QUESTION_ENDED, onEnded)
    socket.on(EVENTS.PARTICIPANT_JOINED, onJoin)
    socket.on(EVENTS.PARTICIPANT_LEFT, onLeft)
    socket.on(EVENTS.SESSION_STATUS_CHANGED, onStatus)
    socket.on(EVENTS.LEADERBOARD_UPDATE, onLeaderboard)
    socket.on(EVENTS.SESSION_RESTORED, onRestored)
    socket.on(EVENTS.TEAMS_UPDATED, onTeams)
    socket.on(EVENTS.BUZZ_QUESTION_STARTED, onBuzzStarted)
    socket.on(EVENTS.BUZZ_STATE, onBuzzState)
    socket.on(EVENTS.BUZZ_QUESTION_ENDED, onBuzzEnded)
    socket.on(EVENTS.QUIZ_ERROR, onFatal)

    return () => {
      socket.off(EVENTS.QUESTION_STARTED, onStarted)
      socket.off(EVENTS.QUESTION_ENDED, onEnded)
      socket.off(EVENTS.PARTICIPANT_JOINED, onJoin)
      socket.off(EVENTS.PARTICIPANT_LEFT, onLeft)
      socket.off(EVENTS.SESSION_STATUS_CHANGED, onStatus)
      socket.off(EVENTS.LEADERBOARD_UPDATE, onLeaderboard)
      socket.off(EVENTS.SESSION_RESTORED, onRestored)
      socket.off(EVENTS.TEAMS_UPDATED, onTeams)
      socket.off(EVENTS.BUZZ_QUESTION_STARTED, onBuzzStarted)
      socket.off(EVENTS.BUZZ_STATE, onBuzzState)
      socket.off(EVENTS.BUZZ_QUESTION_ENDED, onBuzzEnded)
      socket.off(EVENTS.QUIZ_ERROR, onFatal)
    }
  }, [])
}
