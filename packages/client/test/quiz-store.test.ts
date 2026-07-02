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
})
