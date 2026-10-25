import { describe, expect, it } from 'vitest'
import { parseQuizJson } from '../src/quiz-io'

const quiz = (q: Record<string, unknown>) => JSON.stringify({ title: 'T', questions: [q] })
const mcq = { type: 'mcq', text: 'Capitale ?', choices: ['Paris', 'Lyon'], correctAnswers: ['Paris'] }

describe('parseQuizJson — QCM', () => {
  it('accepte une bonne réponse présente dans les choix', () => {
    expect(parseQuizJson(quiz(mcq)).error).toBeNull()
  })

  it('refuse une bonne réponse absente des choix (casse différente → personne ne marquerait)', () => {
    expect(parseQuizJson(quiz({ ...mcq, correctAnswers: ['paris'] })).error).toMatch(/l'un des "choices"/)
  })

  it('refuse plus de 4 choix (l’éditeur les tronquait)', () => {
    expect(parseQuizJson(quiz({ ...mcq, choices: ['Paris', 'Lyon', 'Nice', 'Brest', 'Lille'] })).error).toMatch(/2 à 4/)
  })
})
