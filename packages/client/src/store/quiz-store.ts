import { create } from 'zustand'
import type { Participant, ParticipantScore, QuestionPublic } from '@lya-quiz/shared'

type AppView = 'join' | 'lobby' | 'question' | 'answer' | 'leaderboard' | 'ended'

export interface LastResult {
  correct: boolean
  myAnswer: string | number | null
  myScore: number
  myDelta: number
  correctAnswers: string[]
}

// Payload de question_ended côté serveur (dérivé du contrat)
interface QuestionEndedPayload {
  correctAnswers: string[]
  scores: ParticipantScore[]
  distribution: { value: string; count: number }[]
  myAnswer: string | number | null
  myScore: number
  myDelta: number
}

interface QuizStore {
  // Identité
  myId: string | null
  myPseudo: string | null
  myScore: number

  // Session
  sessionPin: string | null
  sessionId: string | null

  // Participants
  participants: Participant[]

  // Quiz en cours
  currentView: AppView
  currentQuestion: QuestionPublic | null
  questionStartedAt: number | null   // horloge CLIENT au moment de la réception (anti-skew)
  hasAnswered: boolean
  lastResult: LastResult | null
  leaderboard: ParticipantScore[]

  // Actions
  setJoined: (params: {
    myId: string
    myPseudo: string
    sessionPin: string
    sessionId: string
    participants: Participant[]
  }) => void
  setParticipantJoined: (p: Participant) => void
  setParticipantLeft: (participantId: string) => void
  onQuestionStarted: (q: QuestionPublic) => void
  markAnswered: () => void
  onQuestionEnded: (payload: QuestionEndedPayload) => void
  onQuizEnded: () => void
  setView: (view: AppView) => void
  setLeaderboard: (scores: ParticipantScore[]) => void
  reset: () => void
}

const initialState = {
  myId: null,
  myPseudo: null,
  myScore: 0,
  sessionPin: null,
  sessionId: null,
  participants: [],
  currentView: 'join' as AppView,
  currentQuestion: null,
  questionStartedAt: null,
  hasAnswered: false,
  lastResult: null,
  leaderboard: [],
} satisfies Partial<QuizStore>

export const useQuizStore = create<QuizStore>()((set) => ({
  ...initialState,

  setJoined: ({ myId, myPseudo, sessionPin, sessionId, participants }) =>
    set({ myId, myPseudo, sessionPin, sessionId, participants, currentView: 'lobby' }),

  setParticipantJoined: (p) =>
    set((state) => ({
      participants: state.participants.some((x) => x.id === p.id)
        ? state.participants.map((x) => (x.id === p.id ? p : x))
        : [...state.participants, p],
    })),

  setParticipantLeft: (participantId) =>
    set((state) => ({
      participants: state.participants.map((p) =>
        p.id === participantId ? { ...p, connected: false } : p,
      ),
    })),

  // question_started : on ancre le timer sur l'horloge CLIENT (réception = t0)
  // pour éviter tout décalage d'horloge serveur/client.
  onQuestionStarted: (q) =>
    set({
      currentView: 'question',
      currentQuestion: q,
      questionStartedAt: Date.now(),
      hasAnswered: false,
      lastResult: null,
    }),

  markAnswered: () => set({ hasAnswered: true }),

  onQuestionEnded: (payload) =>
    set({
      currentView: 'answer',
      questionStartedAt: null,
      myScore: payload.myScore,
      leaderboard: payload.scores,
      lastResult: {
        correct:
          payload.myAnswer !== null &&
          payload.correctAnswers.includes(String(payload.myAnswer)),
        myAnswer: payload.myAnswer,
        myScore: payload.myScore,
        myDelta: payload.myDelta,
        correctAnswers: payload.correctAnswers,
      },
    }),

  onQuizEnded: () => set({ currentView: 'ended', questionStartedAt: null }),

  setView: (currentView) => set({ currentView }),
  setLeaderboard: (leaderboard) => set({ leaderboard }),
  reset: () => set(initialState),
}))
