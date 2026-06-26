import { useHostSession } from '../hooks/useHostSession'
import { useRemaining } from '../hooks/useRemaining'
import { useHostSound } from '../hooks/useHostSound'
import { QrCode } from '../components/QrCode'
import { choiceStyle } from '../mcq'
import { rankMovement, movementMark } from '../rank-movement'
import { TimePressure } from '../components/TimePressure'
import { QuestionImage } from '../components/QuestionImage'
import { TeamStandings } from '../components/TeamStandings'

// Contrôle audio (fixe, coin haut-droit). Visible sur tous les écrans TV.
function SoundControl({
  on,
  muted,
  enable,
  toggleMute,
}: {
  on: boolean
  muted: boolean
  enable: () => void
  toggleMute: () => void
}) {
  return (
    <div className="fixed top-4 right-4 z-40">
      {!on ? (
        <button
          onClick={enable}
          className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 font-bold text-white"
        >
          🔊 Activer le son
        </button>
      ) : (
        <button
          onClick={toggleMute}
          className="px-3 py-2 rounded-xl bg-gray-800 hover:bg-gray-700 text-2xl"
          title={muted ? 'Activer' : 'Couper'}
        >
          {muted ? '🔇' : '🔊'}
        </button>
      )}
    </div>
  )
}

