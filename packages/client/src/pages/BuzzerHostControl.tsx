import { useState } from 'react'
import type { GameReport } from '@lya-quiz/shared'
import type { HostSessionView } from '../hooks/useHostSession'
import { fetchReport, clearHostSession } from '../host-session'
import { QrCode } from '../components/QrCode'
import { ConnectionBanner } from '../components/ConnectionBanner'
import { ReportView } from '../components/ReportView'

const DIFF: Record<string, { label: string; pts: number; cls: string }> = {
  facile: { label: 'Facile', pts: 1, cls: 'bg-emerald-700' },
  moyen: { label: 'Moyen', pts: 2, cls: 'bg-amber-700' },
  difficile: { label: 'Difficile', pts: 3, cls: 'bg-rose-700' },
}

// Écran de contrôle host en mode buzzer (partie famille). L'admin arbitre tout :
// 3 gros boutons Correct / Faux / Passer (+ Rouvrir). Le serveur sait QUI est
// jugé selon la phase (owner à l'oral ou buzzeur).
export function BuzzerHostControl({ s }: { s: HostSessionView }) {
  const [report, setReport] = useState<GameReport | null>(null)
  const connected = s.participants.filter((p) => p.connected)
  const joinUrl = s.pin ? `${window.location.origin}/join?pin=${s.pin}` : ''
  const b = s.buzz
  const q = s.buzzQuestion
  const diff = q?.difficulty ? DIFF[q.difficulty] : null

  const btn = 'px-6 py-4 rounded-2xl font-bold text-lg transition-colors disabled:opacity-40'

  // ── Waiting : QR + participants + démarrer ──────────────────
  if (s.status === 'waiting') {
    return (
      <div className="min-h-screen bg-gray-950 text-white flex flex-col">
        <ConnectionBanner connected={s.socketConnected} />
        <header className="flex items-center justify-between px-8 py-5 border-b border-gray-800">
          <h1 className="text-2xl font-bold">LYA QUIZ · <span className="text-indigo-300 text-base">Famille (buzzer)</span>{s.quizTitle && <span className="text-gray-500 text-base"> · {s.quizTitle}</span>}</h1>
          <p className="text-gray-400">PIN <span className="text-white font-mono font-bold tracking-widest">{s.pin}</span> · <span className="text-indigo-400 font-bold">{connected.length}</span> joueur{connected.length > 1 ? 's' : ''}</p>
        </header>
        <div className="flex-1 grid md:grid-cols-2 gap-8 p-8">
          <section className="flex flex-col items-center justify-center gap-6 bg-gray-900 rounded-3xl p-8">
            <div className="bg-white p-4 rounded-2xl"><QrCode value={joinUrl} size={220} /></div>
            <p className="text-6xl font-black tracking-widest font-mono">{s.pin}</p>
          </section>
          <section className="flex flex-col gap-3">
            <h2 className="text-lg font-bold text-gray-300">Joueurs connectés</h2>
            <ul className="flex-1 flex flex-wrap gap-2 content-start">
              {connected.map((p) => (
                <li key={p.id} className="px-3 py-2 rounded-xl bg-gray-800 flex items-center gap-2">
                  {p.pseudo}
                  <button onClick={() => { if (confirm(`Retirer ${p.pseudo} ?`)) s.kick(p.id) }} className="text-gray-500 hover:text-rose-400" aria-label={`Retirer ${p.pseudo}`}>✕</button>
                </li>
              ))}
              {connected.length === 0 && <li className="text-gray-500">En attente de joueurs…</li>}
            </ul>
          </section>
        </div>
        <footer className="px-8 py-6 border-t border-gray-800 flex justify-end">
          <button onClick={s.start} disabled={connected.length === 0} className={`${btn} bg-indigo-600 hover:bg-indigo-500 px-10`}>Démarrer le quiz</button>
        </footer>
      </div>
    )
  }

  // ── Ended : podium ──────────────────────────────────────────
  if (s.status === 'ended' || s.leaderboardFinal) {
    return (
      <div className="min-h-screen bg-gray-950 text-white flex flex-col items-center justify-center gap-4 p-8 text-center">
        <div className="text-6xl">🏁</div>
        <h2 className="text-3xl font-black">Quiz terminé</h2>
        <ol className="w-full max-w-md space-y-2 mt-2">
          {s.leaderboard.slice(0, 8).map((sc) => (
            <li key={sc.participantId} className="flex items-center justify-between px-4 py-3 rounded-xl bg-gray-900">
              <span className="font-medium">{sc.rank}. {sc.pseudo}</span>
              <span className="font-mono font-bold">{sc.score}</span>
            </li>
          ))}
        </ol>
        <div className="flex gap-3 mt-4">
          <button onClick={() => { if (s.sessionId) void fetchReport(s.sessionId).then(setReport) }} className={`${btn} bg-indigo-600 hover:bg-indigo-500`}>📊 Rapport</button>
          <button onClick={() => { if (confirm('Nouvelle session ?')) { clearHostSession(); window.location.reload() } }} className={`${btn} bg-gray-800 hover:bg-gray-700 text-gray-300`}>➕ Nouvelle session</button>
        </div>
        {report && <ReportView report={report} onClose={() => setReport(null)} />}
      </div>
    )
  }

  // ── Running : entre deux questions (aucune question active) ──
  const speaker = b?.phase === 'owner_oral' ? b.ownerName : b?.lockedBy?.pseudo ?? null

  return (
    <div className="min-h-screen bg-gray-950 text-white flex flex-col">
      <ConnectionBanner connected={s.socketConnected} />
      <header className="flex items-center justify-between px-8 py-4 border-b border-gray-800">
        <h1 className="text-xl font-bold">LYA QUIZ · <span className="text-indigo-300 text-sm">Famille</span></h1>
        <p className="text-gray-400 text-sm">{connected.length} joueur{connected.length > 1 ? 's' : ''}</p>
      </header>

      <div className="flex-1 p-8 flex flex-col gap-6">
        {!b || !q ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-4 text-center">
            <p className="text-2xl text-gray-300">Prêt à lancer une question.</p>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-3">
              {diff && <span className={`px-3 py-1 rounded-full text-sm font-bold ${diff.cls}`}>{diff.label} · {diff.pts} pt{diff.pts > 1 ? 's' : ''}</span>}
              {q.section === 'perso' && b.ownerName && <span className="px-3 py-1 rounded-full text-sm bg-indigo-800">Thème de {b.ownerName}</span>}
              <span className="text-gray-500 text-sm ml-auto">Q{q.index + 1}/{q.total}</span>
            </div>
            <h2 className="text-3xl font-bold">{q.text}</h2>

            {/* Antisèche admin : la réponse de référence (jamais envoyée aux joueurs) */}
            {b.phase === 'revealed' ? (
              <div className="bg-gray-900 rounded-2xl p-5">
                <p className="text-xs uppercase tracking-wider text-gray-500 mb-1">Réponse</p>
                <p className="text-2xl font-bold">{s.buzzReveal?.correctAnswers.join(' · ')}</p>
                <p className={`mt-2 ${s.buzzReveal?.scorer ? 'text-emerald-400 font-bold' : 'text-gray-400'}`}>
                  {s.buzzReveal?.scorer ? `✓ ${s.buzzReveal.scorer.pseudo} marque +${s.buzzReveal.scorer.points}` : 'Personne n’a trouvé.'}
                </p>
              </div>
            ) : (
              <div className="flex items-center gap-3 text-lg">
                {b.phase === 'owner_oral' && <span>🗣️ Au tour de <b className="text-indigo-300">{b.ownerName ?? '—'}</b> (à l'oral)</span>}
                {b.phase === 'steal' && b.armed && <span className="text-rose-300">🔔 Buzzer ouvert — attends un buzz…</span>}
                {b.phase === 'steal' && !b.armed && <span className="text-amber-300">⏸️ Vol raté — rouvre le buzzer ou passe.</span>}
                {b.phase === 'locked' && <span className="text-emerald-300">🎤 <b>{b.lockedBy?.pseudo}</b> a la parole</span>}
              </div>
            )}

            {/* Classement live compact */}
            <div className="flex flex-wrap gap-2 mt-auto">
              {s.leaderboard.slice(0, 6).map((sc) => (
                <span key={sc.participantId} className="px-3 py-1 rounded-lg bg-gray-900 text-sm">
                  {sc.rank}. {sc.pseudo} <b className="font-mono">{sc.score}</b>
                </span>
              ))}
            </div>
          </>
        )}
      </div>

      <footer className="px-8 py-5 border-t border-gray-800 flex items-center justify-between gap-4">
        <button onClick={s.endQuiz} className="px-5 py-3 rounded-xl text-rose-400 hover:bg-rose-500/10 font-medium">Terminer</button>
        <div className="flex items-center gap-3">
          {/* Aucune question active → lancer la suivante */}
          {(!b || b.phase === 'revealed') && (
            <button onClick={s.next} className={`${btn} bg-indigo-600 hover:bg-indigo-500 px-10`}>
              {b?.phase === 'revealed' ? 'Question suivante →' : 'Lancer une question →'}
            </button>
          )}
          {/* Locuteur à juger (owner à l'oral OU buzzeur) */}
          {b && (b.phase === 'owner_oral' || b.phase === 'locked') && (
            <>
              <button onClick={() => s.adjudicate(false)} className={`${btn} bg-rose-600 hover:bg-rose-500`}>✗ Faux</button>
              <button onClick={() => s.adjudicate(true)} className={`${btn} bg-emerald-600 hover:bg-emerald-500`}>✓ Correct</button>
            </>
          )}
          {/* Vol en cours (buzzer ouvert, personne n'a encore la parole) → passer */}
          {b && b.phase === 'steal' && (
            <>
              {!b.armed && <button onClick={s.reopenBuzzer} className={`${btn} bg-amber-600 hover:bg-amber-500`}>↻ Rouvrir le buzzer</button>}
              <button onClick={s.passQuestion} className={`${btn} bg-gray-700 hover:bg-gray-600`}>Personne / passer</button>
            </>
          )}
        </div>
      </footer>
    </div>
  )
}
