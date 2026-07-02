# Architecture — LYA QUIZ

## Vue d'ensemble

Monorepo npm workspaces à 3 packages. `shared` est importé par `server` et `client`
sous le nom `@lya-quiz/shared` et **doit être buildé avant** (les scripts le font).

```
quizz/
├── packages/
│   ├── shared/   types, contrat d'events Socket.io, scoring, normalisation, config WS
│   ├── server/   Fastify + Socket.io, handlers, état en mémoire, persistance SQLite
│   └── client/   React + Vite : pages participant / host / admin, store Zustand
├── CLAUDE.md     mémoire projet (auto-chargée)
└── .claude/      doc détaillée (ce dossier)
```

## packages/shared

La **source de vérité partagée**. Tout ce qui doit être identique entre client et
serveur vit ici.

| Fichier | Contenu |
|---|---|
| `events.ts` | `EVENTS` (strings d'events — **seule source autorisée**), interfaces `ClientToServerEvents` / `ServerToClientEvents` typant chaque payload |
| `models.ts` | `Participant`, `ParticipantScore`, `QuestionPublic` (sans réponses), `Question`/`Quiz`/`Session` (serveur), types de rapport (`GameReport`…) |
| `scoring.ts` | `calculateScore` (vitesse, 0–1000 linéaire), `calculateClosestScore` (numérique dégressif), `normalizeAnswer` + `levenshtein` + `isCorrectFreeAnswer` (saisie libre tolérante) |
| `socket-config.ts` | `SOCKET_CLIENT_CONFIG`, `SOCKET_SERVER_CONFIG`, `SESSION_TOKEN_TTL_MS` |

### Types de questions (`QuestionType`)

- `mcq` — choix multiples (énoncé sur la TV, boutons couleur sur le tél)
- `free` — saisie libre (normalisation + Levenshtein ≤ 2 pour tolérer les fautes)
- `closest` — numérique « au plus proche » (scoring dégressif vs l'écart max observé)
- `ordering` — remettre des items dans le bon ordre (`choices` = items **mélangés** ;
  réponse = `string[]` réordonné ; `myCorrect` = ordre parfait)

`QuestionPublic.choices` sert à deux choses selon le type : les choix MCQ, ou les
items à réordonner. Jamais les bonnes réponses (`correctAnswers` reste côté serveur).

## packages/server

Point d'entrée : `src/index.ts`. Fastify et Socket.io **partagent le même serveur
HTTP** (`new Server(app.server, …)`) → un seul port pour HTTP + WebSocket.

| Fichier | Rôle |
|---|---|
| `index.ts` | bootstrap, branchement des handlers Socket.io, routes REST, service du build client, fallback SPA |
| `state.ts` | état **en mémoire** : sessions, participants, PIN ↔ session, tokens |
| `handlers/join.ts` | `join_session` (1er join) + `rejoin_session` (reconnexion par token) |
| `handlers/host.ts` | `host_join`, `host_start_quiz`, `host_end_quiz` |
| `handlers/game.ts` | `host_next_question`, `submit_answer`, `host_show_leaderboard` (boucle de jeu, scoring, fermeture de question) |
| `handlers/disconnect.ts` | déconnexion → marque le participant `connected:false`, garde l'état le temps du TTL |
| `session-helpers.ts` | dérivations : liste participants, leaderboard |
| `db.ts` | better-sqlite3 + schéma Drizzle, création idempotente des tables |
| `quiz-repo.ts` | CRUD quiz (utilisé par l'admin) + `seedIfEmpty` |
| `seed-quiz.ts` | quiz par défaut injecté si la base est vide |
| `logger.ts` | logs structurés par événement (pino), `logWarn` / `logError` |

Les sessions de jeu vivent **en mémoire** (rapidité) avec un **snapshot SQLite**
(`session-snapshot.ts`, table `session_snapshots`) sauvegardé aux transitions clés
(join, début/fin de question, statut, équipes) et restauré au boot : un restart ne
perd plus les parties (tokens valides → reconnexion transparente ; la question
ouverte au moment du crash est rejouée). Les **quiz** (contenu éditable) sont
persistés à part (`quizzes`/`questions`).

### Robustesse serveur

- Chaque handler Socket.io est enveloppé dans `safe()` : une exception est loggée
  (`handler_error`) et renvoyée au client en `quiz_error` au lieu de planter le process.
- `uncaughtException` / `unhandledRejection` sont loggés (`fatal_*`).

## packages/client

React + Vite, routing react-router. Store global **Zustand** (`store/quiz-store.ts`).

### Routes

| Route | Vue |
|---|---|
| `/` `/join` | Join participant (PIN pré-rempli via `?pin=`) |
| `/lobby` | Shell participant (`ParticipantApp`) — bascule la vue selon l'état du jeu |
| `/host/control` | Écran de contrôle host (Mac) |
| `/host/display` | Écran TV passif (lisible à distance) |
| `/admin` | Éditeur de quiz (protégé par mot de passe) |

`ParticipantApp` est monté sur `/lobby` : il branche les events temps réel
(`useParticipantEvents`), gère la reprise au reload, et `switch` sur
`currentView` (`lobby` / `question` / `answer` / `leaderboard` / `ended`).

> ⚠️ `<QuestionPage>` est monté avec `key={question.index}` pour **repartir d'un
> état neuf à chaque question** (`order`, `text` sont en `useState`). Sans cette
> key, le tri par ordre repartait avec les choix de la question précédente.
> Voir [known-issues.md](known-issues.md).

### Fichiers clés client

| Fichier | Rôle |
|---|---|
| `socket.ts` | instance Socket.io (autoConnect off) + ré-émission auto de `rejoin_session` sur chaque `connect` |
| `config.ts` | `SERVER_URL` : vide en dev (same-origin + proxy Vite), URL absolue en prod via `VITE_SERVER_URL` |
| `store/quiz-store.ts` | état du jeu + actions (`onQuestionStarted`, `onQuestionEnded`, `onSessionRestored`…) |
| `hooks/useParticipantEvents.ts` | abonnement aux events serveur → mise à jour du store |
| `hooks/useRemaining.ts` | timer dérivé de `questionStartedAt` (ancré sur l'horloge **client**, anti-skew) |
| `pages/QuestionPage.tsx` | rendu de la question selon le type (mcq/free/closest/ordering) |
| `components/OrderingList.tsx` | liste réordonnable `ordering` : glisser-déposer (`@dnd-kit`, poignée ⠿) + boutons ↑/↓ en fallback |

## Flux temps réel

### Join & lobby
1. `POST /api/sessions { quizId? }` → `{ pin, sessionId }` (host).
2. Participant : `join_session { pin, pseudo, sessionToken:null }` →
   `session_joined { sessionToken, participant, participants, … }`. Le client
   stocke le token dans `localStorage` (`lya_quiz_token`).
3. `participant_joined` / `participant_left` diffusés à toute la room (lobby live).

### Boucle de jeu
1. Host : `host_start_quiz` → `session_status_changed { running }` (synchro control + TV).
2. `host_next_question` → `question_started { question, startedAt }` à toute la room.
   Le client ancre le timer sur l'horloge **client** à la réception (anti-skew serveur).
3. Participant : `submit_answer { answer }`. Le host reçoit `answer_received` (ack, pas la réponse).
4. Fin de question (timer écoulé **ou** tous ont répondu) → `question_ended`
   (bonnes réponses, scores, distribution pour le bar chart TV, récap perso).
5. `host_show_leaderboard` → `leaderboard_update { scores, final:false }` (classement intermédiaire).
6. `host_end_quiz` ou dernière question → `leaderboard_update { final:true }` (podium).

### <a name="reconnexion"></a>Reconnexion transparente (la feature centrale)
- `socket.ts` ré-émet automatiquement `rejoin_session { sessionToken }` à **chaque**
  event `connect` Socket.io (cycle de vie, pas métier).
- Le serveur répond `session_restored` avec : même `participantId`, participants,
  **question en cours** (`currentQuestion`), `timeElapsed` (→ le client recale le
  timer : `questionStartedAt = Date.now() - timeElapsed*1000`), `alreadyAnswered`,
  `myScore`, `scores` (classement courant) et `lastResult` (résultat individuel de
  la dernière question fermée). Hors question ouverte, le client bascule sur la
  bonne vue : révélation si la question affichée est périmée, podium si le quiz
  s'est terminé pendant la coupure, vue conservée pour un simple blip.
- Reprise au **reload complet** (store vidé mais token présent) : `ParticipantApp`
  reconnecte le socket ; `session_restored` repeuple identité + état. On ne renvoie
  vers `/join` QUE si le serveur dit `INVALID_TOKEN` / `SESSION_ENDED`. Pas de
  timeout : si le serveur est lent, Socket.io retente (`reconnectionAttempts: Infinity`).
- **Host & TV** : `useHostSession` ré-émet `host_join { pin }` à **chaque** event
  `connect` (pas seulement le premier — un `once` historique laissait boutons morts
  et TV figée après une micro-coupure, cf. audit-2026-07). Le serveur re-répond
  `session_joined` + `question_started` si une question est ouverte. Un bandeau
  `ConnectionBanner` s'affiche sur les vues host pendant une coupure.
- Côté config WS : `pingInterval 10s` / `pingTimeout 10s` (détecte les zombies
  sans faux positifs sur wifi saturé), `tryAllTransports: true` (vrai fallback
  polling si le réseau bloque les WebSockets),
  reconnexion 500ms→2s avec `randomizationFactor 0.3` (évite que N téléphones
  reconnectent en même temps). NB : `SESSION_TOKEN_TTL_MS` et
  `cleanupDisconnectedParticipants` ne sont branchés nulle part — la fenêtre de
  reprise est en pratique **illimitée** (voulu : personne ne perd son score).

## API REST (serveur)

| Route | Usage |
|---|---|
| `POST /api/sessions { quizId? }` | crée une session → `{ pin, sessionId }` |
| `GET /api/sessions/:id` | résout une session (bootstrap `/host/display?session=XXXX`) |
| `GET /api/sessions/:id/report` | rapport de fin (stats par question + classement) |
| `POST /api/client-log` | remontée des erreurs JS des téléphones → logs serveur (S10) |
| `GET /health` | `{ status, sessions, build }` (healthcheck Railway) |
| `*/api/admin/*` | CRUD quiz, protégé par header `x-admin-password` |

Toute autre route GET (non `/api`, non `/socket.io`) renvoie `index.html` (SPA fallback).
`index.html` est servi en `cache-control: no-cache` → un nouveau déploiement est pris
en compte sans hard-refresh (les assets JS/CSS sont hashés donc immuables).

## Scoring (rappel)

- **Vitesse** (mcq/free/ordering) : `1000 * (timeLimit - elapsed) / timeLimit`,
  arrondi, borné 0–1000. Répondre vite = plus de points.
- **closest** : le plus proche reçoit 1000 ; les autres `1000 * (1 - écart/écartMax)`,
  où `écartMax` = plus grand écart observé parmi les participants.
- **free** : `normalizeAnswer` (trim, lowercase, sans accents/tirets/apostrophes/espaces)
  puis égalité exacte OU Levenshtein ≤ 2 (tolère les fautes de frappe).

## Mode équipe

Couche optionnelle **par-dessus** la boucle de jeu (qui ne change pas). Les équipes
sont **éphémères, par session, en mémoire** — aucune persistance DB.

- **Modèle** (`shared/models.ts`) : `SessionMode 'solo'|'team'`, `Team {id,name,color}`,
  `teamId?` sur `Participant`, `TeamScore`. Couleurs = hex de `TEAM_PALETTE`, appliquées
  en **style inline** côté client (pas de classe Tailwind dynamique → pas de purge).
- **État serveur** (`state.ts`) : `mode`, `teams: Map`, `teamsLocked` sur la session ;
  `teamId?` sur le participant.
- **Handlers** (`handlers/team.ts`) : `host_set_mode`, `host_add_team`, `host_remove_team`,
  `host_lock_teams`, `host_assign_participant`, `host_autobalance_teams`, `join_team`.
  Chaque mutation rediffuse `teams_updated` (état complet) à toute la room.
- **Scoring** (`session-helpers.getTeamLeaderboard`) : score d'équipe = somme des
  scores des membres ; delta d'équipe sur une question = somme des deltas des membres.
  Les joueurs sans équipe ne comptent pour personne. `teamScores` est injecté dans
  `question_ended` et `leaderboard_update` quand `mode === 'team'`.
- **Garde-fous** : changement de mode / création d'équipe / `join_team` uniquement en
  `status === 'waiting'` (sinon le scoring cumulé deviendrait incohérent). Le host peut
  (ré)assigner / verrouiller à tout moment.
- **Reconnexion** : `session_joined` / `session_restored` embarquent `mode`, `teams`,
  `teamsLocked` (+ `participant.teamId`) → le joueur retrouve son équipe.
- **Client** : store (`mode/teams/teamsLocked/myTeamId/teamLeaderboard` + `onTeamsUpdated`),
  composants `TeamPicker` (lobby), `HostTeamPanel` (host waiting : toggle, création,
  verrou, auto-répartition, **attribution en glisser-déposer** via `@dnd-kit` — zones
  de dépôt par équipe + "sans équipe", pastilles joueurs déplaçables, ✕ pour retirer),
  `TeamStandings` (classement réutilisable téléphone + TV). Pages lobby/host/TV/classements
  ont une variante équipe.
- **Contribution par question** : après chaque question, `teamScores[].delta` = points
  gagnés par l'équipe sur CETTE question. Affiché sur la TV (rangée de pastilles "Équipe
  +delta" sous la révélation) et côté participant (carte de son équipe dans `AnswerPage`).
