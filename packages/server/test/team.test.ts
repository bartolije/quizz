import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { ServerToClientEvents } from '@lya-quiz/shared'
import { EVENTS } from '@lya-quiz/shared'
import { makeSession, startTestServer, waitFor, type TestServer, type TestClient } from './helpers.js'
import { getTeamLeaderboard } from '../src/session-helpers.js'
import type { SessionState } from '../src/state.js'

// Ajoute un joueur (sans socket) directement dans la session.
function addPlayer(s: SessionState, pseudo: string, score: number, teamId?: string): void {
  const id = crypto.randomUUID()
  s.participants.set(id, {
    id, pseudo, socketId: '', sessionToken: id, connected: true,
    score, lastDelta: score, correctTotal: 0, ...(teamId ? { teamId } : {}),
  })
}

describe('score d’équipe', () => {
  it('moyenne des membres : une petite équipe n’est pas désavantagée', () => {
    const s = makeSession()
    s.mode = 'team'
    s.teams.set('a', { id: 'a', name: 'A', color: '#000' })
    s.teams.set('b', { id: 'b', name: 'B', color: '#fff' })
    addPlayer(s, 'a1', 600, 'a')
    addPlayer(s, 'a2', 600, 'a')
    addPlayer(s, 'a3', 600, 'a') // somme 1800, moyenne 600
    addPlayer(s, 'b1', 900, 'b')
    addPlayer(s, 'b2', 700, 'b') // somme 1600, moyenne 800
    addPlayer(s, 'solo', 1000)   // sans équipe : ne compte pour personne

    const [first, second] = getTeamLeaderboard(s)
    expect(first).toMatchObject({ teamId: 'b', score: 800, delta: 800, rank: 1 })
    expect(second).toMatchObject({ teamId: 'a', score: 600, rank: 2 })
  })

  it('équipe vide : 0', () => {
    const s = makeSession()
    s.teams.set('a', { id: 'a', name: 'A', color: '#000' })
    expect(getTeamLeaderboard(s)[0]).toMatchObject({ score: 0, delta: 0 })
  })
})

type Joined = Parameters<ServerToClientEvents['session_joined']>[0]
type Teams = Parameters<ServerToClientEvents['teams_updated']>[0]

describe('tirage au sort des équipes', () => {
  let srv: TestServer
  beforeAll(async () => {
    srv = await startTestServer()
  })
  afterAll(async () => {
    await srv.close()
  })

  async function join(pin: string, pseudo: string): Promise<{ c: TestClient; joined: Joined }> {
    const c = srv.connect()
    c.emit(EVENTS.JOIN_SESSION, { pin, pseudo, sessionToken: null })
    return { c, joined: await waitFor<Joined>(c, EVENTS.SESSION_JOINED) }
  }
  async function hostOf(s: { pin: string; hostKey: string }): Promise<TestClient> {
    const h = srv.connect()
    h.emit(EVENTS.HOST_JOIN, { pin: s.pin, hostKey: s.hostKey })
    await waitFor(h, EVENTS.SESSION_JOINED)
    return h
  }

  it('crée N équipes, répartit tout le monde (±1), verrouille ; le retardataire va dans la plus petite', async () => {
    const s = makeSession()
    for (const p of ['a', 'b', 'c', 'd', 'e']) await join(s.pin, p)
    const host = await hostOf(s)

    const drawn = waitFor<Teams>(host, EVENTS.TEAMS_UPDATED)
    host.emit(EVENTS.HOST_DRAW_TEAMS, { count: 2 })
    const t = await drawn
    expect(t.mode).toBe('team')
    expect(t.locked).toBe(true)
    expect(t.teams.map((x) => x.name)).toEqual(['Rouges', 'Bleus'])
    const sizes = t.teams.map((x) => t.participants.filter((p) => p.teamId === x.id).length)
    expect(sizes.sort()).toEqual([2, 3])

    // f arrive après le tirage : équipes verrouillées → équipe de 2 (la plus petite)
    const small = t.teams.find((x) => t.participants.filter((p) => p.teamId === x.id).length === 2)!
    const { joined } = await join(s.pin, 'f')
    expect(joined.participant.teamId).toBe(small.id)
  })

  it('refusé une fois la partie lancée', async () => {
    const s = makeSession()
    await join(s.pin, 'a')
    const host = await hostOf(s)
    host.emit(EVENTS.HOST_START_QUIZ, {})
    host.emit(EVENTS.HOST_DRAW_TEAMS, { count: 3 })
    await new Promise((r) => setTimeout(r, 150))
    expect(s.teams.size).toBe(0)
    expect(s.mode).toBe('solo')
  })
})
