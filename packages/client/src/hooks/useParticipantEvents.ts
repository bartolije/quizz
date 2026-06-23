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
      store().onQuestionStarted(p.question)
    }
    const onEnded = (p: QEnded) => {
      vibrate([60, 40, 60]) // fin de question
      store().onQuestionEnded(p)
    }
    const onJoin = (p: PJoin) => store().setParticipantJoined(p.participant)
    const onLeft = (p: PLeft) => store().setParticipantLeft(p.participantId)
    const onStatus = (p: Status) => {
      if (p.status === 'ended') store().onQuizEnded()
    }
    const onLeaderboard = (p: Leaderboard) => store().onLeaderboard(p.scores, p.final)
    const onRestored = (p: Restored) => store().onSessionRestored(p)

    socket.on(EVENTS.QUESTION_STARTED, onStarted)
    socket.on(EVENTS.QUESTION_ENDED, onEnded)
    socket.on(EVENTS.PARTICIPANT_JOINED, onJoin)
    socket.on(EVENTS.PARTICIPANT_LEFT, onLeft)
    socket.on(EVENTS.SESSION_STATUS_CHANGED, onStatus)
    socket.on(EVENTS.LEADERBOARD_UPDATE, onLeaderboard)
    socket.on(EVENTS.SESSION_RESTORED, onRestored)

    return () => {
      socket.off(EVENTS.QUESTION_STARTED, onStarted)
      socket.off(EVENTS.QUESTION_ENDED, onEnded)
      socket.off(EVENTS.PARTICIPANT_JOINED, onJoin)
      socket.off(EVENTS.PARTICIPANT_LEFT, onLeft)
      socket.off(EVENTS.SESSION_STATUS_CHANGED, onStatus)
      socket.off(EVENTS.LEADERBOARD_UPDATE, onLeaderboard)
      socket.off(EVENTS.SESSION_RESTORED, onRestored)
    }
  }, [])
}
