# Contrat d'events Socket.io — LYA QUIZ

> **Source de vérité unique : `packages/shared/src/events.ts`.** Ce fichier en est
> le miroir lisible — en cas de doute, le `.ts` fait foi. Ne jamais écrire une
> string d'event en dur : importer `EVENTS` depuis `@lya-quiz/shared`.

## Client → Serveur (`ClientToServerEvents`)

| Event (`EVENTS.*`) | string | Payload | Qui |
|---|---|---|---|
| `JOIN_SESSION` | `join_session` | `{ pin, pseudo, sessionToken: string\|null }` | participant (1er join, token `null`) |
| `REJOIN_SESSION` | `rejoin_session` | `{ sessionToken }` | participant — **auto-émis sur chaque `connect`** |
| `SUBMIT_ANSWER` | `submit_answer` | `{ answer: string\|number\|string[], questionIndex }` + **ack** `SubmitAnswerAck` | participant (string=mcq/free · number=closest · string[]=ordering). L'ack (`accepted`/`already_answered`/`question_closed`/`not_in_session`) permet l'envoi fiable avec retry (`submit-answer.ts`) ; `questionIndex` protège contre une réponse retardée comptée pour la question suivante |
| `HOST_JOIN` | `host_join` | `{ pin, hostKey }` | host (control). `hostKey` = secret retourné par `POST /api/sessions` — le PIN public ne suffit plus ; PIN inconnu = erreur (plus de création implicite) |
| `DISPLAY_JOIN` | `display_join` | `{ sessionId }` | TV/écran passif, lecture seule (jamais dans `hostSocketIds`) |
| `HOST_START_QUIZ` | `host_start_quiz` | `{}` | host |
| `HOST_NEXT_QUESTION` | `host_next_question` | `{}` | host |
| `HOST_SHOW_LEADERBOARD` | `host_show_leaderboard` | `{}` | host (classement intermédiaire) |
| `HOST_END_QUIZ` | `host_end_quiz` | `{}` | host |
| `HOST_KICK_PARTICIPANT` | `host_kick_participant` | `{ participantId }` | host — éjecte (score retiré, token invalidé, l'éjecté reçoit `quiz_error KICKED`) |
| `HOST_REPLAY_LAST_QUESTION` | `host_replay_last_question` | `{}` | host — annule les points de la dernière question fermée et la relance aussitôt |
| `HOST_SET_MODE` | `host_set_mode` | `{ mode: 'solo'\|'team' }` | host (waiting only) |
| `HOST_ADD_TEAM` | `host_add_team` | `{ name }` | host (waiting only) |
| `HOST_REMOVE_TEAM` | `host_remove_team` | `{ teamId }` | host (waiting only) |
| `HOST_LOCK_TEAMS` | `host_lock_teams` | `{ locked }` | host |
| `HOST_ASSIGN_PARTICIPANT` | `host_assign_participant` | `{ participantId, teamId: string\|null }` | host |
| `HOST_AUTOBALANCE_TEAMS` | `host_autobalance_teams` | `{}` | host |
| `JOIN_TEAM` | `join_team` | `{ teamId: string\|null }` | participant (waiting, non verrouillé) |

## Serveur → Client (`ServerToClientEvents`)

| Event (`EVENTS.*`) | string | Payload (résumé) | Destinataire |
|---|---|---|---|
| `SESSION_JOINED` | `session_joined` | `{ sessionToken, sessionId, participant, participants, session }` | l'émetteur du join |
| `SESSION_RESTORED` | `session_restored` | `{ participant, participants, currentQuestion\|null, timeElapsed, alreadyAnswered, myScore, myRank, session }` | l'émetteur du rejoin |
| `SESSION_STATUS_CHANGED` | `session_status_changed` | `{ status }` | toute la room (synchro control + TV) |
| `PARTICIPANT_JOINED` | `participant_joined` | `{ participant }` | toute la room |
| `PARTICIPANT_LEFT` | `participant_left` | `{ participantId }` | toute la room |
| `QUESTION_STARTED` | `question_started` | `{ question: QuestionPublic, startedAt }` | toute la room |
| `QUESTION_ENDED` | `question_ended` | `{ correctAnswers, scores, distribution, answeredCount, correctCount, myAnswer, myCorrect, myScore, myDelta }` | toute la room |
| `ANSWER_RECEIVED` | `answer_received` | `{ participantId, pseudo, answeredCount, totalCount }` | host (ack, **pas** la réponse) |
| `LEADERBOARD_UPDATE` | `leaderboard_update` | `{ scores, final }` | toute la room (`final:true` = podium) |
| `QUIZ_ERROR` | `quiz_error` | `{ code, message }` | l'émetteur |
| `TEAMS_UPDATED` | `teams_updated` | `{ mode, teams: Team[], locked, participants: Participant[] }` | toute la room (état équipe complet) |

> Mode équipe : `session_joined` / `session_restored` embarquent aussi `mode`, `teams`,
> `teamsLocked` ; `question_ended` et `leaderboard_update` portent un `teamScores?` présent
> uniquement quand `mode === 'team'`. Détail : [architecture.md](architecture.md#mode-équipe).

## Events du mode buzzer (partie famille arbitrée)

Client → serveur :

| Constante | Event | Payload | Notes |
|---|---|---|---|
| `BUZZ` | `buzz` | `{}` | ignoré si non armé, owner du thème, ou déjà `lockedOut` ; le 1er reçu gagne |
| `HOST_ADJUDICATE` | `host_adjudicate` | `{ correct }` | juge l'owner (`owner_oral`) ou le buzzeur (`locked`). `correct:true` sur un thème **non attribué** est refusé |
| `HOST_REOPEN_BUZZER` | `host_reopen_buzzer` | `{}` | après un vol raté : ré-arme pour les autres |
| `HOST_PASS_QUESTION` | `host_pass_question` | `{}` | clôt la question à 0 point |
| `HOST_START_THEME` | `host_start_theme` | `{ ownerName }` | choisit le thème à jouer (round perso ou culture) |
| `HOST_ASSIGN_OWNER` | `host_assign_owner` | `{ ownerName, participantId\|null }` | binding thème→joueur ; `participantId` inconnu ignoré ; re-résout l'owner en `owner_oral` **et** `steal` |
| `HOST_ADD_MANUAL_PARTICIPANT` | `host_add_manual_participant` | `{ pseudo }` | joueur « sans téléphone » ; mode buzzer uniquement, pseudo unique, 20 chars max |
| `HOST_ADJUST_SCORE` | `host_adjust_score` | `{ participantId, delta }` | delta clampé ±1000 |

Serveur → client :

| Constante | Event | Payload | Destinataires |
|---|---|---|---|
| `BUZZ_QUESTION_STARTED` | `buzz_question_started` | `{ question: QuestionPublic, buzz: BuzzState }` | room ; **rejoué** au retardataire, au participant qui rejoint/reload en pleine question, et au host/TV qui se ré-attache |
| `BUZZ_STATE` | `buzz_state` | `BuzzState \| null` | room, rediffusé complet à chaque changement (`null` = retour sélecteur) |
| `BUZZ_QUESTION_ENDED` | `buzz_question_ended` | `{ correctAnswers, difficulty, scorer, scores }` | room ; **rejoué** au host/TV qui se ré-attache en phase `revealed` (`lastBuzzReveal`) |
| `BUZZ_THEMES` | `buzz_themes` | `BuzzThemesState` | room (progression + bindings des thèmes) |

> `session_restored` embarque aussi `buzz` (état courant, `null` en classic) — et le
> serveur fait suivre un `buzz_question_started` si une question buzzer est ouverte.

### Codes d'erreur (`quiz_error.code`)

`INVALID_PIN` · `PSEUDO_TAKEN` · `SESSION_ENDED` · `SESSION_FULL` · `INVALID_TOKEN` · `UNKNOWN`

Côté participant, `INVALID_TOKEN` et `SESSION_ENDED` purgent le token localStorage
et renvoient vers `/join` (cf. `ParticipantApp`).

## Notes de contrat

- `QUESTION_STARTED.startedAt` est un timestamp **serveur**, mais le client ancre son
  timer sur **son propre `Date.now()`** à la réception (anti-skew d'horloge).
- `QUESTION_ENDED.distribution` ne sert qu'au bar chart TV ; vide pour les types non-MCQ.
- `myCorrect` = bonne réponse (mcq/free) **ou** ordre parfait (ordering) ; toujours
  `false` pour `closest` (il n'y a pas de « juste/faux », juste un score de proximité).
- Les payloads des events host sont `Record<string, never>` (objet vide typé) — ne
  rien y mettre.
