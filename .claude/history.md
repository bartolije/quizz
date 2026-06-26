# Historique — LYA QUIZ

Le projet a été construit par étapes « S1 → S13 » (briefs originellement dans
`rules/`, supprimés une fois intégrés ici), puis enrichi de features UX. Résumé de
ce qui existe et pourquoi.

## Étapes structurantes

| Étape | Contenu |
|---|---|
| **S1** | Scaffold monorepo (shared/server/client), contrat d'events TypeScript complet, utilitaires scoring/normalisation, stubs serveur & client. |
| **S2** | Sessions en mémoire + PIN, rooms Socket.io, flow join/rejoin, lobby temps réel, **reconnexion transparente par token** (ré-identification auto sur `connect`). |
| **S3** | Vues host : `/host/control` (création session + PIN + QR + participants live + bouton Démarrer) et `/host/display` (TV passive). Synchro via `session_status_changed`. `GET /api/sessions/:id` pour bootstrap de la TV. |
| **S4** | Boucle de jeu MCQ : `question_started`, timer synchronisé, `submit_answer`, scoring vitesse, fermeture auto (timer ou tous répondu), révélation + distribution. |
| **S5** | Scoring cumulé + leaderboard (rang/ex æquo, delta, mouvements ↑/↓), classement intermédiaire + podium final. |
| **S6** | Saisie libre (normalisation + Levenshtein) & numérique « au plus proche » (scoring dégressif). |
| **S7** | Robustesse (priorité #1) : reconnexion **en pleine question** (`session_restored` restaure question + temps restant + réponse), `host_end_quiz`, reprise host. |
| **S8** | Persistance SQLite (Drizzle) + éditeur `/admin` (CRUD quiz, protégé par `ADMIN_PASSWORD`). `POST /api/sessions { quizId }`. Auto-détection du Volume Railway. |
| **S9** | Déploiement **single-service Railway** : le serveur Fastify sert aussi le build client + l'API + le WebSocket sur une seule URL. SQLite sur Volume. |
| **S10** | Observabilité : logs serveur structurés par événement (pino), robustesse des handlers (`safe()`), remontée des erreurs client (`POST /api/client-log` + ErrorBoundary). |
| **S11** | Type de question **« remettre dans l'ordre »** (ordering). |
| **S12** | Rapport de fin de partie (stats par question + export CSV) : `GET /api/sessions/:id/report`, `ReportView`. |
| **S13** | Images dans les questions (URL publique https, affichage propre) : `QuestionImage`, champ `mediaUrl`. |

## Features UX & divers (après S10)

- Classement **optionnel** côté host (slide à la demande via `host_show_leaderboard`)
  au lieu d'être imposé après chaque question.
- Timer « pression » (≤ 5 s) + vibrations optionnelles (`TimePressure`, `haptics.ts`).
- **Reprise automatique au rechargement** sans re-saisir le PIN (token localStorage).
- Récap des réponses enrichi à la révélation.
- Son / musique sur la TV (fichiers libres de droits ; `sound.ts`, `useHostSound`).
- Admin : import/export JSON des quiz + classement plus visible.
- Indicateur de version (build SHA + date, `BuildBadge`) + `index.html` no-cache.

## Corrections notables

- **fix participant (tri par ordre + bouton d'action)** : `<QuestionPage>` remonté
  par `key={question.index}` (état neuf à chaque question) + layout viewport fixe
  (`100dvh`) avec contenu scrollable et bouton « Valider » toujours visible.
  Détail et contexte : [known-issues.md](known-issues.md).

> Pour le détail d'un commit : `git log --oneline` puis `git show <sha>`.
