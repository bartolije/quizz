import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { ServerToClientEvents, Question } from '@lya-quiz/shared'
import { EVENTS } from '@lya-quiz/shared'
import {
  startTestServer,
  makeBuzzerSession,
  waitFor,
  tick,
  type TestServer,
  type TestClient,
} from './helpers.js'

type Joined = Parameters<ServerToClientEvents['session_joined']>[0]
type Restored = Parameters<ServerToClientEvents['session_restored']>[0]
type BuzzStarted = Parameters<ServerToClientEvents['buzz_question_started']>[0]
type BuzzStateP = Parameters<ServerToClientEvents['buzz_state']>[0]
type BuzzEnded = Parameters<ServerToClientEvents['buzz_question_ended']>[0]
type BuzzThemes = Parameters<ServerToClientEvents['buzz_themes']>[0]
type Leaderboard = Parameters<ServerToClientEvents['leaderboard_update']>[0]

let srv: TestServer

// Attend le PREMIER buzz_state qui satisfait `pred` (ignore les états
// intermédiaires) — modélise un vrai client qui applique le dernier état reçu,
// et évite les courses sur l'ordre de livraison des broadcasts room.
function waitBuzz(
  socket: TestClient,
  pred: (s: BuzzStateP) => boolean,
  timeoutMs = 3000,
): Promise<BuzzStateP> {
  return new Promise<BuzzStateP>((resolve, reject) => {
    const to = setTimeout(() => {
      socket.off(EVENTS.BUZZ_STATE, handler)
      reject(new Error(`timeout (${timeoutMs}ms) en attendant un buzz_state`))
    }, timeoutMs)
    const handler = (s: BuzzStateP): void => {
      if (!pred(s)) return
      clearTimeout(to)
      socket.off(EVENTS.BUZZ_STATE, handler)
      resolve(s)
    }
    socket.on(EVENTS.BUZZ_STATE, handler)
  })
}

// Attend le premier buzz_themes satisfaisant `pred` (ignore les intermédiaires).
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

