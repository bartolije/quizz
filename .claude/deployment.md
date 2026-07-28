# Déploiement — LYA QUIZ

Deux voies coexistent. La voie **single-service Railway** est la cible de référence.

## Voie 1 — Single-service Railway (référence)

Le serveur Fastify sert **tout** : l'API REST, le WebSocket Socket.io, **et** le
build statique du client React (`@fastify/static` + fallback SPA). Une seule URL,
un seul service.

- **Build** (`railway.json`) : `cd packages/shared && npm run build && cd ../client && npm run build && cd ../server && npm run build` (builder NIXPACKS).
- **Start** : `node packages/server/dist/index.js`.
- **Healthcheck** : `GET /health` (timeout 30s, restart `ON_FAILURE`, max 10).
- Le serveur résout le build client à `../../client/dist` relativement à
  `import.meta.url` (indépendant du cwd de lancement).
- En single-service, `VITE_SERVER_URL` reste **vide** → le client tape en same-origin.

### Persistance SQLite sur Railway

`db.ts` choisit le chemin du fichier dans cet ordre :
1. `DATABASE_PATH` (override manuel) ;
2. `RAILWAY_VOLUME_MOUNT_PATH` → `<mount>/lya-quiz.db`. **Railway crée cette variable
   automatiquement dès qu'un Volume est attaché** : il suffit d'ajouter un Volume au
   service, aucune autre config ;
3. sinon `./data/lya-quiz.db` (dev local, gitignoré).

Mode WAL activé. Tables créées de façon **idempotente** (`CREATE TABLE IF NOT EXISTS`)
au démarrage — pas de `drizzle-kit` en prod. Seul le **contenu des quiz** est persisté ;
les sessions de jeu sont en mémoire.

## Voie 2 — Vercel (client) + Railway (serveur), domaines séparés

- `vercel.json` : build du client uniquement (`outputDirectory: packages/client/dist`),
  rewrite SPA `/(.*) → /index.html`.
- Le client étant sur un domaine différent du serveur, il faut une **URL absolue** :
  définir `VITE_SERVER_URL` (ex. `https://lya-quiz-server.up.railway.app`) dans les
  variables d'env Vercel. Vite l'inline au build (`config.ts`).

## Variables d'environnement

| Variable | Effet | Défaut |
|---|---|---|
| `PORT` | port d'écoute serveur | `3001` |
| `ADMIN_PASSWORD` | mot de passe de l'éditeur `/admin` (header `x-admin-password`). **Obligatoire en prod** : sans lui, `/api/admin/*` répond `503` (éditeur verrouillé). En dev local : `dev` par défaut. | — |
| `DATABASE_PATH` | override du chemin SQLite | — |
| `RAILWAY_VOLUME_MOUNT_PATH` | injectée par Railway si un Volume est attaché | — |
| `RAILWAY_GIT_COMMIT_SHA` | exposée dans `/health.build` et le badge de version | `local` |
| `VITE_SERVER_URL` | (build client) URL absolue du serveur en déploiement séparé | `''` (same-origin) |

## Pièges

- **devDependencies au build** : `tsc` / `vite` / `tsx` sont en devDependencies. Les
  builds avec `NODE_ENV=production` les sauteraient → `.npmrc` force `include=dev`.
  Ne pas le retirer.
- **better-sqlite3 13 compile au `npm ci`** : le paquet n'a plus de script `install`
  mais garde son `binding.gyp` → npm déclenche sa compilation implicite
  (`node-gyp rebuild`), qui exige Python + gcc + make. L'image nixpacks de Railway
  ne les a pas → `nixpacks.toml` les ajoute à la phase setup
  (`nixPkgs = ['...', 'python3', 'gcc', 'gnumake']`). Ne pas supprimer ce fichier.
- **Ordre de build** : `shared` d'abord, toujours (les deux autres en dépendent).
- **Admin verrouillé par défaut en prod** (anti-triche) : `ADMIN_PASSWORD` doit être
  défini dans Railway, sinon l'éditeur `/admin` est inaccessible (`503`). Aucun mot de
  passe par défaut n'est shippé (le repo est public). Détecté via `NODE_ENV=production`
  ou les variables `RAILWAY_*`.
- **CORS** : `SOCKET_SERVER_CONFIG.cors.origin` est `'*'` — à restreindre si le
  service devient public. (Note : le CORS ne protège pas des appels directs type
  `curl`/devtools ; il ne limite que le JS cross-origin.)
- **Cache** : `index.html` est servi `no-cache` (déploiement pris en compte sans
  hard-refresh) ; les assets hashés sont immuables.
