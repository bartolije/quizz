import { useEffect, useRef, useState } from 'react'
import type {
  Participant,
  ServerToClientEvents,
  SessionStatus,
} from '@lya-quiz/shared'
import { EVENTS } from '@lya-quiz/shared'
import { socket } from '../socket'
import {
  readHostSession,
  writeHostSession,
  createHostSession,
  fetchSessionInfo,
} from '../host-session'

type HostMode = 'control' | 'display'

interface HostSessionView {
  pin: string | null
  sessionId: string | null
  participants: Participant[]
  status: SessionStatus
  error: string | null
}

// Types de payload dérivés du contrat → garantit l'alignement avec events.ts
type JoinedPayload = Parameters<ServerToClientEvents['session_joined']>[0]
type JoinPayload = Parameters<ServerToClientEvents['participant_joined']>[0]
type LeftPayload = Parameters<ServerToClientEvents['participant_left']>[0]

function upsert(list: Participant[], p: Participant): Participant[] {
  return list.some((x) => x.id === p.id)
    ? list.map((x) => (x.id === p.id ? p : x))
    : [...list, p]
}

/**
 * Résout/crée la session host et maintient la liste des participants à jour
 * via Socket.io. `control` crée la session (POST), `display` la résout
 * (localStorage ou ?session= via GET). StrictMode-safe (ref guard + 2 effects).
 */
export function useHostSession(mode: HostMode): HostSessionView {
  const [pin, setPin] = useState<string | null>(null)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [participants, setParticipants] = useState<Participant[]>([])
  const [status, setStatus] = useState<SessionStatus>('waiting')
  const [error, setError] = useState<string | null>(null)

  const resolvedRef = useRef(false)

  // Effet 1 — résolution one-shot (évite la double création en StrictMode dev)
  useEffect(() => {
    if (resolvedRef.current) return
    resolvedRef.current = true

    void (async () => {
      const stored = readHostSession()
      const urlSession = new URLSearchParams(window.location.search).get('session')

      try {
        if (mode === 'control') {
          if (stored) {
            setPin(stored.pin)
            setSessionId(stored.sessionId)
          } else {
            const created = await createHostSession()
            writeHostSession(created)
            setPin(created.pin)
            setSessionId(created.sessionId)
          }
          return
        }

        // mode 'display' : résoudre une session existante
        const targetId = urlSession ?? stored?.sessionId ?? null
        if (!targetId) {
          setError('Aucune session. Ouvre d’abord /host/control.')
          return
        }
        const info = await fetchSessionInfo(targetId)
        if (!info) {
          setError('Session introuvable ou expirée.')
          return
        }
        setParticipants(info.participants)
        setStatus(info.status)
        setPin(info.pin)
        setSessionId(info.sessionId)
      } catch {
        setError('Erreur de connexion au serveur.')
      }
    })()
  }, [mode])

  // Effet 2 — listeners temps réel + host_join, rebranchés quand le pin change
  useEffect(() => {
    if (!pin) return

    const onJoined = (p: JoinedPayload) => {
      // SESSION_JOINED = source de vérité (gère une session recréée côté serveur)
      setPin(p.session.pin)
      setSessionId(p.sessionId)
      setParticipants(p.participants)
      setStatus(p.session.status)
      writeHostSession({ sessionId: p.sessionId, pin: p.session.pin })
    }
    const onJoin = (p: JoinPayload) =>
      setParticipants((prev) => upsert(prev, p.participant))
    const onLeft = (p: LeftPayload) =>
      setParticipants((prev) =>
        prev.map((x) => (x.id === p.participantId ? { ...x, connected: false } : x)),
      )

    socket.on(EVENTS.SESSION_JOINED, onJoined)
    socket.on(EVENTS.PARTICIPANT_JOINED, onJoin)
    socket.on(EVENTS.PARTICIPANT_LEFT, onLeft)

    const join = () => socket.emit(EVENTS.HOST_JOIN, { pin })
    if (!socket.connected) socket.connect()
    if (socket.connected) join()
    else socket.once('connect', join)

    return () => {
      socket.off(EVENTS.SESSION_JOINED, onJoined)
      socket.off(EVENTS.PARTICIPANT_JOINED, onJoin)
      socket.off(EVENTS.PARTICIPANT_LEFT, onLeft)
      socket.off('connect', join)
    }
  }, [pin])

  return { pin, sessionId, participants, status, error }
}