// Deux questions de culture G (buzzer ouvert à tous), difficultés distinctes.
const CULTURE_QS: Question[] = [
  { id: 'c1', text: "Capitale de l'Espagne ?", type: 'free', correctAnswers: ['Madrid'], timeLimit: 0, difficulty: 'facile', section: 'culture' },
  { id: 'c2', text: 'Combien de côtés a un hexagone ?', type: 'free', correctAnswers: ['6'], timeLimit: 0, difficulty: 'difficile', section: 'culture' },
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

// Session buzzer prête : 2 joueurs + host, quiz lancé sur la 1ʳᵉ question (culture, armée).
async function setup(questions = CULTURE_QS): Promise<{
  session: ReturnType<typeof makeBuzzerSession>
  alice: TestClient
  bob: TestClient
  host: TestClient
}> {
  const session = makeBuzzerSession(questions)
  const { c: alice } = await joinAs('alice', session.pin)
  const { c: bob } = await joinAs('bob', session.pin)
  const host = await hostJoin(session)
  return { session, alice, bob, host }
}

describe('buzzer — round culture (ouvert à tous)', () => {
  it('la question diffusée porte la difficulté et JAMAIS les bonnes réponses', async () => {
    const { alice, host } = await setup()
    host.emit(EVENTS.HOST_START_QUIZ, {})
    host.emit(EVENTS.HOST_NEXT_QUESTION, {})

    const started = await waitFor<BuzzStarted>(alice, EVENTS.BUZZ_QUESTION_STARTED)
    expect(started.question.text).toBe("Capitale de l'Espagne ?")
    expect(started.question.difficulty).toBe('facile')
    expect(started.question).not.toHaveProperty('correctAnswers')
    expect(started.buzz.phase).toBe('steal')
    expect(started.buzz.armed).toBe(true)
  })

  it('buzz → arbitrage correct → le buzzeur marque les points de difficulté', async () => {
    const { alice, host } = await setup()
    host.emit(EVENTS.HOST_START_QUIZ, {})
    host.emit(EVENTS.HOST_NEXT_QUESTION, {})
    await waitFor<BuzzStarted>(alice, EVENTS.BUZZ_QUESTION_STARTED)

    const locked = waitFor<BuzzStateP>(alice, EVENTS.BUZZ_STATE)
    alice.emit(EVENTS.BUZZ, {})
    const st = await locked
    expect(st.phase).toBe('locked')
    expect(st.armed).toBe(false)
    expect(st.lockedBy?.pseudo).toBe('alice')

    const ended = waitFor<BuzzEnded>(alice, EVENTS.BUZZ_QUESTION_ENDED)
    host.emit(EVENTS.HOST_ADJUDICATE, { correct: true })
    const res = await ended
    expect(res.correctAnswers).toEqual(['Madrid'])
    expect(res.scorer?.pseudo).toBe('alice')
    expect(res.scorer?.points).toBe(1) // facile = 1
    expect(res.scores.find((s) => s.pseudo === 'alice')?.score).toBe(1)
  })

  it('le premier buzz gagne : un second buzzeur ne vole pas la parole', async () => {
    const { alice, bob, host } = await setup()
    host.emit(EVENTS.HOST_START_QUIZ, {})
    host.emit(EVENTS.HOST_NEXT_QUESTION, {})
    await waitFor<BuzzStarted>(alice, EVENTS.BUZZ_QUESTION_STARTED)

    const locked = waitFor<BuzzStateP>(alice, EVENTS.BUZZ_STATE)
    alice.emit(EVENTS.BUZZ, {})
    const st = await locked
    expect(st.lockedBy?.pseudo).toBe('alice')

    // bob buzze trop tard → ignoré (buzzer désarmé). L'arbitrage porte sur alice.
    bob.emit(EVENTS.BUZZ, {})
    await tick()

    const ended = waitFor<BuzzEnded>(host, EVENTS.BUZZ_QUESTION_ENDED)
    host.emit(EVENTS.HOST_ADJUDICATE, { correct: true })
    const res = await ended
    expect(res.scorer?.pseudo).toBe('alice')
  })

  it('vol raté → rouvrir → un autre buzze et marque ; le raté est bloqué', async () => {
    const { alice, bob, host } = await setup()
    host.emit(EVENTS.HOST_START_QUIZ, {})
    host.emit(EVENTS.HOST_NEXT_QUESTION, {})
    await waitFor<BuzzStarted>(alice, EVENTS.BUZZ_QUESTION_STARTED)

    // alice buzze puis se trompe → vol raté, buzzer désarmé, alice verrouillée
    const missed = waitBuzz(alice, (s) => s.phase === 'steal' && !s.armed)
    alice.emit(EVENTS.BUZZ, {})
    await tick() // laisse le serveur enregistrer le buzz (phase 'locked') avant l'arbitrage
    host.emit(EVENTS.HOST_ADJUDICATE, { correct: false })
    const stMissed = await missed
    expect(stMissed.lockedOut).toHaveLength(1) // alice verrouillée pour cette question

    // host rouvre le buzzer → armé
    const reopened = waitBuzz(bob, (s) => s.armed === true)
    host.emit(EVENTS.HOST_REOPEN_BUZZER, {})
    await reopened

    // alice re-buzze (ignorée : lockedOut), bob buzze → bob prend la parole
    const lockedB = waitBuzz(bob, (s) => s.lockedBy?.pseudo === 'bob')
    alice.emit(EVENTS.BUZZ, {})
    await tick()
    bob.emit(EVENTS.BUZZ, {})
    await lockedB

    const ended = waitFor<BuzzEnded>(bob, EVENTS.BUZZ_QUESTION_ENDED)
    host.emit(EVENTS.HOST_ADJUDICATE, { correct: true })
    expect((await ended).scorer?.pseudo).toBe('bob')
  })

  it('personne ne trouve → passer → 0 point, aucun scorer', async () => {
    const { alice, host } = await setup()
    host.emit(EVENTS.HOST_START_QUIZ, {})
    host.emit(EVENTS.HOST_NEXT_QUESTION, {})
    await waitFor<BuzzStarted>(alice, EVENTS.BUZZ_QUESTION_STARTED)

    const ended = waitFor<BuzzEnded>(alice, EVENTS.BUZZ_QUESTION_ENDED)
    host.emit(EVENTS.HOST_PASS_QUESTION, {})
    const res = await ended
    expect(res.scorer).toBeNull()
    expect(res.correctAnswers).toEqual(['Madrid'])
    expect(res.scores.every((s) => s.score === 0)).toBe(true)
  })

  it('fin du quiz après la dernière question → classement final', async () => {
    const { alice, host } = await setup()
    host.emit(EVENTS.HOST_START_QUIZ, {})
    // Q1 : passer
    host.emit(EVENTS.HOST_NEXT_QUESTION, {})
    await waitFor<BuzzStarted>(alice, EVENTS.BUZZ_QUESTION_STARTED)
    let ended = waitFor<BuzzEnded>(alice, EVENTS.BUZZ_QUESTION_ENDED)
    host.emit(EVENTS.HOST_PASS_QUESTION, {})
    await ended
    // Q2 : alice buzze et gagne (difficile = 3)
    host.emit(EVENTS.HOST_NEXT_QUESTION, {})
    await waitFor<BuzzStarted>(alice, EVENTS.BUZZ_QUESTION_STARTED)
    alice.emit(EVENTS.BUZZ, {})
    ended = waitFor<BuzzEnded>(alice, EVENTS.BUZZ_QUESTION_ENDED)
    host.emit(EVENTS.HOST_ADJUDICATE, { correct: true })
    expect((await ended).scorer?.points).toBe(3)
    // Plus de questions → fin + classement final
    const final = waitFor<Leaderboard>(alice, EVENTS.LEADERBOARD_UPDATE)
    host.emit(EVENTS.HOST_NEXT_QUESTION, {})
    const lb = await final
    expect(lb.final).toBe(true)
    expect(lb.scores.find((s) => s.pseudo === 'alice')?.score).toBe(3)
  })
})

// Thème perso (Papa : 2 questions) + Léa (1) + culture (1)
const PERSO_QS: Question[] = [
  { id: 'p1', text: 'Combien de titres F1 pour Senna ?', type: 'free', correctAnswers: ['3'], timeLimit: 0, difficulty: 'moyen', section: 'perso', ownerName: 'Papa' },
  { id: 'p2', text: "Écurie de Prost en 1990 ?", type: 'free', correctAnswers: ['Ferrari'], timeLimit: 0, difficulty: 'difficile', section: 'perso', ownerName: 'Papa' },
  { id: 'l1', text: 'Maison de Harry Potter ?', type: 'free', correctAnswers: ['Gryffondor'], timeLimit: 0, difficulty: 'facile', section: 'perso', ownerName: 'Léa' },
  { id: 'c1', text: 'Capitale du Japon ?', type: 'free', correctAnswers: ['Tokyo'], timeLimit: 0, difficulty: 'facile', section: 'culture' },
]

describe('buzzer — round perso (thème + owner)', () => {
  it('attribution owner → lancer le thème → owner marque, puis vol sur question ratée, puis thème terminé', async () => {
    const session = makeBuzzerSession(PERSO_QS)
    const { c: alice, joined: ja } = await joinAs('alice', session.pin)
    const { c: bob, joined: jb } = await joinAs('bob', session.pin)
    const host = await hostJoin(session)
    const aliceId = ja.participant.id
    const bobId = jb.participant.id

    host.emit(EVENTS.HOST_START_QUIZ, {})

    // Attribution : le thème de Papa revient à alice
    const bound = waitThemes(host, (t) => t.owners.find((o) => o.ownerName === 'Papa')?.participantId === aliceId)
    host.emit(EVENTS.HOST_ASSIGN_OWNER, { ownerName: 'Papa', participantId: aliceId })
    const tb = await bound
    expect(tb.owners.map((o) => o.ownerName)).toEqual(['Papa', 'Léa']) // ordre du quiz
    expect(tb.culture.total).toBe(1)

    // Lancer le thème de Papa → owner_oral, owner = alice, 1ʳᵉ question (moyen)
    const st1 = waitFor<BuzzStarted>(alice, EVENTS.BUZZ_QUESTION_STARTED)
    host.emit(EVENTS.HOST_START_THEME, { ownerName: 'Papa' })
    const s1 = await st1
    expect(s1.buzz.phase).toBe('owner_oral')
    expect(s1.buzz.ownerName).toBe('Papa')
    expect(s1.buzz.ownerParticipantId).toBe(aliceId)
    expect(s1.question.difficulty).toBe('moyen')

    // Owner répond juste à l'oral → +2 (moyen)
    const e1 = waitFor<BuzzEnded>(host, EVENTS.BUZZ_QUESTION_ENDED)
    host.emit(EVENTS.HOST_ADJUDICATE, { correct: true })
    expect((await e1).scorer?.participantId).toBe(aliceId)
    expect((await e1).scorer?.points).toBe(2)

    // Question suivante du thème (difficile) → owner sèche → vol
    const st2 = waitFor<BuzzStarted>(alice, EVENTS.BUZZ_QUESTION_STARTED)
    host.emit(EVENTS.HOST_NEXT_QUESTION, {})
    const s2 = await st2
    expect(s2.buzz.phase).toBe('owner_oral')
    expect(s2.question.difficulty).toBe('difficile')

    const armed = waitBuzz(bob, (s) => s.phase === 'steal' && s.armed)
    host.emit(EVENTS.HOST_ADJUDICATE, { correct: false })
    await armed

    // L'owner (alice) ne peut PAS voler son propre thème → buzz ignoré ; bob vole
    alice.emit(EVENTS.BUZZ, {})
    await tick()
    const lockedBob = waitBuzz(bob, (s) => s.lockedBy?.participantId === bobId)
    bob.emit(EVENTS.BUZZ, {})
    await lockedBob

    const e2 = waitFor<BuzzEnded>(host, EVENTS.BUZZ_QUESTION_ENDED)
    host.emit(EVENTS.HOST_ADJUDICATE, { correct: true })
    expect((await e2).scorer?.participantId).toBe(bobId)
    expect((await e2).scorer?.points).toBe(3) // difficile

    // Thème de Papa épuisé → retour sélecteur, Papa marqué done, Léa non
    const done = waitThemes(host, (t) => t.currentTheme === null)
    host.emit(EVENTS.HOST_NEXT_QUESTION, {})
    const td = await done
    expect(td.owners.find((o) => o.ownerName === 'Papa')?.done).toBe(true)
    expect(td.owners.find((o) => o.ownerName === 'Léa')?.done).toBe(false)
  })
})

describe('buzzer — reconnexion', () => {
  it('le tél retrouve gameType=buzzer + l\'état buzzer armé après reconnexion', async () => {
    const session = makeBuzzerSession(CULTURE_QS)
    const { c: alice, joined } = await joinAs('alice', session.pin)
    const host = await hostJoin(session)
    host.emit(EVENTS.HOST_START_QUIZ, {})
    host.emit(EVENTS.HOST_NEXT_QUESTION, {})
    await waitFor<BuzzStarted>(alice, EVENTS.BUZZ_QUESTION_STARTED)

    await new Promise<void>((resolve) => {
      alice.once('disconnect', () => resolve())
      alice.disconnect()
    })

    const alice2 = srv.connect()
    alice2.emit(EVENTS.REJOIN_SESSION, { sessionToken: joined.sessionToken })
    const restored = await waitFor<Restored>(alice2, EVENTS.SESSION_RESTORED)
    expect(restored.gameType).toBe('buzzer')
    expect(restored.currentQuestion).toBeNull() // pas de question "classique" en mode buzzer
    expect(restored.buzz?.phase).toBe('steal')
    expect(restored.buzz?.armed).toBe(true)
  })
})
