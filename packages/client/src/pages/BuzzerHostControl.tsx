import { useState } from 'react'
import type { GameReport } from '@lya-quiz/shared'
import { CULTURE_THEME } from '@lya-quiz/shared'
import type { HostSessionView } from '../hooks/useHostSession'
import { fetchReport, clearHostSession } from '../host-session'
import { QrCode } from '../components/QrCode'
import { ConnectionBanner } from '../components/ConnectionBanner'
import { ReportView } from '../components/ReportView'
import { QuestionImage } from '../components/QuestionImage'

const ptsBadge = (pts: number): { label: string; cls: string } => ({
  label: `${pts} pt${pts > 1 ? 's' : ''}`,
  cls: pts >= 4 ? 'bg-fuchsia-700' : pts === 3 ? 'bg-rose-700' : pts === 2 ? 'bg-amber-700' : 'bg-emerald-700',
})

// Écran de contrôle host en mode buzzer (partie famille). L'admin arbitre tout :
// 3 gros boutons Correct / Faux / Passer (+ Rouvrir). Le serveur sait QUI est
// jugé selon la phase (owner à l'oral ou buzzeur).
export function BuzzerHostControl({ s }: { s: HostSessionView }) {
  const [report, setReport] = useState<GameReport | null>(null)
  const [adjustOpen, setAdjustOpen] = useState(false)
  const [showScores, setShowScores] = useState(false)
  const [manualName, setManualName] = useState('')
  // Joueurs pouvant marquer (avec tél connecté OU « sans téléphone » manuel).
  // C'est CE décompte qu'on affiche : compter les seuls téléphones connectés
  // annonçait « 0 joueur » sur une partie jouée uniquement sans téléphone.
  const players = s.participants.filter((p) => p.connected || p.manual)
  // Écran d'ajustement : TOUT LE MONDE est ajustable, même un joueur déconnecté
  // (ex. celui qui vient de passer et dont le tél s'est mis en veille). L'arbitrage
  // de score ne dépend pas de l'état de connexion.
  const adjustable = s.participants
  const joinUrl = s.pin ? `${window.location.origin}/join?pin=${s.pin}` : ''
  const b = s.buzz
  const q = s.buzzQuestion
  const badge = q?.points ? ptsBadge(q.points) : null
  const hasPerso = (s.themes?.owners.length ?? 0) > 0

  const btn = 'px-6 py-4 rounded-2xl font-bold text-lg transition-colors disabled:opacity-40'

  const addManual = () => {
    const name = manualName.trim()
    if (!name) return
    s.addManualParticipant(name)
    setManualName('')
  }

  // Bouton « Ajuster » (présent dans chaque phase) + panneau (rendu une seule fois
  // car une seule vue est active à la fois).
  const adjustBtn = (
    <button
      onClick={() => setAdjustOpen(true)}
      className="px-4 py-3 rounded-xl bg-gray-800 hover:bg-gray-700 text-gray-200 font-medium"
      title="Donner / retirer des points (arbitrage)"
    >
      ⚖️ Ajuster
    </button>
  )
  const adjustOverlay = adjustOpen ? (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={() => setAdjustOpen(false)}>
      <div className="bg-gray-900 rounded-3xl p-6 max-w-lg w-full max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-xl font-bold">⚖️ Ajuster les points</h2>
          <button onClick={() => setShowScores((v) => !v)} className="text-sm px-3 py-1 rounded-lg bg-gray-800 hover:bg-gray-700">
            {showScores ? '🙈 Cacher les scores' : '👁 Voir les scores'}
          </button>
        </div>
        <p className="text-gray-500 text-sm mb-4">Arbitrage : +/− des points. Par défaut on n'affiche que ton ajustement, pas le score total.</p>
        <ul className="space-y-2">
          {adjustable.map((p) => {
            const sc = s.leaderboard.find((x) => x.participantId === p.id)?.score ?? 0
            return (
              <li key={p.id} className="flex items-center gap-3 bg-gray-800 rounded-xl px-3 py-2">
                <span className="flex-1 font-medium">
                  {p.pseudo}
                  {p.manual && <span className="text-gray-500 text-xs"> (sans tél)</span>}
                  {!p.manual && !p.connected && <span className="text-amber-500/70 text-xs"> (déconnecté)</span>}
                </span>
                {showScores && <span className="font-mono text-indigo-300 tabular-nums">{sc}</span>}
                {typeof p.bonus === 'number' && p.bonus !== 0 && (
                  <span className={`text-sm font-bold ${p.bonus > 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {p.bonus > 0 ? '+' : ''}{p.bonus}
                  </span>
                )}
                <div className="flex gap-1">
                  <button onClick={() => s.adjustScore(p.id, -1)} className="w-9 h-9 rounded-lg bg-rose-700 hover:bg-rose-600 font-black text-lg">−</button>
                  <button onClick={() => s.adjustScore(p.id, 1)} className="w-9 h-9 rounded-lg bg-emerald-700 hover:bg-emerald-600 font-black text-lg">+</button>
                </div>
              </li>
            )
          })}
          {adjustable.length === 0 && <li className="text-gray-500">Aucun joueur pour l'instant.</li>}
        </ul>
        <button onClick={() => setAdjustOpen(false)} className="mt-5 w-full py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 font-bold">Fermer</button>
      </div>
    </div>
  ) : null

  // ── Waiting : QR + participants + démarrer ──────────────────
  if (s.status === 'waiting') {
    return (
      <div className="min-h-screen bg-gray-950 text-white flex flex-col">
        <ConnectionBanner connected={s.socketConnected} />
        <header className="flex items-center justify-between px-8 py-5 border-b border-gray-800">
          <h1 className="text-2xl font-bold">LYA QUIZ · <span className="text-indigo-300 text-base">Famille (buzzer)</span>{s.quizTitle && <span className="text-gray-500 text-base"> · {s.quizTitle}</span>}</h1>
          <p className="text-gray-400">PIN <span className="text-white font-mono font-bold tracking-widest">{s.pin}</span> · <span className="text-indigo-400 font-bold">{players.length}</span> joueur{players.length > 1 ? 's' : ''}</p>
        </header>
        <div className="flex-1 grid md:grid-cols-2 gap-8 p-8">
          <section className="flex flex-col items-center justify-center gap-6 bg-gray-900 rounded-3xl p-8">
            <div className="bg-white p-4 rounded-2xl"><QrCode value={joinUrl} size={220} /></div>
            <p className="text-6xl font-black tracking-widest font-mono">{s.pin}</p>
          </section>
          <section className="flex flex-col gap-3">
            <h2 className="text-lg font-bold text-gray-300">Joueurs</h2>
            <ul className="flex flex-wrap gap-2 content-start">
              {players.map((p) => (
                <li key={p.id} className="px-3 py-2 rounded-xl bg-gray-800 flex items-center gap-2">
                  {p.pseudo}
                  {p.manual && <span className="text-gray-500 text-xs">(sans tél)</span>}
                  <button onClick={() => { if (confirm(`Retirer ${p.pseudo} ?`)) s.kick(p.id) }} className="text-gray-500 hover:text-rose-400" aria-label={`Retirer ${p.pseudo}`}>✕</button>
                </li>
              ))}
              {players.length === 0 && <li className="text-gray-500">En attente de joueurs…</li>}
            </ul>
            {/* Joueur sans téléphone : géré par l'admin (thème + points, pas de buzz) */}
            <div className="flex gap-2">
              <input
                value={manualName}
                onChange={(e) => setManualName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addManual()}
                placeholder="Ajouter un joueur sans téléphone…"
                className="flex-1 bg-gray-800 rounded-lg px-3 py-2 border border-gray-700 focus:border-indigo-500 outline-hidden"
              />
              <button onClick={addManual} className="px-3 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 font-bold">+ Sans tél</button>
            </div>
          </section>
        </div>

        {/* Distribution des thèmes : associer chaque thème perso à un joueur.
            Les thèmes LIBRES (sans propriétaire) n'ont rien à distribuer. */}
        {(s.themes?.owners.filter((o) => !o.libre).length ?? 0) > 0 && (
          <section className="px-8 pb-6">
            <h2 className="text-lg font-bold text-gray-300 mb-3">Distribution des thèmes</h2>
            <div className="grid sm:grid-cols-2 gap-2">
              {s.themes!.owners.filter((o) => !o.libre).map((o) => (
                <div key={o.ownerName} className="flex items-center gap-3 bg-gray-900 rounded-xl px-4 py-2">
                  <span className="font-medium flex-1">
                    🎤 {o.ownerName}
                    {o.themeName && <span className="text-indigo-300 text-sm"> · « {o.themeName} »</span>}
                    <span className="text-gray-500 text-sm"> · {o.total} Q</span>
                  </span>
                  <select
                    value={o.participantId ?? ''}
                    onChange={(e) => s.assignOwner(o.ownerName, e.target.value || null)}
                    className="bg-gray-800 rounded-lg px-2 py-1 border border-gray-700 max-w-40"
                  >
                    <option value="">— non attribué</option>
                    {players.map((p) => <option key={p.id} value={p.id}>{p.pseudo}{p.manual ? ' (sans tél)' : ''}</option>)}
                  </select>
                </div>
              ))}
            </div>
            {s.themes!.owners.some((o) => !o.libre && !o.participantId) && (
              <p className="text-amber-400 text-sm mt-2">Attribue chaque thème à son joueur avant de le lancer (tu pourras aussi le faire en cours de partie).</p>
            )}
          </section>
        )}

        <footer className="px-8 py-6 border-t border-gray-800 flex items-center justify-between">
          {adjustBtn}
          <button onClick={s.start} disabled={players.length === 0} className={`${btn} bg-indigo-600 hover:bg-indigo-500 px-10`}>Démarrer le quiz</button>
        </footer>
        {adjustOverlay}
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
        <div className="flex flex-wrap justify-center gap-3 mt-4">
          {adjustBtn}
          <button onClick={() => { if (s.sessionId) void fetchReport(s.sessionId).then(setReport) }} className={`${btn} bg-indigo-600 hover:bg-indigo-500`}>📊 Rapport</button>
          <button onClick={() => { if (confirm('Nouvelle session ?')) { clearHostSession(); window.location.reload() } }} className={`${btn} bg-gray-800 hover:bg-gray-700 text-gray-300`}>➕ Nouvelle session</button>
        </div>
        {report && <ReportView report={report} onClose={() => setReport(null)} />}
        {adjustOverlay}
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
        <p className="text-gray-400 text-sm">{players.length} joueur{players.length > 1 ? 's' : ''}</p>
      </header>

      <div className="flex-1 p-8 flex flex-col gap-6">
        {!b || !q ? (
          hasPerso ? (
            /* Entre deux thèmes : sélecteur de thème. En tour par tour, le joueur
               du tour annonce son choix à l'oral (son thème OU celui d'un autre —
               c'est LUI qui répondra) et l'admin clique. */
            <div className="flex-1 flex flex-col gap-5">
              {(() => {
                const turn = s.themes?.turn
                const current = turn && turn.index < turn.order.length ? turn.order[turn.index] : null
                const available = s.themes!.owners.filter((o) => !o.done)
                return (
                  <>
                    {current && turn ? (
                      <div className="bg-indigo-950 border border-indigo-700 rounded-2xl px-5 py-4 flex items-center justify-between gap-4">
                        <p className="text-2xl font-bold">🎯 Au tour de <span className="text-indigo-300">{current.pseudo}</span> — quel thème ?</p>
                        <p className="text-sm text-gray-400">
                          Puis : {turn.order.slice(turn.index + 1, turn.index + 4).map((t) => t.pseudo).join(' → ') || '— dernier tour !'}
                        </p>
                      </div>
                    ) : (
                      <h2 className="text-2xl font-bold">Choisis le thème à jouer</h2>
                    )}
                    {available.length > 1 && (
                      <button
                        onClick={() => {
                          const pick = available[Math.floor(Math.random() * available.length)]
                          if (pick && window.confirm(`🎲 Le sort a choisi « ${pick.themeName ?? pick.ownerName} » — on lance ?`)) s.startTheme(pick.ownerName)
                        }}
                        className="self-start px-5 py-3 rounded-2xl bg-fuchsia-700 hover:bg-fuchsia-600 font-bold"
                      >🎲 Thème aléatoire</button>
                    )}
                  </>
                )
              })()}
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {s.themes!.owners.map((o) => {
                  const pseudo = o.participantId ? (s.participants.find((p) => p.id === o.participantId)?.pseudo ?? '?') : null
                  const hasTurn = !!s.themes?.turn
                  // Tour par tour : le répondeur est le joueur du tour → un thème
                  // non « attribué » (binding) reste jouable. Sans tour : ancien flux.
                  const blocked = o.done || (!hasTurn && !o.participantId)
                  return (
                    <button
                      key={o.ownerName}
                      onClick={() => s.startTheme(o.ownerName)}
                      disabled={blocked}
                      className={`px-5 py-4 rounded-2xl text-left font-bold transition-colors ${
                        o.done ? 'bg-gray-800 text-gray-600 line-through' : blocked ? 'bg-gray-800 text-gray-500 cursor-not-allowed' : 'bg-indigo-700 hover:bg-indigo-600'
                      }`}
                    >
                      {/* L'admin voit le thème ET son propriétaire (la TV ne montre
                          que le thème — c'est ici qu'on sait à qui il est / s'il est libre). */}
                      🎤 {o.themeName ?? o.ownerName}
                      <span className="block text-sm font-normal opacity-80">
                        {o.done ? 'déjà joué' : `${o.total} Q · ${o.libre ? 'thème libre' : `de ${o.ownerName}`}${pseudo && pseudo !== o.ownerName ? ` · tél : ${pseudo}` : ''}`}
                      </span>
                    </button>
                  )
                })}
                {s.themes!.culture.total > 0 && (
                  <button
                    onClick={() => s.startTheme(CULTURE_THEME)}
                    disabled={s.themes!.culture.done}
                    className={`px-5 py-4 rounded-2xl text-left font-bold transition-colors ${s.themes!.culture.done ? 'bg-gray-800 text-gray-600 line-through' : 'bg-violet-700 hover:bg-violet-600'}`}
                  >
                    🌍 Culture générale
                    <span className="block text-sm font-normal opacity-80">{s.themes!.culture.done ? 'terminé' : `${s.themes!.culture.total} Q`}</span>
                  </button>
                )}
              </div>
              <div className="flex flex-wrap gap-2 mt-auto">
                {s.leaderboard.slice(0, 8).map((sc) => (
                  <span key={sc.participantId} className="px-3 py-1 rounded-lg bg-gray-900 text-sm">{sc.rank}. {sc.pseudo} <b className="font-mono">{sc.score}</b></span>
                ))}
              </div>
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center gap-4 text-center">
              <p className="text-2xl text-gray-300">Prêt à lancer une question.</p>
            </div>
          )
        ) : (
          <>
            <div className="flex items-center gap-3">
              {badge && <span className={`px-3 py-1 rounded-full text-sm font-bold ${badge.cls}`}>{badge.label}</span>}
              {q.section === 'perso' && b.ownerName && (
                <span className="px-3 py-1 rounded-full text-sm bg-indigo-800">
                  {q.themeName ? `Thème ${q.themeName} (de ${b.ownerName})` : `Thème de ${b.ownerName}`}
                </span>
              )}
              {q.section === 'libre' && (
                <span className="px-3 py-1 rounded-full text-sm bg-indigo-800">
                  Thème {q.themeName ?? b.ownerName} (libre)
                </span>
              )}
              <span className="text-gray-500 text-sm ml-auto">Q{q.index + 1}/{q.total}</span>
            </div>
            <h2 className="text-3xl font-bold">{q.text}</h2>
            {q.mediaUrl && <QuestionImage key={q.mediaUrl} url={q.mediaUrl} className="max-h-48 max-w-full rounded-xl" />}

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
              <>
              {/* Antisèche : la réponse de référence, visible de l'admin SEUL
                  (jamais sur la TV ni les téléphones) — il juge à l'oral. */}
              {s.hostAnswer && (
                <div className="bg-gray-900 rounded-2xl p-4 border border-gray-800">
                  <p className="text-xs uppercase tracking-wider text-gray-500 mb-1">Réponse attendue (visible de toi seul)</p>
                  <p className="text-xl font-bold text-emerald-300">{s.hostAnswer.join(' · ')}</p>
                </div>
              )}
              <div className="flex items-center gap-3 text-lg">
                {b.phase === 'owner_oral' && (() => {
                  // Le répondeur = le joueur du TOUR (pas forcément le propriétaire
                  // du thème : il a pu prendre celui d'un autre). Le badge « Thème
                  // de X » au-dessus dit à qui appartient le thème.
                  const responder = b.ownerParticipantId ? s.participants.find((p) => p.id === b.ownerParticipantId) : null
                  return (
                    <span>
                      🗣️ À <b className="text-indigo-300">{responder?.pseudo ?? b.ownerName ?? '—'}</b> de répondre (à l'oral)
                      {!responder && <span className="ml-2 text-amber-400 text-sm">⚠️ personne pour répondre — passe ou attribue le thème</span>}
                      {/* Un joueur « sans téléphone » n'a jamais de socket : ne PAS
                          l'annoncer déconnecté (l'alerte resterait toute la partie). */}
                      {responder && !responder.manual && !responder.connected && (
                        <span className="ml-2 text-amber-400 text-sm">⚠️ {responder.pseudo} est déconnecté·e</span>
                      )}
                    </span>
                  )
                })()}
                {b.phase === 'steal' && b.armed && <span className="text-rose-300">🔔 Buzzer ouvert — attends un buzz…</span>}
                {b.phase === 'steal' && !b.armed && <span className="text-amber-300">⏸️ Vol raté — rouvre le buzzer ou passe.</span>}
                {b.phase === 'locked' && <span className="text-emerald-300">🎤 <b>{b.lockedBy?.pseudo}</b> a la parole</span>}
              </div>
              </>
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
        <div className="flex items-center gap-2">
          {/* confirm : irréversible (supprime aussi le snapshot anti-restart) */}
          <button
            onClick={() => { if (window.confirm('Terminer la partie ? Le classement devient définitif.')) s.endQuiz() }}
            className="px-5 py-3 rounded-xl text-rose-400 hover:bg-rose-500/10 font-medium"
          >Terminer</button>
          {adjustBtn}
        </div>
        <div className="flex items-center gap-3">
          {/* Question suivante dans le thème (révélation), ou lancement direct
              en culture-only (sans thèmes perso, le sélecteur n'apparaît pas). */}
          {(b?.phase === 'revealed' || (!b && !hasPerso)) && (
            <button onClick={s.next} className={`${btn} bg-indigo-600 hover:bg-indigo-500 px-10`}>
              {b?.phase === 'revealed' ? 'Question suivante →' : 'Lancer une question →'}
            </button>
          )}
          {/* Locuteur à juger (owner à l'oral OU buzzeur) */}
          {b && (b.phase === 'owner_oral' || b.phase === 'locked') && (
            <>
              <button onClick={() => s.adjudicate(false)} className={`${btn} bg-rose-600 hover:bg-rose-500`}>✗ Faux</button>
              {/* Thème non attribué : ✓ créditerait personne (le serveur refuse aussi) */}
              <button
                onClick={() => s.adjudicate(true)}
                disabled={b.phase === 'owner_oral' && !b.ownerParticipantId}
                className={`${btn} bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed`}
              >✓ Correct</button>
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
      {adjustOverlay}
    </div>
  )
}
