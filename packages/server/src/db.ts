import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Chemin du fichier SQLite, par ordre de priorité :
// 1. DATABASE_PATH si défini explicitement (override manuel) ;
// 2. RAILWAY_VOLUME_MOUNT_PATH : Railway crée cette variable AUTOMATIQUEMENT dès
//    qu'un Volume est attaché au service → le fichier vit sur le disque persistant
//    sans aucune config (il suffit d'ajouter un Volume dans Railway) ;
// 3. sinon ./data/lya-quiz.db à la racine du repo (dev local, gitignoré).
const DB_PATH =
  process.env['DATABASE_PATH'] ??
  (process.env['RAILWAY_VOLUME_MOUNT_PATH']
    ? join(process.env['RAILWAY_VOLUME_MOUNT_PATH'], 'lya-quiz.db')
    : join(dirname(fileURLToPath(import.meta.url)), '../../../data/lya-quiz.db'))

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
  gameType: text('game_type'), // 'classic' | 'buzzer' | null (=classic) — partie famille
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
  // Mode buzzer (nullable → questions classiques inchangées)
  difficulty: text('difficulty'), // 'facile' | 'moyen' | 'difficile' | null (compat)
  points: integer('points'),      // points de la question (nombre libre) | null
  section: text('section'),       // 'perso' | 'culture' | null
  ownerName: text('owner_name'),  // slot joueur propriétaire du thème (section perso)
  themeName: text('theme_name'),  // nom d'affichage du thème (masque l'owner sur TV/tél)
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
  -- Filet anti-restart : snapshot JSON de chaque session de jeu active
  -- (cf. session-snapshot.ts). Restauré au boot, purgé à la fin du quiz.
  CREATE TABLE IF NOT EXISTS session_snapshots (
    id TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );
`)

// Migration idempotente : ajoute les colonnes du mode buzzer aux bases déjà
// créées (Volume Railway) sans drizzle-kit. ALTER TABLE ADD COLUMN est additif ;
// on ne l'exécute que si la colonne manque (sinon SQLite lève "duplicate column").
function ensureColumn(table: string, column: string, decl: string): void {
  const cols = sqlite.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
  if (!cols.some((c) => c.name === column)) {
    sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${decl}`)
  }
}
ensureColumn('quizzes', 'game_type', 'TEXT')
ensureColumn('questions', 'difficulty', 'TEXT')
ensureColumn('questions', 'points', 'INTEGER')
ensureColumn('questions', 'section', 'TEXT')
ensureColumn('questions', 'owner_name', 'TEXT')
ensureColumn('questions', 'theme_name', 'TEXT')

export const db = drizzle(sqlite)
// Accès brut pour les modules qui n'ont pas besoin de Drizzle (snapshots)
export { sqlite }
