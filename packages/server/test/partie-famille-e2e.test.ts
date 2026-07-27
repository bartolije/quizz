import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { ServerToClientEvents, Question, BuzzState } from '@lya-quiz/shared'
import { EVENTS, CULTURE_THEME } from '@lya-quiz/shared'
import {
  startTestServer,
  makeBuzzerSession,
  waitFor,
  tick,
  type TestServer,
  type TestClient,
} from './helpers.js'

// ─────────────────────────────────────────────────────────────
// PARTIE FAMILLE DE BOUT EN BOUT — le déroulé réel d'une soirée :
//   lancer la partie → jouer TOUT un thème → passer au thème suivant →
//   question ratée par l'owner rejouée au buzzer → culture G → fin + total.
//
// Les tests de buzzer.test.ts couvrent chaque mécanisme isolément ; celui-ci
// vérifie l'enchaînement complet et surtout l'ARITHMÉTIQUE FINALE des points
// sur une partie entière (le bug le plus coûteux en vrai : un score faux).
// ─────────────────────────────────────────────────────────────

type Joined = Parameters<ServerToClientEvents['session_joined']>[0]
type BuzzStarted = Parameters<ServerToClientEvents['buzz_question_started']>[0]
type BuzzStateP = Parameters<ServerToClientEvents['buzz_state']>[0]
type BuzzEnded = Parameters<ServerToClientEvents['buzz_question_ended']>[0]
type BuzzThemes = Parameters<ServerToClientEvents['buzz_themes']>[0]
type Leaderboard = Parameters<ServerToClientEvents['leaderboard_update']>[0]
type TeamsUpdated = Parameters<ServerToClientEvents['teams_updated']>[0]

let srv: TestServer

function waitBuzz(socket: TestClient, pred: (s: BuzzState) => boolean, timeoutMs = 3000): Promise<BuzzState> {
  return new Promise<BuzzState>((resolve, reject) => {
    const to = setTimeout(() => {
      socket.off(EVENTS.BUZZ_STATE, handler)
      reject(new Error(`timeout (${timeoutMs}ms) en attendant un buzz_state`))
    }, timeoutMs)
    const handler = (s: BuzzStateP): void => {
      if (s === null || !pred(s)) return
      clearTimeout(to)
      socket.off(EVENTS.BUZZ_STATE, handler)
      resolve(s)
    }
    socket.on(EVENTS.BUZZ_STATE, handler)
  })
}

