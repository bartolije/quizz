export type QuestionType = 'mcq' | 'free' | 'closest' | 'ordering'

export type QuestionStatus = 'waiting' | 'running' | 'ended'
export type SessionStatus  = 'waiting' | 'running' | 'ended'

// Participant tel qu'exposé aux clients
export interface Participant {
  id: string           // uuid stable, persiste à travers les reconnexions
  pseudo: string
  connected: boolean
}

// Score d'un participant à un instant T
export interface ParticipantScore {
  participantId: string
  pseudo: string
  score: number        // score cumulé
  delta: number        // points gagnés sur la dernière question
  rank: number
}

// Question telle qu'envoyée aux participants (sans les bonnes réponses)
export interface QuestionPublic {
  id: string
  text: string
  type: QuestionType
  choices?: string[]   // 'mcq' : les choix · 'ordering' : les items MÉLANGÉS à réordonner
  timeLimit: number    // en secondes
  index: number        // position dans le quiz (0-based)
  total: number        // nombre total de questions
}

// Question complète (côté serveur uniquement, jamais envoyée aux participants)
export interface Question {
  id: string
  text: string
  type: QuestionType
  choices?: string[]
  correctAnswers: string[]   // plusieurs pour gérer variantes (accents, tirets...)
  timeLimit: number          // override si != defaultTimeLimit
  mediaUrl?: string          // pour plus tard
}

// Quiz complet
export interface Quiz {
  id: string
  title: string
  defaultTimeLimit: number   // valeur par défaut pour toutes les questions
  questions: Question[]
  createdAt: number          // timestamp
}

// État d'une session en cours
export interface Session {
  id: string
  pin: string                // code à 4 chiffres pour rejoindre
  quizId: string
  status: SessionStatus
  currentQuestionIndex: number
}

// ─────────────────────────────────────────────────────────────
// Rapport de fin de partie (REST: GET /api/sessions/:id/report)
// ─────────────────────────────────────────────────────────────

export interface QuestionReport {
  index: number
  text: string
  type: QuestionType
  correctAnswers: string[]
  answeredCount: number
  correctCount: number
}

export interface PlayerReport {
  participantId: string
  pseudo: string
  score: number
  rank: number
  correct: number // nombre de questions réussies (mcq/free/ordering parfait)
}

export interface GameReport {
  title: string
  totalQuestions: number
  questions: QuestionReport[]
  players: PlayerReport[]
}

// Réponse d'un participant à une question
export interface Answer {
  participantId: string
  questionId: string
  value: string | number
  submittedAt: number        // timestamp serveur
  score: number
  isCorrect: boolean
}