// Vue TV : passive, lisible à distance. Énoncé + choix pendant la question
// (le téléphone ne montre que les boutons), puis révélation, puis classement.
export function HostDisplayPage() {
  const s = useHostSession('display')
  const connected = s.participants.filter((p) => p.connected)
  const joinUrl = s.pin ? `${window.location.origin}/join?pin=${s.pin}` : ''
  const remaining = useRemaining(s.questionStartedAt, s.currentQuestion?.timeLimit ?? 0)
  const lowTime = remaining > 0 && remaining <= 5

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

  const sound = useHostSound(phase)

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

  const q = s.currentQuestion
  const total = s.totalCount || connected.length
  const soundCtl = <SoundControl {...sound} />

  // ── Lobby (avant le démarrage) ───────────────────────────────
  if (phase === 'lobby') {
    return (
      <div className="min-h-screen bg-gray-950 text-white flex flex-col items-center justify-center p-10 gap-8">
        {soundCtl}
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
          {s.mode === 'team' && s.teams.length > 0 && (
            <div className="flex flex-wrap justify-center gap-3 mb-5">
              {s.teams.map((t) => {
                const n = connected.filter((p) => p.teamId === t.id).length
                return (
                  <span
                    key={t.id}
                    className="px-5 py-2 rounded-full text-2xl font-bold text-white"
                    style={{ backgroundColor: t.color }}
                  >
                    {t.name} · {n}
                  </span>
                )
              })}
            </div>
          )}
          <div className="flex flex-wrap justify-center gap-3">
            {connected.map((p) => {
              const color = s.mode === 'team' ? s.teams.find((t) => t.id === p.teamId)?.color : undefined
              return (
                <span
                  key={p.id}
                  className="px-6 py-2 rounded-full bg-gray-800 text-2xl font-medium"
                  style={color ? { backgroundColor: color, color: '#fff' } : undefined}
                >
                  {p.pseudo}
                </span>
              )
            })}
          </div>
        </div>
        <p className="text-gray-500 text-3xl mt-4">En attente du host…</p>
      </div>
    )
  }

  // ── Classement intermédiaire ─────────────────────────────────
  if (phase === 'leaderboard' && s.mode === 'team') {
    return (
      <div className="min-h-screen bg-gray-950 text-white flex flex-col items-center justify-center p-10 gap-8">
        {soundCtl}
        <h1 className="text-5xl font-black">Classement des équipes</h1>
        <TeamStandings teams={s.teamLeaderboard} big />
      </div>
    )
  }
  if (phase === 'leaderboard') {
    return (
      <div className="min-h-screen bg-gray-950 text-white flex flex-col items-center justify-center p-10 gap-8">
        {soundCtl}
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
  if (phase === 'ended' && s.mode === 'team') {
    return (
      <div className="min-h-screen bg-gray-950 text-white flex flex-col items-center justify-center p-10 gap-8">
        {soundCtl}
        <div className="text-7xl">🏆</div>
        <h1 className="text-6xl font-black">Classement final des équipes</h1>
        <TeamStandings teams={s.teamLeaderboard} big />
      </div>
    )
  }
  if (phase === 'ended') {
    return (
      <div className="min-h-screen bg-gray-950 text-white flex flex-col items-center justify-center p-10 gap-8">
        {soundCtl}
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
  const answered = s.reveal?.answeredCount ?? 0
  const correctN = s.reveal?.correctCount ?? 0
  const revealSummary =
    q!.type === 'closest'
      ? `${answered} réponse${answered > 1 ? 's' : ''}`
      : `✓ ${correctN} / ${answered} ${q!.type === 'ordering' ? "ont l'ordre parfait" : 'ont trouvé'}`

  return (
    <div className="min-h-screen bg-gray-950 text-white flex flex-col p-10">
      <TimePressure active={phase === 'question' && lowTime} />
      {soundCtl}
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

      <div className="flex-1 flex flex-col items-center justify-center gap-5 px-4 min-h-0">
        <QuestionImage key={q!.mediaUrl} url={q!.mediaUrl} className="max-h-[32vh] max-w-full" />
        <h2 className="text-5xl font-black text-center">{q!.text}</h2>
      </div>

      {q!.type === 'mcq' ? (
        <div className="grid grid-cols-2 gap-5">
          {(q!.choices ?? []).map((choice, i) => {
            const st = choiceStyle(i)
            const isReveal = phase === 'reveal'
            const isCorrect = s.reveal?.correctAnswers.includes(choice)
            const count = s.reveal?.distribution.find((d) => d.value === choice)?.count ?? 0
            const pct = answered > 0 ? Math.round((count / answered) * 100) : 0
            // À la révélation : la bonne réponse passe en VERT et reste pleine ;
            // les mauvaises gardent leur couleur Kahoot mais sont estompées.
            const tileBg = isReveal && isCorrect ? 'bg-emerald-500' : st.bg
            const dimmed = isReveal && !isCorrect
            return (
              <div
                key={choice}
                className={`relative rounded-3xl px-8 py-7 flex items-center gap-5 transition-all ${tileBg} ${
                  dimmed ? 'opacity-30' : ''
                } ${
                  isReveal && isCorrect
                    ? 'ring-4 ring-emerald-300 scale-[1.03] shadow-2xl shadow-emerald-500/40'
                    : ''
                }`}
              >
                {isReveal && isCorrect && (
                  <span className="absolute -top-4 -left-4 w-12 h-12 flex items-center justify-center rounded-full bg-emerald-400 text-emerald-950 text-3xl font-black shadow-lg">
                    ✓
                  </span>
                )}
                <span className="text-5xl">{st.shape}</span>
                <span className="text-3xl font-bold flex-1">{choice}</span>
                {isReveal && (
                  <div className="flex items-center gap-3">
                    <div className="w-28 h-3 bg-black/30 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-white/80"
                        style={{ width: `${(count / maxCount) * 100}%` }}
                      />
                    </div>
                    <span className="text-2xl font-mono font-bold w-28 text-right tabular-nums">
                      {count} · {pct}%
                    </span>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      ) : phase === 'reveal' ? (
        <div className="bg-emerald-500/10 ring-2 ring-emerald-500/40 rounded-3xl p-10 text-center">
          <p className="text-emerald-300/80 text-2xl uppercase tracking-wider mb-3">
            {q!.type === 'closest'
              ? 'Bonne réponse'
              : q!.type === 'ordering'
                ? 'Le bon ordre'
                : 'Réponse(s) acceptée(s)'}
          </p>
          <p className="text-5xl font-black text-emerald-300">
            {(s.reveal?.correctAnswers ?? []).join(' · ')}
          </p>
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

      <p className="text-center text-2xl mt-6">
        {phase === 'question' ? (
          <span className="text-gray-400">
            {s.answeredCount} / {total} ont répondu
          </span>
        ) : (
          <span className="text-emerald-400 font-bold">{revealSummary}</span>
        )}
      </p>

      {/* Mode équipe : points gagnés par chaque équipe SUR CETTE question */}
      {phase === 'reveal' && s.mode === 'team' && s.teamLeaderboard.length > 0 && (
        <div className="flex flex-wrap justify-center gap-3 mt-4">
          {[...s.teamLeaderboard]
            .sort((a, b) => b.delta - a.delta)
            .map((t) => (
              <span
                key={t.teamId}
                className="flex items-center gap-2 rounded-full px-5 py-2 text-2xl font-bold text-white"
                style={{ backgroundColor: t.color }}
              >
                {t.name}
                <span className="opacity-90">+{t.delta}</span>
              </span>
            ))}
        </div>
      )}
    </div>
  )
}
