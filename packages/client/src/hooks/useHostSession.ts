import { useEffect, useRef, useState } from 'react'
import type {
  BuzzState,
  BuzzThemesState,
  Difficulty,
  GameType,
  Participant,
  ParticipantScore,
  QuestionPublic,
  ServerToClientEvents,
  SessionMode,
  SessionStatus,
  Team,
  TeamScore,
} from '@lya-quiz/shared'
import { EVENTS } from '@lya-quiz/shared'
import { socket } from '../socket'
import {
  readHostSession,
  writeHostSession,
  clearHostSession,
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

// Mode buzzer : révélation d'une question (qui a marqué)
export interface BuzzReveal {
  correctAnswers: string[]
  difficulty: Difficulty | null
  scorer: { participantId: string; pseudo: string; points: number } | null
}

export interface HostSessionView {
  pin: string | null
  sessionId: string | null
  participants: Participant[]
  status: SessionStatus
  error: string | null
  socketConnected: boolean   // false pendant une coupure → bandeau de reconnexion
  quizTitle: string | null   // titre du quiz chargé (contrôle visuel : le BON quiz ?)
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
  // Mode équipe
  mode: SessionMode
  teams: Team[]
  teamsLocked: boolean
  teamLeaderboard: TeamScore[]
  // Mode buzzer (partie famille)
  gameType: GameType
  buzz: BuzzState | null
  buzzQuestion: QuestionPublic | null
  buzzReveal: BuzzReveal | null
  // Antisèche admin (control uniquement — le serveur ne l'envoie jamais à la TV)
  hostAnswer: string[] | null
  themes: BuzzThemesState | null
  start: () => void
  next: () => void
  showLeaderboard: () => void
  endQuiz: () => void
  kick: (participantId: string) => void
  replayLast: () => void
  // Actions host mode buzzer
  adjudicate: (correct: boolean) => void
  reopenBuzzer: () => void
  passQuestion: () => void
  startTheme: (ownerName: string) => void
  assignOwner: (ownerName: string, participantId: string | null) => void
  addManualParticipant: (pseudo: string) => void
  adjustScore: (participantId: string, delta: number) => void
  // Actions host mode équipe
  setMode: (mode: SessionMode) => void
  addTeam: (name: string) => void
  removeTeam: (teamId: string) => void
  lockTeams: (locked: boolean) => void
  assign: (participantId: string, teamId: string | null) => void
  autobalance: () => void
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
type TeamsPayload = Parameters<ServerToClientEvents['teams_updated']>[0]
type BuzzStartedPayload = Parameters<ServerToClientEvents['buzz_question_started']>[0]
type BuzzStatePayload = Parameters<ServerToClientEvents['buzz_state']>[0]
type BuzzEndedPayload = Parameters<ServerToClientEvents['buzz_question_ended']>[0]
type BuzzThemesPayload = Parameters<ServerToClientEvents['buzz_themes']>[0]

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
  const [quizTitle, setQuizTitle] = useState<string | null>(null)

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

  // Mode équipe (state distinct du paramètre `mode` = vue host control/display)
  const [teamMode, setTeamMode] = useState<SessionMode>('solo')
  const [teams, setTeams] = useState<Team[]>([])
  const [teamsLocked, setTeamsLocked] = useState(false)
  const [teamLeaderboard, setTeamLeaderboard] = useState<TeamScore[]>([])

  // Mode buzzer (partie famille)
  const [gameType, setGameType] = useState<GameType>('classic')
  const [buzz, setBuzz] = useState<BuzzState | null>(null)
  const [buzzQuestion, setBuzzQuestion] = useState<QuestionPublic | null>(null)
  const [buzzReveal, setBuzzReveal] = useState<BuzzReveal | null>(null)
  const [hostAnswer, setHostAnswer] = useState<string[] | null>(null)
  const [themes, setThemes] = useState<BuzzThemesState | null>(null)

  const resolvedRef = useRef(false)
  // Secret host (control) — jamais dans le state React, seulement pour host_join
  const hostKeyRef = useRef<string | null>(null)
  // Une seule tentative de récupération automatique (session perdue) par montage
  const recoveredRef = useRef(false)

  // État de la connexion Socket.io — pilote le bandeau « reconnexion » des vues host
  const [socketConnected, setSocketConnected] = useState(socket.connected)
  useEffect(() => {
    const onConnect = () => setSocketConnected(true)
    const onDisconnect = () => setSocketConnected(false)
    socket.on('connect', onConnect)
    socket.on('disconnect', onDisconnect)
    return () => {
      socket.off('connect', onConnect)
      socket.off('disconnect', onDisconnect)
    }
  }, [])

  // Effet 1 — résolution one-shot (évite la double création en StrictMode dev)
  useEffect(() => {
    if (resolvedRef.current) return
    resolvedRef.current = true

    void (async () => {
      const stored = readHostSession()
      const urlSession = new URLSearchParams(window.location.search).get('session')

      try {
        if (mode === 'control') {
          if (stored?.hostKey) {
            hostKeyRef.current = stored.hostKey
            setPin(stored.pin)
            setSessionId(stored.sessionId)
          } else {
            // pas de session stockée (ou ancienne, sans hostKey) → nouvelle session
            const created = await createHostSession()
            writeHostSession(created)
            hostKeyRef.current = created.hostKey ?? null
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

  // Effet 2 — listeners temps réel + (re)join, rebranchés quand la session change
  useEffect(() => {
    if (!pin) return

    const onJoined = (p: JoinedPayload) => {
      // SESSION_JOINED = source de vérité (gère une session recréée côté serveur)
      setPin(p.session.pin)
      setSessionId(p.sessionId)
      setParticipants(p.participants)
      setStatus(p.session.status)
      setTeamMode(p.mode)
      setTeams(p.teams)
      setTeamsLocked(p.teamsLocked)
      setGameType(p.gameType)
      setQuizTitle(p.quizTitle ?? null)
      // Seul le CONTROL persiste la session (avec son hostKey). La TV ne doit
      // jamais écraser le hostKey stocké par un control sur la même machine.
      if (mode === 'control' && hostKeyRef.current) {
        writeHostSession({ sessionId: p.sessionId, pin: p.session.pin, hostKey: hostKeyRef.current })
      }
    }
    const onTeams = (p: TeamsPayload) => {
      setTeamMode(p.mode)
      setTeams(p.teams)
      setTeamsLocked(p.locked)
      setParticipants(p.participants)
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
      // timeElapsed > 0 = question rejouée après refresh/ré-attachement → chrono recalé
      setQuestionStartedAt(Date.now() - (p.timeElapsed ?? 0) * 1000)
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
      if (p.teamScores) setTeamLeaderboard(p.teamScores)
      setQuestionStartedAt(null) // stoppe le timer ; on garde currentQuestion pour la révélation
      // Préchauffe l'image de la PROCHAINE question pendant la révélation
      // (payload host-only) : à l'affichage, elle sort du cache navigateur.
      if (p.nextMediaUrl) {
        const img = new Image()
        img.src = p.nextMediaUrl
      }
    }
    const onLeaderboard = (p: LbPayload) => {
      setPrevRanks(ranksOf(leaderboardRef.current)) // rangs d'avant cette MAJ
      leaderboardRef.current = p.scores
      setLeaderboard(p.scores)
      setShowingLeaderboard(!p.final)
      setLeaderboardFinal(p.final)
      if (p.teamScores) setTeamLeaderboard(p.teamScores)
    }

    // Mode buzzer
    const onBuzzStarted = (p: BuzzStartedPayload) => {
      setBuzzQuestion(p.question)
      setBuzz(p.buzz)
      setBuzzReveal(null)
      setHostAnswer(null) // l'antisèche de la nouvelle question suit (control uniquement)
      setShowingLeaderboard(false)
      setLeaderboardFinal(false)
    }
    const onHostAnswer = (p: { correctAnswers: string[] }) => setHostAnswer(p.correctAnswers)
    const onBuzzState = (p: BuzzStatePayload) => setBuzz(p)
    const onBuzzEnded = (p: BuzzEndedPayload) => {
      setBuzzReveal({ correctAnswers: p.correctAnswers, difficulty: p.difficulty, scorer: p.scorer })
      setPrevRanks(ranksOf(leaderboardRef.current))
      leaderboardRef.current = p.scores
      setLeaderboard(p.scores)
    }
    const onThemes = (p: BuzzThemesPayload) => setThemes(p)

    socket.on(EVENTS.SESSION_JOINED, onJoined)
    socket.on(EVENTS.PARTICIPANT_JOINED, onJoin)
    socket.on(EVENTS.PARTICIPANT_LEFT, onLeft)
    socket.on(EVENTS.SESSION_STATUS_CHANGED, onStatus)
    socket.on(EVENTS.QUESTION_STARTED, onQuestion)
    socket.on(EVENTS.ANSWER_RECEIVED, onAck)
    socket.on(EVENTS.QUESTION_ENDED, onEnded)
    socket.on(EVENTS.LEADERBOARD_UPDATE, onLeaderboard)
    socket.on(EVENTS.TEAMS_UPDATED, onTeams)
    socket.on(EVENTS.BUZZ_QUESTION_STARTED, onBuzzStarted)
    socket.on(EVENTS.BUZZ_STATE, onBuzzState)
    socket.on(EVENTS.BUZZ_QUESTION_ENDED, onBuzzEnded)
    socket.on(EVENTS.BUZZ_HOST_ANSWER, onHostAnswer)
    socket.on(EVENTS.BUZZ_THEMES, onThemes)

    // Session côté serveur introuvable / clé invalide (ex : snapshots purgés).
    // Control : on repart proprement sur une NOUVELLE session (une seule fois).
    // Display : message clair — la TV ne pilote rien, elle ne crée rien.
    const onError = (e: { code?: string; message?: string }) => {
      if (e.code !== 'INVALID_PIN' && e.code !== 'INVALID_HOST_KEY') return
      if (mode === 'control' && !recoveredRef.current) {
        recoveredRef.current = true
        clearHostSession()
        void createHostSession().then((created) => {
          writeHostSession(created)
          hostKeyRef.current = created.hostKey ?? null
          setSessionId(created.sessionId)
          setPin(created.pin) // → re-déclenche cet effet → host_join sur la nouvelle session
        })
        return
      }
      setError(e.message ?? 'Session introuvable.')
    }
    socket.on(EVENTS.QUIZ_ERROR, onError)

    // (re)join à CHAQUE connexion — pas seulement la première. À la moindre
    // micro-coupure le serveur retire ce socket de hostSocketIds et des rooms
    // (disconnect.ts) : sans ré-émission, boutons morts et TV figée sans erreur.
    // control = host_join (pin + hostKey secret) · display = display_join (lecture seule)
    const join = () => {
      if (mode === 'control') {
        socket.emit(EVENTS.HOST_JOIN, { pin, hostKey: hostKeyRef.current ?? '' })
      } else if (sessionId) {
        socket.emit(EVENTS.DISPLAY_JOIN, { sessionId })
      }
    }
    if (!socket.connected) socket.connect()
    if (socket.connected) join()
    socket.on('connect', join)

    return () => {
      socket.off(EVENTS.QUIZ_ERROR, onError)
      socket.off(EVENTS.SESSION_JOINED, onJoined)
      socket.off(EVENTS.PARTICIPANT_JOINED, onJoin)
      socket.off(EVENTS.PARTICIPANT_LEFT, onLeft)
      socket.off(EVENTS.SESSION_STATUS_CHANGED, onStatus)
      socket.off(EVENTS.QUESTION_STARTED, onQuestion)
      socket.off(EVENTS.ANSWER_RECEIVED, onAck)
      socket.off(EVENTS.QUESTION_ENDED, onEnded)
      socket.off(EVENTS.LEADERBOARD_UPDATE, onLeaderboard)
      socket.off(EVENTS.TEAMS_UPDATED, onTeams)
      socket.off(EVENTS.BUZZ_QUESTION_STARTED, onBuzzStarted)
      socket.off(EVENTS.BUZZ_STATE, onBuzzState)
      socket.off(EVENTS.BUZZ_QUESTION_ENDED, onBuzzEnded)
      socket.off(EVENTS.BUZZ_HOST_ANSWER, onHostAnswer)
      socket.off(EVENTS.BUZZ_THEMES, onThemes)
      socket.off('connect', join)
    }
  }, [pin, sessionId, mode])

  const start = () => socket.emit(EVENTS.HOST_START_QUIZ, {})
  const next = () => socket.emit(EVENTS.HOST_NEXT_QUESTION, {})
  const showLeaderboard = () => socket.emit(EVENTS.HOST_SHOW_LEADERBOARD, {})
  const endQuiz = () => socket.emit(EVENTS.HOST_END_QUIZ, {})
  const kick = (participantId: string) => socket.emit(EVENTS.HOST_KICK_PARTICIPANT, { participantId })
  const replayLast = () => socket.emit(EVENTS.HOST_REPLAY_LAST_QUESTION, {})

  // Actions host mode buzzer
  const adjudicate = (correct: boolean) => socket.emit(EVENTS.HOST_ADJUDICATE, { correct })
  const reopenBuzzer = () => socket.emit(EVENTS.HOST_REOPEN_BUZZER, {})
  const passQuestion = () => socket.emit(EVENTS.HOST_PASS_QUESTION, {})
  const startTheme = (ownerName: string) => socket.emit(EVENTS.HOST_START_THEME, { ownerName })
  const assignOwner = (ownerName: string, participantId: string | null) =>
    socket.emit(EVENTS.HOST_ASSIGN_OWNER, { ownerName, participantId })
  const addManualParticipant = (pseudo: string) => socket.emit(EVENTS.HOST_ADD_MANUAL_PARTICIPANT, { pseudo })
  const adjustScore = (participantId: string, delta: number) =>
    socket.emit(EVENTS.HOST_ADJUST_SCORE, { participantId, delta })

  // Actions host mode équipe
  const changeMode = (m: SessionMode) => socket.emit(EVENTS.HOST_SET_MODE, { mode: m })
  const addTeam = (name: string) => socket.emit(EVENTS.HOST_ADD_TEAM, { name })
  const removeTeam = (teamId: string) => socket.emit(EVENTS.HOST_REMOVE_TEAM, { teamId })
  const lockTeams = (locked: boolean) => socket.emit(EVENTS.HOST_LOCK_TEAMS, { locked })
  const assign = (participantId: string, teamId: string | null) =>
    socket.emit(EVENTS.HOST_ASSIGN_PARTICIPANT, { participantId, teamId })
  const autobalance = () => socket.emit(EVENTS.HOST_AUTOBALANCE_TEAMS, {})

  return {
    pin,
    sessionId,
    participants,
    status,
    error,
    socketConnected,
    quizTitle,
    currentQuestion,
    questionStartedAt,
    answeredCount,
    totalCount,
    reveal,
    leaderboard,
    prevRanks,
    showingLeaderboard,
    leaderboardFinal,
    mode: teamMode,
    teams,
    teamsLocked,
    teamLeaderboard,
    gameType,
    buzz,
    buzzQuestion,
    buzzReveal,
    hostAnswer,
    themes,
    start,
    next,
    showLeaderboard,
    endQuiz,
    kick,
    replayLast,
    adjudicate,
    reopenBuzzer,
    passQuestion,
    startTheme,
    assignOwner,
    addManualParticipant,
    adjustScore,
    setMode: changeMode,
    addTeam,
    removeTeam,
    lockTeams,
    assign,
    autobalance,
  }
}
