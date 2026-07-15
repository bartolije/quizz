import type {
  BuzzState,
  BuzzThemesState,
  Difficulty,
  GameType,
  Participant,
  ParticipantScore,
  QuestionPublic,
  Session,
  SessionMode,
  SessionStatus,
  Team,
  TeamScore,
} from './models.js'

// Token de session persistant côté client (localStorage)
// Permet la ré-identification transparente après reconnexion
export type SessionToken = string

// Accusé de réception d'une réponse (callback Socket.io de submit_answer).
// `already_answered` est un succès : la réponse est bien enregistrée côté
// serveur (cas du retry après une coupure où le 1er envoi était passé).
export interface SubmitAnswerAck {
  ok: boolean
  status: 'accepted' | 'already_answered' | 'question_closed' | 'not_in_session' | 'invalid_answer'
}

// ─────────────────────────────────────────────────────────────
// EVENTS CLIENT → SERVEUR
// ─────────────────────────────────────────────────────────────

export interface ClientToServerEvents {
  // Rejoindre une session pour la première fois
  join_session: (payload: {
    pin: string
    pseudo: string
    sessionToken: SessionToken | null   // null à la première connexion
  }) => void

  // Ré-identification automatique après reconnexion Socket.io
  // Envoyé automatiquement par le client sur chaque 'connect' si token présent
  rejoin_session: (payload: {
    sessionToken: SessionToken
  }) => void

  // Participant envoie sa réponse.
  // string : free/mcq · number : closest · string[] : ordering (items réordonnés)
  // `questionIndex` : la question visée — le serveur rejette une réponse retardée
  // (buffer rejoué après reconnexion) qui arriverait après le passage à la suivante.
  // L'ack permet au client d'afficher un état d'envoi fiable + retry (le serveur
  // déduplique par participant → ré-émettre est toujours sûr).
  submit_answer: (
    payload: {
      answer: string | number | string[]
      questionIndex: number
    },
    ack: (res: SubmitAnswerAck) => void,
  ) => void

  // HOST ONLY — passer à la question suivante
  host_next_question: (payload: Record<string, never>) => void

  // HOST ONLY — lancer le quiz (depuis l'écran waiting)
  host_start_quiz: (payload: Record<string, never>) => void

  // HOST ONLY — afficher le classement intermédiaire (entre deux questions)
  host_show_leaderboard: (payload: Record<string, never>) => void

  // HOST ONLY — terminer le quiz manuellement
  host_end_quiz: (payload: Record<string, never>) => void

  // HOST ONLY — éjecter un participant (troll, doublon). Il est retiré de la
  // session (score compris), son token est invalidé, il reçoit quiz_error KICKED.
  host_kick_participant: (payload: { participantId: string }) => void

  // HOST ONLY — filet anti-fausse-manip : annule la DERNIÈRE question fermée
  // (points repris, entrée du rapport retirée) et la relance immédiatement.
  // Disponible entre la révélation et la question suivante uniquement.
  host_replay_last_question: (payload: Record<string, never>) => void

  // HOST ONLY — s'identifier comme host de la session.
  // hostKey : secret retourné par POST /api/sessions (jamais affiché à l'écran).
  // Sans lui, n'importe quel joueur pouvait prendre le contrôle avec le PIN
  // affiché en grand sur la TV. Un PIN inconnu = erreur (plus de création
  // silencieuse de session avec le plus vieux quiz de la base).
  host_join: (payload: {
    pin: string
    hostKey: string
  }) => void

  // TV / écran passif — rejoint une session en LECTURE SEULE via son sessionId
  // (uuid non devinable, résolu par ?session= ou le localStorage de la machine
  // host). Reçoit les mêmes events que le host mais ne peut piloter la partie.
  display_join: (payload: {
    sessionId: string
  }) => void

  // ── MODE ÉQUIPE ──────────────────────────────────────────────
  // HOST ONLY — basculer solo/équipe (uniquement avant le démarrage)
  host_set_mode: (payload: { mode: SessionMode }) => void

  // HOST ONLY — créer une équipe nommée (couleur attribuée par le serveur)
  host_add_team: (payload: { name: string }) => void

  // HOST ONLY — supprimer une équipe (ses membres repassent "sans équipe")
  host_remove_team: (payload: { teamId: string }) => void

