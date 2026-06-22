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
- S2 — sessions/rooms, logique host, UI participant, persistance.

## Scripts

| Script              | Effet                                              |
| ------------------- | -------------------------------------------------- |
| `npm run dev`       | serveur + client en parallèle                      |
| `npm run dev:server`| serveur Fastify + Socket.io seul                   |
| `npm run dev:client`| client Vite seul                                   |
| `npm run build`     | build shared → server → client                     |
| `npm run typecheck` | `tsc --noEmit` sur les 3 packages                  |
