import type { Quiz } from '@lya-quiz/shared'

// Quiz de démonstration chargé en mémoire (S4).
// Sera remplacé par un quiz chargé depuis la DB en S8 — passer par getQuiz()
// pour que la bascule ne touche qu'un seul point.
export const SEED_QUIZ: Quiz = {
  id: 'seed',
  title: 'Quiz de démo LYA',
  defaultTimeLimit: 20,
  createdAt: 0,
  questions: [
    {
      id: 'q1',
      text: 'Quelle est la capitale de la France ?',
      type: 'mcq',
      choices: ['Paris', 'Lyon', 'Marseille', 'Bordeaux'],
      correctAnswers: ['Paris'],
      timeLimit: 20,
    },
    {
      id: 'q2',
      text: 'Combien font 7 × 8 ?',
      type: 'mcq',
      choices: ['54', '56', '64', '48'],
      correctAnswers: ['56'],
      timeLimit: 15,
    },
    {
      id: 'q3',
      text: 'Quel langage s’exécute nativement dans un navigateur ?',
      type: 'mcq',
      choices: ['Python', 'JavaScript', 'Java', 'C#'],
      correctAnswers: ['JavaScript'],
      timeLimit: 20,
    },
    {
      id: 'q4',
      text: 'Quelle planète est la plus proche du Soleil ?',
      type: 'mcq',
      choices: ['Vénus', 'Mars', 'Mercure', 'Terre'],
      correctAnswers: ['Mercure'],
      timeLimit: 20,
    },
    {
      id: 'q5',
      text: 'En quelle année a eu lieu le premier pas sur la Lune ?',
      type: 'mcq',
      choices: ['1965', '1969', '1972', '1958'],
      correctAnswers: ['1969'],
      timeLimit: 20,
    },
  ],
}

export function getSeedQuiz(): Quiz {
  return SEED_QUIZ
}
