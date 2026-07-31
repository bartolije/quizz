import type { HostSessionView } from '../hooks/useHostSession'
import { useBuzzerSound } from '../hooks/useBuzzerSound'
import { QrCode } from '../components/QrCode'
import { ConnectionBanner } from '../components/ConnectionBanner'
import { QuestionImage } from '../components/QuestionImage'

const ptsBadge = (pts: number): { label: string; cls: string } => ({
  label: `${pts} pt${pts > 1 ? 's' : ''}`,
  cls: pts >= 4 ? 'bg-fuchsia-600' : pts === 3 ? 'bg-rose-600' : pts === 2 ? 'bg-amber-600' : 'bg-emerald-600',
})

// Écran TV (passif) en mode buzzer : grand, lisible à distance. Ne pilote rien.
export function BuzzerHostDisplay({ s }: { s: HostSessionView }) {
  const joinUrl = s.pin ? `${window.location.origin}/join?pin=${s.pin}` : ''
  const b = s.buzz
  const q = s.buzzQuestion
  const badge = q?.points ? ptsBadge(q.points) : null
  // `min-h-dvh` et pas `h-dvh` : avec beaucoup de thèmes le contenu dépasse
  // l'écran — la page doit grandir (fond compris) au lieu de déborder d'un
  // shell figé, où `justify-center` rend en plus le haut inatteignable.
  const shell = 'min-h-dvh bg-gray-950 text-white flex flex-col'
  const sound = useBuzzerSound(s.status, s.buzz)

  const soundCtl = (
    <div className="fixed top-4 right-4 z-40">
      {!sound.on ? (
        <button onClick={sound.enable} className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 font-bold text-white">🔊 Activer le son</button>
      ) : (
        <button onClick={sound.toggleMute} className="px-3 py-2 rounded-xl bg-gray-800 hover:bg-gray-700 text-2xl" title={sound.muted ? 'Activer' : 'Couper'}>{sound.muted ? '🔇' : '🔊'}</button>
      )}
    </div>
  )

  if (s.status === 'waiting') {
    return (
      <div className={`${shell} items-center justify-center gap-8`}>
        <ConnectionBanner connected={s.socketConnected} />
        {soundCtl}
        <h1 className="text-5xl font-black">Rejoins la partie 🎙️</h1>
        <div className="bg-white p-5 rounded-3xl"><QrCode value={joinUrl} size={280} /></div>
        <p className="text-8xl font-black tracking-widest font-mono">{s.pin}</p>
        <p className="text-2xl text-indigo-300">{s.participants.filter((p) => p.connected || p.manual).length} joueur·euse·s prêt·e·s</p>
      </div>
    )
  }

  if (s.status === 'ended' || s.leaderboardFinal) {
    const [first, second, third] = s.leaderboard
    return (
      <div className={`${shell} items-center justify-center gap-6`}>
        {soundCtl}
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
      {soundCtl}
      <div className="flex-1 flex flex-col items-center justify-center gap-8 p-10 text-center">
        {!b || !q ? (
          (() => {
            // Entre deux thèmes : la TV affiche les thèmes (joués barrés) et le
            // joueur dont c'est le tour de choisir — le sien ou celui d'un autre.
            const turn = s.themes?.turn
            const current = turn && turn.index < turn.order.length ? turn.order[turn.index] : null
            const owners = s.themes?.owners ?? []
            if (owners.length === 0) return <p className="text-4xl text-gray-400">Prêts pour la prochaine question…</p>
            return (
              <>
                {current ? (
                  <h1 className="text-5xl font-black">🎯 Au tour de <span className="text-indigo-300">{current.pseudo}</span></h1>
                ) : (
                  <h1 className="text-4xl font-black text-gray-300">Choix du thème…</h1>
                )}
                {current && <p className="text-2xl text-gray-400">Choisis un thème pas encore joué — le tien ou celui d'un·e autre !</p>}
                <div className="flex flex-wrap justify-center gap-3 max-w-5xl">
                  {/* Le nom du THÈME, pas celui du joueur : on peut voler le thème
                      d'un·e autre sans savoir à qui il appartient. */}
                  {owners.map((o) => (
                    <span
                      key={o.ownerName}
                      className={`px-6 py-3 rounded-2xl text-2xl font-bold ${o.done ? 'bg-gray-800 text-gray-600 line-through' : 'bg-indigo-700'}`}
                    >
                      {o.themeName ?? o.ownerName}
                    </span>
                  ))}
                  {s.themes && s.themes.culture.total > 0 && (
                    <span className={`px-6 py-3 rounded-2xl text-2xl font-bold ${s.themes.culture.done ? 'bg-gray-800 text-gray-600 line-through' : 'bg-violet-700'}`}>
                      🌍 Culture G
                    </span>
                  )}
                </div>
                {turn && (
                  <p className="text-xl text-gray-500">
                    Ordre de passage : {turn.order.map((t, i) => (i === turn.index ? `▶ ${t.pseudo}` : t.pseudo)).join(' · ')}
                  </p>
                )}
              </>
            )
          })()
        ) : (
          <>
            <div className="flex items-center gap-4">
              {badge && <span className={`px-4 py-2 rounded-full text-xl font-bold ${badge.cls}`}>{badge.label}</span>}
              {/* Perso ET libre : même badge, la salle ne peut pas les distinguer */}
              {(q.section === 'perso' || q.section === 'libre') && (q.themeName || b.ownerName) && (
                <span className="px-4 py-2 rounded-full text-xl bg-indigo-700">
                  {q.themeName ? `Thème ${q.themeName}` : `Thème de ${b.ownerName}`}
                </span>
              )}
            </div>
            <h1 className="text-5xl font-black leading-tight max-w-4xl">{q.text}</h1>
            {q.mediaUrl && <QuestionImage key={q.mediaUrl} url={q.mediaUrl} className="max-h-[42vh] max-w-3xl rounded-2xl" />}

            {b.phase === 'revealed' ? (
              <div className="flex flex-col items-center gap-3">
                <p className="text-gray-400 uppercase tracking-widest">Réponse</p>
                <p className="text-4xl font-bold text-emerald-400">{s.buzzReveal?.correctAnswers.join(' · ')}</p>
                <p className="text-2xl mt-2">
                  {s.buzzReveal?.scorer ? `🎉 ${s.buzzReveal.scorer.pseudo} +${s.buzzReveal.scorer.points}` : '🤷 Personne'}
                </p>
              </div>
            ) : b.phase === 'owner_oral' ? (
              <p className="text-3xl">
                🗣️ À <span className="font-black text-indigo-300">
                  {(b.ownerParticipantId && s.participants.find((p) => p.id === b.ownerParticipantId)?.pseudo) ?? b.ownerName}
                </span> de répondre
              </p>
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
