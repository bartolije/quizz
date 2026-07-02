import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { ServerToClientEvents, SubmitAnswerAck } from '@lya-quiz/shared'
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

async function hostStart(pin: string, watcher: TestClient): Promise<TestClient> {
  const host = srv.connect()
  host.emit(EVENTS.HOST_JOIN, { pin })
  await waitFor<Joined>(host, EVENTS.SESSION_JOINED)
  host.emit(EVENTS.HOST_START_QUIZ, {})
  host.emit(EVENTS.HOST_NEXT_QUESTION, {})
  await waitFor<QStarted>(watcher, EVENTS.QUESTION_STARTED)
  return host
}

describe('fermeture anticipée — fenêtre de grâce des déconnectés', () => {
  it("un joueur en coupure ne fait PAS fermer la question sous ses pieds", async () => {
    const session = makeSession()
    const { c: alice } = await joinAs('alice', session.pin)
    const { c: bob, joined: bobJoined } = await joinAs('bob', session.pin)
    const { c: carol } = await joinAs('carol', session.pin)
    await hostStart(session.pin, alice)

    // bob perd sa connexion en pleine question (blip wifi)
    await new Promise<void>((resolve) => {
      bob.once('disconnect', () => resolve())
      bob.disconnect()
    })
    await tick()

    // les deux joueurs restants répondent → AVANT le fix, la question fermait ici
    alice.emit(EVENTS.SUBMIT_ANSWER, { answer: '4', questionIndex: 0 }, () => {})
    carol.emit(EVENTS.SUBMIT_ANSWER, { answer: '3', questionIndex: 0 }, () => {})
    await tick(300)
    expect(session.questionStartedAt).not.toBeNull() // toujours ouverte (grâce)

    // bob revient et répond → maintenant tout le monde a répondu → fermeture
    const bob2 = srv.connect()
    bob2.emit(EVENTS.REJOIN_SESSION, { sessionToken: bobJoined.sessionToken })
    await waitFor(bob2, EVENTS.SESSION_RESTORED)
    const ended = waitFor<QEnded>(alice, EVENTS.QUESTION_ENDED)
    bob2.emit(EVENTS.SUBMIT_ANSWER, { answer: '4', questionIndex: 0 }, () => {})
    expect((await ended).answeredCount).toBe(3)
  })
})

describe('retardataire en pleine question', () => {
  it('reçoit la question en cours avec le temps déjà écoulé, et peut répondre', async () => {
    const session = makeSession()
    const { c: alice } = await joinAs('alice', session.pin)
    await hostStart(session.pin, alice)
    await tick(300) // la question tourne depuis ~300 ms

    // dave scanne le QR APRÈS le lancement de la question
    const dave = srv.connect()
    const started = waitFor<QStarted>(dave, EVENTS.QUESTION_STARTED)
    dave.emit(EVENTS.JOIN_SESSION, { pin: session.pin, pseudo: 'dave', sessionToken: null })
    await waitFor<Joined>(dave, EVENTS.SESSION_JOINED)

    const replay = await started
    expect(replay.question.text).toBe('2 + 2 ?')
    expect(replay.timeElapsed).toBeGreaterThan(0.2) // chrono recalé, pas reparti à fond

    const res: SubmitAnswerAck = await dave
      .timeout(2000)
      .emitWithAck(EVENTS.SUBMIT_ANSWER, { answer: '4', questionIndex: 0 })
    expect(res.status).toBe('accepted')
  })
})
