import { io, type Socket } from 'socket.io-client'
import type { ClientToServerEvents, ServerToClientEvents } from '@lya-quiz/shared'
import { SOCKET_CLIENT_CONFIG, EVENTS } from '@lya-quiz/shared'
import { SERVER_URL } from './config'

// Connexion same-origin en dev (SERVER_URL vide → proxy Vite /socket.io vers
// :3001, pratique pour tester depuis un téléphone sans hardcoder l'IP du Mac).
// En prod, SERVER_URL est l'URL absolue du serveur Railway (cf. config.ts).
const options = {
  ...SOCKET_CLIENT_CONFIG,
  autoConnect: false,   // connexion manuelle au moment du join
}

export const socket: Socket<ServerToClientEvents, ClientToServerEvents> =
  SERVER_URL ? io(SERVER_URL, options) : io(options)

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
