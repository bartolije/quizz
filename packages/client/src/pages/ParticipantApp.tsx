import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { EVENTS } from '@lya-quiz/shared'
import { socket } from '../socket'
import { useQuizStore } from '../store/quiz-store'
import { useParticipantEvents } from '../hooks/useParticipantEvents'
import { LobbyPage } from './LobbyPage'
import { QuestionPage } from './QuestionPage'
import { AnswerPage } from './AnswerPage'
import { LeaderboardPage } from './LeaderboardPage'
import { EndedPage } from './EndedPage'

// Shell participant monté sur /lobby : branche les events temps réel, gère la
// reprise automatique au rechargement, et bascule la vue selon l'état du jeu.
export function ParticipantApp() {
  useParticipantEvents()
  const view = useQuizStore((s) => s.currentView)
  const myId = useQuizStore((s) => s.myId)
  // 'trying' tant qu'un token est présent (on tente la reprise) ; 'failed' = pas
  // de token ou token périmé → on bascule vers /join. État initial synchrone
  // (pas de flash "Reconnexion" si aucun token).
  const [resume, setResume] = useState<'trying' | 'failed'>(() =>
    localStorage.getItem('lya_quiz_token') ? 'trying' : 'failed',
  )

  // Reprise au reload : store vidé mais token présent → on reconnecte le socket
  // (socket.ts ré-émet rejoin_session sur 'connect') → session_restored repeuple
  // le store. On ne bascule vers /join QUE si le serveur dit le token invalide.
  // Pas de timeout : si le serveur est juste lent/indispo, Socket.io retente.
  useEffect(() => {
    if (myId) return
    const token = localStorage.getItem('lya_quiz_token')
    if (!token) {
      setResume('failed')
      return
    }
    setResume('trying')
    if (!socket.connected) socket.connect()

    const onError = (e: { code?: string }) => {
      if (e?.code === 'INVALID_TOKEN' || e?.code === 'SESSION_ENDED') {
        localStorage.removeItem('lya_quiz_token')
        setResume('failed')
      }
    }
    socket.on(EVENTS.QUIZ_ERROR, onError)
    return () => {
      socket.off(EVENTS.QUIZ_ERROR, onError)
    }
  }, [myId])

  if (!myId) {
    if (resume === 'failed') return <Navigate to="/join" replace />
    return (
      <div className="min-h-screen bg-gray-950 text-gray-300 flex flex-col items-center justify-center gap-3">
        <div className="w-8 h-8 border-2 border-gray-600 border-t-indigo-500 rounded-full animate-spin" />
        <p>Reconnexion…</p>
      </div>
    )
  }

  switch (view) {
    case 'question':
      return <QuestionPage />
    case 'answer':
      return <AnswerPage />
    case 'leaderboard':
      return <LeaderboardPage />
    case 'ended':
      return <EndedPage />
    default:
      return <LobbyPage />
  }
}
