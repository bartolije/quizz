import { io, type Socket } from 'socket.io-client'
import type { ClientToServerEvents, ServerToClientEvents } from '@lya-quiz/shared'
import { SOCKET_CLIENT_CONFIG, EVENTS } from '@lya-quiz/shared'

// Connexion same-origin par défaut : le socket tape sur l'origine de la page
// (http://<ip-du-mac>:5173) et le proxy Vite (/socket.io) route vers le serveur
// :3001. Ça permet de tester depuis un téléphone sans hardcoder l'IP du Mac.
// VITE_SERVER_URL force une URL absolue si besoin (prod, domaine séparé…).
const SERVER_URL = import.meta.env['VITE_SERVER_URL'] as string | undefined

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
