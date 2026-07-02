import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { ServerToClientEvents } from '@lya-quiz/shared'
import { EVENTS } from '@lya-quiz/shared'
import { getSessionByPin } from '../src/state.js'
import {
  startTestServer,
  makeSession,
  waitFor,
  tick,
  type TestServer,
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

describe('autorisation host (hostKey)', () => {
  it('host_join avec le PIN mais une MAUVAISE clé → rejeté, aucune prise de contrôle', async () => {
    const session = makeSession()
    // le joueur taquin ne connaît que le PIN affiché sur la TV
    const attacker = srv.connect()
    attacker.emit(EVENTS.HOST_JOIN, { pin: session.pin, hostKey: 'devine' })
    const err = await waitFor<QuizError>(attacker, EVENTS.QUIZ_ERROR)
    expect(err.code).toBe('INVALID_HOST_KEY')
    expect(session.hostSocketIds.size).toBe(0)

    // ses events host sont ignorés : rien ne démarre
    attacker.emit(EVENTS.HOST_START_QUIZ, {})
    attacker.emit(EVENTS.HOST_NEXT_QUESTION, {})
    await tick(200)
    expect(session.status).toBe('waiting')
    expect(session.questionStartedAt).toBeNull()
  })

  it('host_join avec la bonne clé → contrôle OK', async () => {
    const session = makeSession()
    const host = srv.connect()
    host.emit(EVENTS.HOST_JOIN, { pin: session.pin, hostKey: session.hostKey })
    const joined = await waitFor<Joined>(host, EVENTS.SESSION_JOINED)
    expect(joined.session.pin).toBe(session.pin)
    expect(session.hostSocketIds.size).toBe(1)
  })

  it("host_join avec un PIN inconnu → erreur explicite, AUCUNE session créée en silence", async () => {
    const c = srv.connect()
    c.emit(EVENTS.HOST_JOIN, { pin: '0000', hostKey: 'peu-importe' })
    const err = await waitFor<QuizError>(c, EVENTS.QUIZ_ERROR)
    expect(err.code).toBe('INVALID_PIN')
    expect(getSessionByPin('0000')).toBeUndefined()
  })
})

describe('display_join (TV, lecture seule)', () => {
  it('rejoint par sessionId, reçoit l’état + la question en cours, mais ne pilote RIEN', async () => {
    const session = makeSession()
    const host = srv.connect()
    host.emit(EVENTS.HOST_JOIN, { pin: session.pin, hostKey: session.hostKey })
    await waitFor<Joined>(host, EVENTS.SESSION_JOINED)
    host.emit(EVENTS.HOST_START_QUIZ, {})
    host.emit(EVENTS.HOST_NEXT_QUESTION, {})
    await waitFor<QStarted>(host, EVENTS.QUESTION_STARTED)

    // la TV rejoint EN PLEINE question via le sessionId (uuid non devinable)
    const tv = srv.connect()
    const joinedP = waitFor<Joined>(tv, EVENTS.SESSION_JOINED)
    const startedP = waitFor<QStarted>(tv, EVENTS.QUESTION_STARTED)
    tv.emit(EVENTS.DISPLAY_JOIN, { sessionId: session.id })

    expect((await joinedP).session.status).toBe('running')
    const replay = await startedP
    expect(replay.timeElapsed).toBeGreaterThanOrEqual(0)

    // la TV n'est PAS host : ses events host sont ignorés
    expect(session.hostSocketIds.size).toBe(1) // seulement le vrai host
    tv.emit(EVENTS.HOST_END_QUIZ, {})
    await tick(200)
    expect(session.status).toBe('running') // toujours en cours
  })

  it('sessionId inconnu → erreur claire', async () => {
    const tv = srv.connect()
    tv.emit(EVENTS.DISPLAY_JOIN, { sessionId: 'n-existe-pas' })
    const err = await waitFor<QuizError>(tv, EVENTS.QUIZ_ERROR)
    expect(err.code).toBe('INVALID_PIN')
  })
})
