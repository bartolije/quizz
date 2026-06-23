import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { socket } from '../socket'
import { useQuizStore } from '../store/quiz-store'
import { EVENTS } from '@lya-quiz/shared'

export function JoinPage() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()

  // PIN pré-rempli depuis le QR code (/join?pin=XXXX)
  const [pin, setPin] = useState(
    () => (searchParams.get('pin') ?? '').replace(/\D/g, '').slice(0, 4),
  )
  const [pseudo, setPseudo]   = useState('')
  const [error, setError]     = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  // Ref pour éviter la stale closure dans le setTimeout (le state `loading`
  // capturé à la fermeture serait toujours `false`).
  const loadingRef = useRef(false)

  const setJoined = useQuizStore((s) => s.setJoined)

  // Reprise au reload : pas de QR (?pin absent) + un token présent → on retourne
  // directement dans la partie via /lobby (ParticipantApp tente la reconnexion).
  // Avec ?pin (scan d'un QR), on garde le formulaire pour rejoindre cette session.
  useEffect(() => {
    if (!searchParams.get('pin') && localStorage.getItem('lya_quiz_token')) {
      navigate('/lobby', { replace: true })
    }
  }, [navigate, searchParams])

  function handleJoin() {
    if (!pin.trim() || !pseudo.trim()) return
    setError(null)
    setLoading(true)
    loadingRef.current = true

    // Connecter le socket si pas encore connecté
    if (!socket.connected) socket.connect()

    const existingToken = localStorage.getItem('lya_quiz_token')

    socket.emit(EVENTS.JOIN_SESSION, {
      pin: pin.trim(),
      pseudo: pseudo.trim(),
      sessionToken: existingToken,
    })

    // Écouter la confirmation (one-time)
    socket.once(EVENTS.SESSION_JOINED, (payload) => {
      localStorage.setItem('lya_quiz_token', payload.sessionToken)
      setJoined({
        myId: payload.participant.id,
        myPseudo: payload.participant.pseudo,
        sessionPin: payload.session.pin,
        sessionId: payload.sessionId,
        participants: payload.participants,
      })
      setLoading(false)
      loadingRef.current = false

      // Les listeners temps réel (participants + questions) sont branchés par
      // ParticipantApp via useParticipantEvents — rien à faire ici.
      navigate('/lobby')
    })

    socket.once(EVENTS.QUIZ_ERROR, (err) => {
      setError(err.message)
      setLoading(false)
      loadingRef.current = false
    })

    // Timeout si le serveur ne répond pas (loadingRef évite la stale closure)
    setTimeout(() => {
      if (loadingRef.current) {
        setError('Impossible de joindre la session. Vérifie le PIN.')
        setLoading(false)
        loadingRef.current = false
      }
    }, 5000)
  }

  return (
    <div className="min-h-screen bg-gray-950 flex flex-col items-center justify-center p-6">
      <h1 className="text-4xl font-bold text-white mb-2">LYA QUIZ</h1>
      <p className="text-gray-400 mb-10 text-sm">Rejoins la session</p>

      <div className="w-full max-w-sm space-y-4">
        <input
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={4}
          placeholder="PIN (4 chiffres)"
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
          onKeyDown={(e) => e.key === 'Enter' && handleJoin()}
          className="w-full text-center text-3xl font-bold tracking-widest bg-gray-800 text-white rounded-2xl px-6 py-5 border-2 border-gray-700 focus:border-indigo-500 outline-none"
          autoFocus
        />

        <input
          type="text"
          maxLength={20}
          placeholder="Ton pseudo"
          value={pseudo}
          onChange={(e) => setPseudo(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleJoin()}
          className="w-full text-center text-xl bg-gray-800 text-white rounded-2xl px-6 py-4 border-2 border-gray-700 focus:border-indigo-500 outline-none"
        />

        {error && (
          <p className="text-red-400 text-center text-sm">{error}</p>
        )}

        <button
          onClick={handleJoin}
          disabled={loading || !pin || !pseudo}
          className="w-full py-5 rounded-2xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xl font-bold transition-colors"
        >
          {loading ? 'Connexion...' : 'Rejoindre →'}
        </button>
      </div>
    </div>
  )
}
