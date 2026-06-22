import { Navigate } from 'react-router-dom'
import { useQuizStore } from '../store/quiz-store'
import { ParticipantList } from '../components/ParticipantList'

export function LobbyPage() {
  const myId         = useQuizStore((s) => s.myId)
  const sessionPin   = useQuizStore((s) => s.sessionPin)
  const myPseudo     = useQuizStore((s) => s.myPseudo)
  const participants = useQuizStore((s) => s.participants)

  // Pas encore rejoint (refresh direct sur /lobby) → retour au join
  if (!myId) return <Navigate to="/join" replace />

  const connected = participants.filter((p) => p.connected)

  return (
    <div className="min-h-screen bg-gray-950 flex flex-col items-center p-6 pt-12">
      <p className="text-gray-400 text-sm mb-1">Session</p>
      <div className="text-6xl font-bold text-white tracking-widest mb-2">
        {sessionPin}
      </div>
      <p className="text-gray-400 text-sm mb-10">
        Tu joues en tant que <span className="text-white font-medium">{myPseudo}</span>
      </p>

      <div className="w-full max-w-sm">
        <p className="text-gray-400 text-xs mb-3 uppercase tracking-wider">
          {connected.length} participant{connected.length > 1 ? 's' : ''} connecté{connected.length > 1 ? 's' : ''}
        </p>
        <ParticipantList participants={participants} />
      </div>

      <p className="text-gray-600 text-sm mt-10">En attente du host…</p>
    </div>
  )
}
