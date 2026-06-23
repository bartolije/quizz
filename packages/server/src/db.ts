import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Chemin du fichier SQLite :
// - PROD (Railway) : DATABASE_PATH pointe vers le Volume persistant (ex. /data/lya-quiz.db).
// - DEV : ./data/lya-quiz.db à la racine du repo (gitignoré).
const DB_PATH =
  process.env['DATABASE_PATH'] ??
  join(dirname(fileURLToPath(import.meta.url)), '../../../data/lya-quiz.db')

mkdirSync(dirname(DB_PATH), { recursive: true })

const sqlite = new Database(DB_PATH)
sqlite.pragma('journal_mode = WAL')

// ─────────────────────────────────────────────────────────────
// Schéma Drizzle
// ─────────────────────────────────────────────────────────────

export const quizzes = sqliteTable('quizzes', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  defaultTimeLimit: integer('default_time_limit').notNull(),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
})

export const questions = sqliteTable('questions', {
  id: text('id').primaryKey(),
  quizId: text('quiz_id').notNull(),
  type: text('type').notNull(),
  text: text('text').notNull(),
  choices: text('choices'), // JSON string | null (mcq uniquement)
  correctAnswers: text('correct_answers').notNull(), // JSON string
  timeLimit: integer('time_limit').notNull(),
  ord: integer('ord').notNull(),
  mediaUrl: text('media_url'),
})

// Création idempotente des tables (évite drizzle-kit en prod).
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS quizzes (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    default_time_limit INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS questions (
    id TEXT PRIMARY KEY,
    quiz_id TEXT NOT NULL,
    type TEXT NOT NULL,
    text TEXT NOT NULL,
    choices TEXT,
    correct_answers TEXT NOT NULL,
    time_limit INTEGER NOT NULL,
    ord INTEGER NOT NULL,
    media_url TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_questions_quiz ON questions(quiz_id, ord);
`)

export const db = drizzle(sqlite)
