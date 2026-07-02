import { beforeEach, describe, expect, it } from 'vitest'
import { useQuizStore } from '../src/store/quiz-store'
import type { QuestionPublic } from '@lya-quiz/shared'

const q = (index: number): QuestionPublic => ({
  id: `q${index}`,
  index,
  total: 5,
  text: `Question ${index}`,
  type: 'mcq',
  choices: ['a', 'b'],
  timeLimit: 30,
})

const restoredBase = {
  participant: { id: 'p1', pseudo: 'alice' },
  participants: [],
  timeElapsed: 0,
  alreadyAnswered: false,
  myScore: 0,
  scores: [],
  lastResult: null,
  session: { pin: '1234', status: 'running' as const },
  mode: 'solo' as const,
  teams: [],
  teamsLocked: false,
}

beforeEach(() => {
  useQuizStore.getState().reset()
})

describe('quiz-store — boucle de jeu', () => {
  it('setJoined → vue lobby avec identité', () => {
    useQuizStore.getState().setJoined({
      myId: 'p1',
      myPseudo: 'alice',
      sessionPin: '1234',
      sessionId: 's1',
      participants: [],
      mode: 'solo',
      teams: [],
      teamsLocked: false,
      myTeamId: null,
    })
    const s = useQuizStore.getState()
    expect(s.currentView).toBe('lobby')
    expect(s.myId).toBe('p1')
  })

  it('onQuestionStarted ancre le timer sur l’horloge CLIENT (anti-skew)', () => {
    const before = Date.now()
    useQuizStore.getState().onQuestionStarted(q(0))
    const s = useQuizStore.getState()
    expect(s.currentView).toBe('question')
    expect(s.hasAnswered).toBe(false)
    expect(s.questionStartedAt).toBeGreaterThanOrEqual(before)
    expect(s.questionStartedAt).toBeLessThanOrEqual(Date.now())
  })

  it('onQuestionEnded → vue answer + résultat personnel', () => {
    useQuizStore.getState().onQuestionStarted(q(0))
    useQuizStore.getState().onQuestionEnded({
      correctAnswers: ['a'],
      scores: [],
      distribution: [],
      myAnswer: 'a',
      myCorrect: true,
      myScore: 800,
      myDelta: 800,
    })
    const s = useQuizStore.getState()
    expect(s.currentView).toBe('answer')
    expect(s.questionStartedAt).toBeNull()
    expect(s.lastResult?.correct).toBe(true)
    expect(s.myScore).toBe(800)
  })

  it('onLeaderboard intermédiaire → vue leaderboard ; final → podium', () => {
    useQuizStore.getState().onLeaderboard([], false)
    expect(useQuizStore.getState().currentView).toBe('leaderboard')
    useQuizStore.getState().onLeaderboard([], true)
    expect(useQuizStore.getState().currentView).toBe('ended')
  })
})

describe('quiz-store — acheminement de la réponse (ack)', () => {
  it('beginAnswer → sending, answerDelivered → sent', () => {
    useQuizStore.getState().onQuestionStarted(q(0))
    useQuizStore.getState().beginAnswer('a')
    let s = useQuizStore.getState()
    expect(s.hasAnswered).toBe(true)
    expect(s.answerStatus).toBe('sending')
    expect(s.pendingAnswer).toBe('a')

    useQuizStore.getState().answerDelivered()
    s = useQuizStore.getState()
    expect(s.answerStatus).toBe('sent')
    expect(s.pendingAnswer).toBeNull()
  })

  it('answerLate / answerFailed (pendingAnswer conservé pour « Réessayer »)', () => {
    useQuizStore.getState().onQuestionStarted(q(0))
    useQuizStore.getState().beginAnswer('b')
    useQuizStore.getState().answerFailed()
    expect(useQuizStore.getState().answerStatus).toBe('failed')
    expect(useQuizStore.getState().pendingAnswer).toBe('b')

    useQuizStore.getState().answerLate()
    expect(useQuizStore.getState().answerStatus).toBe('late')
  })

  it('nouvelle question → statut remis à idle', () => {
    useQuizStore.getState().onQuestionStarted(q(0))
    useQuizStore.getState().beginAnswer('a')
    useQuizStore.getState().onQuestionStarted(q(1))
    const s = useQuizStore.getState()
    expect(s.hasAnswered).toBe(false)
    expect(s.answerStatus).toBe('idle')
    expect(s.pendingAnswer).toBeNull()
  })

  it('restore avec alreadyAnswered → sent (source de vérité serveur)', () => {
    useQuizStore.getState().onSessionRestored({
      ...restoredBase,
      currentQuestion: q(2),
      timeElapsed: 5,
      alreadyAnswered: true,
    })
    expect(useQuizStore.getState().answerStatus).toBe('sent')
  })
})

