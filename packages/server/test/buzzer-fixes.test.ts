import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { ServerToClientEvents, Question, BuzzState } from '@lya-quiz/shared'
import { EVENTS } from '@lya-quiz/shared'
import { serializeSession, deserializeSession } from '../src/session-snapshot.js'
import {
  startTestServer,
  makeBuzzerSession,
  waitFor,
  tick,
  type TestServer,
  type TestClient,
} from './helpers.js'

// Tests de non-régression des correctifs de la revue de juillet 2026
// (cf. .claude/revue-buzzer-2026-07.md — C1, H1, H2, M2, M3, M5, M6).

type Joined = Parameters<ServerToClientEvents['session_joined']>[0]
type Restored = Parameters<ServerToClientEvents['session_restored']>[0]
type BuzzStarted = Parameters<ServerToClientEvents['buzz_question_started']>[0]
type BuzzEnded = Parameters<ServerToClientEvents['buzz_question_ended']>[0]

let srv: TestServer

const CULTURE_QS: Question[] = [
  { id: 'c1', text: "Capitale de l'Italie ?", type: 'free', correctAnswers: ['Rome'], timeLimit: 0, difficulty: 'moyen', section: 'culture' },
  { id: 'c2', text: 'Combien de pattes a une araignée ?', type: 'free', correctAnswers: ['8'], timeLimit: 0, difficulty: 'facile', section: 'culture' },
]

