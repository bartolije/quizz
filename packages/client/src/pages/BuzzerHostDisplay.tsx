import type { HostSessionView } from '../hooks/useHostSession'
import { QrCode } from '../components/QrCode'
import { ConnectionBanner } from '../components/ConnectionBanner'

const DIFF: Record<string, { label: string; pts: number; cls: string }> = {
  facile: { label: 'Facile', pts: 1, cls: 'bg-emerald-600' },
  moyen: { label: 'Moyen', pts: 2, cls: 'bg-amber-600' },
  difficile: { label: 'Difficile', pts: 3, cls: 'bg-rose-600' },
}

// Écran TV (passif) en mode buzzer : grand, lisible à distance. Ne pilote rien.
export function BuzzerHostDisplay({ s }: { s: HostSessionView }) {
  const joinUrl = s.pin ? `${window.location.origin}/join?pin=${s.pin}` : ''
  const b = s.buzz
  const q = s.buzzQuestion
  const diff = q?.difficulty ? DIFF[q.difficulty] : null
  const shell = 'h-[100dvh] bg-gray-950 text-white flex flex-col'

  if (s.status === 'waiting') {
    return (
      <div className={`${shell} items-center justify-center gap-8`}>
        <ConnectionBanner connected={s.socketConnected} />
        <h1 className="text-5xl font-black">Rejoins la partie 🎙️</h1>
        <div className="bg-white p-5 rounded-3xl"><QrCode value={joinUrl} size={280} /></div>
        <p className="text-8xl font-black tracking-widest font-mono">{s.pin}</p>
        <p className="text-2xl text-indigo-300">{s.participants.filter((p) => p.connected).length} joueur·euse·s prêt·e·s</p>
      </div>
    )
  }

  if (s.status === 'ended' || s.leaderboardFinal) {
    const [first, second, third] = s.leaderboard
    return (
      <div className={`${shell} items-center justify-center gap-6`}>
        <div className="text-7xl">🏆</div>
        <h1 className="text-5xl font-black">Podium</h1>
        <ol className="w-full max-w-xl space-y-3 mt-4">
          {[first, second, third].filter(Boolean).map((sc, i) => (
            <li key={sc!.participantId} className={`flex items-center justify-between px-6 py-4 rounded-2xl text-2xl ${['bg-amber-500 text-black', 'bg-gray-400 text-black', 'bg-orange-800'][i]}`}>
              <span className="font-black">{['🥇', '🥈', '🥉'][i]} {sc!.pseudo}</span>
              <span className="font-mono font-black">{sc!.score}</span>
            </li>
          ))}
        </ol>
      </div>
    )
  }

  // En jeu
  return (
    <div className={shell}>
      <ConnectionBanner connected={s.socketConnected} />
      <div className="flex-1 flex flex-col items-center justify-center gap-8 p-10 text-center">
        {!b || !q ? (
          <p className="text-4xl text-gray-400">Prêts pour la prochaine question…</p>
        ) : (
          <>
            <div className="flex items-center gap-4">
              {diff && <span className={`px-4 py-2 rounded-full text-xl font-bold ${diff.cls}`}>{diff.label} · {diff.pts} pt{diff.pts > 1 ? 's' : ''}</span>}
              {q.section === 'perso' && b.ownerName && <span className="px-4 py-2 rounded-full text-xl bg-indigo-700">Thème de {b.ownerName}</span>}
            </div>
            <h1 className="text-5xl font-black leading-tight max-w-4xl">{q.text}</h1>

            {b.phase === 'revealed' ? (
              <div className="flex flex-col items-center gap-3">
                <p className="text-gray-400 uppercase tracking-widest">Réponse</p>
                <p className="text-4xl font-bold text-emerald-400">{s.buzzReveal?.correctAnswers.join(' · ')}</p>
                <p className="text-2xl mt-2">
                  {s.buzzReveal?.scorer ? `🎉 ${s.buzzReveal.scorer.pseudo} +${s.buzzReveal.scorer.points}` : '🤷 Personne'}
                </p>
              </div>
            ) : b.phase === 'owner_oral' ? (
              <p className="text-3xl">🗣️ Au tour de <span className="font-black text-indigo-300">{b.ownerName}</span></p>
            ) : b.phase === 'locked' ? (
              <p className="text-4xl font-black text-emerald-400 animate-pulse">🎤 {b.lockedBy?.pseudo} !</p>
            ) : b.armed ? (
              <p className="text-3xl text-rose-400 animate-pulse">🔔 BUZZ ! Qui sait ?</p>
            ) : (
              <p className="text-3xl text-amber-400">⏸️ On reprend…</p>
            )}
          </>
        )}
      </div>
    </div>
  )
}