  // HOST ONLY — verrouiller/déverrouiller le choix d'équipe par les joueurs
  host_lock_teams: (payload: { locked: boolean }) => void

  // HOST ONLY — (ré)assigner un participant à une équipe (null = retirer)
  host_assign_participant: (payload: {
    participantId: string
    teamId: string | null
  }) => void

  // HOST ONLY — répartir automatiquement les joueurs sans équipe
  host_autobalance_teams: (payload: Record<string, never>) => void

  // PARTICIPANT — rejoindre / quitter une équipe (avant le démarrage, si non verrouillé)
  join_team: (payload: { teamId: string | null }) => void

  // ── MODE BUZZER (partie famille arbitrée) ───────────────────
  // cf. .claude/plan-quiz-famille.md — rien n'est auto-corrigé, l'admin juge.

  // PARTICIPANT — je buzze. Ignoré si le buzzer n'est pas armé, si je suis
  // l'owner (perso) ou si je suis déjà dans lockedOut. Le 1er reçu gagne.
  buzz: (payload: Record<string, never>) => void

  // HOST ONLY — juge le locuteur courant (l'owner en phase 'owner_oral', ou le
  // buzzeur en phase 'locked'). correct=true → il marque les points de difficulté.
  // correct=false en 'owner_oral' → ouvre le vol ; en 'locked' → bloque le
  // buzzeur (lockedOut) et attend host_reopen_buzzer ou host_pass_question.
  host_adjudicate: (payload: { correct: boolean }) => void

  // HOST ONLY — après un vol raté : ré-arme le buzzer pour les autres (le raté
  // reste dans lockedOut).
  host_reopen_buzzer: (payload: Record<string, never>) => void

  // HOST ONLY — personne ne trouve : clôt la question à 0 point (révélation).
  host_pass_question: (payload: Record<string, never>) => void

  // HOST ONLY — round perso : choisir le thème (joueur) à aborder. Les questions
  // 'perso' de cet owner seront servies par host_next_question.
  host_start_theme: (payload: { ownerName: string }) => void

  // HOST ONLY — associer un slot de thème (ownerName) à un participant connecté
  // (binding, écran lobby). null = dissocier. Auto-bind par pseudo par défaut.
  host_assign_owner: (payload: { ownerName: string; participantId: string | null }) => void

  // HOST ONLY — ajouter un joueur « sans téléphone » (participant fantôme géré par
  // l'admin : peut posséder un thème et marquer des points, ne peut pas buzzer).
  host_add_manual_participant: (payload: { pseudo: string }) => void

  // HOST ONLY — ajustement manuel de points (+/-) pour arbitrer un détail.
  host_adjust_score: (payload: { participantId: string; delta: number }) => void
}

// ─────────────────────────────────────────────────────────────
// EVENTS SERVEUR → CLIENT
// ─────────────────────────────────────────────────────────────

export interface ServerToClientEvents {
  // Confirmation de join réussi (première connexion)
  session_joined: (payload: {
    sessionToken: SessionToken       // à stocker dans localStorage
    sessionId: string
    participant: Participant
    participants: Participant[]
    session: Pick<Session, 'status' | 'pin'>
    // Mode équipe (toujours présent → resync à la connexion)
    mode: SessionMode
    teams: Team[]
    teamsLocked: boolean
    // Type de jeu (toujours présent → le client choisit l'UI classique ou buzzer)
    gameType: GameType
    // Envoyé au host/TV uniquement : titre du quiz chargé (le host vérifie d'un
    // coup d'œil qu'il anime le BON quiz — pas celui de démo).
    quizTitle?: string
  }) => void

