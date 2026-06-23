import { useState } from 'react'

// Affiche l'image d'une question proprement : jamais déformée (object-contain),
// hauteur bornée, centrée. Masquée si l'URL est vide ou si l'image casse au
// chargement (pas d'icône d'image brisée). Penser à un key={url} côté parent
// pour réinitialiser l'état d'erreur quand l'image change.
export function QuestionImage({
  url,
  className,
}: {
  url?: string | undefined
  className?: string
}) {
  const [broken, setBroken] = useState(false)
  if (!url || broken) return null
  return (
    <img
      src={url}
      alt=""
      onError={() => setBroken(true)}
      className={`object-contain rounded-2xl bg-black/20 mx-auto ${className ?? ''}`}
    />
  )
}
