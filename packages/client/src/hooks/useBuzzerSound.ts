import { useEffect, useRef, useState } from 'react'
import type { BuzzState, SessionStatus } from '@lya-quiz/shared'
import { enableSound, setMuted, playLoop, stopLoop, playOnce } from '../sound'

// Audio de la partie famille (TV/host uniquement). Sons ponctuels sur les
// transitions du buzzer (quelqu'un buzze / révélation / podium) + ambiance légère
// hors question active. Débloqué par un geste (« Activer le son »). Fichiers
// absents → no-op silencieux (cf. sound.ts).
export function useBuzzerSound(status: SessionStatus, buzz: BuzzState | null) {
  const [on, setOn] = useState(false)
  const [muted, setMutedState] = useState(false)
  const prevPhase = useRef<string | null>(null)

  useEffect(() => {
    if (!on || muted) return
    const phase = buzz?.phase ?? null
    const prev = prevPhase.current
    prevPhase.current = phase

    if (status === 'ended') { stopLoop(); playOnce('podium'); return }
    if (phase === 'locked' && prev !== 'locked') { playOnce('buzz'); return }       // quelqu'un a buzzé
    if (phase === 'revealed' && prev !== 'revealed') { stopLoop(); playOnce('reveal'); return } // révélation
    if (phase === null || phase === 'owner_oral') { playLoop('lobby'); return }      // attente / owner à l'oral
    if (phase === 'steal') { stopLoop(); return }                                   // buzzer ouvert : silence tendu
  }, [status, buzz?.phase, on, muted])

  const enable = () => { enableSound(); setOn(true); playLoop('lobby') }
  const toggleMute = () =>
    setMutedState((m) => {
      const next = !m
      setMuted(next)
      return next
    })

  return { on, muted, enable, toggleMute }
}
