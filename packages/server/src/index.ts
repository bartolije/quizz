import Fastify from 'fastify'
import type { FastifyRequest, FastifyReply } from 'fastify'
import fastifyStatic from '@fastify/static'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { Server } from 'socket.io'
import type { ClientToServerEvents, ServerToClientEvents } from '@lya-quiz/shared'
import { SOCKET_SERVER_CONFIG } from '@lya-quiz/shared'
import { attachSocketHandlers } from './socket-handlers.js'
import { getAllSessions, createSession, getSessionById } from './state.js'
import { getParticipantList, getLeaderboard } from './session-helpers.js'
import type { GameReport } from '@lya-quiz/shared'
import {
  seedIfEmpty,
  seedBuzzerDemoIfMissing,
  listQuizzes,
  getQuiz,
  createQuiz,
  replaceQuiz,
  deleteQuiz,
  type QuizInput,
} from './quiz-repo.js'
import { logWarn, logError, logEvent } from './logger.js'
import { saveSessionSnapshot, restoreSessionsAtBoot } from './session-snapshot.js'

// Au démarrage : crée les tables (import de db via quiz-repo) + seed si DB vide.
seedIfEmpty()
// Quiz famille (buzzer) de démo, si aucun quiz buzzer n'existe encore.
seedBuzzerDemoIfMissing()

// Filet anti-restart : recharge les sessions de jeu snapshotées (Volume Railway).
// Les téléphones se reconnectent tout seuls (leur token redevient valide) ; la
// question interrompue est simplement rejouée par le host.
const restoredCount = restoreSessionsAtBoot()
if (restoredCount > 0) logEvent('sessions_restored_at_boot', { count: restoredCount })

// Filets de sécurité : on logge les crashs au lieu de mourir en silence.
process.on('uncaughtException', (e) => logError('fatal_uncaught_exception', e))
process.on('unhandledRejection', (e) => logError('fatal_unhandled_rejection', e))

// Mot de passe de l'éditeur admin. ANTI-TRICHE : l'éditeur expose les bonnes
// réponses ; le repo étant public, on ne ship JAMAIS de mot de passe par défaut
// en déploiement.
// - En prod (Railway / NODE_ENV=production) : ADMIN_PASSWORD est OBLIGATOIRE ;
//   sans lui, toutes les routes /api/admin renvoient 503 → éditeur inaccessible.
// - En dev local : mot de passe de confort ('dev') si ADMIN_PASSWORD non défini,
//   pour ouvrir /admin sans configuration.
const IS_DEPLOYED =
  process.env['NODE_ENV'] === 'production' ||
  !!process.env['RAILWAY_ENVIRONMENT'] ||
  !!process.env['RAILWAY_PROJECT_ID']
const ADMIN_PASSWORD = process.env['ADMIN_PASSWORD'] ?? (IS_DEPLOYED ? '' : 'dev')

if (IS_DEPLOYED && !ADMIN_PASSWORD) {
  logWarn('admin_disabled_no_password', {
    hint: "Définir ADMIN_PASSWORD (Railway) pour activer l'éditeur /admin.",
  })
}

async function requireAdmin(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!ADMIN_PASSWORD) {
    // Déploiement sans mot de passe configuré → admin verrouillé.
    await reply.code(503).send({ error: 'admin_disabled' })
    return
  }
  if (req.headers['x-admin-password'] !== ADMIN_PASSWORD) {
    await reply.code(401).send({ error: 'unauthorized' })
  }
}

// Logger Fastify en 'warn' : évite de noyer les logs sous chaque requête HTTP
// (assets, /health…). Les événements métier passent par logEvent (info). cf. logger.ts
const app = Fastify({ logger: { level: 'warn' } })

// Socket.io partage le serveur HTTP sous-jacent de Fastify (app.server).
// app.listen() démarre les deux : routes HTTP + WebSocket sur le même port.
const io = new Server<ClientToServerEvents, ServerToClientEvents>(
  app.server,
  SOCKET_SERVER_CONFIG,
)

attachSocketHandlers(io)

// Création d'une session (host au chargement de /host/control, ou "Lancer" depuis
// l'éditeur avec un quizId). Sans quizId → quiz par défaut.
app.post<{ Body: { quizId?: string } }>('/api/sessions', async (req) => {
  const session = createSession(req.body?.quizId)
  saveSessionSnapshot(session)
  // hostKey : secret du host — seul canal où il transite (jamais en broadcast)
  return { pin: session.pin, sessionId: session.id, hostKey: session.hostKey }
})

// ── Éditeur admin (protégé par mot de passe via header x-admin-password) ──
app.post('/api/admin/check', { preHandler: requireAdmin }, async () => ({ ok: true }))

app.get('/api/admin/quizzes', { preHandler: requireAdmin }, async () => listQuizzes())

