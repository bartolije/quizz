import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { ServerToClientEvents, Question } from '@lya-quiz/shared'
import { EVENTS, CULTURE_THEME } from '@lya-quiz/shared'
import {
  startTestServer,
  makeBuzzerSession,
  waitFor,
  tick,
  type TestServer,
  type TestClient,
} from './helpers.js'

// Thèmes LIBRES : thèmes sans propriétaire définis par l'admin. Même flux que
// les thèmes perso (le joueur du tour choisit et répond d'abord à l'oral, vol
// ensuite), indistinguables sur la TV — le piment est de ne pas savoir si on
// prend le thème de quelqu'un ou un thème libre. Slot : ownerName = themeName.

type Joined = Parameters<ServerToClientEvents['session_joined']>[0]
type BuzzStarted = Parameters<ServerToClientEvents['buzz_question_started']>[0]
type BuzzEnded = Parameters<ServerToClientEvents['buzz_question_ended']>[0]
type BuzzThemes = Parameters<ServerToClientEvents['buzz_themes']>[0]

let srv: TestServer

const QS: Question[] = [
  { id: 'pa', text: 'Question du thème alice ?', type: 'free', correctAnswers: ['A'], timeLimit: 0, points: 2, section: 'perso', ownerName: 'alice', themeName: 'Espace' },
  { id: 'l1', text: 'Question libre 1 ?', type: 'free', correctAnswers: ['L1'], timeLimit: 0, points: 1, section: 'libre', ownerName: 'Jeux vidéo', themeName: 'Jeux vidéo' },
  { id: 'l2', text: 'Question libre 2 ?', type: 'free', correctAnswers: ['L2'], timeLimit: 0, points: 3, section: 'libre', ownerName: 'Jeux vidéo', themeName: 'Jeux vidéo' },
  { id: 'c1', text: 'Culture ?', type: 'free', correctAnswers: ['C'], timeLimit: 0, points: 1, section: 'culture' },
]

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

function waitThemes(
  socket: TestClient,
  pred: (t: BuzzThemes) => boolean,
  timeoutMs = 3000,
): Promise<BuzzThemes> {
  return new Promise<BuzzThemes>((resolve, reject) => {
    const to = setTimeout(() => {
      socket.off(EVENTS.BUZZ_THEMES, handler)
      reject(new Error(`timeout (${timeoutMs}ms) en attendant un buzz_themes`))
    }, timeoutMs)
    const handler = (t: BuzzThemes): void => {
      if (!pred(t)) return
      clearTimeout(to)
      socket.off(EVENTS.BUZZ_THEMES, handler)
      resolve(t)
    }
    socket.on(EVENTS.BUZZ_THEMES, handler)
  })
}

beforeAll(async () => {
  srv = await startTestServer()
})

afterAll(async () => {
  await srv.close()
})

describe('thèmes libres — diffusion', () => {
  it('buildThemes expose le thème libre (flag + themeName) et la culture ne l\'aspire pas', async () => {
    const session = makeBuzzerSession(QS)
    await joinAs('alice', session.pin)
    const host = await hostJoin(session)

    const themed = waitThemes(host, (t) => t.owners.length > 0)
    host.emit(EVENTS.HOST_START_QUIZ, {})
    const t = await themed

    const libre = t.owners.find((o) => o.ownerName === 'Jeux vidéo')
    expect(libre).toMatchObject({ themeName: 'Jeux vidéo', libre: true, total: 2 })
    const perso = t.owners.find((o) => o.ownerName === 'alice')
    expect(perso?.libre).toBeUndefined()
    // La culture ne compte QUE la question 'culture' (pas les 2 libres)
    expect(t.culture.total).toBe(1)
  })
})

describe('thèmes libres — flux de jeu', () => {
  it('le joueur du tour prend le thème libre : il répond, ne vole pas, les autres si ; le thème consomme son tour', async () => {
    const session = makeBuzzerSession(QS)
    const { c: alice, joined: ja } = await joinAs('alice', session.pin)
    const { c: bob, joined: jb } = await joinAs('bob', session.pin)
    const host = await hostJoin(session)
    host.emit(EVENTS.HOST_START_QUIZ, {})
    await tick()
    session.buzzTurnOrder = [jb.participant.id, ja.participant.id] // bob commence

    // Bob choisit le thème LIBRE → owner_oral, c'est LUI le répondeur.
    const started = waitFor<BuzzStarted>(alice, EVENTS.BUZZ_QUESTION_STARTED)
    host.emit(EVENTS.HOST_START_THEME, { ownerName: 'Jeux vidéo' })
    const s = await started
    expect(s.buzz.phase).toBe('owner_oral')
    expect(s.buzz.ownerParticipantId).toBe(jb.participant.id)
    expect(s.question.section).toBe('libre')
    expect(s.question.themeName).toBe('Jeux vidéo')

    // Bob sèche → vol : bob exclu, alice peut buzzer.
    host.emit(EVENTS.HOST_ADJUDICATE, { correct: false })
    await tick()
    bob.emit(EVENTS.BUZZ, {})
    await tick()
    expect(session.buzz?.lockedBy).toBeNull()
    alice.emit(EVENTS.BUZZ, {})
    await tick()
    expect(session.buzz?.lockedBy?.participantId).toBe(ja.participant.id)

    const ended = waitFor<BuzzEnded>(host, EVENTS.BUZZ_QUESTION_ENDED)
    host.emit(EVENTS.HOST_ADJUDICATE, { correct: true })
    expect((await ended).scorer?.participantId).toBe(ja.participant.id)

    // Question 2 du thème : bob répond toujours (le tour n'avance qu'à la fin du thème).
    const started2 = waitFor<BuzzStarted>(alice, EVENTS.BUZZ_QUESTION_STARTED)
    host.emit(EVENTS.HOST_NEXT_QUESTION, {})
    const s2 = await started2
    expect(s2.buzz.ownerParticipantId).toBe(jb.participant.id)
    host.emit(EVENTS.HOST_ADJUDICATE, { correct: false })
    await tick()
    host.emit(EVENTS.HOST_PASS_QUESTION, {})
    await tick()

    // Thème libre fini → retour sélecteur, le tour passe à alice.
    const themed = waitThemes(host, (t) => t.currentTheme === null)
    host.emit(EVENTS.HOST_NEXT_QUESTION, {})
    const t = await themed
    expect(t.turn!.index).toBe(1)
    expect(t.owners.find((o) => o.ownerName === 'Jeux vidéo')?.done).toBe(true)
  })

  it('CULTURE_THEME ne sert jamais une question libre', async () => {
    const session = makeBuzzerSession(QS)
    const { c: alice } = await joinAs('alice', session.pin)
    const host = await hostJoin(session)
    host.emit(EVENTS.HOST_START_QUIZ, {})
    await tick()

    const started = waitFor<BuzzStarted>(alice, EVENTS.BUZZ_QUESTION_STARTED)
    host.emit(EVENTS.HOST_START_THEME, { ownerName: CULTURE_THEME })
    const s = await started
    expect(s.question.id).toBe('c1')
    expect(s.question.section).toBe('culture')
  })
})
