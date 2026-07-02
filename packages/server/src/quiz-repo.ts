import { v4 as uuid } from 'uuid'
import { eq, asc, sql } from 'drizzle-orm'
import type { Quiz, Question, QuestionType } from '@lya-quiz/shared'
import { db, quizzes, questions } from './db.js'
import { SEED_QUIZ } from './seed-quiz.js'

// Forme d'entrée envoyée par l'éditeur (sans id technique).
export interface QuestionInput {
  type: QuestionType
  text: string
  choices?: string[]
  correctAnswers: string[]
  timeLimit: number
  mediaUrl?: string
}
export interface QuizInput {
  title: string
  defaultTimeLimit: number
  questions: QuestionInput[]
}

export interface QuizSummary {
  id: string
  title: string
  questionCount: number
  updatedAt: number
}

type QuestionRow = typeof questions.$inferSelect

function rowToQuestion(r: QuestionRow): Question {
  const choices = r.choices ? (JSON.parse(r.choices) as string[]) : undefined
  return {
    id: r.id,
    text: r.text,
    type: r.type as QuestionType,
    ...(choices ? { choices } : {}),
    correctAnswers: JSON.parse(r.correctAnswers) as string[],
    timeLimit: r.timeLimit,
    ...(r.mediaUrl ? { mediaUrl: r.mediaUrl } : {}),
  }
}

function insertQuestions(quizId: string, items: QuestionInput[]): void {
  items.forEach((q, i) => {
    db.insert(questions)
      .values({
        id: uuid(),
        quizId,
        type: q.type,
        text: q.text,
        choices: q.choices && q.choices.length > 0 ? JSON.stringify(q.choices) : null,
        correctAnswers: JSON.stringify(q.correctAnswers),
        timeLimit: q.timeLimit,
        ord: i,
        mediaUrl: q.mediaUrl ?? null,
      })
      .run()
  })
}

export function listQuizzes(): QuizSummary[] {
  const rows = db.select().from(quizzes).orderBy(asc(quizzes.createdAt)).all()
  return rows.map((qz) => {
    const c =
      db
        .select({ c: sql<number>`count(*)` })
        .from(questions)
        .where(eq(questions.quizId, qz.id))
        .get()?.c ?? 0
    return { id: qz.id, title: qz.title, questionCount: c, updatedAt: qz.updatedAt }
  })
}

export function getQuiz(id: string): Quiz | null {
  const qz = db.select().from(quizzes).where(eq(quizzes.id, id)).get()
  if (!qz) return null
  const qs = db
    .select()
    .from(questions)
    .where(eq(questions.quizId, id))
    .orderBy(asc(questions.ord))
    .all()
  return {
    id: qz.id,
    title: qz.title,
    defaultTimeLimit: qz.defaultTimeLimit,
    createdAt: qz.createdAt,
    questions: qs.map(rowToQuestion),
  }
}

// Quiz par défaut (le plus ancien) — utilisé quand /host/control est ouvert sans
// quizId explicite.
export function getDefaultQuiz(): Quiz | null {
  const first = db.select().from(quizzes).orderBy(asc(quizzes.createdAt)).get()
  return first ? getQuiz(first.id) : null
}

export function createQuiz(input: QuizInput): string {
  const id = uuid()
  const now = Date.now()
  // Tout-ou-rien : les questions DANS la transaction — un crash au milieu ne
  // peut plus laisser un quiz sans questions en base.
  db.transaction(() => {
    db.insert(quizzes)
      .values({
        id,
        title: input.title,
        defaultTimeLimit: input.defaultTimeLimit,
        createdAt: now,
        updatedAt: now,
      })
      .run()
    insertQuestions(id, input.questions)
  })
  return id
}

export function replaceQuiz(id: string, input: QuizInput): boolean {
  const exists = db.select({ id: quizzes.id }).from(quizzes).where(eq(quizzes.id, id)).get()
  if (!exists) return false
  // Tout-ou-rien : delete + réinsertion dans la MÊME transaction — un crash ne
  // peut plus vider le quiz de la soirée entre les deux.
  db.transaction(() => {
    db.update(quizzes)
      .set({ title: input.title, defaultTimeLimit: input.defaultTimeLimit, updatedAt: Date.now() })
      .where(eq(quizzes.id, id))
      .run()
    db.delete(questions).where(eq(questions.quizId, id)).run()
    insertQuestions(id, input.questions)
  })
  return true
}

export function deleteQuiz(id: string): void {
  db.transaction((tx) => {
    tx.delete(questions).where(eq(questions.quizId, id)).run()
    tx.delete(quizzes).where(eq(quizzes.id, id)).run()
  })
}

// Au premier démarrage (DB vide), insère le quiz de démo pour avoir de quoi jouer.
export function seedIfEmpty(): void {
  const any = db.select({ id: quizzes.id }).from(quizzes).get()
  if (any) return
  createQuiz({
    title: SEED_QUIZ.title,
    defaultTimeLimit: SEED_QUIZ.defaultTimeLimit,
    questions: SEED_QUIZ.questions.map((q) => ({
      type: q.type,
      text: q.text,
      ...(q.choices ? { choices: q.choices } : {}),
      correctAnswers: q.correctAnswers,
      timeLimit: q.timeLimit,
      ...(q.mediaUrl ? { mediaUrl: q.mediaUrl } : {}),
    })),
  })
}
