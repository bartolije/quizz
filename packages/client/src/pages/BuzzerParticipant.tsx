import { EVENTS } from '@lya-quiz/shared'
import { socket } from '../socket'
import { useQuizStore } from '../store/quiz-store'
import { vibrate } from '../haptics'

const DIFFICULTY_LABEL: Record<string, { label: string; pts: number }> = {
  facile: { label: 'Facile', pts: 1 },
  moyen: { label: 'Moyen', pts: 2 },
  difficile: { label: 'Difficile', pts: 3 },
}

// Vue participant en mode buzzer (partie famille). Le téléphone n'est qu'un
// BUZZER : pas de saisie, l'admin arbitre tout à l'oral. La vue est pilotée par
// l'état buzzer (source de vérité serveur) + le statut de session.
export function BuzzerParticipant() {
  const myId = useQuizStore((s) => s.myId)
  const myPseudo = useQuizStore((s) => s.myPseudo)
  const status = useQuizStore((s) => s.sessionStatus)
  const buzz = useQuizStore((s) => s.buzz)
  const question = useQuizStore((s) => s.buzzQuestion)
  const result = useQuizStore((s) => s.buzzResult)
  const leaderboard = useQuizStore((s) => s.leaderboard)
  const myScore = useQuizStore((s) => s.myScore)

  const shell = 'h-[100dvh] bg-gray-950 text-white flex flex-col items-center justify-center p-6 text-center gap-4 select-none'

  // ── Fin de partie : podium ──────────────────────────────────
  if (status === 'ended') {
    const myRank = leaderboard.find((s) => s.participantId === myId)?.rank
    return (
      <div className={shell}>
        <div className="text-6xl">🏁</div>
        <h1 className="text-3xl font-black">Terminé !</h1>
        {myRank && <p className="text-xl text-gray-300">Tu finis <span className="font-bold text-indigo-400">{myRank}ᵉ</span> avec {myScore} pt{myScore > 1 ? 's' : ''}</p>}
        <ol className="w-full max-w-xs space-y-2 mt-2">
          {leaderboard.slice(0, 5).map((s) => (
            <li key={s.participantId} className={`flex items-center justify-between px-4 py-2 rounded-xl ${s.participantId === myId ? 'bg-indigo-600' : 'bg-gray-900'}`}>
              <span className="font-medium">{s.rank}. {s.pseudo}</span>
              <span className="font-mono font-bold">{s.score}</span>
            </li>
          ))}
        </ol>
      </div>
    )
  }

  // ── Avant le lancement ──────────────────────────────────────
  if (status !== 'running' || !buzz || !question) {
    return (
      <div className={shell}>
        <div className="text-5xl">🎙️</div>
        <h1 className="text-2xl font-bold">Prêt·e, {myPseudo} ?</h1>
        <p className="text-gray-400">L'animateur va lancer la partie. Garde ton téléphone en main — il servira de buzzer.</p>
        <p className="text-sm text-gray-500 mt-2">Ton score : <span className="font-mono font-bold text-white">{myScore}</span></p>
      </div>
    )
  }

  const iAmOwner = buzz.ownerParticipantId === myId
  const iHaveFloor = buzz.lockedBy?.participantId === myId
  const iAmLockedOut = myId !== null && buzz.lockedOut.includes(myId)
  const canBuzz = buzz.armed && !iAmOwner && !iAmLockedOut
  const diff = question.difficulty ? DIFFICULTY_LABEL[question.difficulty] : null

  const onBuzz = () => {
    if (!canBuzz) return
    vibrate(50)
    socket.emit(EVENTS.BUZZ, {})
  }

  // Bandeau haut : difficulté + score (constant quelle que soit la phase)
  const header = (
    <div className="absolute top-0 inset-x-0 flex items-center justify-between px-5 py-4 text-sm">
      {diff ? (
        <span className="px-3 py-1 rounded-full bg-gray-800 font-bold">{diff.label} · {diff.pts} pt{diff.pts > 1 ? 's' : ''}</span>
      ) : <span />}
      <span className="text-gray-400">Score <span className="font-mono font-bold text-white">{myScore}</span></span>
    </div>
  )

  // ── Révélation ──────────────────────────────────────────────
  if (buzz.phase === 'revealed') {
    const iScored = result?.scorer?.participantId === myId
    return (
      <div className={`${shell} relative`}>
        {header}
        <div className="text-5xl">{iScored ? '🎉' : result?.scorer ? '👏' : '🤷'}</div>
        <p className="text-gray-400 text-sm uppercase tracking-wider">Réponse</p>
        <p className="text-2xl font-bold">{(result?.correctAnswers ?? []).join(' · ')}</p>
        {result?.scorer ? (
          <p className={iScored ? 'text-emerald-400 font-bold text-lg' : 'text-gray-300'}>
            {iScored ? `+${result.scorer.points} pour toi !` : `${result.scorer.pseudo} marque +${result.scorer.points}`}
          </p>
        ) : (
          <p className="text-gray-500">Personne n'a trouvé.</p>
        )}
      </div>
    )
  }

  // ── Tour de l'owner à l'oral (round perso) ──────────────────
  if (buzz.phase === 'owner_oral') {
    return (
      <div className={`${shell} relative`}>
        {header}
        {iAmOwner ? (
          <>
            <div className="text-6xl">🗣️</div>
            <h1 className="text-3xl font-black text-indigo-400">À toi !</h1>
            <p className="text-gray-300">C'est ton thème. Réponds <span className="font-bold">à voix haute</span>.</p>
          </>
        ) : (
          <>
            <div className="text-5xl">👂</div>
            <p className="text-xl">Au tour de <span className="font-bold text-indigo-400">{buzz.ownerName}</span></p>
            <p className="text-gray-400">Prépare-toi à buzzer s'il·elle sèche…</p>
          </>
        )}
      </div>
    )
  }

  // ── Phase de vol / buzzer ouvert ────────────────────────────
  // J'ai la parole
  if (iHaveFloor) {
    return (
      <div className={`${shell} relative bg-emerald-600`}>
        {header}
        <div className="text-6xl">🎤</div>
        <h1 className="text-4xl font-black">À toi de répondre !</h1>
        <p className="text-emerald-100">Réponds à voix haute — l'animateur valide.</p>
      </div>
    )
  }
  // Quelqu'un d'autre a buzzé
  if (buzz.lockedBy) {
    return (
      <div className={`${shell} relative`}>
        {header}
        <div className="text-5xl">🔒</div>
        <p className="text-xl"><span className="font-bold text-indigo-400">{buzz.lockedBy.pseudo}</span> a buzzé</p>
        <p className="text-gray-400">Écoute sa réponse…</p>
      </div>
    )
  }
  // Je suis l'owner pendant le vol (je ne peux pas voler mon propre thème)
  if (iAmOwner) {
    return (
      <div className={`${shell} relative`}>
        {header}
        <div className="text-5xl">⏳</div>
        <p className="text-xl">C'était ton thème…</p>
        <p className="text-gray-400">Les autres tentent de voler la question.</p>
      </div>
    )
  }
  // J'ai déjà tenté (verrouillé)
  if (iAmLockedOut) {
    return (
      <div className={`${shell} relative`}>
        {header}
        <div className="text-5xl">🙊</div>
        <p className="text-xl">Tu as déjà tenté</p>
        <p className="text-gray-400">Laisse les autres buzzer.</p>
      </div>
    )
  }

  // Buzzer disponible (armé) OU en attente de réouverture
  return (
    <div className={`${shell} relative`}>
      {header}
      <button
        type="button"
        onClick={onBuzz}
        disabled={!canBuzz}
        className={`w-56 h-56 rounded-full font-black text-3xl shadow-2xl transition-transform active:scale-95 ${
          canBuzz
            ? 'bg-rose-600 hover:bg-rose-500 text-white ring-8 ring-rose-500/30'
            : 'bg-gray-800 text-gray-600 cursor-not-allowed'
        }`}
      >
        {canBuzz ? 'BUZZ' : '…'}
      </button>
      <p className="text-gray-400 mt-4">
        {canBuzz ? 'Appuie dès que tu connais la réponse !' : 'Buzzer fermé — attends la réouverture.'}
      </p>
    </div>
  )
}
