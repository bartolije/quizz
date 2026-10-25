import { describe, expect, it } from 'vitest'
import {
  calculateScore,
  closestPointsByPlace,
  freeAnswerTolerance,
  normalizeAnswer,
  levenshtein,
  isCorrectFreeAnswer,
} from '../src/scoring.js'

describe('calculateScore (linéaire à la vitesse)', () => {
  it('1000 pts pour une réponse immédiate', () => {
    expect(calculateScore(30, 0)).toBe(1000)
  })
  it('500 pts à mi-temps', () => {
    expect(calculateScore(30, 15)).toBe(500)
  })
  it('0 pt au temps limite et au-delà', () => {
    expect(calculateScore(30, 30)).toBe(0)
    expect(calculateScore(30, 45)).toBe(0)
  })
})

describe('closestPointsByPlace (au plus proche, selon la place)', () => {
  it('le plus proche 1000, le plus loin 100, linéaire selon la place', () => {
    // pour 1000 : 999 / 1002 / 1100 / 5000
    expect(closestPointsByPlace([1, 2, 100, 4000])).toEqual([1000, 700, 400, 100])
  })
  it('ordre des réponses conservé', () => {
    expect(closestPointsByPlace([100, 1, 4000, 2])).toEqual([400, 1000, 100, 700])
  })
  it("une réponse absurde finit dernière sans écraser l'écart entre les autres", () => {
    expect(closestPointsByPlace([5, 10, 999_999_999])).toEqual([1000, 550, 100])
  })
  it('ex æquo = même place', () => {
    expect(closestPointsByPlace([3, 1, 1])).toEqual([100, 1000, 1000])
  })
  it('cas limites', () => {
    expect(closestPointsByPlace([])).toEqual([])
    expect(closestPointsByPlace([7])).toEqual([1000])
  })
})

describe('freeAnswerTolerance (proportionnelle à la longueur)', () => {
  it('0 faute sur les réponses courtes, 1 puis 2 ensuite', () => {
    expect(freeAnswerTolerance(4)).toBe(0)
    expect(freeAnswerTolerance(5)).toBe(1)
    expect(freeAnswerTolerance(7)).toBe(1)
    expect(freeAnswerTolerance(8)).toBe(2)
  })
})

describe('normalizeAnswer', () => {
  it('minuscules + accents + espaces', () => {
    expect(normalizeAnswer('  PÂRIS ')).toBe('paris')
  })
  it('apostrophes et tirets supprimés', () => {
    expect(normalizeAnswer("L'Élysée")).toBe('lelysee')
    expect(normalizeAnswer('Jean-Pierre')).toBe('jeanpierre')
  })
})

describe('levenshtein', () => {
  it('0 pour deux chaînes identiques', () => {
    expect(levenshtein('paris', 'paris')).toBe(0)
  })
  it('compte insertions/substitutions', () => {
    expect(levenshtein('paris', 'pariss')).toBe(1)
    expect(levenshtein('abc', 'xyz')).toBe(3)
  })
  it('chaîne vide → longueur de l’autre', () => {
    expect(levenshtein('', 'abc')).toBe(3)
  })
})

describe('isCorrectFreeAnswer', () => {
  it('match exact insensible casse/accents', () => {
    expect(isCorrectFreeAnswer('  pâris ', ['Paris'])).toBe(true)
  })
  it('tolère 2 fautes de frappe sur une réponse longue', () => {
    expect(isCorrectFreeAnswer('marsseile', ['Marseille'])).toBe(true)
  })
  it('rejette une réponse trop éloignée', () => {
    expect(isCorrectFreeAnswer('Lyon', ['Marseille'])).toBe(false)
  })
  it('réponses courtes : AUCUNE faute admise (« 1898 » ne vaut pas « 1998 »)', () => {
    expect(isCorrectFreeAnswer('1898', ['1998'])).toBe(false)
    expect(isCorrectFreeAnswer('Lyn', ['Lyon'])).toBe(false)
    expect(isCorrectFreeAnswer('1998', ['1998'])).toBe(true)
  })
  it('réponses moyennes (5-7 chars) : 1 faute', () => {
    expect(isCorrectFreeAnswer('pariss', ['Paris'])).toBe(true)
    expect(isCorrectFreeAnswer('parriss', ['Paris'])).toBe(false)
  })
  it('accepte via une des variantes', () => {
    expect(isCorrectFreeAnswer('NYC', ['New York', 'NYC'])).toBe(true)
  })
  it('entrée démesurée : rejet rapide (garde de longueur avant Levenshtein)', () => {
    const t0 = performance.now()
    expect(isCorrectFreeAnswer('x'.repeat(100_000), ['Paris'])).toBe(false)
    expect(performance.now() - t0).toBeLessThan(50) // pas de plein-matrice 100k×5
  })
})
