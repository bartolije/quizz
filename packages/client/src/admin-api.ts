import type { Quiz, QuestionType, Difficulty, QuestionSection, GameType } from '@lya-quiz/shared'
import { apiUrl } from './config'

const PW_KEY = 'lya_admin_pw'
export const getPw = (): string => localStorage.getItem(PW_KEY) ?? ''
export const setPw = (p: string): void => localStorage.setItem(PW_KEY, p)

function authHeaders(): Record<string, string> {
  return { 'Content-Type': 'application/json', 'x-admin-password': getPw() }
}

export interface QuizSummary {
  id: string
  title: string
  questionCount: number
  updatedAt: number
}

// Forme envoyée au serveur (sans id technique) — aligne sur QuizInput côté serveur.
export interface QuestionInput {
  type: QuestionType
  text: string
  choices?: string[]
  correctAnswers: string[]
  timeLimit: number
  mediaUrl?: string
  // Mode buzzer (partie famille)
  difficulty?: Difficulty
  points?: number
  section?: QuestionSection
  ownerName?: string
}
export interface QuizInput {
  title: string
  defaultTimeLimit: number
  questions: QuestionInput[]
  gameType?: GameType
}

export async function checkPw(password: string): Promise<boolean> {
  const res = await fetch(apiUrl('/api/admin/check'), {
    method: 'POST',
    headers: { 'x-admin-password': password },
  })
  return res.ok
}

export async function listQuizzes(): Promise<QuizSummary[]> {
  const res = await fetch(apiUrl('/api/admin/quizzes'), { headers: authHeaders() })
  if (!res.ok) throw new Error('unauthorized')
  return (await res.json()) as QuizSummary[]
}

export async function fetchQuiz(id: string): Promise<Quiz> {
  const res = await fetch(apiUrl(`/api/admin/quizzes/${id}`), { headers: authHeaders() })
  if (!res.ok) throw new Error('not_found')
  return (await res.json()) as Quiz
}

export async function createQuiz(input: QuizInput): Promise<string> {
  const res = await fetch(apiUrl('/api/admin/quizzes'), {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(input),
  })
  if (!res.ok) throw new Error('create_failed')
  return ((await res.json()) as { id: string }).id
}

export async function updateQuiz(id: string, input: QuizInput): Promise<void> {
  const res = await fetch(apiUrl(`/api/admin/quizzes/${id}`), {
    method: 'PUT',
    headers: authHeaders(),
    body: JSON.stringify(input),
  })
  if (!res.ok) throw new Error('update_failed')
}

export async function deleteQuiz(id: string): Promise<void> {
  const res = await fetch(apiUrl(`/api/admin/quizzes/${id}`), {
    method: 'DELETE',
    headers: authHeaders(),
  })
  if (!res.ok) throw new Error('delete_failed')
}

// Lance un quiz : crée une session liée puis renvoie pin+sessionId.
export async function launchQuiz(quizId: string): Promise<{ pin: string; sessionId: string }> {
  const res = await fetch(apiUrl('/api/sessions'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ quizId }),
  })
  if (!res.ok) throw new Error('launch_failed')
  return (await res.json()) as { pin: string; sessionId: string }
}
