// URL de base du serveur LYA QUIZ.
//
// - En DEV : VITE_SERVER_URL n'est pas défini → SERVER_URL vaut '' (chaîne vide).
//   Le client tape en same-origin (http://<ip>:5173) et le proxy Vite route
//   /api et /socket.io vers le serveur :3001.
//
// - En PROD : le client (statique) est sur Vercel et le serveur sur Railway,
//   sur des domaines différents → il faut une URL ABSOLUE. On la fournit au
//   build via la variable d'environnement Vercel VITE_SERVER_URL
//   (ex: https://lya-quiz-server.up.railway.app). Vite l'inline dans le bundle.
export const SERVER_URL =
  (import.meta.env['VITE_SERVER_URL'] as string | undefined)?.replace(/\/+$/, '') ?? ''

// Construit une URL d'API en préfixant la base serveur (vide en dev).
export function apiUrl(path: string): string {
  return `${SERVER_URL}${path}`
}
