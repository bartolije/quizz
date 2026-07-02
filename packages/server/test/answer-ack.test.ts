import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { ServerToClientEvents, SubmitAnswerAck } from '@lya-quiz/shared'
import { EVENTS } from '@lya-quiz/shared'
import {
  startTestServer,
  makeSession,
  waitFor,
  type TestServer,
  type TestClient,
} from './helpers.js'

type Joined = Parameters<ServerToClientEvents['session_joined']>[0]
type QStarted = Parameters<ServerToClientEvents['question_started']>[0]

let srv: TestServer

beforeAll(async () => {
  srv = await startTestServer()
})

afterAll(async () => {
  await srv.close()
})

async function joinAs(pseudo: string, pin: string): Promise<TestClient> {
  const c = srv.connect()
  c.emit(EVENTS.JOIN_SESSION, { pin, pseudo, sessionToken: null })
  await waitFor<Joined>(c, EVENTS.SESSION_JOINED)
  return c
}

async function hostStartFirstQuestion(pin: string, watcher: TestClient): Promise<TestClient> {
  const host = srv.connect()
  host.emit(EVENTS.HOST_JOIN, { pin })
  await waitFor<Joined>(host, EVENTS.SESSION_JOINED)
  host.emit(EVENTS.HOST_START_QUIZ, {})
  host.emit(EVENTS.HOST_NEXT_QUESTION, {})
  await waitFor<QStarted>(watcher, EVENTS.QUESTION_STARTED)
  return host
}

const submit = (
  c: TestClient,
  answer: string | number | string[],
  questionIndex: number,
): Promise<SubmitAnswerAck> =>
  c.timeout(2000).emitWithAck(EVENTS.SUBMIT_ANSWER, { answer, questionIndex })

describe('ack des réponses (submit_answer)', () => {
  it('réponse valide → accepted ; doublon → already_answered (succès)', async () => {
    const session = makeSession()
    const alice = await joinAs('alice', session.pin)
    await joinAs('bob', session.pin) // 2ᵉ joueur : évite la fermeture anticipée
    await hostStartFirstQuestion(session.pin, alice)

    expect(await submit(alice, '4', 0)).toEqual({ ok: true, status: 'accepted' })
    // Retry après coupure : la réponse est déjà là → succès, pas d'erreur
    expect(await submit(alice, '4', 0)).toEqual({ ok: true, status: 'already_answered' })
  })

  it('réponse retardée visant une AUTRE question → question_closed (pas comptée)', async () => {
    const session = makeSession()
    const alice = await joinAs('alice', session.pin)
    await joinAs('bob', session.pin)
    await hostStartFirstQuestion(session.pin, alice)

    // Réponse rejouée par un buffer qui visait une question précédente (index 7)
    const res = await submit(alice, '4', 7)
    expect(res).toEqual({ ok: false, status: 'question_closed' })
    expect(session.answers.size).toBe(0) // rien enregistré
  })

  it('question fermée (fin du quiz par le host) → question_closed', async () => {
    const session = makeSession()
    const alice = await joinAs('alice', session.pin)
    await joinAs('bob', session.pin)
    const host = await hostStartFirstQuestion(session.pin, alice)

    host.emit(EVENTS.HOST_END_QUIZ, {})
    await waitFor(alice, EVENTS.SESSION_STATUS_CHANGED)

    const res = await submit(alice, '4', 0)
    expect(res).toEqual({ ok: false, status: 'question_closed' })
  })

  it('socket jamais rattaché à un participant → not_in_session', async () => {
    const stranger = srv.connect()
    await new Promise<void>((resolve) => stranger.once('connect', () => resolve()))
    const res = await submit(stranger, '4', 0)
    expect(res).toEqual({ ok: false, status: 'not_in_session' })
  })
})
