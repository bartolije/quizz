export type QuestionType = 'mcq' | 'free' | 'closest' | 'ordering'

export type QuestionStatus = 'waiting' | 'running' | 'ended'
export type SessionStatus  = 'waiting' | 'running' | 'ended'

// Mode de partie : 'solo' = scoring individuel (défaut) · 'team' = scoring par équipe
export type SessionMode = 'solo' | 'team'

// ─────────────────────────────────────────────────────────────
// MODE « FAMILLE » (buzzer arbitré) — cf. .claude/plan-quiz-famille.md
// Tout ce qui suit est OPTIONNEL : un quiz classique (gameType absent/'classic')
// se comporte exactement comme avant.
// ─────────────────────────────────────────────────────────────

// Type de jeu : 'classic' = Kahoot auto-corrigé à la vitesse (défaut) ·
// 'buzzer' = partie famille arbitrée par l'admin, téléphone = buzzer, rien
// n'est corrigé automatiquement.
export type GameType = 'classic' | 'buzzer'

// Difficulté d'une question buzzer → nombre de points (cf. DIFFICULTY_POINTS)
export type Difficulty = 'facile' | 'moyen' | 'difficile'

export const DIFFICULTY_POINTS: Record<Difficulty, number> = {
  facile: 1,
  moyen: 2,
  difficile: 3,
}

// Points effectifs d'une question buzzer : `points` explicite s'il est défini
// (nombre libre), sinon dérivé de l'ancienne `difficulty` (1/2/3), sinon 1.
export function questionPoints(q: { points?: number; difficulty?: Difficulty }): number {
  if (typeof q.points === 'number' && q.points > 0) return Math.round(q.points)
  if (q.difficulty) return DIFFICULTY_POINTS[q.difficulty]
  return 1
}

// Section d'une question dans une partie famille :
// 'perso'   = thème d'un joueur (répondu d'abord par l'owner, puis volable)
// 'culture' = culture générale, buzzer ouvert à tous dès le départ
export type QuestionSection = 'perso' | 'culture'

// « Thème » sélectionnable par l'admin : soit un nom de joueur (ownerName d'un
// thème perso), soit cette sentinelle pour le round culture générale.
export const CULTURE_THEME = '__culture__'

// État d'un thème perso pour l'écran de distribution / sélection (host)
export interface BuzzThemeInfo {
  ownerName: string
  themeName?: string           // nom d'affichage du thème (ex. « Disney ») — la TV
                               // et les téléphones l'affichent SANS révéler l'owner
  participantId: string | null // joueur associé (binding), null = non attribué
  total: number                // nombre de questions du thème
  done: boolean                // toutes les questions du thème ont été jouées
}

// Tour par tour (règle 2026) : ordre de passage ALÉATOIRE tiré au lancement du
// quiz. Le joueur du tour choisit un thème PAS ENCORE JOUÉ — le sien ou celui
// d'un autre — et c'est LUI qui répond à tout le thème (mauvaise réponse →
// vol ouvert à tous les autres, y compris le propriétaire du thème).
export interface BuzzTurnState {
  order: { participantId: string; pseudo: string }[]  // ordre de passage mélangé
  index: number                                        // position courante (>= length = tours finis)
}

// État complet des thèmes d'une partie famille (rediffusé au host à chaque changement)
export interface BuzzThemesState {
  owners: BuzzThemeInfo[]
  culture: { total: number; done: boolean }
  currentTheme: string | null  // thème en cours (ownerName | CULTURE_THEME | null)
  turn: BuzzTurnState | null   // null = pas de tour par tour (culture-only, vieux flux)
}

// Palette de couleurs d'équipe (hex → utilisé en style inline côté client, pas de
// classe Tailwind dynamique qui serait purgée au build). Le serveur pioche dedans.
export const TEAM_PALETTE = [
  '#ef4444', // rouge
  '#3b82f6', // bleu
  '#10b981', // emeraude
  '#f59e0b', // ambre
  '#8b5cf6', // violet
  '#ec4899', // rose
] as const

export interface Team {
  id: string
  name: string
  color: string        // hex (cf. TEAM_PALETTE)
}

// Participant tel qu'exposé aux clients
export interface Participant {
  id: string           // uuid stable, persiste à travers les reconnexions
  pseudo: string
  connected: boolean
  teamId?: string      // mode équipe : équipe du participant (absent = sans équipe)
  manual?: boolean     // mode buzzer : joueur « sans téléphone » géré par l'admin (pas de buzz)
  bonus?: number       // total des ajustements manuels (+/-) appliqués par l'admin
}

// Score d'un participant à un instant T
export interface ParticipantScore {
  participantId: string
  pseudo: string
  score: number        // score cumulé
  delta: number        // points gagnés sur la dernière question
  rank: number
}

