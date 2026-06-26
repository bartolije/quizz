# LYA QUIZ

Application de quiz multijoueur en temps réel. Un host lance un quiz depuis son
Mac (TV + écran de contrôle), les participants rejoignent depuis leur téléphone
via un PIN + pseudo. Questions chronométrées, scoring à la vitesse, leaderboard.

> **Priorité du projet : la stabilité WebSocket.** La reconnexion transparente
> est la feature principale — chaque participant retrouve automatiquement son
> état (question en cours, temps restant, réponse, score) si son téléphone perd
> le réseau quelques secondes.

> 🧠 **Pour Claude Code** : le contexte projet est dans [`CLAUDE.md`](CLAUDE.md)
> (chargé automatiquement) et la doc détaillée dans [`.claude/`](.claude/).

## Stack

- Node.js 20 · TypeScript strict (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`)
- Fastify 4 · Socket.io 4
- React 18 · Vite 5 · Tailwind CSS 3 · Zustand · react-router
- Drizzle ORM + better-sqlite3 (persistance des quiz)

## Architecture (monorepo npm workspaces)

```
quizz/
├── packages/
│   ├── shared/   types, contrat d'events Socket.io, scoring, config WS
│   ├── server/   Fastify + Socket.io, handlers, état en mémoire, repo SQLite
│   └── client/   React + Vite : pages participant / host / admin
├── CLAUDE.md     mémoire projet (auto-chargée par Claude Code)
└── .claude/      doc détaillée (architecture, events, déploiement, historique…)
```

**Règle absolue :** aucune string d'event Socket.io en dur hors de
`packages/shared/src/events.ts`. Client et serveur importent toujours `EVENTS`
depuis `@lya-quiz/shared`. Détail : [`.claude/events-contract.md`](.claude/events-contract.md).

## Démarrage

```bash
npm install        # installe + build le package shared

npm run typecheck  # vérifie les 3 packages (TS strict) — à lancer avant de commit
npm run dev        # lance serveur (:3001) + client (:5173) en parallèle

# ou séparément :
npm run dev:server # http://localhost:3001  (GET /health → {"status":"ok"})
npm run dev:client # http://localhost:5173
```

Pour tester depuis un téléphone en dev, le client tape en same-origin (proxy Vite
vers `:3001`) : ouvrir `http://<ip-du-mac>:5173` sur le téléphone.

## Fonctionnalités

- **Temps réel** : lobby live, boucle de jeu synchronisée host ↔ téléphones ↔ TV.
- **Reconnexion transparente** : reprise de l'état en pleine question, y compris
  après un rechargement complet de la page (token en `localStorage`).
- **4 types de questions** : QCM (`mcq`), saisie libre tolérante (`free`, normalisation
  + Levenshtein), numérique « au plus proche » (`closest`), remettre dans l'ordre
  (`ordering`).
- **Images** dans les questions (URL publique).
- **Scoring à la vitesse** + leaderboard (rangs, ex æquo, deltas, mouvements ↑/↓),
  classement intermédiaire (à la demande du host) et podium final.
- **Rapport de fin de partie** (stats par question + export CSV).
- **Éditeur `/admin`** (CRUD des quiz, import/export JSON, protégé par mot de passe).
- **Observabilité** : logs serveur structurés (pino) + remontée des erreurs client.
- **Déploiement single-service** (Fastify sert le client + l'API + le WebSocket).

État détaillé des étapes S1→S13 : [`.claude/history.md`](.claude/history.md).

## Routes client

| Route            | Vue                                                  |
| ---------------- | ---------------------------------------------------- |
| `/` `/join`      | Join participant (PIN pré-rempli via `?pin=`)        |
| `/lobby`         | Shell participant (bascule selon l'état du jeu)      |
| `/host/control`  | Écran de contrôle host (Mac)                         |
| `/host/display`  | Écran TV (passif, lisible à distance)                |
| `/admin`         | Éditeur de quiz (protégé par mot de passe)           |

## API REST (extrait)

| Route                          | Usage                                            |
| ------------------------------ | ------------------------------------------------ |
| `POST /api/sessions`           | crée une session → `{ pin, sessionId }`          |
| `GET /api/sessions/:id`        | résout une session (bootstrap de la TV)          |
| `GET /api/sessions/:id/report` | rapport de fin (stats + classement)              |
| `GET /health`                  | healthcheck `{ status, sessions, build }`        |
| `*/api/admin/*`                | CRUD quiz (header `x-admin-password`)            |

## Déploiement

Cible de référence : **single-service Railway** (le serveur sert aussi le build
client), SQLite sur Volume Railway. Détail, variables d'env et pièges :
[`.claude/deployment.md`](.claude/deployment.md).

## Scripts

| Script              | Effet                                              |
| ------------------- | -------------------------------------------------- |
| `npm run dev`       | serveur + client en parallèle                      |
| `npm run dev:server`| serveur Fastify + Socket.io seul                   |
| `npm run dev:client`| client Vite seul                                   |
| `npm run build`     | build shared → server → client                     |
| `npm run typecheck` | `tsc --noEmit` sur les 3 packages                  |
