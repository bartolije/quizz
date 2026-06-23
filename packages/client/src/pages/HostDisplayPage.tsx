import { useHostSession } from '../hooks/useHostSession'
import { useRemaining } from '../hooks/useRemaining'
import { QrCode } from '../components/QrCode'
import { choiceStyle } from '../mcq'
import { rankMovement, movementMark } from '../rank-movement'
import { TimePressure } from '../components/TimePressure'

// Vue TV : passive, lisible à distance. Énoncé + choix pendant la question
// (le téléphone ne montre que les boutons), puis révélation, puis classement.
export function HostDisplayPage() {
  const s = useHostSession('display')
  const connected = s.participants.filter((p) => p.connected)
  const joinUrl = s.pin ? `${window.location.origin}/join?pin=${s.pin}` : ''
  const remaining = useRemaining(s.questionStartedAt, s.currentQuestion?.timeLimit ?? 0)
  const lowTime = remaining > 0 && remaining <= 5

  if (s.error) {
    return (
      <div className="min-h-screen bg-gray-950 text-white flex items-center justify-center p-10 text-center text-3xl">
        {s.error}
      </div>
    )
  }
  if (!s.pin) {
    return (
      <div className="min-h-screen bg-gray-950 text-gray-400 flex items-center justify-center text-3xl">
        Chargement…
      </div>
    )
  }

  const phase =
    s.status === 'ended' || s.leaderboardFinal
      ? 'ended'
      : s.showingLeaderboard
        ? 'leaderboard'
        : s.reveal
          ? 'reveal'
          : s.currentQuestion && s.questionStartedAt
            ? 'question'
            : 'lobby'

  const q = s.currentQuestion
  const total = s.totalCount || connected.length

  // ── Lobby (avant le démarrage) ───────────────────────────────
  if (phase === 'lobby') {
    return (
      <div className="min-h-screen bg-gray-950 text-white flex flex-col items-center justify-center p-10 gap-8">
        <h1 className="text-5xl font-black tracking-tight">LYA QUIZ</h1>
        <div className="bg-white p-5 rounded-3xl">
          <QrCode value={joinUrl} size={300} />
        </div>
        <div className="text-center">
          <p className="text-2xl text-gray-300">
            Rejoins sur <span className="text-white font-semibold">{window.location.host}</span>
          </p>
          <p className="text-[96px] leading-none font-black font-mono tracking-widest mt-2">{s.pin}</p>
        </div>
        <div className="w-full max-w-5xl">
          <p className="text-center text-gray-400 text-2xl mb-4">
            {connected.length} participant{connected.length > 1 ? 's' : ''}
          </p>
          <div className="flex flex-wrap justify-center gap-3">
            {connected.map((p) => (
              <span key={p.id} className="px-6 py-2 rounded-full bg-gray-800 text-2xl font-medium">
                {p.pseudo}
              </span>
            ))}
          </div>
        </div>
        <p className="text-gray-500 text-3xl mt-4">En attente du host…</p>
      </div>
    )
  }

  // ── Classement intermédiaire ─────────────────────────────────
  if (phase === 'leaderboard') {
    return (
      <div className="min-h-screen bg-gray-950 text-white flex flex-col items-center justify-center p-10 gap-8">
        <h1 className="text-5xl font-black">Classement</h1>
        <ol className="w-full max-w-3xl space-y-3">
          {s.leaderboard.slice(0, 5).map((sc) => {
            const mv = movementMark(rankMovement(s.prevRanks, sc.participantId, sc.rank))
            return (
              <li
                key={sc.participantId}
                className="flex items-center gap-5 px-8 py-5 rounded-2xl bg-gray-900 text-3xl"
              >
                <span className="w-12 text-center font-black text-indigo-400">{sc.rank}</span>
                <span className={`w-8 ${mv.className}`}>{mv.icon}</span>
                <span className="font-bold flex-1">{sc.pseudo}</span>
                {sc.delta > 0 && <span className="text-emerald-400 text-2xl">+{sc.delta}</span>}
                <span className="font-mono font-black tabular-nums">{sc.score}</span>
              </li>
            )
          })}
        </ol>
      </div>
    )
  }

  // ── Podium final ─────────────────────────────────────────────
  if (phase === 'ended') {
    return (
      <div className="min-h-screen bg-gray-950 text-white flex flex-col items-center justify-center p-10 gap-8">
        <div className="text-7xl">🏆</div>
        <h1 className="text-6xl font-black">Classement final</h1>
        <ol className="w-full max-w-3xl space-y-3">
          {s.leaderboard.slice(0, 5).map((sc) => (
            <li
              key={sc.participantId}
              className="flex items-center justify-between px-8 py-5 rounded-2xl bg-gray-900 text-3xl"
            >
              <span className="font-bold">
                {sc.rank}. {sc.pseudo}
              </span>
              <span className="font-mono font-black tabular-nums">{sc.score}</span>
            </li>
          ))}
        </ol>
      </div>
    )
  }

  // ── Question en cours / Révélation ───────────────────────────
  const maxCount = Math.max(1, ...(s.reveal?.distribution.map((d) => d.count) ?? [1]))

  return (
    <div className="min-h-screen bg-gray-950 text-white flex flex-col p-10">
      <TimePressure active={phase === 'question' && lowTime} />
      <div className="flex items-center justify-between mb-6">
        <span className="text-2xl text-gray-400">
          Question {q!.index + 1} / {q!.total}
        </span>
        {phase === 'question' ? (
          <span
            className={`font-black tabular-nums ${
              lowTime ? 'text-7xl text-red-500 animate-pulse' : 'text-6xl'
            }`}
          >
            {Math.ceil(remaining)}
          </span>
        ) : (
          <span className="text-3xl text-emerald-400 font-bold">Réponse</span>
        )}
      </div>

      <h2 className="text-5xl font-black text-center flex-1 flex items-center justify-center px-4">
        {q!.text}
      </h2>

      {q!.type === 'mcq' ? (
        <div className="grid grid-cols-2 gap-5">
          {(q!.choices ?? []).map((choice, i) => {
            const st = choiceStyle(i)
            const isCorrect = s.reveal?.correctAnswers.includes(choice)
            const count = s.reveal?.distribution.find((d) => d.value === choice)?.count ?? 0
            const dimmed = phase === 'reveal' && !isCorrect
            return (
              <div
                key={choice}
                className={`rounded-3xl px-8 py-7 flex items-center gap-5 ${st.bg} ${
                  dimmed ? 'opacity-30' : ''
                } ${phase === 'reveal' && isCorrect ? 'ring-4 ring-white' : ''}`}
              >
                <span className="text-5xl">{st.shape}</span>
                <span className="text-3xl font-bold flex-1">{choice}</span>
                {phase === 'reveal' && (
                  <div className="flex items-center gap-3">
                    <div className="w-32 h-3 bg-black/30 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-white/80"
                        style={{ width: `${(count / maxCount) * 100}%` }}
                      />
                    </div>
                    <span className="text-2xl font-mono font-bold w-10 text-right">{count}</span>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      ) : phase === 'reveal' ? (
        <div className="bg-gray-900 rounded-3xl p-10 text-center">
          <p className="text-gray-400 text-2xl uppercase tracking-wider mb-3">
            {q!.type === 'closest'
              ? 'Bonne réponse'
              : q!.type === 'ordering'
                ? 'Le bon ordre'
                : 'Réponse(s) acceptée(s)'}
          </p>
          <p className="text-5xl font-black">{(s.reveal?.correctAnswers ?? []).join(' · ')}</p>
        </div>
      ) : (
        <p className="text-center text-3xl text-gray-500">
          {q!.type === 'closest'
            ? '⌨️ Saisie numérique sur les téléphones'
            : q!.type === 'ordering'
              ? '🔀 Les joueurs réordonnent sur leurs téléphones'
              : '⌨️ Saisie libre sur les téléphones'}
        </p>
      )}

      <p className="text-center text-2xl text-gray-400 mt-6">
        {phase === 'question'
          ? `${s.answeredCount} / ${total} ont répondu`
          : 'En attente du classement…'}
      </p>
    </div>
  )
}