// Score d'une équipe (somme des membres) à un instant T
export interface TeamScore {
  teamId: string
  name: string
  color: string
  score: number        // somme des scores cumulés des membres
  delta: number        // somme des points gagnés par les membres sur la dernière question
  rank: number
}

// Question telle qu'envoyée aux participants (sans les bonnes réponses)
export interface QuestionPublic {
  id: string
  text: string
  type: QuestionType
  choices?: string[]   // 'mcq' : les choix · 'ordering' : les items MÉLANGÉS à réordonner
  mediaUrl?: string    // image optionnelle (URL publique https)
  timeLimit: number    // en secondes
  index: number        // position dans le quiz (0-based)
  total: number        // nombre total de questions
  // Mode buzzer (optionnels) : affichés sur la TV / le tél, JAMAIS correctAnswers
  difficulty?: Difficulty
  points?: number      // points de la question (nombre libre ; cf. questionPoints)
  section?: QuestionSection
  ownerName?: string   // section 'perso' : nom du propriétaire du thème (affichage)
  themeName?: string   // section 'perso' : nom d'affichage du thème (masque l'owner)
}

// Question complète (côté serveur uniquement, jamais envoyée aux participants)
export interface Question {
  id: string
  text: string
  type: QuestionType
  choices?: string[]
  correctAnswers: string[]   // plusieurs pour gérer variantes (accents, tirets...)
                             // en mode buzzer : réponse de RÉFÉRENCE (révélation + antisèche admin), jamais auto-corrigée
  timeLimit: number          // override si != defaultTimeLimit
  mediaUrl?: string          // image optionnelle (URL publique https) — buzzer inclus
  // ── Mode buzzer (optionnels, absents = question classique) ──
  difficulty?: Difficulty    // ancien palier (compat) ; points prime dessus
  points?: number            // points de la question (nombre libre, ex. « ultra dur » = 5)
  section?: QuestionSection  // 'perso' | 'culture'
  ownerName?: string         // section 'perso' : le slot joueur propriétaire du thème
  themeName?: string         // section 'perso' : nom d'affichage du thème (TV/téléphones)
}

// Quiz complet
export interface Quiz {
  id: string
  title: string
  defaultTimeLimit: number   // valeur par défaut pour toutes les questions
  questions: Question[]
  createdAt: number          // timestamp
  gameType?: GameType        // 'buzzer' = partie famille · absent/'classic' = Kahoot
}

// État d'une session en cours
export interface Session {
  id: string
  pin: string                // code à 4 chiffres pour rejoindre
  quizId: string
  status: SessionStatus
  currentQuestionIndex: number
  mode: SessionMode          // 'solo' (défaut) ou 'team'
  gameType: GameType         // 'classic' (défaut) ou 'buzzer'
}

// ─────────────────────────────────────────────────────────────
// Rapport de fin de partie (REST: GET /api/sessions/:id/report)
// ─────────────────────────────────────────────────────────────

export interface QuestionReport {
  index: number
  text: string
  type: QuestionType
  correctAnswers: string[]
  answeredCount: number
  correctCount: number
}

export interface PlayerReport {
  participantId: string
  pseudo: string
  score: number
  rank: number
  correct: number // nombre de questions réussies (mcq/free/ordering parfait)
}

export interface GameReport {
  title: string
  totalQuestions: number
  questions: QuestionReport[]
  players: PlayerReport[]
}

// ─────────────────────────────────────────────────────────────
// ÉTAT BUZZER (mode 'buzzer')
// Rediffusé COMPLET à toute la room à chaque changement (patron teams_updated) :
// source de vérité unique → chaque client dérive ses propres affordances
// (puis-je buzzer ? suis-je l'owner ? suis-je bloqué ?) sans booléens par client.
// ─────────────────────────────────────────────────────────────

export type BuzzPhase =
  | 'idle'         // aucune question buzzer ouverte
  | 'owner_oral'   // perso : l'owner répond à l'oral (buzzer désarmé)
  | 'steal'        // vol : buzzer armé (armed=true) ou en attente de réouverture (armed=false)
  | 'locked'       // quelqu'un a buzzé et a la parole (buzzer désarmé)
  | 'revealed'     // question terminée, réponse révélée

export interface BuzzLock {
  participantId: string
  pseudo: string
}

export interface BuzzState {
  phase: BuzzPhase
  armed: boolean                    // le buzzer accepte-t-il un press maintenant ?
  ownerName: string | null          // perso : propriétaire du thème (null en culture)
  ownerParticipantId: string | null // owner résolu vers un participant connecté (binding)
  lockedBy: BuzzLock | null         // qui a la parole (phase 'locked')
  lockedOut: string[]               // participantIds ayant déjà tenté (ne peuvent plus buzzer cette question)
}

// Réponse d'un participant à une question
export interface Answer {
  participantId: string
  questionId: string
  value: string | number
  submittedAt: number        // timestamp serveur
  score: number
  isCorrect: boolean
}
