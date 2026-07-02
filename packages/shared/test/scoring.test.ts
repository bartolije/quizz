import { describe, expect, it } from 'vitest'
import {
  calculateScore,
  calculateClosestScore,
  computeClosestScale,
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

describe('calculateClosestScore', () => {
  it('réponse exacte → 1000', () => {
    expect(calculateClosestScore(100, 100, 50)).toBe(1000)
  })
  it('maxDeviation 0 (tout le monde juste) → 1000', () => {
    expect(calculateClosestScore(100, 100, 0)).toBe(1000)
  })
  it("à la moitié de l'écart max → 500", () => {
    expect(calculateClosestScore(100, 125, 50)).toBe(500)
  })
  it("à l'écart max → 0", () => {
    expect(calculateClosestScore(100, 150, 50)).toBe(0)
  })
})

describe('computeClosestScale (échelle robuste aux aberrants)', () => {
  it("une réponse absurde n'écrase plus le barème", () => {
    // écarts sains 1..3, un troll à 1 000 000 → l'échelle reste dans le raisonnable
    expect(computeClosestScale([1, 2, 3, 1_000_000])).toBe(3)
  })
  it('discrimine à nouveau les réponses saines malgré un aberrant', () => {
    const scale = computeClosestScale([5, 10, 20, 999_999_999])
    const good = calculateClosestScore(100, 105, scale) // écart 5
    const ok = calculateClosestScore(100, 110, scale)   // écart 10
    const troll = calculateClosestScore(100, 999_999_999 + 100, scale)
    expect(good).toBeGreaterThan(ok)   // avant : good ≈ ok ≈ 1000
    expect(troll).toBe(0)
    expect(good).toBeGreaterThan(600)
  })
  it('cas limites', () => {
    expect(computeClosestScale([])).toBe(0)
    expect(computeClosestScale([7])).toBe(7)
    expect(computeClosestScale([0, 0])).toBe(0)
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
