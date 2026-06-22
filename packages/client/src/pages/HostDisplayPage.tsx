import { useHostSession } from '../hooks/useHostSession'
import { QrCode } from '../components/QrCode'

// Vue TV : passive, lisible à distance (PIN ≥ 96px, pseudos ≥ 24px).
export function HostDisplayPage() {
  const { pin, participants, status, error } = useHostSession('display')

  const connected = participants.filter((p) => p.connected)
  const joinUrl = pin ? `${window.location.origin}/join?pin=${pin}` : ''

  if (error) {
    return (
      <div className="min-h-screen bg-gray-950 text-white flex items-center justify-center p-10 text-center text-3xl">
        {error}
      </div>
    )
  }

  if (!pin) {
    return (
      <div className="min-h-screen bg-gray-950 text-gray-400 flex items-center justify-center text-3xl">
        Chargement…
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white flex flex-col items-center justify-center p-10 gap-8">
      <h1 className="text-5xl font-black tracking-tight">LYA QUIZ</h1>

      <div className="bg-white p-5 rounded-3xl">
        <QrCode value={joinUrl} size={300} />
      </div>

      <div className="text-center">
        <p className="text-2xl text-gray-300">
          Rejoins sur <span className="text-white font-semibold">{window.location.host}</span>
        </p>
        <p className="text-[96px] leading-none font-black font-mono tracking-widest mt-2">
          {pin}
        </p>
      </div>

      <div className="w-full max-w-5xl">
        <p className="text-center text-gray-400 text-2xl mb-4">
          {connected.length} participant{connected.length > 1 ? 's' : ''}
        </p>
        <div className="flex flex-wrap justify-center gap-3">
          {connected.map((p) => (
            <span
              key={p.id}
              className="px-6 py-2 rounded-full bg-gray-800 text-2xl font-medium"
            >
              {p.pseudo}
            </span>
          ))}
        </div>
      </div>

      <p className="text-gray-500 text-3xl mt-4">
        {status === 'running' ? 'Le quiz a commencé !' : 'En attente du host…'}
      </p>
    </div>
  )
}
