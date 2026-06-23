import { useEffect, useRef, useState } from 'react'
import type {
  Participant,
  ParticipantScore,
  QuestionPublic,
  ServerToClientEvents,
  SessionStatus,
} from '@lya-quiz/shared'
import { EVENTS } from '@lya-quiz/shared'
import { socket } from '../socket'
import {
  readHostSession,
  writeHostSession,
  createHostSession,
  fetchSessionInfo,
} from '../host-session'

type HostMode = 'control' | 'display'

export interface RevealState {
  correctAnswers: string[]
  distribution: { value: string; count: number }[]
  scores: ParticipantScore[]
  answeredCount: number
  correctCount: number
}

interface HostSessionView {
  pin: string | null
  sessionId: string | null
  participants: Participant[]
  status: SessionStatus
  error: string | null
  // Jeu (S4)
  currentQuestion: QuestionPublic | null
  questionStartedAt: number | null   // horloge client (réception) pour le timer
  answeredCount: number
  totalCount: number
  reveal: RevealState | null
  // Classement (S5)
  leaderboard: ParticipantScore[]
  prevRanks: Record<string, number>
  showingLeaderboard: boolean
  leaderboardFinal: boolean
  start: () => void
  next: () => void
  showLeaderboard: () => void
  endQuiz: () => void
}

const ranksOf = (lb: ParticipantScore[]): Record<string, number> =>
  Object.fromEntries(lb.map((s) => [s.participantId, s.rank]))

// Types de payload dérivés du contrat → garantit l'alignement avec events.ts
type JoinedPayload = Parameters<ServerToClientEvents['session_joined']>[0]
type JoinPayload = Parameters<ServerToClientEvents['participant_joined']>[0]
type LeftPayload = Parameters<ServerToClientEvents['participant_left']>[0]
type StatusPayload = Parameters<ServerToClientEvents['session_status_changed']>[0]
type QStartedPayload = Parameters<ServerToClientEvents['question_started']>[0]
type AckPayload = Parameters<ServerToClientEvents['answer_received']>[0]
type QEndedPayload = Parameters<ServerToClientEvents['question_ended']>[0]
type LbPayload = Parameters<ServerToClientEvents['leaderboard_update']>[0]

function upsert(list: Participant[], p: Participant): Participant[] {
  return list.some((x) => x.id === p.id)
    ? list.map((x) => (x.id === p.id ? p : x))
    : [...list, p]
}

/**
 * Résout/crée la session host et maintient l'état du jeu à jour via Socket.io.
 * `control` crée la session (POST), `display` la résout (localStorage ou
 * ?session= via GET). StrictMode-safe (ref guard + 2 effects).
 */
