import { useState } from 'react'
import { EVENTS } from '@lya-quiz/shared'
import { socket } from '../socket'
import { useHostSession } from '../hooks/useHostSession'
import { QrCode } from '../components/QrCode'

export function HostControlPage() {
  const { pin, participants, status, error } = useHostSession('control')
  const [started, setStarted] = useState(false)

  const connected = participants.filter((p) => p.connected)
  const joinUrl = pin ? `${window.location.origin}/join?pin=${pin}` : ''
  const running = started || status === 'running'

  function startQuiz() {
    socket.emit(EVENTS.HOST_START_QUIZ, {})
    setStarted(true)
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-950 text-white flex items-center justify-center p-8 text-center text-xl">
        {error}
      </div>
    )
  }

  if (!pin) {
    return (
      <div className="min-h-screen bg-gray-950 text-gray-400 flex items-center justify-center">
        Création de la session…
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white flex flex-col">
      <header className="flex items-center justify-between px-8 py-5 border-b border-gray-800">
        <h1 className="text-2xl font-bold">LYA QUIZ</h1>
        <p className="text-gray-400">
          Session ·{' '}
          <span className="text-white font-mono font-bold tracking-widest">{pin}</span>
        </p>
      </header>

      <div className="flex-1 grid md:grid-cols-2 gap-8 p-8">
        {/* Colonne gauche : QR + PIN */}
        <section className="flex flex-col items-center justify-center gap-6 bg-gray-900 rounded-3xl p-8">
          <div className="bg-white p-4 rounded-2xl">
            <QrCode value={joinUrl} size={260} />
          </div>
          <div className="text-center">
            <p className="text-gray-400 text-sm uppercase tracking-wider mb-1">PIN</p>
            <p className="text-7xl font-black tracking-widest font-mono">{pin}</p>
          </div>
          <p className="text-gray-500 text-sm text-center break-all">{joinUrl}</p>
        </section>

        {/* Colonne droite : participants */}
        <section className="bg-gray-900 rounded-3xl p-8 flex flex-col">
          <div className="flex items-baseline justify-between mb-4">
            <h2 className="text-xl font-bold">Participants</h2>
            <span className="text-indigo-400 font-bold text-2xl">{connected.length}</span>
          </div>
          {connected.length === 0 ? (
            <p className="text-gray-500 flex-1 flex items-center justify-center">
              En attente de participants…
            </p>
          ) : (
            <ul className="space-y-2 overflow-y-auto flex-1">
              {connected.map((p) => (
                <li
                  key={p.id}
                  className="flex items-center gap-3 px-4 py-3 rounded-xl bg-gray-800"
                >
                  <span className="w-2 h-2 rounded-full bg-green-400 flex-shrink-0" />
                  <span className="font-medium">{p.pseudo}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <footer className="px-8 py-6 border-t border-gray-800 flex items-center justify-between gap-6">
        <div className="text-gray-400">
          <span className="text-xs uppercase tracking-wider">Prochaine question</span>
          <p className="text-white">
            «&nbsp;…&nbsp;» <span className="text-gray-600 text-sm">(branché en S8)</span>
          </p>
        </div>
        <button
          onClick={startQuiz}
          disabled={connected.length === 0 || running}
          className="px-10 py-4 rounded-2xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed font-bold text-lg transition-colors"
        >
          {running ? 'Quiz démarré' : 'Démarrer le quiz'}
        </button>
      </footer>
    </div>
  )
}