app.get<{ Params: { id: string } }>(
  '/api/admin/quizzes/:id',
  { preHandler: requireAdmin },
  async (req, reply) => {
    const quiz = getQuiz(req.params.id)
    if (!quiz) {
      reply.code(404)
      return { error: 'not_found' }
    }
    return quiz
  },
)

app.post<{ Body: QuizInput }>(
  '/api/admin/quizzes',
  { preHandler: requireAdmin },
  async (req) => ({ id: createQuiz(req.body) }),
)

app.put<{ Params: { id: string }; Body: QuizInput }>(
  '/api/admin/quizzes/:id',
  { preHandler: requireAdmin },
  async (req, reply) => {
    if (!replaceQuiz(req.params.id, req.body)) {
      reply.code(404)
      return { error: 'not_found' }
    }
    return { ok: true }
  },
)

app.delete<{ Params: { id: string } }>(
  '/api/admin/quizzes/:id',
  { preHandler: requireAdmin },
  async (req) => {
    deleteQuiz(req.params.id)
    return { ok: true }
  },
)

// Résolution d'une session par id — sert à /host/display ouvert via ?session=XXXX
// (autre navigateur/machine, sans le PIN en localStorage). Bootstrap one-shot,
// la synchro temps réel reste 100% Socket.io.
app.get<{ Params: { id: string } }>('/api/sessions/:id', async (req, reply) => {
  const session = getSessionById(req.params.id)
  if (!session) {
    reply.code(404)
    return { error: 'not_found' }
  }
  return {
    pin: session.pin,
    sessionId: session.id,
    status: session.status,
    participants: getParticipantList(session),
  }
})

// Rapport de fin de partie : stats par question + classement par joueur.
app.get<{ Params: { id: string } }>('/api/sessions/:id/report', async (req, reply) => {
  const session = getSessionById(req.params.id)
  if (!session) {
    reply.code(404)
    return { error: 'not_found' }
  }
  const report: GameReport = {
    title: session.quiz?.title ?? 'Quiz',
    totalQuestions: session.results.length,
    questions: session.results,
    players: getLeaderboard(session).map((s) => ({
      participantId: s.participantId,
      pseudo: s.pseudo,
      score: s.score,
      rank: s.rank,
      correct: session.participants.get(s.participantId)?.correctTotal ?? 0,
    })),
  }
  return report
})

app.get('/health', async () => ({
  status: 'ok',
  sessions: getAllSessions().length,
  build: process.env['RAILWAY_GIT_COMMIT_SHA']?.slice(0, 7) ?? 'local',
}))

// Remontée des erreurs JS des clients (téléphones) → logs serveur (S10).
// Sinon un crash côté joueur est invisible. Payload borné, pas de log du log.
app.post<{
  Body: { level?: string; message?: string; stack?: string; context?: Record<string, unknown> }
}>('/api/client-log', async (req) => {
  const b = req.body ?? {}
  const message = String(b.message ?? '').slice(0, 500)
  if (!message) return { ok: false }
  logWarn('client_error', {
    level: b.level ?? 'error',
    message,
    stack: typeof b.stack === 'string' ? b.stack.slice(0, 2000) : undefined,
    ctx: b.context,
  })
  return { ok: true }
})

// Déploiement single-service : Fastify sert aussi le build client React.
// __dirname = packages/server/dist → le build client est à ../../client/dist
// (résolu depuis l'emplacement du fichier, indépendant du cwd de lancement).
const clientDist = join(dirname(fileURLToPath(import.meta.url)), '../../client/dist')
void app.register(fastifyStatic, {
  root: clientDist,
  wildcard: false,
  // index.html en no-store → JAMAIS caché (navigateur, heuristique, proxy/CDN) :
  // un nouveau déploiement est pris en compte au refresh suivant, sans hard-refresh.
  // Les assets /assets/* sont hashés par Vite → immuables, cache long (les 80
  // téléphones ne les re-téléchargent pas à chaque visite).
  setHeaders: (res, path) => {
    if (path.endsWith('.html')) res.setHeader('cache-control', 'no-store')
    else if (path.includes('/assets/'))
      res.setHeader('cache-control', 'public, max-age=31536000, immutable')
  },
})

// SPA : toute route GET non-API/non-socket renvoie index.html
// (react-router gère le routing /host/control, /join… côté client au refresh).
app.setNotFoundHandler((req, reply) => {
  const url = req.raw.url ?? ''
  if (req.method !== 'GET' || url.startsWith('/api') || url.startsWith('/socket.io')) {
    void reply.code(404).send({ error: 'not_found' })
    return
  }
  void reply.header('cache-control', 'no-store').sendFile('index.html')
})

const PORT = Number(process.env['PORT'] ?? 3001)
app.listen({ port: PORT, host: '0.0.0.0' }, (err, address) => {
  if (err) {
    app.log.error(err)
    process.exit(1)
  }
  console.log(`LYA QUIZ server — ${address}`)
})
