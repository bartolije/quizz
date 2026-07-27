import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { ServerToClientEvents, Question } from '@lya-quiz/shared'
import { EVENTS, CULTURE_THEME } from '@lya-quiz/shared'
import { serializeSession, deserializeSession } from '../src/session-snapshot.js'
import {
  startTestServer,
  makeBuzzerSession,
  waitFor,
  tick,
  type TestServer,
  type TestClient,
} from './helpers.js'

// Tour par tour (règle 2026) : ordre de passage aléatoire tiré au start ; le
// joueur du tour choisit un thème PAS ENCORE JOUÉ (le sien ou celui d'un autre)
// et répond à tout le thème. Mauvaise réponse → vol ouvert à tous les autres,
// y compris le propriétaire du thème.

type Joined = Parameters<ServerToClientEvents['session_joined']>[0]
type BuzzStarted = Parameters<ServerToClientEvents['buzz_question_started']>[0]
type BuzzEnded = Parameters<ServerToClientEvents['buzz_question_ended']>[0]
type BuzzThemes = Parameters<ServerToClientEvents['buzz_themes']>[0]

let srv: TestServer

const QS: Question[] = [
  { id: 'pa', text: 'Question du thème alice ?', type: 'free', correctAnswers: ['A'], timeLimit: 0, difficulty: 'moyen', section: 'perso', ownerName: 'alice' },
  { id: 'pb', text: 'Question du thème bob ?', type: 'free', correctAnswers: ['B'], timeLimit: 0, difficulty: 'facile', section: 'perso', ownerName: 'bob' },
  { id: 'c1', text: 'Culture ?', type: 'free', correctAnswers: ['C'], timeLimit: 0, difficulty: 'facile', section: 'culture' },
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

describe('tour par tour — tirage et diffusion', () => {
  it('host_start_quiz tire un ordre couvrant tous les joueurs (tél + sans téléphone)', async () => {
    const session = makeBuzzerSession(QS)
    await joinAs('alice', session.pin)
    await joinAs('bob', session.pin)
    const host = await hostJoin(session)
    host.emit(EVENTS.HOST_ADD_MANUAL_PARTICIPANT, { pseudo: 'Mamie' })
    await tick()

    const themed = waitThemes(host, (t) => t.turn !== null)
    host.emit(EVENTS.HOST_START_QUIZ, {})
    const t = await themed
    expect(t.turn!.order).toHaveLength(3)
    expect(t.turn!.order.map((o) => o.pseudo).sort()).toEqual(['Mamie', 'alice', 'bob'])
    expect(t.turn!.index).toBe(0)
    expect(session.buzzTurnOrder).toHaveLength(3)
  })

  it('un quiz 100 % culture ne tire PAS de tour', async () => {
    const session = makeBuzzerSession([QS[2] as Question])
    await joinAs('alice', session.pin)
    const host = await hostJoin(session)
    host.emit(EVENTS.HOST_START_QUIZ, {})
    await tick()
    expect(session.buzzTurnOrder).toBeNull()
  })
})

describe('tour par tour — prendre le thème d\'un autre', () => {
  it('bob (joueur du tour) prend le thème d\'alice : il répond, ne vole pas, alice PEUT voler', async () => {
    const session = makeBuzzerSession(QS)
    const { c: alice, joined: ja } = await joinAs('alice', session.pin)
    const { c: bob, joined: jb } = await joinAs('bob', session.pin)
    const host = await hostJoin(session)
    host.emit(EVENTS.HOST_START_QUIZ, {})
    await tick()
    session.buzzTurnOrder = [jb.participant.id, ja.participant.id] // bob commence

    // Bob choisit le thème d'ALICE → c'est LUI le répondeur.
    const started = waitFor<BuzzStarted>(alice, EVENTS.BUZZ_QUESTION_STARTED)
    host.emit(EVENTS.HOST_START_THEME, { ownerName: 'alice' })
    const s = await started
    expect(s.buzz.phase).toBe('owner_oral')
    expect(s.buzz.ownerName).toBe('alice')                       // le thème reste celui d'alice
    expect(s.buzz.ownerParticipantId).toBe(jb.participant.id)   // mais bob répond

    // Bob sèche → vol ouvert. Bob ne peut PAS voler sa propre main…
    host.emit(EVENTS.HOST_ADJUDICATE, { correct: false })
    await tick()
    expect(session.buzz?.phase).toBe('steal')
    bob.emit(EVENTS.BUZZ, {})
    await tick()
    expect(session.buzz?.lockedBy).toBeNull()

    // …mais ALICE (propriétaire du thème) peut buzzer : « tant pis pour elle » ne
    // l'exclut pas du vol, elle a juste perdu la priorité.
    alice.emit(EVENTS.BUZZ, {})
    await tick()
    expect(session.buzz?.lockedBy?.participantId).toBe(ja.participant.id)

    const ended = waitFor<BuzzEnded>(host, EVENTS.BUZZ_QUESTION_ENDED)
    host.emit(EVENTS.HOST_ADJUDICATE, { correct: true })
    expect((await ended).scorer?.participantId).toBe(ja.participant.id)
  })
})

describe('tour par tour — avancement', () => {
  it('un thème perso fini fait passer le tour ; la culture ne consomme pas de tour', async () => {
    const session = makeBuzzerSession(QS)
    const { c: alice, joined: ja } = await joinAs('alice', session.pin)
    const { joined: jb } = await joinAs('bob', session.pin)
    const host = await hostJoin(session)
    host.emit(EVENTS.HOST_START_QUIZ, {})
    await tick()
    session.buzzTurnOrder = [ja.participant.id, jb.participant.id]

    // Tour d'alice : elle joue son thème (1 question) jusqu'au bout.
    host.emit(EVENTS.HOST_START_THEME, { ownerName: 'alice' })
    await waitFor<BuzzStarted>(alice, EVENTS.BUZZ_QUESTION_STARTED)
    host.emit(EVENTS.HOST_ADJUDICATE, { correct: true })
    await tick()
    // Fin du thème → retour sélecteur : le tour passe à bob.
    const themed = waitThemes(host, (t) => t.currentTheme === null)
    host.emit(EVENTS.HOST_NEXT_QUESTION, {})
    const t = await themed
    expect(t.turn!.index).toBe(1)
    expect(t.turn!.order[1]?.pseudo).toBe('bob')

    // Interlude culture : ne consomme PAS le tour de bob.
    host.emit(EVENTS.HOST_START_THEME, { ownerName: CULTURE_THEME })
    await waitFor<BuzzStarted>(alice, EVENTS.BUZZ_QUESTION_STARTED)
    host.emit(EVENTS.HOST_PASS_QUESTION, {})
    await tick()
    const themed2 = waitThemes(host, (t) => t.currentTheme === null)
    host.emit(EVENTS.HOST_NEXT_QUESTION, {})
    expect((await themed2).turn!.index).toBe(1) // toujours le tour de bob
  })

  it('kick du joueur du tour : son tour disparaît, le suivant a la main', async () => {
    const session = makeBuzzerSession(QS)
    const { joined: ja } = await joinAs('alice', session.pin)
    const { joined: jb } = await joinAs('bob', session.pin)
    const host = await hostJoin(session)
    host.emit(EVENTS.HOST_START_QUIZ, {})
    await tick()
    session.buzzTurnOrder = [ja.participant.id, jb.participant.id]

    const themed = waitThemes(host, (t) => (t.turn?.order.length ?? 0) === 1)
    host.emit(EVENTS.HOST_KICK_PARTICIPANT, { participantId: ja.participant.id })
    const t = await themed
    expect(t.turn!.order[0]?.pseudo).toBe('bob')
    expect(t.turn!.index).toBe(0)
    expect(session.buzzTurnOrder).toEqual([jb.participant.id])
  })
})

describe('tour par tour — persistance', () => {
  it('l\'ordre et l\'index survivent au roundtrip snapshot', () => {
    const session = makeBuzzerSession(QS)
    session.status = 'running'
    session.buzzTurnOrder = ['id-a', 'id-b', 'id-c']
    session.buzzTurnIndex = 2

    const restored = deserializeSession(serializeSession(session))
    expect(restored.buzzTurnOrder).toEqual(['id-a', 'id-b', 'id-c'])
    expect(restored.buzzTurnIndex).toBe(2)
  })
})
