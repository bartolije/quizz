import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { ServerToClientEvents } from '@lya-quiz/shared'
import { EVENTS } from '@lya-quiz/shared'
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
type QuizError = Parameters<ServerToClientEvents['quiz_error']>[0]

let srv: TestServer

beforeAll(async () => {
  srv = await startTestServer()
})

afterAll(async () => {
  await srv.close()
})

// Rejoint une session comme participant et attend la confirmation serveur.
async function joinAs(pseudo: string, pin: string): Promise<{ c: TestClient; joined: Joined }> {
  const c = srv.connect()
  c.emit(EVENTS.JOIN_SESSION, { pin, pseudo, sessionToken: null })
  const joined = await waitFor<Joined>(c, EVENTS.SESSION_JOINED)
  return { c, joined }
}

// Rejoint une session comme host et attend la confirmation serveur.
async function hostJoin(pin: string): Promise<TestClient> {
  const c = srv.connect()
  c.emit(EVENTS.HOST_JOIN, { pin })
  await waitFor<Joined>(c, EVENTS.SESSION_JOINED)
  return c
}

describe('join', () => {
  it('un joueur rejoint avec un PIN valide et reçoit son token + la liste', async () => {
    const session = makeSession()
    const { joined } = await joinAs('alice', session.pin)

    expect(joined.sessionToken).toBeTruthy()
    expect(joined.participant.pseudo).toBe('alice')
    expect(joined.participants.map((p) => p.pseudo)).toContain('alice')
    expect(joined.session.pin).toBe(session.pin)
  })

  it('PIN inconnu → INVALID_PIN', async () => {
    const c = srv.connect()
    c.emit(EVENTS.JOIN_SESSION, { pin: '0000', pseudo: 'bob', sessionToken: null })
    const err = await waitFor<QuizError>(c, EVENTS.QUIZ_ERROR)
    expect(err.code).toBe('INVALID_PIN')
  })

  it('pseudo déjà utilisé → PSEUDO_TAKEN', async () => {
    const session = makeSession()
    await joinAs('carol', session.pin)

    const c = srv.connect()
    c.emit(EVENTS.JOIN_SESSION, { pin: session.pin, pseudo: 'carol', sessionToken: null })
    const err = await waitFor<QuizError>(c, EVENTS.QUIZ_ERROR)
    expect(err.code).toBe('PSEUDO_TAKEN')
  })
})

describe('boucle de jeu', () => {
  it('question → réponses → fermeture anticipée → scores personnalisés', async () => {
    const session = makeSession()
    const { c: alice } = await joinAs('alice', session.pin)
    const { c: bob } = await joinAs('bob', session.pin)
    const host = await hostJoin(session.pin)

    host.emit(EVENTS.HOST_START_QUIZ, {})
    host.emit(EVENTS.HOST_NEXT_QUESTION, {})

    const qAlice = await waitFor<QStarted>(alice, EVENTS.QUESTION_STARTED)
    expect(qAlice.question.text).toBe('2 + 2 ?')
    // ANTI-TRICHE : la question diffusée ne contient jamais les bonnes réponses
    expect(qAlice.question).not.toHaveProperty('correctAnswers')

    const endedAlice = waitFor<QEnded>(alice, EVENTS.QUESTION_ENDED)
    const endedBob = waitFor<QEnded>(bob, EVENTS.QUESTION_ENDED)

    alice.emit(EVENTS.SUBMIT_ANSWER, { answer: '4', questionIndex: 0 }, () => {})
    bob.emit(EVENTS.SUBMIT_ANSWER, { answer: '3', questionIndex: 0 }, () => {})

    // Tous les connectés ont répondu → fermeture anticipée sans attendre le timer
    const [ra, rb] = await Promise.all([endedAlice, endedBob])
    expect(ra.correctAnswers).toEqual(['4'])
    expect(ra.myCorrect).toBe(true)
    expect(ra.myDelta).toBeGreaterThan(0)
    expect(rb.myCorrect).toBe(false)
    expect(rb.myDelta).toBe(0)
    expect(ra.answeredCount).toBe(2)
    expect(ra.correctCount).toBe(1)
  })

  it('seule la première réponse compte (double submit ignoré)', async () => {
    const session = makeSession()
    const { c: alice } = await joinAs('alice', session.pin)
    const { c: bob } = await joinAs('bob', session.pin)
    const host = await hostJoin(session.pin)

    host.emit(EVENTS.HOST_START_QUIZ, {})
    host.emit(EVENTS.HOST_NEXT_QUESTION, {})
    await waitFor<QStarted>(alice, EVENTS.QUESTION_STARTED)

    const endedAlice = waitFor<QEnded>(alice, EVENTS.QUESTION_ENDED)

    alice.emit(EVENTS.SUBMIT_ANSWER, { answer: '4', questionIndex: 0 }, () => {})
    alice.emit(EVENTS.SUBMIT_ANSWER, { answer: '3', questionIndex: 0 }, () => {}) // ignoré : déjà répondu
    bob.emit(EVENTS.SUBMIT_ANSWER, { answer: '5', questionIndex: 0 }, () => {})

    const ra = await endedAlice
    expect(ra.myAnswer).toBe('4')
    expect(ra.myCorrect).toBe(true)
  })
})

