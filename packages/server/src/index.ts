import Fastify from 'fastify'
import type { FastifyRequest, FastifyReply } from 'fastify'
import fastifyStatic from '@fastify/static'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { Server } from 'socket.io'
import type { ClientToServerEvents, ServerToClientEvents } from '@lya-quiz/shared'
import { SOCKET_SERVER_CONFIG, EVENTS } from '@lya-quiz/shared'
import { handleJoinSession, handleRejoinSession } from './handlers/join.js'
import { handleHostJoin, handleHostStartQuiz, handleHostEndQuiz } from './handlers/host.js'
import {
  handleNextQuestion,
  handleSubmitAnswer,
  handleShowLeaderboard,
} from './handlers/game.js'
import { handleDisconnect } from './handlers/disconnect.js'
import { getAllSessions, createSession, getSessionById } from './state.js'
import { getParticipantList } from './session-helpers.js'
import {
  seedIfEmpty,
  listQuizzes,
  getQuiz,
  createQuiz,
  replaceQuiz,
  deleteQuiz,
  type QuizInput,
} from './quiz-repo.js'

// Au démarrage : crée les tables (import de db via quiz-repo) + seed si DB vide.
seedIfEmpty()

// Mot de passe de l'éditeur admin (à définir dans Railway via ADMIN_PASSWORD).
const ADMIN_PASSWORD = process.env['ADMIN_PASSWORD'] ?? 'lyaquiz'
async function requireAdmin(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (req.headers['x-admin-password'] !== ADMIN_PASSWORD) {
    await reply.code(401).send({ error: 'unauthorized' })
  }
}

const app = Fastify({ logger: true })

// Socket.io partage le serveur HTTP sous-jacent de Fastify (app.server).
// app.listen() démarre les deux : routes HTTP + WebSocket sur le même port.
const io = new Server<ClientToServerEvents, ServerToClientEvents>(
  app.server,
  SOCKET_SERVER_CONFIG,
)

io.on('connection', (socket) => {
  console.log('[connect]', socket.id)

  socket.on(EVENTS.JOIN_SESSION, (payload) => {
    handleJoinSession(socket, payload, io)
  })

  socket.on(EVENTS.REJOIN_SESSION, (payload) => {
    handleRejoinSession(socket, payload, io)
  })

  socket.on(EVENTS.HOST_JOIN, (payload) => {
    handleHostJoin(socket, payload)
  })

  socket.on(EVENTS.HOST_START_QUIZ, () => {
    handleHostStartQuiz(socket, io)
  })

  socket.on(EVENTS.HOST_NEXT_QUESTION, () => {
    handleNextQuestion(socket, io)
  })

  socket.on(EVENTS.HOST_SHOW_LEADERBOARD, () => {
    handleShowLeaderboard(socket, io)
  })

  socket.on(EVENTS.HOST_END_QUIZ, () => {
    handleHostEndQuiz(socket, io)
  })

  socket.on(EVENTS.SUBMIT_ANSWER, (payload) => {
    handleSubmitAnswer(socket, payload, io)
  })

  socket.on('disconnect', () => {
    console.log('[disconnect]', socket.id)
    handleDisconnect(socket.id, io, getAllSessions)
  })
})

// Création d'une session (host au chargement de /host/control, ou "Lancer" depuis
// l'éditeur avec un quizId). Sans quizId → quiz par défaut.
app.post<{ Body: { quizId?: string } }>('/api/sessions', async (req) => {
  const session = createSession(req.body?.quizId)
  return { pin: session.pin, sessionId: session.id }
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

app.get('/health', async () => ({ status: 'ok', sessions: getAllSessions().length }))

// Déploiement single-service : Fastify sert aussi le build client React.
// __dirname = packages/server/dist → le build client est à ../../client/dist
// (résolu depuis l'emplacement du fichier, indépendant du cwd de lancement).
const clientDist = join(dirname(fileURLToPath(import.meta.url)), '../../client/dist')
void app.register(fastifyStatic, { root: clientDist, wildcard: false })

// SPA : toute route GET non-API/non-socket renvoie index.html
// (react-router gère le routing /host/control, /join… côté client au refresh).
app.setNotFoundHandler((req, reply) => {
  const url = req.raw.url ?? ''
  if (req.method !== 'GET' || url.startsWith('/api') || url.startsWith('/socket.io')) {
    void reply.code(404).send({ error: 'not_found' })
    return
  }
  void reply.sendFile('index.html')
})

const PORT = Number(process.env['PORT'] ?? 3001)
app.listen({ port: PORT, host: '0.0.0.0' }, (err, address) => {
  if (err) {
    app.log.error(err)
    process.exit(1)
  }
  console.log(`LYA QUIZ server — ${address}`)
})
