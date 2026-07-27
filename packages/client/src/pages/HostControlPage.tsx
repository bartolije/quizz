import { useState } from 'react'
import type { GameReport } from '@lya-quiz/shared'
import { useHostSession } from '../hooks/useHostSession'
import { useRemaining } from '../hooks/useRemaining'
import { fetchReport, clearHostSession } from '../host-session'
import { QrCode } from '../components/QrCode'
import { ConnectionBanner } from '../components/ConnectionBanner'
import { ReportView } from '../components/ReportView'
import { QuestionImage } from '../components/QuestionImage'
import { HostTeamPanel } from '../components/HostTeamPanel'
import { TeamStandings } from '../components/TeamStandings'
import { BuzzerHostControl } from './BuzzerHostControl'
import { choiceStyle } from '../mcq'
import { rankMovement, movementMark } from '../rank-movement'

export function HostControlPage() {
  const s = useHostSession('control')
  const connected = s.participants.filter((p) => p.connected)
  const joinUrl = s.pin ? `${window.location.origin}/join?pin=${s.pin}` : ''
  const remaining = useRemaining(s.questionStartedAt, s.currentQuestion?.timeLimit ?? 0)
  const [report, setReport] = useState<GameReport | null>(null)

  if (s.error) {
    return (
      <div className="min-h-screen bg-gray-950 text-white flex items-center justify-center p-8 text-center text-xl">
        {s.error}
      </div>
    )
  }
  if (!s.pin) {
    return (
      <div className="min-h-screen bg-gray-950 text-gray-400 flex items-center justify-center">
        Création de la session…
      </div>
    )
  }

  // Partie famille (buzzer) : écran de contrôle dédié (arbitrage à l'oral).
  if (s.gameType === 'buzzer') {
    return <BuzzerHostControl s={s} />
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
            : s.status === 'running'
              ? 'between'
              : 'waiting'

  const q = s.currentQuestion
  const total = s.totalCount || connected.length
  const isLastQuestion = !!q && q.index + 1 >= q.total

  return (
    <div className="min-h-screen bg-gray-950 text-white flex flex-col">
      <ConnectionBanner connected={s.socketConnected} />
      <header className="flex items-center justify-between px-8 py-5 border-b border-gray-800">
        <h1 className="text-2xl font-bold">
          LYA QUIZ
          {s.quizTitle && (
            <span className="ml-3 text-base font-medium text-indigo-300">· {s.quizTitle}</span>
          )}
        </h1>
        <p className="text-gray-400">
          Session ·{' '}
          <span className="text-white font-mono font-bold tracking-widest">{s.pin}</span>
          {' · '}
          <span className="text-indigo-400 font-bold">{connected.length}</span> participant
          {connected.length > 1 ? 's' : ''}
        </p>
      </header>

      <div className="flex-1 p-8 flex flex-col">
        {phase === 'waiting' && (
          <div className="flex-1 grid md:grid-cols-2 gap-8">
            <section className="flex flex-col items-center justify-center gap-6 bg-gray-900 rounded-3xl p-8">
              <div className="bg-white p-4 rounded-2xl">
                <QrCode value={joinUrl} size={240} />
              </div>
              <div className="text-center">
                <p className="text-gray-400 text-sm uppercase tracking-wider mb-1">PIN</p>
                <p className="text-7xl font-black tracking-widest font-mono">{s.pin}</p>
              </div>
            </section>
            <HostTeamPanel
              mode={s.mode}
              teams={s.teams}
              locked={s.teamsLocked}
              participants={s.participants}
              setMode={s.setMode}
              addTeam={s.addTeam}
              removeTeam={s.removeTeam}
              lockTeams={s.lockTeams}
              assign={s.assign}
              autobalance={s.autobalance}
              onKick={s.kick}
            />
          </div>
        )}

        {phase === 'between' && (
          <div className="flex-1 flex flex-col items-center justify-center gap-6 text-center">
            <p className="text-2xl text-gray-300">Le quiz est lancé.</p>
            <p className="text-gray-500">Clique pour envoyer la première question dans le salon.</p>
          </div>
        )}

        {(phase === 'question' || phase === 'reveal') && q && (
          <div className="flex-1 flex flex-col gap-6">
            <div className="flex items-baseline justify-between">
              <span className="text-gray-400">
                Question {q.index + 1} / {q.total}
              </span>
              {phase === 'question' && (
                <span className="text-3xl font-bold tabular-nums">{Math.ceil(remaining)}s</span>
              )}
            </div>
            <h2 className="text-3xl font-bold">{q.text}</h2>
            <QuestionImage key={q.mediaUrl} url={q.mediaUrl} className="max-h-40 max-w-full" />

            {q.type === 'mcq' ? (
              <div className="grid grid-cols-2 gap-3">
                {(q.choices ?? []).map((choice, i) => {
                  const st = choiceStyle(i)
                  const isCorrect = s.reveal?.correctAnswers.includes(choice)
                  const count = s.reveal?.distribution.find((d) => d.value === choice)?.count ?? 0
                  return (
                    <div
                      key={choice}
                      className={`rounded-2xl px-5 py-4 flex items-center gap-3 ${st.bg} ${
                        phase === 'reveal' && !isCorrect ? 'opacity-40' : ''
                      }`}
                    >
                      <span className="text-2xl">{st.shape}</span>
                      <span className="font-bold flex-1">{choice}</span>
                      {phase === 'reveal' && (
                        <span className="font-mono text-sm bg-black/30 px-2 py-1 rounded-sm">
                          {count} {isCorrect && '✓'}
                        </span>
                      )}
                    </div>
                  )
                })}
              </div>
            ) : phase === 'reveal' ? (
              <div className="bg-gray-900 rounded-2xl p-6 text-center">
                <p className="text-gray-400 text-xs uppercase tracking-wider mb-1">
                  {q.type === 'closest'
                    ? 'Bonne réponse'
                    : q.type === 'ordering'
                      ? 'Le bon ordre'
                      : 'Réponse(s) acceptée(s)'}
                </p>
                <p className="text-3xl font-bold">{(s.reveal?.correctAnswers ?? []).join(' · ')}</p>
              </div>
            ) : (
              <p className="text-gray-500 text-center">
                {q.type === 'closest'
                  ? 'Réponse numérique sur les téléphones…'
                  : q.type === 'ordering'
                    ? 'Les joueurs réordonnent sur leurs téléphones…'
                    : 'Réponse libre sur les téléphones…'}
              </p>
            )}

            {phase === 'question' && (
              <p className="text-center text-gray-400 text-lg">
                {s.answeredCount} / {total} ont répondu
              </p>
            )}
            {phase === 'reveal' && s.reveal && (
              <p className="text-center text-emerald-400 text-lg font-bold">
                {q.type === 'closest'
                  ? `${s.reveal.answeredCount} réponse${s.reveal.answeredCount > 1 ? 's' : ''}`
                  : `✓ ${s.reveal.correctCount} / ${s.reveal.answeredCount} ${
                      q.type === 'ordering' ? "ont l'ordre parfait" : 'ont trouvé'
                    }`}
              </p>
            )}
          </div>
        )}

        {phase === 'leaderboard' && s.mode === 'team' && (
          <div className="flex-1 flex flex-col gap-4">
            <h2 className="text-2xl font-bold">Classement des équipes</h2>
            <TeamStandings teams={s.teamLeaderboard} />
          </div>
        )}

        {phase === 'leaderboard' && s.mode !== 'team' && (
          <div className="flex-1 flex flex-col gap-4">
            <h2 className="text-2xl font-bold">Classement</h2>
            <ol className="space-y-2">
              {s.leaderboard.slice(0, 8).map((sc) => {
                const mv = movementMark(rankMovement(s.prevRanks, sc.participantId, sc.rank))
                return (
                  <li
                    key={sc.participantId}
                    className="flex items-center gap-4 px-4 py-3 rounded-xl bg-gray-900"
                  >
                    <span className="w-8 text-center font-black text-indigo-400">{sc.rank}</span>
                    {mv.icon && <span className={mv.className}>{mv.icon}</span>}
                    <span className="font-medium flex-1">{sc.pseudo}</span>
                    {sc.delta > 0 && <span className="text-emerald-400 text-sm">+{sc.delta}</span>}
                    <span className="font-mono font-bold tabular-nums">{sc.score}</span>
                    <button
                      type="button"
                      onClick={() => {
                        if (window.confirm(`Retirer ${sc.pseudo} de la partie ?`)) s.kick(sc.participantId)
                      }}
                      className="px-2 py-1 rounded-lg text-gray-600 hover:text-red-400 hover:bg-gray-800 transition-colors"
                      title={`Retirer ${sc.pseudo}`}
                      aria-label={`Retirer ${sc.pseudo}`}
                    >
                      ✕
                    </button>
                  </li>
                )
              })}
            </ol>
          </div>
        )}

        {phase === 'ended' && (
          <div className="flex-1 flex flex-col items-center justify-center gap-4 text-center">
            <div className="text-6xl">🏁</div>
            <h2 className="text-3xl font-black">Quiz terminé</h2>
            {s.mode === 'team' ? (
              <div className="w-full max-w-md mt-2">
                <TeamStandings teams={s.teamLeaderboard} />
              </div>
            ) : (
              <ol className="w-full max-w-md space-y-2 mt-2">
                {s.leaderboard.slice(0, 5).map((sc) => (
                  <li
                    key={sc.participantId}
                    className="flex items-center justify-between px-4 py-3 rounded-xl bg-gray-900"
                  >
                    <span className="font-medium">
                      {sc.rank}. {sc.pseudo}
                    </span>
                    <span className="font-mono font-bold">{sc.score}</span>
                  </li>
                ))}
              </ol>
            )}
            <button
              onClick={() => {
                if (s.sessionId) void fetchReport(s.sessionId).then(setReport)
              }}
              className="mt-4 px-6 py-3 rounded-2xl bg-indigo-600 hover:bg-indigo-500 font-bold"
            >
              📊 Voir le rapport détaillé
            </button>
            {/* Repartir sur une partie neuve sans fouiller le localStorage à la main */}
            <button
              onClick={() => {
                if (!window.confirm('Créer une nouvelle session ? (le rapport reste accessible via son URL)')) return
                clearHostSession()
                window.location.reload()
              }}
              className="px-6 py-3 rounded-2xl bg-gray-800 hover:bg-gray-700 text-gray-300 font-bold"
            >
              ➕ Nouvelle session
            </button>
          </div>
        )}
      </div>

      {report && <ReportView report={report} onClose={() => setReport(null)} />}

      <footer className="px-8 py-6 border-t border-gray-800 flex items-center justify-between gap-6">
        <div>
          {phase !== 'waiting' && phase !== 'ended' && (
            <button
              onClick={s.endQuiz}
              className="px-5 py-3 rounded-xl text-rose-400 hover:bg-rose-500/10 font-medium transition-colors"
            >
              Terminer le quiz
            </button>
          )}
        </div>
        <div className="flex items-center gap-6">
        {phase === 'waiting' && (
          <button
            onClick={s.start}
            disabled={connected.length === 0}
            className="px-10 py-4 rounded-2xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed font-bold text-lg transition-colors"
          >
            Démarrer le quiz
          </button>
        )}
        {phase === 'between' && (
          <button
            onClick={s.next}
            className="px-10 py-4 rounded-2xl bg-indigo-600 hover:bg-indigo-500 font-bold text-lg transition-colors"
          >
            Lancer la première question →
          </button>
        )}
        {phase === 'question' && (
          <button
            disabled
            className="px-10 py-4 rounded-2xl bg-gray-800 text-gray-500 font-bold text-lg cursor-not-allowed"
          >
            Question en cours…
          </button>
        )}
        {phase === 'reveal' && (
          <>
            {/* Filet anti-fausse-manip : annule les points de la question et la relance */}
            <button
              onClick={() => {
                if (window.confirm('Annuler les points de cette question et la rejouer ?')) s.replayLast()
              }}
              className="px-5 py-4 rounded-2xl bg-gray-800 hover:bg-gray-700 text-gray-300 font-bold transition-colors"
              title="Annuler les points de cette question et la relancer"
            >
              ↩︎ Rejouer
            </button>
            {/* Classement = optionnel (slide à la demande), pas imposé à chaque question */}
            <button
              onClick={s.showLeaderboard}
              className="px-6 py-4 rounded-2xl bg-violet-600 hover:bg-violet-500 font-bold text-lg transition-colors"
            >
              📊 Afficher le classement
            </button>
            <button
              onClick={s.next}
              className="px-10 py-4 rounded-2xl bg-indigo-600 hover:bg-indigo-500 font-bold text-lg transition-colors"
            >
              {isLastQuestion ? 'Voir le podium →' : 'Question suivante →'}
            </button>
          </>
        )}
        {phase === 'leaderboard' && (
          <>
            <button
              onClick={() => {
                if (window.confirm('Annuler les points de cette question et la rejouer ?')) s.replayLast()
              }}
              className="px-5 py-4 rounded-2xl bg-gray-800 hover:bg-gray-700 text-gray-300 font-bold transition-colors"
              title="Annuler les points de cette question et la relancer"
            >
              ↩︎ Rejouer
            </button>
            <button
              onClick={s.next}
              className="px-10 py-4 rounded-2xl bg-indigo-600 hover:bg-indigo-500 font-bold text-lg transition-colors"
            >
              {isLastQuestion ? 'Voir le podium →' : 'Question suivante →'}
            </button>
          </>
        )}
        </div>
      </footer>
    </div>
  )
}
