# LYA QUIZ

Application de quiz multijoueur en temps réel. Un host lance un quiz depuis son
Mac (TV + écran de contrôle), les participants rejoignent depuis leur téléphone
via un PIN + pseudo. Questions chronométrées, scoring, leaderboard.

> **Priorité du projet : la stabilité WebSocket.** La reconnexion transparente
> est la feature principale — chaque participant retrouve automatiquement son
> état (question en cours, score) si son téléphone perd le réseau 2-3 secondes.

## Stack

- Node.js 20 · TypeScript strict (`strict`, `noUncheckedIndexedAccess`)
- Fastify 4 · Socket.io 4
- React 18 · Vite 5 · Tailwind CSS 3 · Zustand
- Drizzle ORM + better-sqlite3 (S2+)

## Architecture (monorepo npm workspaces)

```
lya-quiz/
├── packages/
│   ├── shared/   types, contrat d'events Socket.io, scoring, config WS
│   ├── server/   Fastify + Socket.io (stub en S1)
│   └── client/   React + Vite (stub en S1)
```

**Règle absolue :** aucune string d'event Socket.io en dur hors de
`packages/shared/src/events.ts`. Client et serveur importent toujours depuis
`@lya-quiz/shared`.

## Démarrage

```bash
npm install        # installe + build le package shared

npm run typecheck  # vérifie les 3 packages (TS strict)
npm run dev        # lance serveur (:3001) + client (:5173) en parallèle

# ou séparément :
npm run dev:server # http://localhost:3001  (GET /health → {"status":"ok"})
npm run dev:client # http://localhost:5173
```

## État d'avancement

- **S1 ✅** — monorepo qui compile, contrat d'events TypeScript complet,
  utilitaires de scoring/normalisation, stubs serveur & client.
- **S2 ✅** — sessions en mémoire + PIN, rooms Socket.io, flow join/rejoin,
  lobby temps réel, **reconnexion transparente par token** (re-identification
  automatique sur `connect`). Pages participant (join + lobby), store Zustand.
- **S3 ✅** — vues host `/host/control` (création session + PIN + QR code +
  participants temps réel + bouton Démarrer) et `/host/display` (TV, synchro
  via la même room). Routing react-router, QR code (`qrcode`), bouton Démarrer
  → `host_start_quiz` → broadcast `session_status_changed` (statut `running`)
  qui synchronise les deux vues host en temps réel. `GET /api/sessions/:id`
  pour résoudre une session depuis `/host/display?session=XXXX`.
- **S4 ✅** — boucle de jeu MCQ : questions, timer synchronisé, `submit_answer`,
  scoring vitesse, fermeture auto (timer ou tous répondu), révélation + distribution.
- **S5 ✅** — scoring cumulé + leaderboard (rang/ex æquo, delta, mouvements ↑/↓),
  classement intermédiaire + podium final.
- **S6 ✅** — saisie libre (normalisation + Levenshtein) & numérique « au plus
  proche » (scoring dégressif). Les 3 types de questions sont jouables.
- **S7 ✅** — robustesse : reconnexion en pleine question (`session_restored`
  restaure question + temps restant + réponse), `host_end_quiz`, reprise host.
- **S8 ✅** — persistance SQLite (Drizzle) + éditeur `/admin` (CRUD quiz des 3
  types, protégé par `ADMIN_PASSWORD`). `POST /api/sessions { quizId }`.
- **S9 ✅** — déploiement **single-service Railway** : le serveur Fastify sert
  aussi le build client (`@fastify/static` + fallback SPA), l'API et le WebSocket
  sur une seule URL. SQLite sur Volume Railway. Tuto : [rules/S9.md](rules/S9.md).
- **S10 ✅** — observabilité : logs serveur structurés par événement (pino, lus
  dans Railway), robustesse des handlers, remontée des erreurs client
  (`POST /api/client-log` + ErrorBoundary). Brief : [rules/S10.md](rules/S10.md).

### Routes client

| Route            | Vue                                                  |
| ---------------- | ---------------------------------------------------- |
| `/` `/join`      | Join participant (PIN pré-rempli via `?pin=`)        |
| `/lobby`         | Lobby participant (temps réel)                       |
| `/host/control`  | Écran de contrôle host (Mac)                         |
| `/host/display`  | Écran TV (passif, lisible à distance)                |
| `/admin`         | Éditeur de quiz (protégé par mot de passe)           |

### Flow temps réel (S2)

- `POST /api/sessions` → crée une session, renvoie `{ pin, sessionId }`.
- Participant : `join_session` (PIN + pseudo) → `session_joined` (+ token localStorage).
- Reconnexion : sur chaque `connect`, le client ré-émet `rejoin_session` avec son
  token → `session_restored` (même `participantId`, score conservé).
- Lobby : `participant_joined` / `participant_left` diffusés à toute la room.

## Scripts

| Script              | Effet                                              |
| ------------------- | -------------------------------------------------- |
| `npm run dev`       | serveur + client en parallèle                      |
| `npm run dev:server`| serveur Fastify + Socket.io seul                   |
| `npm run dev:client`| client Vite seul                                   |
| `npm run build`     | build shared → server → client                     |
| `npm run typecheck` | `tsc --noEmit` sur les 3 packages                  |
