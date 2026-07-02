import { create } from 'zustand'
import type {
  Participant,
  ParticipantScore,
  QuestionPublic,
  SessionMode,
  SessionStatus,
  Team,
  TeamScore,
} from '@lya-quiz/shared'

type AppView = 'join' | 'lobby' | 'question' | 'answer' | 'leaderboard' | 'ended'

// État d'acheminement de la réponse (ack serveur, cf. submit-answer.ts) :
// idle → sending → sent (ack reçu) | late (question fermée) | failed (retries épuisés)
export type AnswerStatus = 'idle' | 'sending' | 'sent' | 'late' | 'failed'

export interface LastResult {
  correct: boolean
  myAnswer: string | number | string[] | null
  myScore: number
  myDelta: number
  correctAnswers: string[]
}

// Payload de question_ended côté serveur (dérivé du contrat)
interface QuestionEndedPayload {
  correctAnswers: string[]
  scores: ParticipantScore[]
  distribution: { value: string; count: number }[]
  myAnswer: string | number | string[] | null
  myCorrect: boolean
  myScore: number
  myDelta: number
  teamScores?: TeamScore[]
}

// Sous-ensemble de session_restored utilisé par le store (reconnexion S7 + reprise au reload)
interface SessionRestoredPayload {
  participant: { id: string; pseudo: string; teamId?: string }
  participants: Participant[]
  currentQuestion: QuestionPublic | null
  timeElapsed: number
  alreadyAnswered: boolean
  myScore: number
  scores: ParticipantScore[]
  lastResult: {
    correctAnswers: string[]
    myAnswer: string | number | string[] | null
    myCorrect: boolean
    myDelta: number
  } | null
  session: { pin: string; status: SessionStatus }
  mode: SessionMode
  teams: Team[]
  teamsLocked: boolean
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

  // Mode équipe
  mode: SessionMode
  teams: Team[]
  teamsLocked: boolean
  myTeamId: string | null
  teamLeaderboard: TeamScore[]

  // Quiz en cours
  currentView: AppView
  currentQuestion: QuestionPublic | null
  questionStartedAt: number | null   // horloge CLIENT au moment de la réception (anti-skew)
  hasAnswered: boolean               // l'utilisateur a validé une réponse (pilote l'écran d'attente)
  answerStatus: AnswerStatus         // acheminement réel de cette réponse (ack serveur)
  pendingAnswer: string | number | string[] | null   // pour le bouton « Réessayer »
  lastResult: LastResult | null
  leaderboard: ParticipantScore[]
  prevRanks: Record<string, number>   // rangs au classement précédent (pour les flèches ↑/↓)

  // Session perdue côté serveur (restart en pleine partie, token invalide…) :
  // message affiché sur /join pour expliquer pourquoi on y est revenu.
  fatalNotice: string | null

  // Actions
  setJoined: (params: {
    myId: string
    myPseudo: string
    sessionPin: string
    sessionId: string
    participants: Participant[]
    mode: SessionMode
    teams: Team[]
    teamsLocked: boolean
    myTeamId: string | null
  }) => void
  setParticipantJoined: (p: Participant) => void
  setParticipantLeft: (participantId: string) => void
  onTeamsUpdated: (payload: {
    mode: SessionMode
    teams: Team[]
    locked: boolean
    participants: Participant[]
  }) => void
  onQuestionStarted: (q: QuestionPublic) => void
  beginAnswer: (answer: string | number | string[]) => void
  answerDelivered: () => void
  answerLate: () => void
  answerFailed: () => void
  onQuestionEnded: (payload: QuestionEndedPayload) => void
  onLeaderboard: (scores: ParticipantScore[], final: boolean, teamScores?: TeamScore[]) => void
  onSessionRestored: (payload: SessionRestoredPayload) => void
  onQuizEnded: () => void
  onSessionLost: (notice: string) => void
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
  mode: 'solo' as SessionMode,
  teams: [],
  teamsLocked: false,
  myTeamId: null,
  teamLeaderboard: [],
  currentView: 'join' as AppView,
  currentQuestion: null,
  questionStartedAt: null,
  hasAnswered: false,
  answerStatus: 'idle' as AnswerStatus,
  pendingAnswer: null,
  lastResult: null,
  leaderboard: [],
  prevRanks: {},
  fatalNotice: null,
} satisfies Partial<QuizStore>

