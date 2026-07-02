import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { ServerToClientEvents } from '@lya-quiz/shared'
import { EVENTS } from '@lya-quiz/shared'
import {
  startTestServer,
  makeSession,
  waitFor,
  tick,
  type TestServer,
  type TestClient,
} from './helpers.js'

type Joined = Parameters<ServerToClientEvents['session_joined']>[0]
type QStarted = Parameters<ServerToClientEvents['question_started']>[0]
type QEnded = Parameters<ServerToClientEvents['question_ended']>[0]
type QuizError = Parameters<ServerToClientEvents['quiz_error']>[0]
type TeamsUpdated = Parameters<ServerToClientEvents['teams_updated']>[0]

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

async function hostJoin(session: { pin: string; hostKey: string }): Promise<TestClient> {
  const c = srv.connect()
  c.emit(EVENTS.HOST_JOIN, { pin: session.pin, hostKey: session.hostKey })
  await waitFor<Joined>(c, EVENTS.SESSION_JOINED)
  return c
}

describe('kick participant', () => {
  it('l’éjecté est retiré (score compris), prévenu, et son token invalidé', async () => {
    const session = makeSession()
    const { c: alice } = await joinAs('alice', session.pin)
    const { c: troll, joined: trollJoined } = await joinAs('troll', session.pin)
    const host = await hostJoin(session)

    const kickedMsg = waitFor<QuizError>(troll, EVENTS.QUIZ_ERROR)
    const listUpdate = waitFor<TeamsUpdated>(alice, EVENTS.TEAMS_UPDATED)
    host.emit(EVENTS.HOST_KICK_PARTICIPANT, { participantId: trollJoined.participant.id })

    expect((await kickedMsg).code).toBe('KICKED')
    // la liste rediffusée ne contient plus l'éjecté
    expect((await listUpdate).participants.map((p) => p.pseudo)).not.toContain('troll')
    expect(session.participants.size).toBe(1)

    // son token ne permet plus de revenir par reconnexion automatique
    const troll2 = srv.connect()
    troll2.emit(EVENTS.REJOIN_SESSION, { sessionToken: trollJoined.sessionToken })
    expect((await waitFor<QuizError>(troll2, EVENTS.QUIZ_ERROR)).code).toBe('INVALID_TOKEN')
  })

  it('seul un vrai host peut kicker', async () => {
    const session = makeSession()
    const { joined: aliceJoined } = await joinAs('alice', session.pin)
    const { c: bob } = await joinAs('bob', session.pin)

    bob.emit(EVENTS.HOST_KICK_PARTICIPANT, { participantId: aliceJoined.participant.id })
    await tick(200)
    expect(session.participants.size).toBe(2) // rien ne s'est passé
  })
})

describe('rejouer la dernière question', () => {
  it('points repris, rapport nettoyé, question relancée immédiatement', async () => {
    const session = makeSession()
    const { c: alice } = await joinAs('alice', session.pin)
    const { c: bob } = await joinAs('bob', session.pin)
    const host = await hostJoin(session)

    host.emit(EVENTS.HOST_START_QUIZ, {})
    host.emit(EVENTS.HOST_NEXT_QUESTION, {})
    await waitFor<QStarted>(alice, EVENTS.QUESTION_STARTED)

    // 1ʳᵉ manche : alice répond juste, bob faux
    const ended1 = waitFor<QEnded>(alice, EVENTS.QUESTION_ENDED)
    alice.emit(EVENTS.SUBMIT_ANSWER, { answer: '4', questionIndex: 0 }, () => {})
    bob.emit(EVENTS.SUBMIT_ANSWER, { answer: '3', questionIndex: 0 }, () => {})
    const r1 = await ended1
    expect(r1.myScore).toBeGreaterThan(0)
    expect(session.results).toHaveLength(1)

    // le host annule et rejoue → la même question repart, état neuf
    const replayed = waitFor<QStarted>(alice, EVENTS.QUESTION_STARTED)
    host.emit(EVENTS.HOST_REPLAY_LAST_QUESTION, {})
    expect((await replayed).question.text).toBe('2 + 2 ?')
    expect(session.results).toHaveLength(0)               // rapport nettoyé
    expect(session.participants.get(r1.scores[0]!.participantId)?.score ?? 0).toBe(0) // points repris

    // 2ᵉ manche : bob répond juste cette fois
    const ended2 = waitFor<QEnded>(bob, EVENTS.QUESTION_ENDED)
    alice.emit(EVENTS.SUBMIT_ANSWER, { answer: '3', questionIndex: 0 }, () => {})
    bob.emit(EVENTS.SUBMIT_ANSWER, { answer: '4', questionIndex: 0 }, () => {})
    const r2 = await ended2
    expect(r2.myCorrect).toBe(true)
    expect(r2.myScore).toBeGreaterThan(0)
    expect(session.results).toHaveLength(1) // une seule entrée pour cette question
  })

  it('replay impossible pendant une question ouverte', async () => {
    const session = makeSession()
    const { c: alice } = await joinAs('alice', session.pin)
    const host = await hostJoin(session)
    host.emit(EVENTS.HOST_START_QUIZ, {})
    host.emit(EVENTS.HOST_NEXT_QUESTION, {})
    await waitFor<QStarted>(alice, EVENTS.QUESTION_STARTED)

    host.emit(EVENTS.HOST_REPLAY_LAST_QUESTION, {})
    await tick(200)
    expect(session.currentQuestionIndex).toBe(0) // rien n'a bougé
    expect(session.questionStartedAt).not.toBeNull()
  })
})
