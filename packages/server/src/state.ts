import type { BuzzState, Difficulty, Quiz, QuestionReport, SessionMode, Team } from '@lya-quiz/shared'
import { getDefaultQuiz, getQuiz } from './quiz-repo.js'
import { logEvent } from './logger.js'

export interface ParticipantState {
  id: string                // uuid stable, identifie le participant
  pseudo: string
  socketId: string          // socket.id courant, change à chaque reconnexion
  sessionToken: string      // uuid stable, stocké dans localStorage client
  connected: boolean
  score: number             // score cumulé
  lastDelta: number         // points gagnés à la dernière question fermée
  correctTotal: number      // nb de questions réussies (pour le rapport de fin)
  disconnectedAt?: number   // timestamp — fenêtre de grâce 30 s du « tous ont répondu »
  teamId?: string           // mode équipe : équipe du participant (absent = sans équipe)
  manual?: boolean          // joueur « sans téléphone » (mode buzzer) — pas d'appareil
  bonus?: number            // total des ajustements manuels (+/-) de l'admin
}

// Réponse en cours d'un participant à la question ouverte
export interface PendingAnswer {
  value: string | number | string[]   // string[] pour le type 'ordering'
  submittedAt: number       // timestamp serveur
}

export interface SessionState {
  id: string
  pin: string
  hostKey: string   // secret du host (retourné par POST /api/sessions, exigé sur host_join)
  status: 'waiting' | 'running' | 'ended'
  participants: Map<string, ParticipantState>    // clé = participantId
  tokenIndex: Map<string, string>                // sessionToken → participantId
  hostSocketIds: Set<string>                     // plusieurs onglets host possibles
  currentQuestionIndex: number                   // -1 = quiz pas encore démarré
  questionStartedAt: number | null               // null = aucune question ouverte
  answers: Map<string, PendingAnswer>            // réponses de la question courante (clé = participantId)
  currentShuffled: string[] | null               // items mélangés de la question 'ordering' en cours
  results: QuestionReport[]                       // historique des questions fermées (rapport de fin)
  // Résultat individuel de la DERNIÈRE question fermée (clé = participantId) —
  // sert à rejouer la révélation à un participant qui reconnecte entre deux
  // questions (session_restored.lastResult). Vidé au démarrage de la suivante.
  lastQuestionResults: Map<string, { gained: number; correct: boolean }> | null
  lastCorrectAnswers: string[] | null            // bonnes réponses de cette même dernière question
  questionTimer: ReturnType<typeof setTimeout> | null
  quiz: Quiz | null   // seedé en mémoire en S4, viendra de la DB en S8
  // Mode équipe (éphémère, par session)
  mode: SessionMode                 // 'solo' (défaut) ou 'team'
  teams: Map<string, Team>          // clé = teamId
  teamsLocked: boolean              // true → les joueurs ne peuvent plus changer d'équipe
  // Mode buzzer (partie famille) — le gameType vit sur session.quiz
  buzz: BuzzState | null            // état de la question buzzer en cours (null = aucune)
  ownerBindings: Map<string, string> // ownerName → participantId (round perso), rebindable
  currentTheme: string | null       // thème en cours (ownerName | CULTURE_THEME | null=sélecteur)
  playedQuestionIndices: Set<number> // index des questions déjà jouées (révélées)
  // Tour par tour : ordre de passage aléatoire tiré au host_start_quiz (mode
  // buzzer avec thèmes perso). Le joueur du tour (order[index]) est le RÉPONDEUR
  // du prochain thème perso lancé, quel que soit le propriétaire du thème.
  // null = pas de tour par tour (quiz culture-only). Avance à chaque thème perso fini.
  buzzTurnOrder: string[] | null    // participantIds mélangés
  buzzTurnIndex: number
  // Dernière révélation buzzer (réponse + scorer) : ré-émise à un host/TV qui se
  // ré-attache en phase 'revealed' — sans ça, une micro-coupure wifi pendant la
  // révélation affichait « Personne n'a trouvé » à tort. Non snapshotée (au
  // restart serveur, la question interrompue est rejouée). Vidée au démarrage
  // de la question suivante.
  lastBuzzReveal: {
    correctAnswers: string[]
    difficulty: Difficulty | null
    scorer: { participantId: string; pseudo: string; points: number } | null
  } | null
}

// Toutes les sessions actives en mémoire
const sessions = new Map<string, SessionState>()

// Index PIN → sessionId pour join rapide
const pinIndex = new Map<string, string>()

export function generatePin(): string {
  // PIN 4 chiffres, pas déjà utilisé
  let pin: string
  do {
    pin = String(Math.floor(1000 + Math.random() * 9000))
  } while (pinIndex.has(pin))
  return pin
}

export function createSession(quizId?: string): SessionState {
  const id = crypto.randomUUID()
  const pin = generatePin()
  const session: SessionState = {
    id,
    pin,
    hostKey: crypto.randomUUID(),
    status: 'waiting',
    participants: new Map(),
    tokenIndex: new Map(),
    hostSocketIds: new Set(),
    currentQuestionIndex: -1,
    questionStartedAt: null,
    answers: new Map(),
    currentShuffled: null,
    results: [],
    lastQuestionResults: null,
    lastCorrectAnswers: null,
    questionTimer: null,
    // S8 : le quiz vient de la DB (quizId explicite, sinon le quiz par défaut).
    quiz: quizId ? getQuiz(quizId) : getDefaultQuiz(),
    mode: 'solo',
    teams: new Map(),
    teamsLocked: false,
    buzz: null,
    ownerBindings: new Map(),
    currentTheme: null,
    playedQuestionIndices: new Set(),
    buzzTurnOrder: null,
    buzzTurnIndex: 0,
    lastBuzzReveal: null,
  }
  sessions.set(id, session)
  pinIndex.set(pin, id)
  logEvent('session_created', { sessionId: id, pin, quizId: session.quiz?.id ?? null })
  return session
}

export function getSessionByPin(pin: string): SessionState | undefined {
  const id = pinIndex.get(pin)
  return id ? sessions.get(id) : undefined
}

export function getSessionById(id: string): SessionState | undefined {
  return sessions.get(id)
}

// Toutes les sessions actives (import statique propre, remplace le placeholder S2)
export function getAllSessions(): SessionState[] {
  return [...sessions.values()]
}

// Ré-enregistre une session reconstruite depuis un snapshot (cf. session-snapshot.ts)
export function restoreSession(session: SessionState): void {
  sessions.set(session.id, session)
  pinIndex.set(session.pin, session.id)
}

// Retire une session de la mémoire (tests de restart ; jamais appelé en prod —
// les sessions vivent jusqu'au restart serveur, c'est assumé pour un usage soirée).
export function deleteSession(id: string): void {
  const session = sessions.get(id)
  if (session) {
    pinIndex.delete(session.pin)
    sessions.delete(id)
  }
}

// NB : pas de purge des participants déconnectés — la fenêtre de reconnexion
// est volontairement ILLIMITÉE (un téléphone qui revient 10 min plus tard
// retrouve son score).
