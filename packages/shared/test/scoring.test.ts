import { describe, expect, it } from 'vitest'
import {
  calculateScore,
  calculateClosestScore,
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
  it('tolère 2 fautes de frappe', () => {
    expect(isCorrectFreeAnswer('marsseile', ['Marseille'])).toBe(true)
  })
  it('rejette une réponse trop éloignée', () => {
    expect(isCorrectFreeAnswer('Lyon', ['Marseille'])).toBe(false)
  })
  it('accepte via une des variantes', () => {
    expect(isCorrectFreeAnswer('NYC', ['New York', 'NYC'])).toBe(true)
  })
})
