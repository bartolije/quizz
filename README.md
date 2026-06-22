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
  → `host_start_quiz` (statut `running`). `GET /api/sessions/:id` pour résoudre
  une session depuis `/host/display?session=XXXX`.
- S4 — questions, timer, affichage des réponses (toujours en mémoire).
- S8 — DB (Drizzle + better-sqlite3), éditeur de quiz.

### Routes client

| Route            | Vue                                                  |
| ---------------- | ---------------------------------------------------- |
| `/` `/join`      | Join participant (PIN pré-rempli via `?pin=`)        |
| `/lobby`         | Lobby participant (temps réel)                       |
| `/host/control`  | Écran de contrôle host (Mac)                         |
| `/host/display`  | Écran TV (passif, lisible à distance)                |

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
