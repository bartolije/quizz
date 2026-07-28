import { eq, asc, sql } from 'drizzle-orm'
import type { Quiz, Question, QuestionType, Difficulty, QuestionSection, GameType } from '@lya-quiz/shared'
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
  // Mode buzzer (optionnels)
  difficulty?: Difficulty
  points?: number
  section?: QuestionSection
  ownerName?: string
  themeName?: string
}
export interface QuizInput {
  title: string
  defaultTimeLimit: number
  questions: QuestionInput[]
  gameType?: GameType
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
    ...(r.difficulty ? { difficulty: r.difficulty as Difficulty } : {}),
    ...(typeof r.points === 'number' ? { points: r.points } : {}),
    ...(r.section ? { section: r.section as QuestionSection } : {}),
    ...(r.ownerName ? { ownerName: r.ownerName } : {}),
    ...(r.themeName ? { themeName: r.themeName } : {}),
  }
}

function insertQuestions(quizId: string, items: QuestionInput[]): void {
  items.forEach((q, i) => {
    db.insert(questions)
      .values({
        id: crypto.randomUUID(),
        quizId,
        type: q.type,
        text: q.text,
        choices: q.choices && q.choices.length > 0 ? JSON.stringify(q.choices) : null,
        correctAnswers: JSON.stringify(q.correctAnswers),
        timeLimit: q.timeLimit,
        ord: i,
        mediaUrl: q.mediaUrl ?? null,
        difficulty: q.difficulty ?? null,
        points: q.points ?? null,
        section: q.section ?? null,
        ownerName: q.ownerName ?? null,
        themeName: q.themeName ?? null,
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
    ...(qz.gameType ? { gameType: qz.gameType as GameType } : {}),
  }
}

// Quiz par défaut (le plus ancien) — utilisé quand /host/control est ouvert sans
// quizId explicite.
export function getDefaultQuiz(): Quiz | null {
  const first = db.select().from(quizzes).orderBy(asc(quizzes.createdAt)).get()
  return first ? getQuiz(first.id) : null
}

export function createQuiz(input: QuizInput): string {
  const id = crypto.randomUUID()
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
        gameType: input.gameType ?? null,
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
      .set({
        title: input.title,
        defaultTimeLimit: input.defaultTimeLimit,
        updatedAt: Date.now(),
        gameType: input.gameType ?? null,
      })
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

// Quiz famille (mode buzzer) de démonstration — inséré une seule fois s'il
// n'existe aucun quiz buzzer, pour pouvoir lancer/tester une partie tout de
// suite. Le vrai contenu sera écrit à la main via l'éditeur (Phase 4).
// (Questions de culture G ; le round perso arrive avec son UI en Phase 2.)
export function seedBuzzerDemoIfMissing(): void {
  const rows = db.select({ gameType: quizzes.gameType }).from(quizzes).all()
  if (rows.some((r) => r.gameType === 'buzzer')) return
  createQuiz({
    title: 'Quiz famille (démo buzzer)',
    defaultTimeLimit: 0,
    gameType: 'buzzer',
    questions: [
      // Round perso : 2 thèmes de démo (l'admin les attribue aux joueurs présents)
      { type: 'free', text: 'Combien de titres de champion du monde pour Ayrton Senna ?', correctAnswers: ['3', 'trois'], timeLimit: 0, points: 2, section: 'perso', ownerName: 'Papa', themeName: 'Formule 1' },
      { type: 'free', text: 'Chez quelle écurie court Alain Prost en 1990 ?', correctAnswers: ['Ferrari'], timeLimit: 0, points: 3, section: 'perso', ownerName: 'Papa', themeName: 'Formule 1' },
      { type: 'free', text: 'Dans quelle maison de Poudlard est Harry Potter ?', correctAnswers: ['Gryffondor'], timeLimit: 0, points: 1, section: 'perso', ownerName: 'Léa', themeName: 'Harry Potter' },
      { type: 'free', text: 'Comment s’appelle le hibou de Harry Potter ?', correctAnswers: ['Hedwige', 'Hedwig'], timeLimit: 0, points: 2, section: 'perso', ownerName: 'Léa', themeName: 'Harry Potter' },
      // Round culture G (buzzer ouvert à tous)
      { type: 'free', text: 'Quel animal est-ce ?', correctAnswers: ['Renard', 'Fox'], timeLimit: 0, points: 1, section: 'culture', mediaUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/3/30/Vulpes_vulpes_ssp_fulvus.jpg/320px-Vulpes_vulpes_ssp_fulvus.jpg' },
      { type: 'free', text: "Quelle est la capitale de l'Australie ?", correctAnswers: ['Canberra'], timeLimit: 0, points: 2, section: 'culture' },
      { type: 'free', text: "ULTRA DUR — En quelle année a été fondée la ville de Québec ?", correctAnswers: ['1608'], timeLimit: 0, points: 5, section: 'culture' },
    ],
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
