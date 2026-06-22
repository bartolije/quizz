import type { ManagerOptions, SocketOptions } from 'socket.io-client'

// Configuration client Socket.io
// Optimisée pour reconnexion rapide et transparente sur mobile
export const SOCKET_CLIENT_CONFIG: Partial<ManagerOptions & SocketOptions> = {
  // WebSocket en priorité, polling en fallback automatique si le réseau bloque WS
  transports: ['websocket', 'polling'],

  // Reconnexion : toujours, sans limite de tentatives
  reconnection: true,
  reconnectionAttempts: Infinity,

  // Délai entre tentatives : 500ms → max 2s (pas 5s comme par défaut)
  // Le randomizationFactor évite que 15 téléphones reconnectent exactement en même temps
  reconnectionDelay: 500,
  reconnectionDelayMax: 2000,
  randomizationFactor: 0.3,

  // Timeout connexion initiale
  timeout: 5000,
}

// Configuration serveur Socket.io
// NB: pas de `as const` ici — il transformerait `cors.methods` en tuple readonly,
// que les types de socket.io (CorsOptions.methods: string | string[]) refusent.
export const SOCKET_SERVER_CONFIG = {
  // Heartbeat : détecte les connexions zombies (téléphone en veille, réseau coupé)
  pingInterval: 10_000,   // ping toutes les 10 secondes
  pingTimeout: 5_000,     // considéré mort si pas de réponse en 5 secondes

  // CORS : à restreindre en production si besoin
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
}

// Durée de rétention d'un sessionToken en mémoire serveur après déconnexion
// Le participant peut se reconnecter dans cette fenêtre sans perdre son état
export const SESSION_TOKEN_TTL_MS = 30_000   // 30 secondes