const PERSO_QS: Question[] = [
  { id: 'p1', text: 'Question du thème alice ?', type: 'free', correctAnswers: ['42'], timeLimit: 0, difficulty: 'moyen', section: 'perso', ownerName: 'alice' },
  { id: 'p2', text: 'Autre question alice ?', type: 'free', correctAnswers: ['43'], timeLimit: 0, difficulty: 'facile', section: 'perso', ownerName: 'alice' },
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

const disc = (c: TestClient): Promise<void> =>
  new Promise((res) => {
    c.once('disconnect', () => res())
    c.disconnect()
  })

beforeAll(async () => {
  srv = await startTestServer()
})

afterAll(async () => {
  await srv.close()
})

describe('C1 — reload participant en pleine question buzzer', () => {
  it('un rejoin par token (reload de page) reçoit AUSSI la question buzzer en cours', async () => {
    const session = makeBuzzerSession(CULTURE_QS)
    const { c: alice, joined } = await joinAs('alice', session.pin)
    const host = await hostJoin(session)
    host.emit(EVENTS.HOST_START_QUIZ, {})
    host.emit(EVENTS.HOST_NEXT_QUESTION, {})
    await waitFor<BuzzStarted>(alice, EVENTS.BUZZ_QUESTION_STARTED)

    // Reload : l'onglet est déchargé (store perdu), nouveau socket + token stocké.
    await disc(alice)
    const alice2 = srv.connect()
    const restoredP = waitFor<Restored>(alice2, EVENTS.SESSION_RESTORED)
    const startedP = waitFor<BuzzStarted>(alice2, EVENTS.BUZZ_QUESTION_STARTED)
    alice2.emit(EVENTS.JOIN_SESSION, { pin: session.pin, pseudo: 'alice', sessionToken: joined.sessionToken })

    const restored = await restoredP
    expect(restored.buzz?.phase).toBe('steal')
    const started = await startedP // AVANT le fix : timeout — l'énoncé n'était jamais rejoué
    expect(started.question.text).toBe("Capitale de l'Italie ?")
    expect(started.question).not.toHaveProperty('correctAnswers')
    expect(started.buzz.armed).toBe(true)
  })

  it('le rejoin dédié (rejoin_session) rejoue aussi la question en cours', async () => {
    const session = makeBuzzerSession(CULTURE_QS)
    const { c: alice, joined } = await joinAs('alice', session.pin)
    const host = await hostJoin(session)
    host.emit(EVENTS.HOST_START_QUIZ, {})
    host.emit(EVENTS.HOST_NEXT_QUESTION, {})
    await waitFor<BuzzStarted>(alice, EVENTS.BUZZ_QUESTION_STARTED)

    await disc(alice)
    const alice2 = srv.connect()
    const startedP = waitFor<BuzzStarted>(alice2, EVENTS.BUZZ_QUESTION_STARTED)
    alice2.emit(EVENTS.REJOIN_SESSION, { sessionToken: joined.sessionToken })
    const started = await startedP
    expect(started.buzz.phase).toBe('steal')
  })
})

describe('H1 — reattach host/TV pendant la révélation', () => {
  it('un host qui se ré-attache en phase revealed reçoit la révélation (pas un écran vide)', async () => {
    const session = makeBuzzerSession(CULTURE_QS)
    const { c: alice } = await joinAs('alice', session.pin)
    const host = await hostJoin(session)
    host.emit(EVENTS.HOST_START_QUIZ, {})
    host.emit(EVENTS.HOST_NEXT_QUESTION, {})
    await waitFor<BuzzStarted>(alice, EVENTS.BUZZ_QUESTION_STARTED)

    alice.emit(EVENTS.BUZZ, {})
    const endedP = waitFor<BuzzEnded>(host, EVENTS.BUZZ_QUESTION_ENDED)
    host.emit(EVENTS.HOST_ADJUDICATE, { correct: true })
    await endedP // phase revealed, alice a marqué

    // Micro-coupure du host : nouveau socket, host_join à la reconnexion (P0-1).
    const host2 = srv.connect()
    const rEndedP = waitFor<BuzzEnded>(host2, EVENTS.BUZZ_QUESTION_ENDED)
    host2.emit(EVENTS.HOST_JOIN, { pin: session.pin, hostKey: session.hostKey })

    const rEnded = await rEndedP // AVANT le fix : rien → « Personne n'a trouvé »
    expect(rEnded.scorer?.pseudo).toBe('alice')
    expect(rEnded.scorer?.points).toBe(2) // moyen = 2
    expect(rEnded.correctAnswers).toEqual(['Rome'])
  })
})

describe('H2 — kick pendant une question buzzer', () => {
  it("kick du joueur qui a la parole (locked) → le vol rouvre pour les autres", async () => {
    const session = makeBuzzerSession(CULTURE_QS)
    const { c: alice, joined: aliceJoined } = await joinAs('alice', session.pin)
    const { c: bob } = await joinAs('bob', session.pin)
    const host = await hostJoin(session)
    host.emit(EVENTS.HOST_START_QUIZ, {})
    host.emit(EVENTS.HOST_NEXT_QUESTION, {})
    await waitFor<BuzzStarted>(bob, EVENTS.BUZZ_QUESTION_STARTED)

    alice.emit(EVENTS.BUZZ, {})
    await tick()
    expect(session.buzz?.phase).toBe('locked')

    host.emit(EVENTS.HOST_KICK_PARTICIPANT, { participantId: aliceJoined.participant.id })
    await tick()
    // AVANT le fix : phase 'locked' figée sur un fantôme.
    expect(session.buzz?.phase).toBe('steal')
    expect(session.buzz?.armed).toBe(true)
    expect(session.buzz?.lockedBy).toBeNull()

    // bob peut buzzer et marquer.
    bob.emit(EVENTS.BUZZ, {})
    const endedP = waitFor<BuzzEnded>(bob, EVENTS.BUZZ_QUESTION_ENDED)
    host.emit(EVENTS.HOST_ADJUDICATE, { correct: true })
    const ended = await endedP
    expect(ended.scorer?.pseudo).toBe('bob')
  })

  it("kick de l'owner en owner_oral → owner détaché et état rediffusé", async () => {
    const session = makeBuzzerSession(PERSO_QS)
    const { c: alice, joined: aliceJoined } = await joinAs('alice', session.pin)
    const host = await hostJoin(session)
    host.emit(EVENTS.HOST_START_QUIZ, {})
    host.emit(EVENTS.HOST_ASSIGN_OWNER, { ownerName: 'alice', participantId: aliceJoined.participant.id })
    host.emit(EVENTS.HOST_START_THEME, { ownerName: 'alice' })
    await waitFor<BuzzStarted>(alice, EVENTS.BUZZ_QUESTION_STARTED)
    expect(session.buzz?.ownerParticipantId).toBe(aliceJoined.participant.id)

    host.emit(EVENTS.HOST_KICK_PARTICIPANT, { participantId: aliceJoined.participant.id })
    await tick()
    expect(session.buzz?.phase).toBe('owner_oral')
    expect(session.buzz?.ownerParticipantId).toBeNull() // AVANT le fix : id fantôme conservé
  })
})

describe('M3 — validation de host_assign_owner', () => {
  it('un participantId inconnu ou non-string est ignoré', async () => {
    const session = makeBuzzerSession(PERSO_QS)
    await joinAs('alice', session.pin)
    const host = await hostJoin(session)

    host.emit(EVENTS.HOST_ASSIGN_OWNER, { ownerName: 'alice', participantId: 'fantome-inexistant' })
    await tick()
    expect(session.ownerBindings.size).toBe(0)

    // Payload hostile : objet à la place d'une string.
    host.emit(EVENTS.HOST_ASSIGN_OWNER, { ownerName: 'alice', participantId: { hack: true } as unknown as string })
    await tick()
    expect(session.ownerBindings.size).toBe(0)
  })

  it('re-binder pendant un vol (steal) met à jour l\'owner — il ne peut pas voler son propre thème', async () => {
    const session = makeBuzzerSession(PERSO_QS)
    const { c: alice, joined: aliceJoined } = await joinAs('alice', session.pin)
    const { c: bob, joined: bobJoined } = await joinAs('bob', session.pin)
    const host = await hostJoin(session)
    host.emit(EVENTS.HOST_START_QUIZ, {})
    host.emit(EVENTS.HOST_ASSIGN_OWNER, { ownerName: 'alice', participantId: aliceJoined.participant.id })
    host.emit(EVENTS.HOST_START_THEME, { ownerName: 'alice' })
    await waitFor<BuzzStarted>(alice, EVENTS.BUZZ_QUESTION_STARTED)

    // L'owner sèche → vol ouvert, puis l'admin corrige le binding : c'était bob.
    host.emit(EVENTS.HOST_ADJUDICATE, { correct: false })
    await tick()
    expect(session.buzz?.phase).toBe('steal')
    host.emit(EVENTS.HOST_ASSIGN_OWNER, { ownerName: 'alice', participantId: bobJoined.participant.id })
    await tick()
    expect(session.buzz?.ownerParticipantId).toBe(bobJoined.participant.id) // AVANT le fix : périmé

    // bob (nouvel owner) buzze sur son propre thème → ignoré.
    bob.emit(EVENTS.BUZZ, {})
    await tick()
    expect(session.buzz?.phase).toBe('steal')
    expect(session.buzz?.lockedBy).toBeNull()
  })
})

describe('M5 — « Correct » sur un thème non attribué', () => {
  it('est refusé (personne à créditer) : la phase ne bouge pas', async () => {
    const session = makeBuzzerSession(PERSO_QS)
    const { c: alice } = await joinAs('alice', session.pin)
    const host = await hostJoin(session)
    host.emit(EVENTS.HOST_START_QUIZ, {})
    // Pas de HOST_ASSIGN_OWNER : le thème alice n'est pas attribué.
    host.emit(EVENTS.HOST_START_THEME, { ownerName: 'alice' })
    await waitFor<BuzzStarted>(alice, EVENTS.BUZZ_QUESTION_STARTED)

    host.emit(EVENTS.HOST_ADJUDICATE, { correct: true })
    await tick()
    // AVANT le fix : passait en revealed avec 0 point en silence.
    expect(session.buzz?.phase).toBe('owner_oral')

    // « Faux » reste possible (ouverture du vol), la partie n'est pas bloquée.
    host.emit(EVENTS.HOST_ADJUDICATE, { correct: false })
    await tick()
    expect(session.buzz?.phase).toBe('steal')
  })
})

describe('M6 — joueur sans téléphone (host_add_manual_participant)', () => {
  it('refuse un pseudo déjà pris et tronque à 20 caractères', async () => {
    const session = makeBuzzerSession(CULTURE_QS)
    await joinAs('alice', session.pin)
    const host = await hostJoin(session)

    host.emit(EVENTS.HOST_ADD_MANUAL_PARTICIPANT, { pseudo: 'alice' }) // doublon
    await tick()
    expect(session.participants.size).toBe(1) // AVANT le fix : 2 « alice »

    host.emit(EVENTS.HOST_ADD_MANUAL_PARTICIPANT, { pseudo: 'x'.repeat(40) })
    await tick()
    const manual = [...session.participants.values()].find((p) => p.manual)
    expect(manual?.pseudo).toHaveLength(20) // borne alignée sur le join téléphone
  })

  it("est ignoré hors mode buzzer (quiz classique)", async () => {
    const session = makeBuzzerSession(CULTURE_QS)
    if (session.quiz) session.quiz.gameType = 'classic'
    await joinAs('alice', session.pin)
    const host = await hostJoin(session)
    host.emit(EVENTS.HOST_ADD_MANUAL_PARTICIPANT, { pseudo: 'fantome' })
    await tick()
    expect(session.participants.size).toBe(1)
  })
})

describe('Antisèche admin (buzz_host_answer)', () => {
  it('le host control reçoit la réponse pendant la question ; TV et téléphones JAMAIS', async () => {
    const session = makeBuzzerSession(CULTURE_QS)
    const { c: alice } = await joinAs('alice', session.pin)
    const host = await hostJoin(session)
    // TV : lecture seule via display_join (sessionId), pas de hostKey.
    const tv = srv.connect()
    tv.emit(EVENTS.DISPLAY_JOIN, { sessionId: session.id })
    await waitFor<Joined>(tv, EVENTS.SESSION_JOINED)

    let tvLeaks = 0
    let phoneLeaks = 0
    tv.on(EVENTS.BUZZ_HOST_ANSWER, () => { tvLeaks++ })
    alice.on(EVENTS.BUZZ_HOST_ANSWER, () => { phoneLeaks++ })

    const answerP = waitFor<{ correctAnswers: string[] }>(host, EVENTS.BUZZ_HOST_ANSWER)
    host.emit(EVENTS.HOST_START_QUIZ, {})
    host.emit(EVENTS.HOST_NEXT_QUESTION, {})
    const answer = await answerP
    expect(answer.correctAnswers).toEqual(['Rome'])

    await tick()
    expect(tvLeaks).toBe(0)     // la TV est visible de toute la salle
    expect(phoneLeaks).toBe(0)  // anti-triche inchangé côté joueurs
  })

  it('un control qui se ré-attache en pleine question re-reçoit l\'antisèche', async () => {
    const session = makeBuzzerSession(CULTURE_QS)
    await joinAs('alice', session.pin)
    const host = await hostJoin(session)
    host.emit(EVENTS.HOST_START_QUIZ, {})
    host.emit(EVENTS.HOST_NEXT_QUESTION, {})
    await waitFor<{ correctAnswers: string[] }>(host, EVENTS.BUZZ_HOST_ANSWER)

    const host2 = srv.connect()
    const answerP = waitFor<{ correctAnswers: string[] }>(host2, EVENTS.BUZZ_HOST_ANSWER)
    host2.emit(EVENTS.HOST_JOIN, { pin: session.pin, hostKey: session.hostKey })
    expect((await answerP).correctAnswers).toEqual(['Rome'])
  })
})

describe('M2 — snapshot : les champs buzzer survivent au roundtrip', () => {
  it('ownerBindings, currentTheme, playedQuestionIndices, manual+bonus sont restaurés', () => {
    const session = makeBuzzerSession(PERSO_QS)
    session.status = 'running'
    session.ownerBindings.set('alice', 'id-alice')
    session.currentTheme = 'alice'
    session.playedQuestionIndices.add(0)
    session.participants.set('id-manuel', {
      id: 'id-manuel',
      pseudo: 'papi',
      socketId: '',
      sessionToken: 'tok-papi',
      connected: false,
      score: 5,
      lastDelta: 0,
      correctTotal: 2,
      manual: true,
      bonus: 3,
    })

    const restored = deserializeSession(serializeSession(session))

    expect([...restored.ownerBindings.entries()]).toEqual([['alice', 'id-alice']])
    expect(restored.currentTheme).toBe('alice')
    expect([...restored.playedQuestionIndices]).toEqual([0])
    const papi = restored.participants.get('id-manuel')
    expect(papi?.manual).toBe(true)
    expect(papi?.bonus).toBe(3)
    expect(papi?.score).toBe(5)
    // Choix assumé : la question interrompue est rejouée, pas l'état buzzer fin.
    expect(restored.buzz).toBeNull()
    expect(restored.lastBuzzReveal).toBeNull()
  })
})
