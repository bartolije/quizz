import { io, type Socket } from 'socket.io-client'
import type { ClientToServerEvents, ServerToClientEvents } from '@lya-quiz/shared'
import { SOCKET_CLIENT_CONFIG, EVENTS } from '@lya-quiz/shared'

// URL du serveur : en dev, proxy Vite vers localhost:3001.
// En prod, même domaine que le client.
const SERVER_URL = import.meta.env['VITE_SERVER_URL'] ?? 'http://localhost:3001'

export const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io(
  SERVER_URL,
  {
    ...SOCKET_CLIENT_CONFIG,
    autoConnect: false,   // connexion manuelle au moment du join
  },
)

// Ré-identification automatique à chaque reconnexion Socket.io.
// 'connect' est un event de cycle de vie Socket.io (pas un event métier).
socket.on('connect', () => {
  const token = localStorage.getItem('lya_quiz_token')
  if (token) {
    socket.emit(EVENTS.REJOIN_SESSION, { sessionToken: token })
  }
})

socket.on('connect_error', (err) => {
  console.warn('[socket] connect_error', err.message)
})
