import Fastify from 'fastify'
import { Server } from 'socket.io'
import type { ClientToServerEvents, ServerToClientEvents } from '@lya-quiz/shared'
import { SOCKET_SERVER_CONFIG, EVENTS } from '@lya-quiz/shared'
import { handleJoinSession, handleRejoinSession } from './handlers/join.js'
import { handleHostJoin, handleHostStartQuiz } from './handlers/host.js'
import { handleNextQuestion, handleSubmitAnswer } from './handlers/game.js'
import { handleDisconnect } from './handlers/disconnect.js'
import { getAllSessions, createSession, getSessionById } from './state.js'
import { getParticipantList } from './session-helpers.js'

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

  socket.on(EVENTS.SUBMIT_ANSWER, (payload) => {
    handleSubmitAnswer(socket, payload, io)
  })

  socket.on('disconnect', () => {
    console.log('[disconnect]', socket.id)
    handleDisconnect(socket.id, io, getAllSessions)
  })
})

// Création d'une session (appelée par le host au chargement de /host/control)
app.post('/api/sessions', async () => {
  const session = createSession()
  return { pin: session.pin, sessionId: session.id }
})

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

// En prod : servir le build client React
// app.register(import('@fastify/static'), { root: '../client/dist', prefix: '/' })

const PORT = Number(process.env['PORT'] ?? 3001)
app.listen({ port: PORT, host: '0.0.0.0' }, (err, address) => {
  if (err) {
    app.log.error(err)
    process.exit(1)
  }
  console.log(`LYA QUIZ server — ${address}`)
})
