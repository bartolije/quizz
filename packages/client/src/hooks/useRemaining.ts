import { useEffect, useState } from 'react'

/**
 * Décompte le temps restant (en secondes) à partir d'un instant de départ
 * (horloge client) et d'une durée. Renvoie 0 si pas de question en cours.
 * Tick à 200 ms — assez fluide pour un anneau de timer sans surcharger.
 */
export function useRemaining(startedAt: number | null, timeLimit: number): number {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (startedAt === null) return
    const id = setInterval(() => setNow(Date.now()), 200)
    return () => clearInterval(id)
  }, [startedAt])

  if (startedAt === null) return 0
  return Math.max(0, timeLimit - (now - startedAt) / 1000)
}