function waitThemes(socket: TestClient, pred: (t: BuzzThemes) => boolean, timeoutMs = 3000): Promise<BuzzThemes> {
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

// Attend le retour au sélecteur de thèmes (buzz_state null), le signal qui
// débloque l'écran host entre deux thèmes.
function waitSelector(socket: TestClient, timeoutMs = 3000): Promise<null> {
  return new Promise<null>((resolve, reject) => {
    const to = setTimeout(() => {
      socket.off(EVENTS.BUZZ_STATE, handler)
      reject(new Error(`timeout (${timeoutMs}ms) en attendant le retour au sélecteur`))
    }, timeoutMs)
    const handler = (s: BuzzStateP): void => {
      if (s !== null) return
      clearTimeout(to)
      socket.off(EVENTS.BUZZ_STATE, handler)
      resolve(null)
    }
    socket.on(EVENTS.BUZZ_STATE, handler)
  })
}

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

beforeAll(async () => {
  srv = await startTestServer()
})

afterAll(async () => {
  await srv.close()
})

// Quiz volontairement ENTRELACÉ (thèmes mélangés dans le tableau) pour vérifier
// que la progression suit bien le thème et pas l'ordre brut des questions.
// Points libres (nombre) plutôt que difficulté : c'est le mode utilisé par /admin.
const QUIZ: Question[] = [
  { id: 'a1', text: 'Thème Alice — Q1 ?', type: 'free', correctAnswers: ['A1'], timeLimit: 0, points: 2, section: 'perso', ownerName: 'Alice' },
  { id: 'c1', text: 'Culture — Q1 ?', type: 'free', correctAnswers: ['C1'], timeLimit: 0, points: 1, section: 'culture' },
  { id: 'b1', text: 'Thème Bob — Q1 ?', type: 'free', correctAnswers: ['B1'], timeLimit: 0, points: 1, section: 'perso', ownerName: 'Bob' },
  { id: 'a2', text: 'Thème Alice — Q2 ?', type: 'free', correctAnswers: ['A2'], timeLimit: 0, points: 3, section: 'perso', ownerName: 'Alice' },
  { id: 'b2', text: 'Thème Bob — Q2 ?', type: 'free', correctAnswers: ['B2'], timeLimit: 0, points: 2, section: 'perso', ownerName: 'Bob' },
  { id: 'c2', text: 'Culture — Q2 ?', type: 'free', correctAnswers: ['C2'], timeLimit: 0, points: 3, section: 'culture' },
]

describe('partie famille de bout en bout', () => {
  it('3 joueurs, 2 thèmes perso + culture : enchaînement complet et total des points exact', async () => {
    const session = makeBuzzerSession(QUIZ)
    const { c: alice, joined: ja } = await joinAs('alice', session.pin)
    const { c: bob, joined: jb } = await joinAs('bob', session.pin)
    const host = await hostJoin(session)
    const aliceId = ja.participant.id
    const bobId = jb.participant.id

    // ── Lobby : un 3ᵉ joueur sans téléphone + distribution des thèmes ──────
    const added = waitFor<TeamsUpdated>(host, EVENTS.TEAMS_UPDATED)
    host.emit(EVENTS.HOST_ADD_MANUAL_PARTICIPANT, { pseudo: 'Mamie' })
    const mamieId = (await added).participants.find((p) => p.pseudo === 'Mamie')!.id

    host.emit(EVENTS.HOST_ASSIGN_OWNER, { ownerName: 'Alice', participantId: aliceId })
    const bound = waitThemes(host, (t) => t.owners.find((o) => o.ownerName === 'Bob')?.participantId === bobId)
    host.emit(EVENTS.HOST_ASSIGN_OWNER, { ownerName: 'Bob', participantId: bobId })
    const t0 = await bound
    expect(t0.owners.map((o) => o.ownerName)).toEqual(['Alice', 'Bob']) // ordre d'apparition
    expect(t0.owners.every((o) => o.total === 2)).toBe(true)
    expect(t0.culture.total).toBe(2)

    host.emit(EVENTS.HOST_START_QUIZ, {})
    await tick()
    // Ordre de passage DÉTERMINISTE pour le scénario (le vrai tirage est aléatoire) :
    // alice joue d'abord (son thème), puis bob (le sien), Mamie en dernier.
    session.buzzTurnOrder = [aliceId, bobId, mamieId]
    session.buzzTurnIndex = 0

    // ══ THÈME 1 (Alice) ═══════════════════════════════════════════════════
    // Q1 (2 pts) : Alice répond juste à l'oral.
    const s1 = waitFor<BuzzStarted>(alice, EVENTS.BUZZ_QUESTION_STARTED)
    host.emit(EVENTS.HOST_START_THEME, { ownerName: 'Alice' })
    const q1 = await s1
    expect(q1.question.text).toBe('Thème Alice — Q1 ?')
    expect(q1.buzz.phase).toBe('owner_oral')
    expect(q1.buzz.armed).toBe(false)            // buzzer fermé pendant l'oral
    expect(q1.question).not.toHaveProperty('correctAnswers')

    let ended = waitFor<BuzzEnded>(host, EVENTS.BUZZ_QUESTION_ENDED)
    host.emit(EVENTS.HOST_ADJUDICATE, { correct: true })
    let e = await ended
    expect(e.scorer?.participantId).toBe(aliceId)
    expect(e.scorer?.points).toBe(2)             // alice : 2

    // Q2 (3 pts) : Alice sèche → la question RATÉE repart au buzzer.
    const s2 = waitFor<BuzzStarted>(bob, EVENTS.BUZZ_QUESTION_STARTED)
    host.emit(EVENTS.HOST_NEXT_QUESTION, {})
    expect((await s2).question.text).toBe('Thème Alice — Q2 ?')

    const armed = waitBuzz(bob, (s) => s.phase === 'steal' && s.armed)
    host.emit(EVENTS.HOST_ADJUDICATE, { correct: false })
    await armed                                  // le tél de bob s'arme

    // L'owner ne vole pas son propre thème : le buzz d'alice est ignoré.
    alice.emit(EVENTS.BUZZ, {})
    await tick()
    // Bob buzze, se trompe → il est bloqué pour cette question.
    const lockedBob = waitBuzz(host, (s) => s.lockedBy?.participantId === bobId)
    bob.emit(EVENTS.BUZZ, {})
    await lockedBob
    const missed = waitBuzz(host, (s) => s.phase === 'steal' && !s.armed)
    host.emit(EVENTS.HOST_ADJUDICATE, { correct: false })
    expect((await missed).lockedOut).toContain(bobId)

    // Rouvrir : bob reste bloqué (lockedOut), personne d'autre → passer, 0 pt.
    const reopened = waitBuzz(host, (s) => s.phase === 'steal' && s.armed)
    host.emit(EVENTS.HOST_REOPEN_BUZZER, {})
    await reopened
    bob.emit(EVENTS.BUZZ, {})
    await tick()
    ended = waitFor<BuzzEnded>(host, EVENTS.BUZZ_QUESTION_ENDED)
    host.emit(EVENTS.HOST_PASS_QUESTION, {})
    e = await ended
    expect(e.scorer).toBeNull()                  // personne ne marque
    expect(e.correctAnswers).toEqual(['A2'])     // la réponse est révélée au host

    // ── Fin du thème 1 → retour au sélecteur (écran host débloqué) ────────
    const back1 = waitSelector(host)
    const themes1 = waitThemes(host, (t) => t.currentTheme === null)
    host.emit(EVENTS.HOST_NEXT_QUESTION, {})
    await back1
    const t1 = await themes1
    expect(t1.owners.find((o) => o.ownerName === 'Alice')?.done).toBe(true)
    expect(t1.owners.find((o) => o.ownerName === 'Bob')?.done).toBe(false)
    expect(t1.culture.done).toBe(false)

    // ══ THÈME 2 (Bob) ═════════════════════════════════════════════════════
    // Q1 (1 pt) : Bob répond juste.
    const s3 = waitFor<BuzzStarted>(alice, EVENTS.BUZZ_QUESTION_STARTED)
    host.emit(EVENTS.HOST_START_THEME, { ownerName: 'Bob' })
    const q3 = await s3
    expect(q3.question.text).toBe('Thème Bob — Q1 ?')
    expect(q3.buzz.ownerParticipantId).toBe(bobId)

    ended = waitFor<BuzzEnded>(host, EVENTS.BUZZ_QUESTION_ENDED)
    host.emit(EVENTS.HOST_ADJUDICATE, { correct: true })
    expect((await ended).scorer?.points).toBe(1) // bob : 1

    // Q2 (2 pts) : Bob sèche → Alice vole et marque.
    const s4 = waitFor<BuzzStarted>(alice, EVENTS.BUZZ_QUESTION_STARTED)
    host.emit(EVENTS.HOST_NEXT_QUESTION, {})
    expect((await s4).question.text).toBe('Thème Bob — Q2 ?')

    const armed2 = waitBuzz(alice, (s) => s.phase === 'steal' && s.armed)
    host.emit(EVENTS.HOST_ADJUDICATE, { correct: false })
    await armed2
    const lockedAlice = waitBuzz(host, (s) => s.lockedBy?.participantId === aliceId)
    alice.emit(EVENTS.BUZZ, {})
    await lockedAlice
    ended = waitFor<BuzzEnded>(host, EVENTS.BUZZ_QUESTION_ENDED)
    host.emit(EVENTS.HOST_ADJUDICATE, { correct: true })
    e = await ended
    expect(e.scorer?.participantId).toBe(aliceId)
    expect(e.scorer?.points).toBe(2)             // alice : 4

    const back2 = waitSelector(host)
    const themes2 = waitThemes(host, (t) => t.currentTheme === null)
    host.emit(EVENTS.HOST_NEXT_QUESTION, {})
    await back2
    expect((await themes2).owners.every((o) => o.done)).toBe(true)

    // ══ CULTURE GÉNÉRALE (ouverte à tous d'emblée) ════════════════════════
    const s5 = waitFor<BuzzStarted>(alice, EVENTS.BUZZ_QUESTION_STARTED)
    host.emit(EVENTS.HOST_START_THEME, { ownerName: CULTURE_THEME })
    const q5 = await s5
    expect(q5.question.text).toBe('Culture — Q1 ?')
    expect(q5.buzz.phase).toBe('steal')
    expect(q5.buzz.armed).toBe(true)             // pas d'oral : buzzer direct

    const lockedBob2 = waitBuzz(host, (s) => s.lockedBy?.participantId === bobId)
    bob.emit(EVENTS.BUZZ, {})
    await lockedBob2
    ended = waitFor<BuzzEnded>(host, EVENTS.BUZZ_QUESTION_ENDED)
    host.emit(EVENTS.HOST_ADJUDICATE, { correct: true })
    expect((await ended).scorer?.points).toBe(1) // bob : 2

    // Dernière question (3 pts) : alice se trompe, bob rafle après réouverture.
    const s6 = waitFor<BuzzStarted>(alice, EVENTS.BUZZ_QUESTION_STARTED)
    host.emit(EVENTS.HOST_NEXT_QUESTION, {})
    expect((await s6).question.text).toBe('Culture — Q2 ?')

    const lockedAlice2 = waitBuzz(host, (s) => s.lockedBy?.participantId === aliceId)
    alice.emit(EVENTS.BUZZ, {})
    await lockedAlice2
    const missed2 = waitBuzz(host, (s) => s.phase === 'steal' && !s.armed)
    host.emit(EVENTS.HOST_ADJUDICATE, { correct: false })
    await missed2
    const reopened2 = waitBuzz(bob, (s) => s.phase === 'steal' && s.armed)
    host.emit(EVENTS.HOST_REOPEN_BUZZER, {})
    await reopened2
    const lockedBob3 = waitBuzz(host, (s) => s.lockedBy?.participantId === bobId)
    bob.emit(EVENTS.BUZZ, {})
    await lockedBob3
    ended = waitFor<BuzzEnded>(host, EVENTS.BUZZ_QUESTION_ENDED)
    host.emit(EVENTS.HOST_ADJUDICATE, { correct: true })
    expect((await ended).scorer?.points).toBe(3) // bob : 5

    // ══ FIN DE PARTIE : tout est joué → classement final ══════════════════
    const final = waitFor<Leaderboard>(host, EVENTS.LEADERBOARD_UPDATE)
    host.emit(EVENTS.HOST_NEXT_QUESTION, {})
    const lb = await final
    expect(lb.final).toBe(true)

    // Total attendu : alice 2 + 2 = 4 · bob 1 + 1 + 3 = 5 · mamie 0
    expect(lb.scores.find((s) => s.participantId === aliceId)?.score).toBe(4)
    expect(lb.scores.find((s) => s.participantId === bobId)?.score).toBe(5)
    expect(lb.scores.find((s) => s.participantId === mamieId)?.score).toBe(0)
    expect(lb.scores.map((s) => s.pseudo)).toEqual(['bob', 'alice', 'Mamie'])
    expect(lb.scores.map((s) => s.rank)).toEqual([1, 2, 3])

    // Somme distribuée = somme des points des questions gagnées (A2 passée = 0)
    const totalDistribue = lb.scores.reduce((acc, s) => acc + s.score, 0)
    expect(totalDistribue).toBe(2 + 1 + 2 + 1 + 3)
  })

  it('un thème non attribué ne fait perdre les points de personne (garde-fou)', async () => {
    const session = makeBuzzerSession(QUIZ)
    const { c: alice } = await joinAs('alice', session.pin)
    const host = await hostJoin(session)
    host.emit(EVENTS.HOST_START_QUIZ, {})
    await tick()
    // Ce test couvre le FALLBACK sans tour par tour (résolution par binding) :
    // on désactive l'ordre tiré au start.
    session.buzzTurnOrder = null

    // Thème d'Alice lancé SANS attribution (l'UI le grise, mais le serveur doit tenir)
    const started = waitFor<BuzzStarted>(alice, EVENTS.BUZZ_QUESTION_STARTED)
    host.emit(EVENTS.HOST_START_THEME, { ownerName: 'Alice' })
    expect((await started).buzz.ownerParticipantId).toBeNull()

    // « Correct » sans owner résolu → REFUSÉ (rien à créditer) : avant le fix M5,
    // la question se révélait avec 0 point en silence. La phase ne bouge pas.
    host.emit(EVENTS.HOST_ADJUDICATE, { correct: true })
    await tick()
    expect(session.buzz?.phase).toBe('owner_oral')

    // « Passer » ferme proprement la question : personne ne marque, la partie continue.
    const ended = waitFor<BuzzEnded>(host, EVENTS.BUZZ_QUESTION_ENDED)
    host.emit(EVENTS.HOST_PASS_QUESTION, {})
    const e = await ended
    expect(e.scorer).toBeNull()
    expect(e.scores.every((s) => s.score === 0)).toBe(true)

    // La question suivante du thème démarre normalement (pas de blocage)
    const next = waitFor<BuzzStarted>(alice, EVENTS.BUZZ_QUESTION_STARTED)
    host.emit(EVENTS.HOST_NEXT_QUESTION, {})
    expect((await next).question.text).toBe('Thème Alice — Q2 ?')
  })

  it('téléphone en veille pendant son tour : l’owner marque quand même ses points', async () => {
    const session = makeBuzzerSession(QUIZ)
    const { c: alice, joined } = await joinAs('alice', session.pin)
    const { c: bob } = await joinAs('bob', session.pin)
    const host = await hostJoin(session)
    const aliceId = joined.participant.id
    host.emit(EVENTS.HOST_ASSIGN_OWNER, { ownerName: 'Alice', participantId: aliceId })
    host.emit(EVENTS.HOST_START_QUIZ, {})
    await tick()
    // Déterministe : c'est le tour d'alice (elle répondra sur son thème).
    session.buzzTurnOrder = [aliceId]
    session.buzzTurnIndex = 0

    const started = waitFor<BuzzStarted>(host, EVENTS.BUZZ_QUESTION_STARTED)
    host.emit(EVENTS.HOST_START_THEME, { ownerName: 'Alice' })
    await started

    // Le tél d'alice se met en veille alors qu'elle répond à l'oral.
    await new Promise<void>((resolve) => {
      alice.once('disconnect', () => resolve())
      alice.disconnect()
    })
    await tick()

    // L'admin valide sa réponse orale → elle marque malgré la déconnexion.
    const ended = waitFor<BuzzEnded>(bob, EVENTS.BUZZ_QUESTION_ENDED)
    host.emit(EVENTS.HOST_ADJUDICATE, { correct: true })
    const e = await ended
    expect(e.scorer?.participantId).toBe(aliceId)
    expect(e.scorer?.points).toBe(2)
    expect(e.scores.find((s) => s.participantId === aliceId)?.score).toBe(2)
  })

  it('reprendre un thème déjà terminé renvoie au sélecteur sans casser la partie', async () => {
    const session = makeBuzzerSession(QUIZ)
    const { c: alice, joined } = await joinAs('alice', session.pin)
    const host = await hostJoin(session)
    host.emit(EVENTS.HOST_ASSIGN_OWNER, { ownerName: 'Alice', participantId: joined.participant.id })
    host.emit(EVENTS.HOST_START_QUIZ, {})

    // On vide le thème d'Alice (2 questions passées)
    for (const text of ['Thème Alice — Q1 ?', 'Thème Alice — Q2 ?']) {
      const st = waitFor<BuzzStarted>(alice, EVENTS.BUZZ_QUESTION_STARTED)
      host.emit(text === 'Thème Alice — Q1 ?' ? EVENTS.HOST_START_THEME : EVENTS.HOST_NEXT_QUESTION, { ownerName: 'Alice' })
      expect((await st).question.text).toBe(text)
      const ended = waitFor<BuzzEnded>(host, EVENTS.BUZZ_QUESTION_ENDED)
      host.emit(EVENTS.HOST_PASS_QUESTION, {})
      await ended
    }
    const back = waitSelector(host)
    host.emit(EVENTS.HOST_NEXT_QUESTION, {})
    await back

    // Re-cliquer sur le thème terminé : retour sélecteur, aucune question relancée
    const again = waitThemes(host, (t) => t.currentTheme === null)
    host.emit(EVENTS.HOST_START_THEME, { ownerName: 'Alice' })
    expect((await again).owners.find((o) => o.ownerName === 'Alice')?.done).toBe(true)

    // Le thème suivant reste lançable
    const st = waitFor<BuzzStarted>(alice, EVENTS.BUZZ_QUESTION_STARTED)
    host.emit(EVENTS.HOST_START_THEME, { ownerName: 'Bob' })
    expect((await st).question.text).toBe('Thème Bob — Q1 ?')
  })
})
