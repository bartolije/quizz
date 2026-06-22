import type {
  Participant,
  ParticipantScore,
  QuestionPublic,
  Session,
} from './models.js'

// Token de session persistant côté client (localStorage)
// Permet la ré-identification transparente après reconnexion
export type SessionToken = string

// ─────────────────────────────────────────────────────────────
// EVENTS CLIENT → SERVEUR
// ─────────────────────────────────────────────────────────────

export interface ClientToServerEvents {
  // Rejoindre une session pour la première fois
  join_session: (payload: {
    pin: string
    pseudo: string
    sessionToken: SessionToken | null   // null à la première connexion
  }) => void

  // Ré-identification automatique après reconnexion Socket.io
  // Envoyé automatiquement par le client sur chaque 'connect' si token présent
  rejoin_session: (payload: {
    sessionToken: SessionToken
  }) => void

  // Participant envoie sa réponse
  submit_answer: (payload: {
    answer: string | number
  }) => void

  // HOST ONLY — passer à la question suivante
  host_next_question: (payload: Record<string, never>) => void

  // HOST ONLY — lancer le quiz (depuis l'écran waiting)
  host_start_quiz: (payload: Record<string, never>) => void

  // HOST ONLY — terminer le quiz manuellement
  host_end_quiz: (payload: Record<string, never>) => void

  // HOST ONLY — s'identifier comme host de la session
  host_join: (payload: {
    pin: string
  }) => void
}

// ─────────────────────────────────────────────────────────────
// EVENTS SERVEUR → CLIENT
// ─────────────────────────────────────────────────────────────

export interface ServerToClientEvents {
  // Confirmation de join réussi (première connexion)
  session_joined: (payload: {
    sessionToken: SessionToken       // à stocker dans localStorage
    sessionId: string
    participant: Participant
    participants: Participant[]
    session: Pick<Session, 'status' | 'pin'>
  }) => void

  // Confirmation de rejoin réussi après reconnexion
  session_restored: (payload: {
    participant: Participant
    participants: Participant[]
    currentQuestion: QuestionPublic | null   // null si entre questions
    timeElapsed: number                       // secondes écoulées sur la question
    myScore: number
    myRank: number
    session: Pick<Session, 'status' | 'pin'>
  }) => void

  // Un nouveau participant vient de rejoindre (broadcast à tous)
  participant_joined: (payload: {
    participant: Participant
  }) => void

  // Un participant s'est déconnecté
  participant_left: (payload: {
    participantId: string
  }) => void

  // Une question commence
  question_started: (payload: {
    question: QuestionPublic
    startedAt: number   // timestamp serveur → le client calcule le timer depuis là
  }) => void

  // Une question se termine
  question_ended: (payload: {
    correctAnswers: string[]
    scores: ParticipantScore[]
    myAnswer: string | number | null
    myScore: number
    myDelta: number
  }) => void

  // HOST ONLY — un participant a répondu (pas la réponse, juste l'ack)
  answer_received: (payload: {
    participantId: string
    pseudo: string
    answeredCount: number
    totalCount: number
  }) => void

  // Leaderboard affiché entre deux questions ou à la fin
  leaderboard_update: (payload: {
    scores: ParticipantScore[]
    final: boolean               // true = fin du quiz
  }) => void

  // Erreur métier (pin invalide, pseudo déjà pris, session terminée...)
  quiz_error: (payload: {
    code: 'INVALID_PIN' | 'PSEUDO_TAKEN' | 'SESSION_ENDED' | 'SESSION_FULL' | 'INVALID_TOKEN' | 'UNKNOWN'
    message: string
  }) => void
}

// ─────────────────────────────────────────────────────────────
// NOMS D'EVENTS — la seule source de vérité pour les strings
// Importer depuis ici, ne jamais écrire les strings en dur ailleurs
// ─────────────────────────────────────────────────────────────

export const EVENTS = {
  // Client → Serveur
  JOIN_SESSION:       'join_session',
  REJOIN_SESSION:     'rejoin_session',
  SUBMIT_ANSWER:      'submit_answer',
  HOST_NEXT_QUESTION: 'host_next_question',
  HOST_START_QUIZ:    'host_start_quiz',
  HOST_END_QUIZ:      'host_end_quiz',
  HOST_JOIN:          'host_join',

  // Serveur → Client
  SESSION_JOINED:     'session_joined',
  SESSION_RESTORED:   'session_restored',
  PARTICIPANT_JOINED: 'participant_joined',
  PARTICIPANT_LEFT:   'participant_left',
  QUESTION_STARTED:   'question_started',
  QUESTION_ENDED:     'question_ended',
  ANSWER_RECEIVED:    'answer_received',
  LEADERBOARD_UPDATE: 'leaderboard_update',
  QUIZ_ERROR:         'quiz_error',
} as const

export type EventName = typeof EVENTS[keyof typeof EVENTS]
