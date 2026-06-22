import type { Participant } from '@lya-quiz/shared'

interface Props {
  participants: Participant[]
}

export function ParticipantList({ participants }: Props) {
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
        </li>
      ))}
    </ul>
  )
}
