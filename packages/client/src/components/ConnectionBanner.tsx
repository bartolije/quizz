// Bandeau fixe affiché pendant une coupure Socket.io (host control + TV).
// La reconnexion est automatique (config shared) — le bandeau sert uniquement
// à ce qu'une coupure ne passe JAMAIS inaperçue pendant la soirée.
export function ConnectionBanner({ connected }: { connected: boolean }) {
  if (connected) return null
  return (
    <div className="fixed top-0 inset-x-0 z-50 bg-amber-500 text-gray-950 text-center font-bold py-2 px-4 animate-pulse">
      ⚠️ Connexion au serveur perdue — reconnexion en cours…
    </div>
  )
}
