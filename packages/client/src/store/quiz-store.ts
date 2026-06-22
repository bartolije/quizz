import { create } from 'zustand'
import type { Participant, ParticipantScore, QuestionPublic } from '@lya-quiz/shared'

type AppView = 'join' | 'lobby' | 'question' | 'answer' | 'leaderboard' | 'ended'

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
  questionStartedAt: number | null   // timestamp serveur
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
  setView: (view: AppView) => void
  setMyScore: (score: number) => void
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

  setView: (currentView) => set({ currentView }),
  setMyScore: (myScore) => set({ myScore }),
  setLeaderboard: (leaderboard) => set({ leaderboard }),
  reset: () => set(initialState),
}))
