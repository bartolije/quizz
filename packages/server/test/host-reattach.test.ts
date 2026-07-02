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
type Ack = Parameters<ServerToClientEvents['answer_received']>[0]

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

// Reproduit le comportement client corrigé (useHostSession : host_join ré-émis
// à chaque connexion) : après une coupure du host, un NOUVEAU socket refait
// host_join → il doit retrouver l'état complet et recevoir à nouveau les events.
describe('reconnexion host / TV', () => {
  it('host re-join en pleine question : question renvoyée + events reçus à nouveau', async () => {
    const session = makeSession()
    const alice = await joinAs('alice', session.pin)
    const bob = await joinAs('bob', session.pin)

    const host1 = srv.connect()
    host1.emit(EVENTS.HOST_JOIN, { pin: session.pin })
    await waitFor<Joined>(host1, EVENTS.SESSION_JOINED)

    host1.emit(EVENTS.HOST_START_QUIZ, {})
    host1.emit(EVENTS.HOST_NEXT_QUESTION, {})
    await waitFor<QStarted>(alice, EVENTS.QUESTION_STARTED)

    // Coupure réseau du host en pleine question
    await new Promise<void>((resolve) => {
      host1.once('disconnect', () => resolve())
      host1.disconnect()
    })

    // Nouveau socket (reconnexion) → host_join ré-émis (fix useHostSession).
    // Les waiters sont posés AVANT l'emit : le serveur renvoie session_joined
    // puis question_started dans la même rafale.
    const host2 = srv.connect()
    const rejoinedP = waitFor<Joined>(host2, EVENTS.SESSION_JOINED)
    const replayP = waitFor<QStarted>(host2, EVENTS.QUESTION_STARTED)
    host2.emit(EVENTS.HOST_JOIN, { pin: session.pin })

    const rejoined = await rejoinedP
    expect(rejoined.session.pin).toBe(session.pin)
    expect(rejoined.session.status).toBe('running')

    // Reprise : la question OUVERTE est renvoyée au host reconnecté
    const replay = await replayP
    expect(replay.question.text).toBe('2 + 2 ?')

    // Le host reconnecté reçoit à nouveau le compteur live et la révélation
    const ack = waitFor<Ack>(host2, EVENTS.ANSWER_RECEIVED)
    const ended = waitFor<QEnded>(host2, EVENTS.QUESTION_ENDED)
    alice.emit(EVENTS.SUBMIT_ANSWER, { answer: '4' })
    bob.emit(EVENTS.SUBMIT_ANSWER, { answer: '3' })

    expect((await ack).answeredCount).toBeGreaterThanOrEqual(1)
    expect((await ended).answeredCount).toBe(2)
  })

  it("le host déconnecté est retiré de hostSocketIds (ses actions ne marchent plus)", async () => {
    const session = makeSession()
    const alice = await joinAs('alice', session.pin)

    const host1 = srv.connect()
    host1.emit(EVENTS.HOST_JOIN, { pin: session.pin })
    await waitFor<Joined>(host1, EVENTS.SESSION_JOINED)

    await new Promise<void>((resolve) => {
      host1.once('disconnect', () => resolve())
      host1.disconnect()
    })
    await tick() // le disconnect côté SERVEUR est traité de façon asynchrone

    // Après la coupure, le serveur ne connaît plus ce socket comme host
    expect(session.hostSocketIds.size).toBe(0)

    // alice ne doit PAS recevoir de question si un ex-host émet dans le vide :
    // (host1 est déconnecté → rien ne part ; on vérifie l'état serveur)
    expect(session.questionStartedAt).toBeNull()
    alice.disconnect()
  })
})
