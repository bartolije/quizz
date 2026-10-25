import { describe, expect, it } from 'vitest'
import { makeSession } from './helpers.js'
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