describe('quiz-store — session perdue (onSessionLost)', () => {
  it('reset complet + message pour /join (restart serveur en pleine partie)', () => {
    useQuizStore.getState().setJoined({
      myId: 'p1',
      myPseudo: 'alice',
      sessionPin: '1234',
      sessionId: 's1',
      participants: [],
      mode: 'solo',
      teams: [],
      teamsLocked: false,
      myTeamId: null,
    })
    useQuizStore.getState().onQuestionStarted(q(3))

    useQuizStore.getState().onSessionLost('La partie a été réinitialisée.')
    const s = useQuizStore.getState()
    expect(s.currentView).toBe('join')   // → ParticipantApp redirige vers /join
    expect(s.myId).toBeNull()
    expect(s.currentQuestion).toBeNull()
    expect(s.fatalNotice).toBe('La partie a été réinitialisée.')
  })

  it('le message est effacé au join suivant', () => {
    useQuizStore.getState().onSessionLost('perdu')
    useQuizStore.getState().setJoined({
      myId: 'p2',
      myPseudo: 'bob',
      sessionPin: '5678',
      sessionId: 's2',
      participants: [],
      mode: 'solo',
      teams: [],
      teamsLocked: false,
      myTeamId: null,
    })
    expect(useQuizStore.getState().fatalNotice).toBeNull()
  })
})

describe('quiz-store — reconnexion (onSessionRestored)', () => {
  it('question ouverte → vue question, timer recalé sur timeElapsed, réponse conservée', () => {
    const before = Date.now()
    useQuizStore.getState().onSessionRestored({
      ...restoredBase,
      currentQuestion: q(2),
      timeElapsed: 10,
      alreadyAnswered: true,
    })
    const s = useQuizStore.getState()
    expect(s.currentView).toBe('question')
    expect(s.hasAnswered).toBe(true)
    expect(s.myId).toBe('p1')
    // startedAt ≈ maintenant - 10s
    expect(s.questionStartedAt).toBeGreaterThanOrEqual(before - 10_500)
    expect(s.questionStartedAt).toBeLessThanOrEqual(Date.now() - 9_500)
  })

  it('reload sans question ouverte (vue join) → lobby', () => {
    useQuizStore.getState().onSessionRestored({ ...restoredBase, currentQuestion: null })
    expect(useQuizStore.getState().currentView).toBe('lobby')
  })

  it('reload sans question ouverte, session terminée → podium', () => {
    useQuizStore.getState().onSessionRestored({
      ...restoredBase,
      currentQuestion: null,
      session: { pin: '1234', status: 'ended' },
    })
    expect(useQuizStore.getState().currentView).toBe('ended')
  })

  it('reconnexion sur une question PÉRIMÉE → révélation rejouée (pas de question figée)', () => {
    // le joueur était en pleine question…
    useQuizStore.getState().onQuestionStarted(q(2))
    useQuizStore.getState().beginAnswer('a')
    // …coupure ; pendant ce temps la question a été fermée côté serveur
    useQuizStore.getState().onSessionRestored({
      ...restoredBase,
      currentQuestion: null,
      myScore: 700,
      lastResult: { correctAnswers: ['a'], myAnswer: 'a', myCorrect: true, myDelta: 700 },
    })
    const s = useQuizStore.getState()
    expect(s.currentView).toBe('answer')     // révélation, pas la question périmée
    expect(s.lastResult?.correct).toBe(true)
    expect(s.lastResult?.myDelta).toBe(700)
    expect(s.currentQuestion).toBeNull()
  })

  it('reconnexion en vue question, quiz TERMINÉ pendant la coupure → podium avec classement', () => {
    useQuizStore.getState().onQuestionStarted(q(4))
    useQuizStore.getState().onSessionRestored({
      ...restoredBase,
      currentQuestion: null,
      session: { pin: '1234', status: 'ended' },
      scores: [{ participantId: 'p1', pseudo: 'alice', score: 1500, delta: 0, rank: 1 }],
    })
    const s = useQuizStore.getState()
    expect(s.currentView).toBe('ended')
    expect(s.leaderboard).toHaveLength(1)
  })

  it('simple blip sur le classement (pas de question ouverte) → vue conservée', () => {
    useQuizStore.getState().onLeaderboard([], false)
    useQuizStore.getState().onSessionRestored({ ...restoredBase, currentQuestion: null })
    expect(useQuizStore.getState().currentView).toBe('leaderboard')
  })
})
