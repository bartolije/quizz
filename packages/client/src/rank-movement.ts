// Mouvement d'un participant entre le classement précédent et l'actuel.
export type Movement = 'up' | 'down' | 'same' | 'new'

export function rankMovement(
  prevRanks: Record<string, number>,
  id: string,
  rank: number,
): Movement {
  const prev = prevRanks[id]
  if (prev === undefined) return 'new'
  if (prev > rank) return 'up'
  if (prev < rank) return 'down'
  return 'same'
}

// Petite pastille ▲/▼ ; rien pour "stable" ou "nouveau" (évite le bruit visuel).
export function movementMark(m: Movement): { icon: string; className: string } {
  switch (m) {
    case 'up':
      return { icon: '▲', className: 'text-emerald-400' }
    case 'down':
      return { icon: '▼', className: 'text-rose-400' }
    default:
      return { icon: '', className: '' }
  }
}
