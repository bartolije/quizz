import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { Server } from 'socket.io'
import { io as ioc, type Socket as ClientSocket } from 'socket.io-client'
import type { ClientToServerEvents, ServerToClientEvents, Question } from '@lya-quiz/shared'
import { attachSocketHandlers, type QuizServer } from '../src/socket-handlers.js'
import { createSession, type SessionState } from '../src/state.js'
import { createQuiz, type QuizInput } from '../src/quiz-repo.js'

export type TestClient = ClientSocket<ServerToClientEvents, ClientToServerEvents>

export interface TestServer {
  io: QuizServer
  url: string
  /** Ouvre un vrai client Socket.io vers le serveur de test (reconnexion désactivée :
   *  les tests de reconnexion créent explicitement un nouveau socket). */
  connect: () => TestClient
  close: () => Promise<void>
}

// Serveur Socket.io éphémère sur un port libre, câblé avec les VRAIS handlers
// (attachSocketHandlers = le câblage exact de index.ts).
export async function startTestServer(): Promise<TestServer> {
  const httpServer = createServer()
  const io: QuizServer = new Server(httpServer)
  attachSocketHandlers(io)
  await new Promise<void>((resolve) => httpServer.listen(0, () => resolve()))
  const port = (httpServer.address() as AddressInfo).port
  const url = `http://localhost:${port}`
  const clients: TestClient[] = []

  return {
    io,
    url,
    connect: () => {
      const c: TestClient = ioc(url, {
        transports: ['websocket'],
        forceNew: true,
        reconnection: false,
      })
      clients.push(c)
      return c
    },
    close: async () => {
      for (const c of clients) c.disconnect()
      await new Promise<void>((resolve) => io.close(() => resolve()))
    },
  }
}

// Quiz de test en base (mémoire) + session prête à jouer.
export function makeSession(questions?: QuizInput['questions']): SessionState {
  const quizId = createQuiz({
    title: 'Quiz test',
    defaultTimeLimit: 30,
    questions: questions ?? [
      { type: 'mcq', text: '2 + 2 ?', choices: ['3', '4', '5'], correctAnswers: ['4'], timeLimit: 30 },
      { type: 'free', text: 'Capitale de la France ?', correctAnswers: ['Paris'], timeLimit: 30 },
    ],
  })
  return createSession(quizId)
}

// Session en mode buzzer (partie famille) avec un quiz en mémoire (le contenu
// buzzer n'est pas encore persisté en base — cf. Phase 4). On crée une session
// normale puis on lui greffe un quiz gameType='buzzer'.
export function makeBuzzerSession(questions: Question[]): SessionState {
  const s = makeSession()
  s.quiz = {
    id: 'buzz-test',
    title: 'Quiz famille test',
    defaultTimeLimit: 0,
    createdAt: 0,
    gameType: 'buzzer',
    questions,
  }
  s.currentQuestionIndex = -1
  s.buzz = null
  return s
}

// Attend un event (une seule occurrence) avec timeout — évite les tests qui pendent.
export function waitFor<T = unknown>(
  socket: TestClient,
  event: string,
  timeoutMs = 3000,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const to = setTimeout(
      () => reject(new Error(`timeout (${timeoutMs}ms) en attendant l'event "${event}"`)),
      timeoutMs,
    )
    ;(socket as ClientSocket).once(event, (payload: T) => {
      clearTimeout(to)
      resolve(payload)
    })
  })
}

// Petit délai — pour laisser passer un broadcast qu'on veut vérifier ABSENT.
export const tick = (ms = 150): Promise<void> => new Promise((r) => setTimeout(r, ms))
