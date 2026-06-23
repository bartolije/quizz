// Gestionnaire audio (côté host/TV uniquement). Lit des fichiers déposés dans
// packages/client/public/sounds/ (servis à /sounds/*.mp3). Fichiers absents →
// no-op silencieux (aucun crash). L'audio doit être débloqué par un geste
// utilisateur (bouton « Activer le son ») à cause des politiques navigateurs.

export type Track = 'lobby' | 'question' | 'reveal' | 'podium'

const FILES: Record<Track, string> = {
  lobby: '/sounds/lobby.mp3',
  question: '/sounds/question.mp3',
  reveal: '/sounds/reveal.mp3',
  podium: '/sounds/podium.mp3',
}
const VOLUME: Record<Track, number> = { lobby: 0.35, question: 0.4, reveal: 0.6, podium: 0.6 }

let enabled = false
let muted = false
let currentLoop: Track | null = null
const cache: Partial<Record<Track, HTMLAudioElement>> = {}

function audio(track: Track): HTMLAudioElement {
  let a = cache[track]
  if (!a) {
    a = new Audio(FILES[track])
    a.preload = 'auto'
    a.volume = VOLUME[track]
    cache[track] = a
  }
  return a
}

export function enableSound(): void {
  enabled = true
}
export function setMuted(m: boolean): void {
  muted = m
  if (m) stopLoop()
}
export function isMuted(): boolean {
  return muted
}

// Démarre/maintient une boucle (lobby, question…). Idempotent si déjà en cours.
export function playLoop(track: Track): void {
  if (!enabled || muted) return
  if (currentLoop === track) return
  stopLoop()
  currentLoop = track
  const a = audio(track)
  a.loop = true
  a.currentTime = 0
  void a.play().catch(() => {})
}

export function stopLoop(): void {
  if (currentLoop) {
    const a = cache[currentLoop]
    if (a) {
      a.pause()
      a.currentTime = 0
    }
    currentLoop = null
  }
}

// Joue un son ponctuel (révélation, podium…).
export function playOnce(track: Track): void {
  if (!enabled || muted) return
  const a = audio(track)
  a.loop = false
  a.currentTime = 0
  void a.play().catch(() => {})
}
