import type { Participant } from '@lya-quiz/shared'

interface Props {
  participants: Participant[]
  // Fourni par l'écran de contrôle host uniquement : bouton ✕ d'éjection
  onKick?: (participantId: string) => void
}

export function ParticipantList({ participants, onKick }: Props) {
  return (
    <ul className="space-y-2">
      {participants.map((p) => (
        <li
          key={p.id}
          className={`flex items-center gap-3 px-4 py-3 rounded-xl bg-gray-800 transition-opacity ${
            p.connected ? 'opacity-100' : 'opacity-40'
          }`}
        >
          <span
            className={`w-2 h-2 rounded-full flex-shrink-0 ${
              p.connected ? 'bg-green-400' : 'bg-gray-600'
            }`}
          />
          <span className="text-white font-medium">{p.pseudo}</span>
          {!p.connected && (
            <span className="ml-auto text-gray-500 text-xs">déconnecté</span>
          )}
          {onKick && (
            <button
              type="button"
              onClick={() => {
                if (window.confirm(`Retirer ${p.pseudo} de la partie ?`)) onKick(p.id)
              }}
              className={`${p.connected ? 'ml-auto' : 'ml-2'} px-2 py-1 rounded-lg text-gray-500 hover:text-red-400 hover:bg-gray-700 transition-colors`}
              title={`Retirer ${p.pseudo}`}
              aria-label={`Retirer ${p.pseudo}`}
            >
              ✕
            </button>
          )}
        </li>
      ))}
    </ul>
  )
}