describe('reconnexion participant', () => {
  it('rejoin en pleine question : état restauré, réponse conservée, scores reçus sur le nouveau socket', async () => {
    const session = makeSession()
    const { c: alice, joined } = await joinAs('alice', session.pin)
    const { c: bob } = await joinAs('bob', session.pin)
    const host = await hostJoin(session.pin)

    host.emit(EVENTS.HOST_START_QUIZ, {})
    host.emit(EVENTS.HOST_NEXT_QUESTION, {})
    await waitFor<QStarted>(alice, EVENTS.QUESTION_STARTED)

    // alice répond ; on attend que le serveur l'ait enregistrée (ack host)
    // AVANT de couper — sans ça la réponse peut se perdre dans la déconnexion
    // (c'est précisément la faiblesse « pas d'ack participant » corrigée en P0-3).
    const ackHost = waitFor(host, EVENTS.ANSWER_RECEIVED)
    alice.emit(EVENTS.SUBMIT_ANSWER, { answer: '4', questionIndex: 0 }, () => {})
    await ackHost
    await new Promise<void>((resolve) => {
      alice.once('disconnect', () => resolve())
      alice.disconnect()
    })

    // nouveau socket (nouvelle connexion) + rejoin par token
    const alice2 = srv.connect()
    alice2.emit(EVENTS.REJOIN_SESSION, { sessionToken: joined.sessionToken })
    const restored = await waitFor<Restored>(alice2, EVENTS.SESSION_RESTORED)

    expect(restored.currentQuestion?.text).toBe('2 + 2 ?')
    expect(restored.alreadyAnswered).toBe(true)
    expect(restored.timeElapsed).toBeGreaterThanOrEqual(0)
    expect(restored.participant.pseudo).toBe('alice')

    // la fin de question doit arriver sur le NOUVEAU socket
    const endedAlice2 = waitFor<QEnded>(alice2, EVENTS.QUESTION_ENDED)
    bob.emit(EVENTS.SUBMIT_ANSWER, { answer: '3', questionIndex: 0 }, () => {})
    const ra = await endedAlice2
    expect(ra.myAnswer).toBe('4')
    expect(ra.myCorrect).toBe(true)
  })

  it('rejoin ENTRE deux questions : classement + résultat de la dernière question rejoués', async () => {
    const session = makeSession()
    const { c: alice, joined } = await joinAs('alice', session.pin)
    const { c: bob } = await joinAs('bob', session.pin)
    const host = await hostJoin(session.pin)

    host.emit(EVENTS.HOST_START_QUIZ, {})
    host.emit(EVENTS.HOST_NEXT_QUESTION, {})
    await waitFor<QStarted>(alice, EVENTS.QUESTION_STARTED)

    // les deux répondent → question fermée (fermeture anticipée)
    const ended = waitFor<QEnded>(alice, EVENTS.QUESTION_ENDED)
    alice.emit(EVENTS.SUBMIT_ANSWER, { answer: '4', questionIndex: 0 }, () => {})
    bob.emit(EVENTS.SUBMIT_ANSWER, { answer: '3', questionIndex: 0 }, () => {})
    await ended

    // alice se déconnecte APRÈS la fermeture, reconnecte pendant l'entre-deux
    await new Promise<void>((resolve) => {
      alice.once('disconnect', () => resolve())
      alice.disconnect()
    })
    const alice2 = srv.connect()
    alice2.emit(EVENTS.REJOIN_SESSION, { sessionToken: joined.sessionToken })
    const restored = await waitFor<Restored>(alice2, EVENTS.SESSION_RESTORED)

    expect(restored.currentQuestion).toBeNull()
    expect(restored.scores.length).toBe(2)
    expect(restored.lastResult).not.toBeNull()
    expect(restored.lastResult?.correctAnswers).toEqual(['4'])
    expect(restored.lastResult?.myAnswer).toBe('4')
    expect(restored.lastResult?.myCorrect).toBe(true)
    expect(restored.lastResult?.myDelta).toBeGreaterThan(0)
    expect(restored.myScore).toBe(restored.lastResult?.myDelta)
  })

  it('token inconnu → INVALID_TOKEN', async () => {
    const c = srv.connect()
    c.emit(EVENTS.REJOIN_SESSION, { sessionToken: 'token-inexistant' })
    const err = await waitFor<QuizError>(c, EVENTS.QUIZ_ERROR)
    expect(err.code).toBe('INVALID_TOKEN')
  })
})
