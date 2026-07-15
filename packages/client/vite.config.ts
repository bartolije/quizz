import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { execSync } from 'node:child_process'

// Identifiant de build affiché dans l'app (pour savoir quelle version tourne).
// Railway fournit RAILWAY_GIT_COMMIT_SHA ; en local on lit git ; sinon "local".
function buildSha(): string {
  const env = process.env['RAILWAY_GIT_COMMIT_SHA']
  if (env) return env.slice(0, 7)
  try {
    return execSync('git rev-parse --short HEAD').toString().trim()
  } catch {
    return 'local'
  }
}
const BUILD_SHA = buildSha()
const BUILD_DATE = new Date().toISOString().slice(0, 16).replace('T', ' ')

// Cible du proxy dev (serveur Fastify). Surchargeable via QUIZ_SERVER_URL quand le
// port 3001 est déjà pris par un autre projet local. Défaut inchangé = 3001.
const SERVER_TARGET = process.env['QUIZ_SERVER_URL'] ?? 'http://localhost:3001'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    __BUILD_SHA__: JSON.stringify(BUILD_SHA),
    __BUILD_DATE__: JSON.stringify(BUILD_DATE),
  },
  server: {
    host: true, // expose sur le réseau local (pour tester sur téléphone)
    port: 5173,
    proxy: {
      '/api': {
        target: SERVER_TARGET,
        changeOrigin: true,
      },
      '/socket.io': {
        target: SERVER_TARGET,
        ws: true, // proxyer les WebSockets
        changeOrigin: true,
      },
    },
  },
})
