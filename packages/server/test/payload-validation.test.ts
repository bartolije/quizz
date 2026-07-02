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
type QuizError = Parameters<ServerToClientEvents['quiz_error']>[0]

let srv: TestServer

beforeAll(async () => {
  srv = await startTestServer()
})

afterAll(async () => {
  await srv.close()
})

describe('validation des payloads — pseudo', () => {
  it('pseudo démesuré tronqué à 20 caractères', async () => {
    const session = makeSession()
    const c = srv.connect()
    c.emit(EVENTS.JOIN_SESSION, { pin: session.pin, pseudo: 'x'.repeat(5000), sessionToken: null })
    const joined = await waitFor<Joined>(c, EVENTS.SESSION_JOINED)
    expect(joined.participant.pseudo).toHaveLength(20)
  })

  it('pseudo vide / espaces → INVALID_PSEUDO', async () => {
    const session = makeSession()
    const c = srv.connect()
    c.emit(EVENTS.JOIN_SESSION, { pin: session.pin, pseudo: '   ', sessionToken: null })
    const err = await waitFor<QuizError>(c, EVENTS.QUIZ_ERROR)
    expect(err.code).toBe('INVALID_PSEUDO')
  })

  it('payload join malformé (types inattendus) → pas de crash serveur', async () => {
    const session = makeSession()
    const c = srv.connect()
    // un client bricolé en DevTools peut envoyer n'importe quoi
    ;(c as { emit: (e: string, p: unknown) => void }).emit(EVENTS.JOIN_SESSION, {
      pin: session.pin,
      pseudo: 12345,
      sessionToken: { evil: true },
    })
    const joined = await waitFor<Joined>(c, EVENTS.SESSION_JOINED)
    expect(joined.participant.pseudo).toBe('12345') // coercition propre, pas de crash
  })
})

describe('validation des payloads — réponses', () => {
  async function setupQuestion(): Promise<{ alice: TestClient; sessionAnswers: Map<string, { value: unknown }> }> {
    const session = makeSession()
    const alice = srv.connect()
    alice.emit(EVENTS.JOIN_SESSION, { pin: session.pin, pseudo: 'alice', sessionToken: null })
    await waitFor<Joined>(alice, EVENTS.SESSION_JOINED)
    const bob = srv.connect()
    bob.emit(EVENTS.JOIN_SESSION, { pin: session.pin, pseudo: 'bob', sessionToken: null })
    await waitFor<Joined>(bob, EVENTS.SESSION_JOINED)

    const host = srv.connect()
    host.emit(EVENTS.HOST_JOIN, { pin: session.pin, hostKey: session.hostKey })
    await waitFor<Joined>(host, EVENTS.SESSION_JOINED)
    host.emit(EVENTS.HOST_START_QUIZ, {})
    host.emit(EVENTS.HOST_NEXT_QUESTION, {})
    await waitFor<QStarted>(alice, EVENTS.QUESTION_STARTED)
    return { alice, sessionAnswers: session.answers }
  }

  it('réponse texte énorme (500 ko) → tronquée à 200 caractères (event loop protégée)', async () => {
    // NB : au-delà de maxHttpBufferSize (1 Mo par défaut), Socket.io coupe
    // carrément la connexion — la borne applicative couvre ce qui passe dessous.
    const { alice, sessionAnswers } = await setupQuestion()
    const res: SubmitAnswerAck = await alice
      .timeout(3000)
      .emitWithAck(EVENTS.SUBMIT_ANSWER, { answer: 'x'.repeat(500_000), questionIndex: 0 })
    expect(res.status).toBe('accepted')
    const stored = [...sessionAnswers.values()][0]
    expect(String(stored?.value)).toHaveLength(200)
  })

  it('tableau ordering absurde (10 000 items) → invalid_answer, rien enregistré', async () => {
    const { alice, sessionAnswers } = await setupQuestion()
    const res: SubmitAnswerAck = await alice
      .timeout(3000)
      .emitWithAck(EVENTS.SUBMIT_ANSWER, {
        answer: Array.from({ length: 10_000 }, (_, i) => String(i)),
        questionIndex: 0,
      })
    expect(res).toEqual({ ok: false, status: 'invalid_answer' })
    expect(sessionAnswers.size).toBe(0)
  })

  it('nombre non fini (NaN/Infinity) → invalid_answer', async () => {
    const { alice } = await setupQuestion()
    const res: SubmitAnswerAck = await alice
      .timeout(3000)
      .emitWithAck(EVENTS.SUBMIT_ANSWER, { answer: Infinity, questionIndex: 0 })
    expect(res).toEqual({ ok: false, status: 'invalid_answer' })
  })
})