export const useQuizStore = create<QuizStore>()((set) => ({
  ...initialState,

  setJoined: ({ myId, myPseudo, sessionPin, sessionId, participants, mode, teams, teamsLocked, myTeamId }) =>
    set({ myId, myPseudo, sessionPin, sessionId, participants, mode, teams, teamsLocked, myTeamId, currentView: 'lobby', fatalNotice: null }),

  // teams_updated : source de vérité de l'état équipe. On remplace participants +
  // état d'équipe et on recalcule myTeamId depuis la liste.
  onTeamsUpdated: ({ mode, teams, locked, participants }) =>
    set((state) => ({
      mode,
      teams,
      teamsLocked: locked,
      participants,
      myTeamId: participants.find((p) => p.id === state.myId)?.teamId ?? null,
    })),

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
      answerStatus: 'idle',
      pendingAnswer: null,
      lastResult: null,
    }),

  beginAnswer: (answer) => set({ hasAnswered: true, answerStatus: 'sending', pendingAnswer: answer }),
  answerDelivered: () => set({ answerStatus: 'sent', pendingAnswer: null }),
  answerLate: () => set({ answerStatus: 'late', pendingAnswer: null }),
  answerFailed: () => set({ answerStatus: 'failed' }),

  onQuestionEnded: (payload) =>
    set({
      currentView: 'answer',
      questionStartedAt: null,
      myScore: payload.myScore,
      ...(payload.teamScores ? { teamLeaderboard: payload.teamScores } : {}),
      lastResult: {
        correct: payload.myCorrect,
        myAnswer: payload.myAnswer,
        myScore: payload.myScore,
        myDelta: payload.myDelta,
        correctAnswers: payload.correctAnswers,
      },
    }),

  // leaderboard_update : final=false → écran classement intermédiaire,
  // final=true → podium de fin. prevRanks = rangs du classement précédent.
  onLeaderboard: (scores, final, teamScores) =>
    set((state) => ({
      leaderboard: scores,
      prevRanks: ranksOf(state.leaderboard),
      currentView: final ? 'ended' : 'leaderboard',
      ...(teamScores ? { teamLeaderboard: teamScores } : {}),
    })),

  // Reconnexion (S7) : on resynchronise participants + score, et si une question
  // est en cours on y revient avec le bon temps restant et l'état "déjà répondu".
  onSessionRestored: (payload) =>
    set((state) => {
      // Identité (re)peuplée → indispensable pour la reprise après un rechargement
      // complet (sinon le lobby renvoie au /join faute de myId).
      const identity = {
        myId: payload.participant.id,
        myPseudo: payload.participant.pseudo,
        sessionPin: payload.session.pin,
        participants: payload.participants,
        myScore: payload.myScore,
        // Mode équipe restauré
        mode: payload.mode,
        teams: payload.teams,
        teamsLocked: payload.teamsLocked,
        myTeamId: payload.participant.teamId ?? null,
      }
      if (payload.currentQuestion) {
        return {
          ...identity,
          currentView: 'question' as AppView,
          currentQuestion: payload.currentQuestion,
          // ancre le timer pour refléter le temps déjà écoulé côté serveur
          questionStartedAt: Date.now() - payload.timeElapsed * 1000,
          hasAnswered: payload.alreadyAnswered,
          // le serveur est la source de vérité : répondu = bien enregistré
          answerStatus: (payload.alreadyAnswered ? 'sent' : 'idle') as AnswerStatus,
          pendingAnswer: null,
          lastResult: null,
        }
      }
      // Pas de question ouverte : recaler la vue sur l'état SERVEUR.
      const base = {
        ...identity,
        currentQuestion: null,
        questionStartedAt: null,
        leaderboard: payload.scores,
      }
      // Quiz terminé pendant la coupure → podium (quel que soit l'écran d'avant).
      if (payload.session.status === 'ended') {
        return { ...base, currentView: 'ended' as AppView }
      }
      // On était sur une question désormais fermée → rejouer la révélation
      // (résultat individuel renvoyé par le serveur) au lieu de rester figé
      // sur une question périmée jusqu'à la suivante.
      if (state.currentView === 'question') {
        if (payload.lastResult) {
          return {
            ...base,
            currentView: 'answer' as AppView,
            lastResult: {
              correct: payload.lastResult.myCorrect,
              myAnswer: payload.lastResult.myAnswer,
              myScore: payload.myScore,
              myDelta: payload.lastResult.myDelta,
              correctAnswers: payload.lastResult.correctAnswers,
            },
          }
        }
        return { ...base, currentView: 'lobby' as AppView }
      }
      // Reload (vue 'join') → lobby ; simple blip ailleurs (révélation,
      // classement…) → on garde la vue courante.
      const view: AppView = state.currentView === 'join' ? 'lobby' : state.currentView
      return { ...base, currentView: view }
    }),

  onQuizEnded: () => set({ currentView: 'ended', questionStartedAt: null }),

  // La session n'existe plus côté serveur (restart en pleine partie, token
  // invalide) : reset complet + message explicatif affiché sur /join.
  // Sans ça, un restart serveur laissait tous les téléphones GELÉS en pleine
  // partie (l'erreur INVALID_TOKEN n'était écoutée que pendant la reprise).
  onSessionLost: (notice) => set({ ...initialState, fatalNotice: notice }),

  setView: (currentView) => set({ currentView }),
  reset: () => set(initialState),
}))
