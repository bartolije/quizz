import Fastify from 'fastify'
import { Server } from 'socket.io'
import type { ClientToServerEvents, ServerToClientEvents } from '@lya-quiz/shared'
import { SOCKET_SERVER_CONFIG } from '@lya-quiz/shared'

const app = Fastify({ logger: true })

// Socket.io partage le serveur HTTP sous-jacent de Fastify (app.server).
// app.listen() démarre les deux : routes HTTP + WebSocket sur le même port.
const io = new Server<ClientToServerEvents, ServerToClientEvents>(
  app.server,
  SOCKET_SERVER_CONFIG,
)

io.on('connection', (socket) => {
  console.log('Client connecté :', socket.id)

  socket.on('disconnect', () => {
    console.log('Client déconnecté :', socket.id)
  })
})

app.get('/health', async () => ({ status: 'ok' }))

const PORT = Number(process.env['PORT'] ?? 3001)
app.listen({ port: PORT, host: '0.0.0.0' }, (err, address) => {
  if (err) {
    app.log.error(err)
    process.exit(1)
  }
  console.log(`LYA QUIZ server running on ${address}`)
})
