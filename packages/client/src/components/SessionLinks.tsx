import { useEffect, useState } from 'react'
import { readHostSession, fetchSessionInfo, type SessionInfo } from '../host-session'

// Récap des liens de la partie, en tête de /admin : écran de contrôle, écran TV,
// lien joueurs. La session vient du localStorage (posée par « Lancer »).
export function SessionLinks() {
  const [stored] = useState(readHostSession)
  // undefined = chargement ; null = aucune session vivante côté serveur
  const [info, setInfo] = useState<SessionInfo | null | undefined>(stored ? undefined : null)
  const [copied, setCopied] = useState<string | null>(null)

  useEffect(() => {
    if (stored) void fetchSessionInfo(stored.sessionId).then(setInfo).catch(() => setInfo(null))
  }, [stored])

  const origin = window.location.origin
  const live = info && info.status !== 'ended' ? info : null

  function copy(url: string) {
    void navigator.clipboard
      .writeText(url)
      .then(() => {
        setCopied(url)
        setTimeout(() => setCopied(null), 1500)
      })
      .catch(() => window.prompt('Copie ce lien :', url)) // contexte non sécurisé (http hors localhost)
  }

  function Row({ icon, title, hint, url }: { icon: string; title: string; hint: string; url: string }) {
    return (
      <li className="flex flex-wrap items-center gap-3 bg-gray-800/60 rounded-xl px-4 py-3">
        <span className="text-2xl" aria-hidden>{icon}</span>
        <div className="flex-1 min-w-48">
          <p className="font-medium">{title}</p>
          <p className="text-xs text-gray-500">{hint}</p>
          <p className="text-xs text-gray-400 font-mono break-all select-all">{url}</p>
        </div>
        <button onClick={() => copy(url)} className="px-3 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-sm">
          {copied === url ? 'Copié ✓' : 'Copier'}
        </button>
        <a
          href={url}
          target="_blank"
          rel="noopener"
          className="px-3 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-sm font-bold"
        >
          Ouvrir ↗
        </a>
      </li>
    )
  }

  if (info === undefined) return null // évite un flash « aucune partie » pendant le chargement

  const players = live ? live.participants.filter((p) => p.connected).length : 0

  return (
    <section className="bg-gray-900 rounded-2xl p-4 mb-6">
      <h2 className="font-bold mb-1">🔗 Liens de la partie</h2>
      {live ? (
        <>
          <p className="text-sm text-gray-400 mb-3">
            PIN <span className="font-mono font-bold text-white">{live.pin}</span>
            {live.quizTitle && <> · {live.quizTitle}</>} · {players} joueur{players > 1 ? 's' : ''} ·{' '}
            {live.status === 'waiting' ? 'en attente des joueurs' : 'partie en cours'}
          </p>
          <ul className="space-y-2">
            <Row
              icon="🎛️"
              title="Écran de contrôle"
              hint="Sur ton ordi : démarrer, questions suivantes, classement."
              url={`${origin}/host/control`}
            />
            <Row
              icon="📺"
              title="Écran TV (présentation)"
              hint="Sur l'écran projeté, en plein écran : QR code, questions, classement. Marche aussi depuis un autre ordi."
              url={`${origin}/host/display?session=${live.sessionId}`}
            />
            <Row
              icon="📱"
              title="Lien joueurs"
              hint="À partager (le QR code est aussi affiché sur la TV) : PIN déjà rempli."
              url={`${origin}/join?pin=${live.pin}`}
            />
          </ul>
        </>
      ) : (
        <p className="text-sm text-gray-400">
          Aucune partie en cours. Clique sur <span className="text-emerald-400 font-bold">Lancer</span> à côté
          d'un quiz : l'écran de contrôle s'ouvre, et tu retrouveras ici les liens de l'écran TV et des
          joueurs (reviens sur <span className="font-mono">/admin</span>).
        </p>
      )}
    </section>
  )
}