export function useHostSession(mode: HostMode): HostSessionView {
  const [pin, setPin] = useState<string | null>(null)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [participants, setParticipants] = useState<Participant[]>([])
  const [status, setStatus] = useState<SessionStatus>('waiting')
  const [error, setError] = useState<string | null>(null)

  // État du jeu (S4)
  const [currentQuestion, setCurrentQuestion] = useState<QuestionPublic | null>(null)
  const [questionStartedAt, setQuestionStartedAt] = useState<number | null>(null)
  const [answeredCount, setAnsweredCount] = useState(0)
  const [totalCount, setTotalCount] = useState(0)
  const [reveal, setReveal] = useState<RevealState | null>(null)

  // Classement (S5)
  const [leaderboard, setLeaderboard] = useState<ParticipantScore[]>([])
  const [prevRanks, setPrevRanks] = useState<Record<string, number>>({})
  const [showingLeaderboard, setShowingLeaderboard] = useState(false)
  const [leaderboardFinal, setLeaderboardFinal] = useState(false)
  const leaderboardRef = useRef<ParticipantScore[]>([])

  const resolvedRef = useRef(false)

  // Effet 1 — résolution one-shot (évite la double création en StrictMode dev)
  useEffect(() => {
    if (resolvedRef.current) return
    resolvedRef.current = true

    void (async () => {
      const stored = readHostSession()
      const urlSession = new URLSearchParams(window.location.search).get('session')

      try {
        if (mode === 'control') {
          if (stored) {
            setPin(stored.pin)
            setSessionId(stored.sessionId)
          } else {
            const created = await createHostSession()
            writeHostSession(created)
            setPin(created.pin)
            setSessionId(created.sessionId)
          }
          return
        }

        // mode 'display' : résoudre une session existante
        const targetId = urlSession ?? stored?.sessionId ?? null
        if (!targetId) {
          setError('Aucune session. Ouvre d’abord /host/control.')
          return
        }
        const info = await fetchSessionInfo(targetId)
        if (!info) {
          setError('Session introuvable ou expirée.')
          return
        }
        setParticipants(info.participants)
        setStatus(info.status)
        setPin(info.pin)
        setSessionId(info.sessionId)
      } catch {
        setError('Erreur de connexion au serveur.')
      }
    })()
  }, [mode])

  // Effet 2 — listeners temps réel + host_join, rebranchés quand le pin change
  useEffect(() => {
    if (!pin) return

    const onJoined = (p: JoinedPayload) => {
      // SESSION_JOINED = source de vérité (gère une session recréée côté serveur)
      setPin(p.session.pin)
      setSessionId(p.sessionId)
      setParticipants(p.participants)
      setStatus(p.session.status)
      writeHostSession({ sessionId: p.sessionId, pin: p.session.pin })
    }
    const onJoin = (p: JoinPayload) =>
      setParticipants((prev) => upsert(prev, p.participant))
    const onLeft = (p: LeftPayload) =>
      setParticipants((prev) =>
        prev.map((x) => (x.id === p.participantId ? { ...x, connected: false } : x)),
      )
    const onStatus = (p: StatusPayload) => setStatus(p.status)

    const onQuestion = (p: QStartedPayload) => {
      setCurrentQuestion(p.question)
      setQuestionStartedAt(Date.now())
      setReveal(null)
      setAnsweredCount(0)
      setTotalCount(0)
      setShowingLeaderboard(false)
      setLeaderboardFinal(false)
    }
    const onAck = (p: AckPayload) => {
      setAnsweredCount(p.answeredCount)
      setTotalCount(p.totalCount)
    }
    const onEnded = (p: QEndedPayload) => {
      setReveal({
        correctAnswers: p.correctAnswers,
        distribution: p.distribution,
        scores: p.scores,
        answeredCount: p.answeredCount,
        correctCount: p.correctCount,
      })
      setQuestionStartedAt(null) // stoppe le timer ; on garde currentQuestion pour la révélation
    }
    const onLeaderboard = (p: LbPayload) => {
      setPrevRanks(ranksOf(leaderboardRef.current)) // rangs d'avant cette MAJ
      leaderboardRef.current = p.scores
      setLeaderboard(p.scores)
      setShowingLeaderboard(!p.final)
      setLeaderboardFinal(p.final)
    }

    socket.on(EVENTS.SESSION_JOINED, onJoined)
    socket.on(EVENTS.PARTICIPANT_JOINED, onJoin)
    socket.on(EVENTS.PARTICIPANT_LEFT, onLeft)
    socket.on(EVENTS.SESSION_STATUS_CHANGED, onStatus)
    socket.on(EVENTS.QUESTION_STARTED, onQuestion)
    socket.on(EVENTS.ANSWER_RECEIVED, onAck)
    socket.on(EVENTS.QUESTION_ENDED, onEnded)
    socket.on(EVENTS.LEADERBOARD_UPDATE, onLeaderboard)

    const join = () => socket.emit(EVENTS.HOST_JOIN, { pin })
    if (!socket.connected) socket.connect()
    if (socket.connected) join()
    else socket.once('connect', join)

    return () => {
      socket.off(EVENTS.SESSION_JOINED, onJoined)
      socket.off(EVENTS.PARTICIPANT_JOINED, onJoin)
      socket.off(EVENTS.PARTICIPANT_LEFT, onLeft)
      socket.off(EVENTS.SESSION_STATUS_CHANGED, onStatus)
      socket.off(EVENTS.QUESTION_STARTED, onQuestion)
      socket.off(EVENTS.ANSWER_RECEIVED, onAck)
      socket.off(EVENTS.QUESTION_ENDED, onEnded)
      socket.off(EVENTS.LEADERBOARD_UPDATE, onLeaderboard)
      socket.off('connect', join)
    }
  }, [pin])

  const start = () => socket.emit(EVENTS.HOST_START_QUIZ, {})
  const next = () => socket.emit(EVENTS.HOST_NEXT_QUESTION, {})
  const showLeaderboard = () => socket.emit(EVENTS.HOST_SHOW_LEADERBOARD, {})
  const endQuiz = () => socket.emit(EVENTS.HOST_END_QUIZ, {})

  return {
    pin,
    sessionId,
    participants,
    status,
    error,
    currentQuestion,
    questionStartedAt,
    answeredCount,
    totalCount,
    reveal,
    leaderboard,
    prevRanks,
    showingLeaderboard,
    leaderboardFinal,
    start,
    next,
    showLeaderboard,
    endQuiz,
  }
}
