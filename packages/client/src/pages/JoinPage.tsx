import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { socket } from '../socket'
import { useQuizStore } from '../store/quiz-store'
import { EVENTS } from '@lya-quiz/shared'
import type { ServerToClientEvents } from '@lya-quiz/shared'

type JoinedPayload = Parameters<ServerToClientEvents['session_joined']>[0]
type ErrorPayload = Parameters<ServerToClientEvents['quiz_error']>[0]

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
  // Listeners de la tentative en cours : détachés dès qu'une réponse arrive (ou à
  // l'unmount) — sinon chaque tentative ratée laissait des `once` orphelins qui se
  // déclenchaient sur des events ultérieurs.
  const cleanupRef = useRef<() => void>(() => {})

  const setJoined = useQuizStore((s) => s.setJoined)
  // Message posé par onSessionLost (ex : restart serveur en pleine partie)
  const fatalNotice = useQuizStore((s) => s.fatalNotice)

  useEffect(() => () => cleanupRef.current(), [])

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

    // Écouter la confirmation — les DEUX listeners sont détachés dès que l'un
    // répond (une tentative = une réponse, pas de once orphelin).
    const onJoined = (payload: JoinedPayload) => {
      cleanupRef.current()
      localStorage.setItem('lya_quiz_token', payload.sessionToken)
      setJoined({
        myId: payload.participant.id,
        myPseudo: payload.participant.pseudo,
        sessionPin: payload.session.pin,
        sessionId: payload.sessionId,
        participants: payload.participants,
        mode: payload.mode,
        teams: payload.teams,
        teamsLocked: payload.teamsLocked,
        myTeamId: payload.participant.teamId ?? null,
        gameType: payload.gameType,
        sessionStatus: payload.session.status,
      })
      setLoading(false)
      loadingRef.current = false

      // Les listeners temps réel (participants + questions) sont branchés par
      // ParticipantApp via useParticipantEvents — rien à faire ici.
      navigate('/lobby')
    }
    const onError = (err: ErrorPayload) => {
      cleanupRef.current()
      setError(err.message)
      setLoading(false)
      loadingRef.current = false
    }
    cleanupRef.current()
    cleanupRef.current = () => {
      socket.off(EVENTS.SESSION_JOINED, onJoined)
      socket.off(EVENTS.QUIZ_ERROR, onError)
      cleanupRef.current = () => {}
    }
    socket.on(EVENTS.SESSION_JOINED, onJoined)
    socket.on(EVENTS.QUIZ_ERROR, onError)

    // Timeout si le serveur ne répond pas (loadingRef évite la stale closure)
    setTimeout(() => {
      if (loadingRef.current) {
        cleanupRef.current()
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
        {fatalNotice && (
          <p className="text-amber-300 bg-amber-950/60 border border-amber-700 rounded-xl px-4 py-3 text-center text-sm">
            {fatalNotice}
          </p>
        )}
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
