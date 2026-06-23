import { useEffect, useState } from 'react'
import { enableSound, setMuted, playLoop, stopLoop, playOnce } from '../sound'

type Phase = 'lobby' | 'question' | 'reveal' | 'leaderboard' | 'ended'

function applyPhase(phase: Phase): void {
  switch (phase) {
    case 'lobby':
    case 'leaderboard':
      playLoop('lobby')
      break
    case 'question':
      playLoop('question')
      break
    case 'reveal':
      stopLoop()
      playOnce('reveal')
      break
    case 'ended':
      stopLoop()
      playOnce('podium')
      break
  }
}

// Pilote l'audio de la TV selon la phase de jeu. L'audio doit être débloqué par
// un geste (bouton « Activer le son ») → enable() lance aussi un premier son
// DANS le geste pour satisfaire la politique d'autoplay des navigateurs.
export function useHostSound(phase: Phase) {
  const [on, setOn] = useState(false)
  const [muted, setMutedState] = useState(false)

  useEffect(() => {
    if (!on || muted) return
    applyPhase(phase)
  }, [phase, on, muted])

  const enable = () => {
    enableSound()
    setOn(true)
    applyPhase(phase) // premier son dans le geste (débloque l'audio)
  }

  const toggleMute = () => {
    setMutedState((m) => {
      const next = !m
      setMuted(next)
      return next
    })
  }

  return { on, muted, enable, toggleMute }
}
