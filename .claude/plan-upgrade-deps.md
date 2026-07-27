# Plan — Montée de versions complète + correctifs (août 2026)

> Objectif : éliminer les 16 vulnérabilités npm restantes (12 high) et remettre
> toutes les dépendances à jour, par phases, avec un gate à chaque étape.
> Règle du repo : chaque phase validée = 1 commit + push.

## État des lieux (27/07/2026)

- Branche `feat/quiz-famille-buzzer` verte : typecheck OK, 96 tests / 12 fichiers.
- `npm audit` : 16 vulnérabilités (4 moderate, 12 high), toutes nécessitant des
  montées **majeures** : `@fastify/static` (bypass auth + path traversal — c'est
  lui qui sert le build React en prod), `find-my-way` (DDoS HTTP2, via Fastify),
  `drizzle-orm`, `esbuild` (via Vite 5), `fast-uri`, `brace-expansion`,
  `react-router`, `uuid`.
- Node local : v24. Railway : NIXPACKS sans version épinglée (⚠️).
- Surfaces d'usage vérifiées → migrations faciles :
  - Fastify : uniquement `Fastify()` + `@fastify/static` (1 register).
  - Drizzle : `drizzle(sqlite)` + `sqliteTable/text/integer`, DDL idempotent à la
    main (pas de drizzle-kit).
  - uuid : `v4` seul, dans 5 fichiers serveur → remplaçable par `crypto.randomUUID()`.
  - react-router : `BrowserRouter/Routes/Route/Navigate/useNavigate/useSearchParams`.
  - zustand : `create` seul. React : `createRoot` + StrictMode déjà en place.
  - Tailwind : config vide, 0 `@apply`, directives standard → migration v4 simple.

## Gate de validation (identique à chaque phase)

```bash
npm run typecheck && npm test        # 96 tests doivent passer
npm run dev                          # smoke test : une mini-partie (join tél + host + TV)
```

Zones sensibles à re-tester à la main quand la phase les touche : reconnexion
(couper le wifi du tél 5 s), drag & drop `OrderingList`, mode buzzer famille.

## Phase 0 — Préparation

- [ ] Merger `feat/quiz-famille-buzzer` → `main` (elle est verte et poussée),
      puis brancher `chore/upgrade-deps-2026-08` depuis `main`.
- [ ] Épingler Node 24 : `engines.node` dans package.json racine + `.nvmrc`
      + variable `NIXPACKS_NODE_VERSION=24` sur Railway (aujourd'hui rien n'est épinglé :
      un redeploy peut changer de runtime silencieusement).

## Phase 1 — Quick wins sans risque

- [ ] `npm audit fix` (non-force) : corrige `react-router` en 6.x patché.
- [ ] Minors/patches : `vitest 4.1.10`, `tsx`, `autoprefixer`.
- [ ] `concurrently` 8→10 (devDep, ne touche que `npm run dev`).
- [ ] **Supprimer `uuid` + `@types/uuid`** : remplacer `import { v4 as uuid } from 'uuid'`
      par `crypto.randomUUID()` (natif Node ≥ 19) dans `state.ts`, `quiz-repo.ts`,
      `handlers/{join,team,host}.ts`. Une dépendance et une CVE en moins.

## Phase 2 — Serveur : Fastify 5

- [ ] `fastify` 4→5 + `@fastify/static` 7→10 ensemble (couplés). Purge les CVE
      `@fastify/static`, `find-my-way`, `fast-uri`. Surface minime ici : vérifier
      l'option `logger` et la signature `listen` dans `index.ts`.
- [ ] `pino` 9→10 (aligné Fastify 5).
- [ ] `better-sqlite3` 11→13 : rebuild natif — vérifier le build Railway (NIXPACKS
      + prebuilds) en plus du local.
- [ ] `drizzle-orm` 0.33→0.45 : usage minime ; vérifier la signature `drizzle(...)`
      (nouvelles versions préfèrent `drizzle({ client })`).
- [ ] `@types/node` aligné sur Node 24 épinglé.
- Gate + `npm run loadtest:buzzer` en local (tests d'intégration Socket.io réels).

## Phase 3 — Client : Vite 8 + Tailwind 4

- [ ] `vite` 5→8 + `@vitejs/plugin-react` 4→6 (purge la CVE esbuild). Vérifier le
      proxy `/api` + `/socket.io` de `vite.config.ts` (syntaxe inchangée a priori).
- [ ] `tailwindcss` 3→4 via `npx @tailwindcss/upgrade` : `@import "tailwindcss"`
      dans `index.css`, plugin `@tailwindcss/vite`, suppression de
      `tailwind.config.js`/`postcss.config.js`/`autoprefixer` (config vide, 0 @apply).
      ⚠️ TW4 exige Safari 16.4+/Chrome 111+ — on assumait déjà iOS 15.4+ pour `dvh`,
      à noter dans known-issues.md.
- Gate + vérif visuelle mobile (100dvh, bouton Valider toujours visible).

## Phase 4 — Client : React 19 + router + state + dnd

- [ ] `react`/`react-dom` 18→19 + `@types/react{,-dom}` 19.
- [ ] `react-router-dom` 6→7 (imports depuis `react-router`, API identique pour
      notre surface).
- [ ] `zustand` 4→5 (import nommé `create` déjà utilisé).
- [ ] `@dnd-kit/modifiers` 7→9, `@dnd-kit/sortable` 8→10 — vérifier compat React 19.
- Gate + **test manuel drag & drop ordering sur téléphone** (zone sensible connue :
  poignée ⠿, FLIP, activationConstraint) + reconnexion.

## Phase 5 — TypeScript (optionnel, isolé)

- [ ] TS 5.9→7 (compilateur natif) dans un commit isolé, facile à reverter.
      Ne tenter que si vitest/vite/tsx le supportent proprement ; sinon rester
      sur le dernier 5.x/6.x stable. Les flags stricts existants ne bougent pas.

## Phase 6 — Correctifs de la revue de code

- [ ] Intégrer les findings de la revue du mode buzzer (rapport en cours —
      sera annexé ici).
- [ ] Déjà identifiés dans known-issues : supprimer le code mort TTL 30 s de
      `socket-config.ts` ; gater `GET /api/sessions/:id/report` ; restreindre
      CORS `*` (origin même-domaine en prod Railway).

## Phase 7 — Validation finale + déploiement

- [ ] `npm audit` → 0 vulnérabilité (ou résiduel documenté ici).
- [ ] Load test buzzer + partie complète classique ET famille en local.
- [ ] Mettre à jour CLAUDE.md (section Stack) + architecture.md si besoin.
- [ ] Merge → `main`, deploy Railway **hors soirée**, vérifier `/health`
      (sha build) + partie test réelle avec 2 téléphones.

## Risques identifiés

| Risque | Mitigation |
|---|---|
| Build natif `better-sqlite3` sur Railway | tester un deploy préview avant merge |
| dnd-kit × React 19 | phase 4 dédiée + test manuel ordering |
| TW4 : navigateurs < Safari 16.4 | déjà assumé de fait (dvh) ; documenter |
| TS 7 : écosystème pas prêt | phase isolée, revert facile |
| Régression reconnexion (priorité n°1) | gate manuel wifi-off à chaque phase client |
