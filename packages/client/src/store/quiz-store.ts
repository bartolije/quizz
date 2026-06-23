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

// Sous-ensemble de session_restored utilisé par le store (reconnexion S7)
interface SessionRestoredPayload {
  participants: Participant[]
  currentQuestion: QuestionPublic | null
  timeElapsed: number
  alreadyAnswered: boolean
  myScore: number
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
  prevRanks: Record<string, number>   // rangs au classement précédent (pour les flèches ↑/↓)

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
  onLeaderboard: (scores: ParticipantScore[], final: boolean) => void
  onSessionRestored: (payload: SessionRestoredPayload) => void
  onQuizEnded: () => void
  setView: (view: AppView) => void
  reset: () => void
}

const ranksOf = (lb: ParticipantScore[]): Record<string, number> =>
  Object.fromEntries(lb.map((s) => [s.participantId, s.rank]))

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
  prevRanks: {},
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

  // leaderboard_update : final=false → écran classement intermédiaire,
  // final=true → podium de fin. prevRanks = rangs du classement précédent.
  onLeaderboard: (scores, final) =>
    set((state) => ({
      leaderboard: scores,
      prevRanks: ranksOf(state.leaderboard),
      currentView: final ? 'ended' : 'leaderboard',
    })),

  // Reconnexion (S7) : on resynchronise participants + score, et si une question
  // est en cours on y revient avec le bon temps restant et l'état "déjà répondu".
  onSessionRestored: (payload) =>
    set(() => {
      if (payload.currentQuestion) {
        return {
          participants: payload.participants,
          myScore: payload.myScore,
          currentView: 'question' as AppView,
          currentQuestion: payload.currentQuestion,
          // ancre le timer pour refléter le temps déjà écoulé côté serveur
          questionStartedAt: Date.now() - payload.timeElapsed * 1000,
          hasAnswered: payload.alreadyAnswered,
          lastResult: null,
        }
      }
      // pas de question ouverte : on ne perturbe pas la vue courante
      return { participants: payload.participants, myScore: payload.myScore }
    }),

  onQuizEnded: () => set({ currentView: 'ended', questionStartedAt: null }),

  setView: (currentView) => set({ currentView }),
  reset: () => set(initialState),
}))
