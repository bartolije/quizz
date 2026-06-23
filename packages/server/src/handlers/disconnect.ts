import type { Server } from 'socket.io'
import type { ClientToServerEvents, ServerToClientEvents } from '@lya-quiz/shared'
import { EVENTS } from '@lya-quiz/shared'
import type { SessionState } from '../state.js'
import { logEvent } from '../logger.js'

export function handleDisconnect(
  socketId: string,
  io: Server<ClientToServerEvents, ServerToClientEvents>,
  getAllSessions: () => SessionState[],
): void {
  for (const session of getAllSessions()) {
    // Chercher si ce socket était un participant
    for (const participant of session.participants.values()) {
      if (participant.socketId === socketId) {
        participant.connected = false
        participant.disconnectedAt = Date.now()

        // Notifier les autres (y compris le host)
        io.to(session.id).emit(EVENTS.PARTICIPANT_LEFT, {
          participantId: participant.id,
        })
        logEvent('participant_left', { sessionId: session.id, participantId: participant.id })
        return
      }
    }

    // Chercher si c'était le host
    if (session.hostSocketIds.has(socketId)) {
      session.hostSocketIds.delete(socketId)
      return
    }
  }
}
