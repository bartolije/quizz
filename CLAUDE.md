# CLAUDE.md — LYA QUIZ

Mémoire projet pour Claude Code. Chargé automatiquement à chaque session. Garde-le
court et à jour ; le détail vit dans [`.claude/`](.claude/).

## Le projet en une phrase

Application de quiz multijoueur **temps réel** (type Kahoot / AhaSlides) à usage
interne LYA. Un host lance un quiz depuis son Mac (TV + écran de contrôle), les
participants rejoignent depuis leur téléphone via **PIN + pseudo**. Questions
chronométrées, scoring à la vitesse, leaderboard.

## ⚠️ Priorité absolue : la stabilité WebSocket

La **reconnexion transparente** est LA feature centrale. Un participant dont le
téléphone perd le réseau 2–3 s doit retrouver automatiquement son état (question
en cours, temps restant, réponse déjà envoyée, score). Toute évolution ne doit
jamais fragiliser ça. Détail du mécanisme : [`.claude/architecture.md`](.claude/architecture.md#reconnexion).

## Règles non négociables

1. **Contrat d'events Socket.io centralisé.** Aucune string d'event en dur hors de
   `packages/shared/src/events.ts`. Client ET serveur importent `EVENTS` depuis
   `@lya-quiz/shared`. Idem pour les types de payloads.
2. **TypeScript strict** (`strict`, `noUncheckedIndexedAccess`,
   `exactOptionalPropertyTypes`). `npm run typecheck` **et** `npm test` doivent
   passer avant tout commit.
3. **Monorepo npm workspaces** : `shared` est la dépendance des deux autres et doit
   être **buildé** avant (`npm run build:shared`). Les scripts le font déjà.
4. **Commit ET push après chaque étape validée** (l'utilisateur y tient). Messages
   de commit en français, dans le style du `git log` existant.
5. **Mobile d'abord** côté participant : cibles tactiles ≥ 44px, bouton d'action
   toujours visible (pas de scroll pour valider), layout calé sur `100dvh`.

## Stack

- Node 24 (épinglé : `engines` + `.nvmrc`) · TypeScript 7 strict · monorepo npm workspaces
- **Serveur** : Fastify 5 + Socket.io 4 + Drizzle ORM 0.45 / better-sqlite3 13
- **Client** : React 19 · Vite 8 · Tailwind 4 (config CSS, plus de tailwind.config.js) ·
  Zustand 5 · react-router 8 (import depuis `react-router`, plus de `-dom`)
- **Déploiement** : single-service Railway (Fastify sert aussi le build React),
  SQLite sur Volume Railway. (Une voie Vercel+Railway séparée existe aussi.)
- Montée de versions 08/2026 : cf. [.claude/plan-upgrade-deps.md](.claude/plan-upgrade-deps.md)
  (npm audit à zéro). ⚠️ ids aléatoires via `crypto.randomUUID()` natif (plus de dep uuid).

## Démarrage rapide

```bash
npm install          # installe + build shared
npm run dev          # serveur :3001 + client :5173 (proxy Vite /api + /socket.io)
npm run typecheck    # tsc --noEmit sur les 3 packages + tests (avant commit)
npm test             # vitest : packages/*/test (intégration Socket.io réelle incluse)
npm run build        # build shared → server → client
```

Les tests vivent dans `packages/*/test/` (hors `src` → jamais dans les builds).
Côté serveur, ils bootent un vrai serveur Socket.io éphémère câblé via
`socket-handlers.ts` (le câblage exact de `index.ts`) avec SQLite en mémoire.

Tester depuis un téléphone en dev : le client tape en same-origin, le proxy Vite
route vers `:3001` → ouvrir `http://<ip-du-mac>:5173` sur le tél (pas besoin de
hardcoder l'IP).

## Carte du code

| Package | Rôle |
|---|---|
| `packages/shared` | types, contrat d'events, scoring/normalisation, config Socket.io |
| `packages/server` | Fastify + Socket.io, handlers, état en mémoire, repo SQLite |
| `packages/client` | React : pages participant + host + admin, store Zustand |

## Docs détaillées (`.claude/`)

- [`architecture.md`](.claude/architecture.md) — packages, modèle de données, flux temps réel, reconnexion, scoring
- [`events-contract.md`](.claude/events-contract.md) — référence event par event
- [`deployment.md`](.claude/deployment.md) — Railway / Vercel, variables d'env, persistance
- [`history.md`](.claude/history.md) — historique des étapes S1→S13 et features
- [`known-issues.md`](.claude/known-issues.md) — limitations connues + retours de test
