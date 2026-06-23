// Styles des choix MCQ (façon Kahoot) : couleur + forme, indexés par position.
// Réutilisés par le téléphone (boutons) et la TV (grille de choix).
export const CHOICE_STYLES = [
  { bg: 'bg-red-600', solid: 'bg-red-600', shape: '▲', label: 'A' },
  { bg: 'bg-blue-600', solid: 'bg-blue-600', shape: '◆', label: 'B' },
  { bg: 'bg-amber-500', solid: 'bg-amber-500', shape: '●', label: 'C' },
  { bg: 'bg-emerald-600', solid: 'bg-emerald-600', shape: '■', label: 'D' },
] as const

export function choiceStyle(index: number) {
  return CHOICE_STYLES[index % CHOICE_STYLES.length]!
}
