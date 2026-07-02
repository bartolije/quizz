import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { ServerToClientEvents } from '@lya-quiz/shared'
import { EVENTS } from '@lya-quiz/shared'
import {
  serializeSession,
  deserializeSession,
  restoreSessionsAtBoot,
  deleteSessionSnapshot,
} from '../src/session-snapshot.js'
import { deleteSession, getSessionById } from '../src/state.js'
import { sqlite } from '../src/db.js'
import {
  startTestServer,
  makeSession,
  waitFor,
  type TestServer,
  type TestClient,
} from './helpers.js'

type Joined = Parameters<ServerToClientEvents['session_joined']>[0]
type Restored = Parameters<ServerToClientEvents['session_restored']>[0]
type QStarted = Parameters<ServerToClientEvents['question_started']>[0]
type QEnded = Parameters<ServerToClientEvents['question_ended']>[0]

let srv: TestServer

beforeAll(async () => {
  srv = await startTestServer()
})

afterAll(async () => {
  await srv.close()
})

async function joinAs(pseudo: string, pin: string): Promise<{ c: TestClient; joined: Joined }> {
  const c = srv.connect()
  c.emit(EVENTS.JOIN_SESSION, { pin, pseudo, sessionToken: null })
  const joined = await waitFor<Joined>(c, EVENTS.SESSION_JOINED)
  return { c, joined }
}

describe('snapshot — sérialisation/désérialisation', () => {
  it('roundtrip fidèle : participants, scores, équipes, résultats', () => {
    const session = makeSession()
    session.status = 'running'
    session.currentQuestionIndex = 1
    session.participants.set('p1', {
      id: 'p1',
      pseudo: 'alice',
      socketId: 'sock-1',
      sessionToken: 'tok-1',
      connected: true,
      score: 1500,
      lastDelta: 700,
      correctTotal: 2,
      teamId: 't1',
    })
    session.tokenIndex.set('tok-1', 'p1')
    session.teams.set('t1', { id: 't1', name: 'Les Rouges', color: '#ff0000' })
    session.mode = 'team'
    session.results.push({
      index: 0,
      text: 'Q1',
      type: 'mcq',
      correctAnswers: ['a'],
      answeredCount: 1,
      correctCount: 1,
    })
    session.lastQuestionResults = new Map([['p1', { gained: 700, correct: true }]])
    session.lastCorrectAnswers = ['a']

    const restored = deserializeSession(serializeSession(session))

    expect(restored.pin).toBe(session.pin)
    expect(restored.status).toBe('running')
    expect(restored.currentQuestionIndex).toBe(1)
    const p1 = restored.participants.get('p1')
    expect(p1?.score).toBe(1500)
    expect(p1?.teamId).toBe('t1')
    expect(p1?.connected).toBe(false)           // plus de socket après restart
    expect(restored.tokenIndex.get('tok-1')).toBe('p1') // le token survit !
    expect(restored.teams.get('t1')?.name).toBe('Les Rouges')
    expect(restored.results).toHaveLength(1)
    expect(restored.lastQuestionResults?.get('p1')?.gained).toBe(700)
    expect(restored.quiz?.questions.length).toBeGreaterThan(0)
    deleteSessionSnapshot(session.id)
  })

  it('question OUVERTE au snapshot → rejouée au restore (index décrémenté, réponses en vol abandonnées)', () => {
    const session = makeSession()
    session.status = 'running'
    session.currentQuestionIndex = 1
    session.questionStartedAt = Date.now() // question 1 en cours
    session.answers.set('p1', { value: 'x', submittedAt: Date.now() })

    const restored = deserializeSession(serializeSession(session))
    expect(restored.currentQuestionIndex).toBe(0) // le host relancera la question 1
    expect(restored.questionStartedAt).toBeNull()
    expect(restored.answers.size).toBe(0)
    deleteSessionSnapshot(session.id)
  })
})

describe('snapshot — cycle complet restart serveur', () => {
  it('après un « restart », le téléphone se reconnecte avec son token et retrouve son score', async () => {
    const session = makeSession()
    const sessionId = session.id
    const { c: alice, joined } = await joinAs('alice', session.pin)
    const { c: bob } = await joinAs('bob', session.pin)

    const host = srv.connect()
    host.emit(EVENTS.HOST_JOIN, { pin: session.pin })
    await waitFor<Joined>(host, EVENTS.SESSION_JOINED)
    host.emit(EVENTS.HOST_START_QUIZ, {})
    host.emit(EVENTS.HOST_NEXT_QUESTION, {})
    await waitFor<QStarted>(alice, EVENTS.QUESTION_STARTED)

    // une question complète est jouée (alice marque des points)
    const ended = waitFor<QEnded>(alice, EVENTS.QUESTION_ENDED)
    alice.emit(EVENTS.SUBMIT_ANSWER, { answer: '4', questionIndex: 0 }, () => {})
    bob.emit(EVENTS.SUBMIT_ANSWER, { answer: '3', questionIndex: 0 }, () => {})
    const aliceScore = (await ended).myScore
    expect(aliceScore).toBeGreaterThan(0)

    // ── « RESTART » : on vide l'état mémoire puis on restaure depuis SQLite ──
    alice.disconnect()
    bob.disconnect()
    deleteSession(sessionId)
    expect(getSessionById(sessionId)).toBeUndefined()

    const n = restoreSessionsAtBoot()
    expect(n).toBeGreaterThanOrEqual(1)
    expect(getSessionById(sessionId)).toBeDefined()

    // le téléphone d'alice se reconnecte avec son token localStorage
    const alice2 = srv.connect()
    alice2.emit(EVENTS.REJOIN_SESSION, { sessionToken: joined.sessionToken })
    const restored = await waitFor<Restored>(alice2, EVENTS.SESSION_RESTORED)

    expect(restored.participant.pseudo).toBe('alice')
    expect(restored.myScore).toBe(aliceScore)   // le score a survécu au restart
    expect(restored.session.pin).toBe(session.pin)
    deleteSessionSnapshot(sessionId)
  })

  it('un snapshot corrompu est purgé sans faire tomber le boot', () => {
    sqlite
      .prepare('INSERT OR REPLACE INTO session_snapshots (id, data, updated_at) VALUES (?, ?, ?)')
      .run('corrompu', '{pas du json', Date.now())
    expect(() => restoreSessionsAtBoot()).not.toThrow()
  })
})