  // Confirmation de rejoin réussi après reconnexion
  session_restored: (payload: {
    participant: Participant
    participants: Participant[]
    currentQuestion: QuestionPublic | null   // null si entre questions
    timeElapsed: number                       // secondes écoulées sur la question
    alreadyAnswered: boolean                  // le participant a-t-il déjà répondu à la question en cours
    myScore: number
    myRank: number
    // Classement courant — nécessaire pour restaurer le podium / le classement
    // à un participant qui reconnecte hors d'une question ouverte.
    scores: ParticipantScore[]
    // Résultat individuel de la DERNIÈRE question fermée (null si aucune question
    // fermée depuis le début, ou si une question est ouverte). Permet de rejouer
    // la révélation à un joueur qui reconnecte entre deux questions au lieu de
    // le laisser figé sur une question périmée.
    lastResult: {
      correctAnswers: string[]
      myAnswer: string | number | string[] | null
      myCorrect: boolean
      myDelta: number
    } | null
    session: Pick<Session, 'status' | 'pin'>
    // Mode équipe restauré (le participant retrouve son équipe)
    mode: SessionMode
    teams: Team[]
    teamsLocked: boolean
    // Type de jeu restauré
    gameType: GameType
    // Mode buzzer : état buzzer courant (null hors mode buzzer ou question non
    // ouverte) → un tél/host/TV qui reconnecte retrouve buzzer armé/verrouillé,
    // s'il est owner/bloqué, qui a buzzé. Le client dérive ses affordances.
    buzz: BuzzState | null
  }) => void

  // Mode équipe : état complet (re)diffusé à toute la room à chaque changement
  // (toggle mode, ajout/suppression d'équipe, lock, (ré)assignation, join/leave).
  // Source de vérité unique → le client remplace participants + état d'équipe.
  teams_updated: (payload: {
    mode: SessionMode
    teams: Team[]
    locked: boolean
    participants: Participant[]   // avec leur teamId à jour
  }) => void

  // ── MODE BUZZER ──────────────────────────────────────────────
  // Une question buzzer démarre (perso ou culture). Envoyé à toute la room.
  buzz_question_started: (payload: {
    question: QuestionPublic   // text, difficulty, section, ownerName… JAMAIS correctAnswers
    buzz: BuzzState            // état initial (owner_oral en perso, steal armé en culture)
  }) => void

  // État buzzer rediffusé COMPLET à chaque changement (buzz, arbitrage, réouverture…).
  // Source de vérité unique → le client remplace son état et dérive ses affordances.
  buzz_state: (payload: BuzzState) => void

  // Une question buzzer se termine (révélation). scorer = qui a marqué (null si personne).
  buzz_question_ended: (payload: {
    correctAnswers: string[]                 // réponse(s) de référence à révéler
    difficulty: Difficulty | null
    scorer: { participantId: string; pseudo: string; points: number } | null
    scores: ParticipantScore[]               // classement cumulé après cette question
  }) => void

  // Round perso : état des thèmes (attribution owner↔joueur + progression),
  // rediffusé à chaque changement. Sert à l'écran de distribution + au sélecteur
  // de thème du host. (Les participants l'ignorent.)
  buzz_themes: (payload: BuzzThemesState) => void

  // Le statut de la session a changé (host démarre / termine le quiz).
  // Diffusé à toute la room → les deux vues host (control + display) se
  // synchronisent. Les questions elles-mêmes passent par question_started (S4).
  session_status_changed: (payload: {
    status: SessionStatus
  }) => void

  // Un nouveau participant vient de rejoindre (broadcast à tous)
  participant_joined: (payload: {
    participant: Participant
  }) => void

  // Un participant s'est déconnecté
  participant_left: (payload: {
    participantId: string
  }) => void

  // Une question commence
  question_started: (payload: {
    question: QuestionPublic
    startedAt: number    // timestamp serveur (informatif — le client ancre sur SA réception)
    // Secondes déjà écoulées sur cette question : 0 au coup d'envoi normal, > 0
    // quand la question est REJOUÉE à un arrivant tardif ou à un host/TV qui se
    // ré-attache — le client recale son chrono (Date.now() - timeElapsed*1000)
    // au lieu de repartir à la valeur pleine.
    timeElapsed: number
  }) => void

  // Une question se termine
  question_ended: (payload: {
    correctAnswers: string[]
    scores: ParticipantScore[]
    // Répartition des réponses (par choix) — utilisée par la vue TV pour le
    // bar chart de révélation. Vide pour les types non-MCQ.
    distribution: { value: string; count: number }[]
    answeredCount: number   // nombre de réponses reçues (récap)
    correctCount: number    // nombre de bonnes réponses (mcq/free) / ordre parfait (ordering)
    myAnswer: string | number | string[] | null
    myCorrect: boolean   // correcte (mcq/free) ou ordre parfait (ordering) ; false pour closest
    myScore: number
    myDelta: number
    // Mode équipe uniquement : classement des équipes après cette question
    teamScores?: TeamScore[]
    // Copie host/TV uniquement : image de la PROCHAINE question, préchargée par
    // la TV pendant la révélation (sinon TV + 80 téléphones la téléchargent au
    // coup d'envoi, chrono déjà lancé). Jamais envoyée aux participants
    // (l'image peut trahir la question suivante).
    nextMediaUrl?: string
  }) => void

