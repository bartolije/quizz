import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useQuizStore } from '../store/quiz-store'
import { ParticipantList } from '../components/ParticipantList'
import { TeamPicker } from '../components/TeamPicker'
import {
  isVibrationEnabled,
  setVibrationEnabled,
  vibrationSupported,
  vibrateTest,
} from '../haptics'

export function LobbyPage() {
  const myId         = useQuizStore((s) => s.myId)
  const sessionPin   = useQuizStore((s) => s.sessionPin)
  const myPseudo     = useQuizStore((s) => s.myPseudo)
  const participants = useQuizStore((s) => s.participants)
  const mode         = useQuizStore((s) => s.mode)
  const teams        = useQuizStore((s) => s.teams)
  const teamsLocked  = useQuizStore((s) => s.teamsLocked)
  const myTeamId     = useQuizStore((s) => s.myTeamId)
  const status       = useQuizStore((s) => s.sessionStatus)

  const [vib, setVib] = useState(isVibrationEnabled())

  // Pas encore rejoint (refresh direct sur /lobby) → retour au join
  if (!myId) return <Navigate to="/join" replace />

  // Le host a lancé le quiz : le téléphone le MONTRE (avant, rien ne changeait
  // entre le clic « Démarrer » et la première question — les joueurs doutaient).
  if (status === 'running') {
    return (
      <div className="h-dvh bg-gray-950 flex flex-col items-center justify-center p-6 text-center gap-4">
        <div className="text-7xl animate-bounce">🚀</div>
        <h1 className="text-3xl font-black text-white">C&apos;est parti !</h1>
        <p className="text-gray-400 text-lg">
          Prépare-toi, la question arrive — garde ton téléphone en main.
        </p>
        <p className="text-gray-600 text-sm">
          Tu joues en tant que <span className="text-gray-300 font-medium">{myPseudo}</span>
        </p>
      </div>
    )
  }

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

      {mode === 'team' && (
        <div className="w-full max-w-sm mb-8">
          <TeamPicker teams={teams} myTeamId={myTeamId} locked={teamsLocked} />
        </div>
      )}

      <div className="w-full max-w-sm">
        <p className="text-gray-400 text-xs mb-3 uppercase tracking-wider">
          {connected.length} participant{connected.length > 1 ? 's' : ''} connecté{connected.length > 1 ? 's' : ''}
        </p>
        <ParticipantList participants={participants} />
      </div>

      {/* Réglage vibrations (testable). Android : OK · iPhone : non supporté. */}
      <div className="w-full max-w-sm mt-8">
        <div className="flex items-center justify-between gap-3 bg-gray-900 rounded-xl px-4 py-3">
          <span className="text-sm text-gray-300">📳 Vibrations</span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                const n = !vib
                setVib(n)
                setVibrationEnabled(n)
                if (n) vibrateTest(60)
              }}
              className={`px-3 py-1.5 rounded-lg text-sm font-bold ${
                vib ? 'bg-indigo-600 text-white' : 'bg-gray-700 text-gray-300'
              }`}
            >
              {vib ? 'On' : 'Off'}
            </button>
            <button
              onClick={() => vibrateTest()}
              className="px-3 py-1.5 rounded-lg text-sm bg-gray-700 hover:bg-gray-600 text-gray-200"
            >
              Tester
            </button>
          </div>
        </div>
        {!vibrationSupported() && (
          <p className="text-gray-600 text-xs mt-2 text-center">
            Vibration non supportée sur cet appareil (ex. iPhone).
          </p>
        )}
      </div>

      <p className="text-gray-600 text-sm mt-10">En attente du host…</p>
    </div>
  )
}
