import type { ManagerOptions, SocketOptions } from 'socket.io-client'

// Configuration client Socket.io
// Optimisée pour reconnexion rapide et transparente sur mobile
export const SOCKET_CLIENT_CONFIG: Partial<ManagerOptions & SocketOptions> = {
  // WebSocket en priorité. ATTENTION : sans tryAllTransports, socket.io-client
  // ne réessaie QUE le premier transport de la liste — un réseau d'entreprise
  // qui bloque les WebSockets rendait l'app inutilisable. Avec ce flag
  // (socket.io-client ≥ 4.8), l'échec du WS bascule réellement sur le polling.
  transports: ['websocket', 'polling'],
  tryAllTransports: true,

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
  // Heartbeat : détecte les connexions zombies (téléphone en veille, réseau coupé).
  // pingTimeout 10s (au lieu de 5s) : sur un wifi d'entreprise saturé, un pong
  // peut mettre plusieurs secondes — 5s produisait des faux « déconnecté » en
  // rafale (et faussait le compteur « tous ont répondu »). Détection zombie
  // en 10+10 = 20s max, largement assez pour la soirée.
  pingInterval: 10_000,   // ping toutes les 10 secondes
  pingTimeout: 10_000,    // considéré mort si pas de réponse en 10 secondes

  // CORS : '*' par défaut, surchargé par CORS_ORIGIN côté serveur (cf. index.ts)
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
}