  // HOST ONLY — un participant a répondu (pas la réponse, juste l'ack)
  answer_received: (payload: {
    participantId: string
    pseudo: string
    answeredCount: number
    totalCount: number
  }) => void

  // Leaderboard affiché entre deux questions ou à la fin
  leaderboard_update: (payload: {
    scores: ParticipantScore[]
    final: boolean               // true = fin du quiz
    // Mode équipe uniquement : classement des équipes
    teamScores?: TeamScore[]
  }) => void

  // Erreur métier (pin invalide, pseudo déjà pris, session terminée...)
  quiz_error: (payload: {
    code: 'INVALID_PIN' | 'PSEUDO_TAKEN' | 'INVALID_PSEUDO' | 'SESSION_ENDED' | 'SESSION_FULL' | 'INVALID_TOKEN' | 'INVALID_HOST_KEY' | 'KICKED' | 'UNKNOWN'
    message: string
  }) => void
}

// ─────────────────────────────────────────────────────────────
// NOMS D'EVENTS — la seule source de vérité pour les strings
// Importer depuis ici, ne jamais écrire les strings en dur ailleurs
// ─────────────────────────────────────────────────────────────

export const EVENTS = {
  // Client → Serveur
  JOIN_SESSION:       'join_session',
  REJOIN_SESSION:     'rejoin_session',
  SUBMIT_ANSWER:      'submit_answer',
  HOST_NEXT_QUESTION:    'host_next_question',
  HOST_START_QUIZ:       'host_start_quiz',
  HOST_SHOW_LEADERBOARD: 'host_show_leaderboard',
  HOST_END_QUIZ:         'host_end_quiz',
  HOST_JOIN:             'host_join',
  DISPLAY_JOIN:          'display_join',
  HOST_KICK_PARTICIPANT:     'host_kick_participant',
  HOST_REPLAY_LAST_QUESTION: 'host_replay_last_question',

  // Mode équipe
  HOST_SET_MODE:            'host_set_mode',
  HOST_ADD_TEAM:            'host_add_team',
  HOST_REMOVE_TEAM:         'host_remove_team',
  HOST_LOCK_TEAMS:          'host_lock_teams',
  HOST_ASSIGN_PARTICIPANT:  'host_assign_participant',
  HOST_AUTOBALANCE_TEAMS:   'host_autobalance_teams',
  JOIN_TEAM:                'join_team',

  // Mode buzzer
  BUZZ:                'buzz',
  HOST_ADJUDICATE:     'host_adjudicate',
  HOST_REOPEN_BUZZER:  'host_reopen_buzzer',
  HOST_PASS_QUESTION:  'host_pass_question',
  HOST_START_THEME:    'host_start_theme',
  HOST_ASSIGN_OWNER:   'host_assign_owner',
  HOST_ADD_MANUAL_PARTICIPANT: 'host_add_manual_participant',
  HOST_ADJUST_SCORE:           'host_adjust_score',

  // Serveur → Client
  SESSION_JOINED:         'session_joined',
  SESSION_RESTORED:       'session_restored',
  SESSION_STATUS_CHANGED: 'session_status_changed',
  TEAMS_UPDATED:          'teams_updated',
  BUZZ_QUESTION_STARTED:  'buzz_question_started',
  BUZZ_STATE:             'buzz_state',
  BUZZ_QUESTION_ENDED:    'buzz_question_ended',
  BUZZ_THEMES:            'buzz_themes',
  PARTICIPANT_JOINED:     'participant_joined',
  PARTICIPANT_LEFT:   'participant_left',
  QUESTION_STARTED:   'question_started',
  QUESTION_ENDED:     'question_ended',
  ANSWER_RECEIVED:    'answer_received',
  LEADERBOARD_UPDATE: 'leaderboard_update',
  QUIZ_ERROR:         'quiz_error',
} as const

export type EventName = typeof EVENTS[keyof typeof EVENTS]
