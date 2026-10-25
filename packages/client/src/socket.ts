import { io, type Socket } from 'socket.io-client'
import type { ClientToServerEvents, ServerToClientEvents } from '@lya-quiz/shared'
import { SOCKET_CLIENT_CONFIG, EVENTS } from '@lya-quiz/shared'

// Toujours same-origin : en prod Fastify sert client + API + WebSocket (Railway),
// en dev le proxy Vite route /socket.io vers :3001 (testable depuis un téléphone
// sans hardcoder l'IP du Mac).
export const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io({
  ...SOCKET_CLIENT_CONFIG,
  autoConnect: false,   // connexion manuelle au moment du join
})

// Ré-identification automatique à chaque reconnexion Socket.io.
// 'connect' est un event de cycle de vie Socket.io (pas un event métier).
// JAMAIS sur les pages host/TV/admin : un token de participant qui traîne dans
// le localStorage (ex : on a testé en tant que joueur sur le même Mac) ferait
// du socket host un participant fantôme au classement.
socket.on('connect', () => {
  const path = window.location.pathname
  if (path.startsWith('/host') || path.startsWith('/admin')) return
  const token = localStorage.getItem('lya_quiz_token')
  if (token) {
    socket.emit(EVENTS.REJOIN_SESSION, { sessionToken: token })
  }
})

socket.on('connect_error', (err) => {
  console.warn('[socket] connect_error', err.message)
})
