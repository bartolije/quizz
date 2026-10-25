# Déploiement — LYA QUIZ

Une seule voie : **single-service Railway** (la voie Vercel a été supprimée en 10/2026).

## Single-service Railway

Le serveur Fastify sert **tout** : l'API REST, le WebSocket Socket.io, **et** le
build statique du client React (`@fastify/static` + fallback SPA). Une seule URL,
un seul service.

- **Build** (`railway.json`) : `npm run build` (= shared → server → client, l'ordre du
  script racine), builder **RAILPACK**. Nixpacks est déprécié par Railway (maintenance
  mode) : migré le 31/07/2026, `nixpacks.toml` supprimé.
- **Start** : `node packages/server/dist/index.js`.
- **Healthcheck** : `GET /health` (timeout 30s, restart `ON_FAILURE`, max 10).
- Le serveur résout le build client à `../../client/dist` relativement à
  `import.meta.url` (indépendant du cwd de lancement).
- Le client tape toujours en same-origin (chemins relatifs `/api`, `/socket.io`).

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

## Variables d'environnement

| Variable | Effet | Défaut |
|---|---|---|
| `PORT` | port d'écoute serveur | `3001` |
| `ADMIN_PASSWORD` | mot de passe de l'éditeur `/admin` (header `x-admin-password`). **Obligatoire en prod** : sans lui, `/api/admin/*` répond `503` (éditeur verrouillé). En dev local : `dev` par défaut. | — |
| `DATABASE_PATH` | override du chemin SQLite | — |
| `RAILWAY_VOLUME_MOUNT_PATH` | injectée par Railway si un Volume est attaché | — |
| `RAILWAY_GIT_COMMIT_SHA` | exposée dans `/health.build` et le badge de version | `local` |
| `RAILPACK_NODE_VERSION` | (build) épingle la version Node du builder Railpack — gagne sur `engines.node` et `.nvmrc`. Remplace l'ancienne `NIXPACKS_NODE_VERSION`, devenue inerte. | — |

## Pièges

- **devDependencies au build** : `tsc` / `vite` / `tsx` sont en devDependencies. Les
  builds avec `NODE_ENV=production` les sauteraient → `.npmrc` force `include=dev`.
  Ne pas le retirer.
- **better-sqlite3 13 compile au `npm ci`** : le paquet n'a plus de script `install`
  mais garde son `binding.gyp` → npm déclenche sa compilation implicite
  (`node-gyp rebuild`), qui exige Python + gcc + make. L'image de build Railpack
  (`buildpack-deps:bookworm-scm` + `build-essential`, `make`, `pkg-config`, et
  `python3` tiré par `mercurial`) les a déjà — c'est pourquoi `nixpacks.toml`, qui
  les ajoutait à la main pour Nixpacks, a pu être supprimé. Si un build casse un
  jour sur `node-gyp`, créer un `railpack.json` à la racine :
  `{ "buildAptPackages": ["python3", "build-essential"] }`.
- **Version de Node sous Railpack** : la variable `NIXPACKS_NODE_VERSION` n'a plus
  d'effet. Railpack résout dans l'ordre `RAILPACK_NODE_VERSION` (variable du service)
  → `engines.node` → `.nvmrc`. Ici `engines.node` vaut `>=24 <25` (une plage, résolue
  par mise) et `.nvmrc` vaut `24` ; en cas de doute ou d'erreur de résolution, poser
  **`RAILPACK_NODE_VERSION=24`** dans les variables du service, elle gagne sur tout.
- **Ordre de build** : `shared` d'abord, toujours (les deux autres en dépendent).
- **Admin verrouillé par défaut en prod** (anti-triche) : `ADMIN_PASSWORD` doit être
  défini dans Railway, sinon l'éditeur `/admin` est inaccessible (`503`). Aucun mot de
  passe par défaut n'est shippé (le repo est public). Détecté via `NODE_ENV=production`
  ou les variables `RAILWAY_*`.
- **Pas de CORS** : tout est same-origin, Socket.io n'a plus d'option `cors`. Un
  client servi depuis un autre domaine ne marcherait pas (voulu).
- **Cache** : `index.html` est servi `no-cache` (déploiement pris en compte sans
  hard-refresh) ; les assets hashés sont immuables.
