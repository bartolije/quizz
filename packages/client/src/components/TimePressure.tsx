// Vignette rouge pulsante sur les bords de l'écran, pour la pression de fin de
// temps (≤ 5 s). Overlay non interactif, par-dessus tout.
export function TimePressure({ active }: { active: boolean }) {
  if (!active) return null
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 z-50 animate-pulse"
      style={{ boxShadow: 'inset 0 0 90px 18px rgba(239,68,68,0.55)' }}
    />
  )
}
