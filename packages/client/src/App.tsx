import { useQuizStore } from './store/quiz-store'
import { JoinPage } from './pages/JoinPage'
import { LobbyPage } from './pages/LobbyPage'

// Routing ultra-simple : on switche la vue selon l'URL path et l'état.
export function App() {
  const currentView = useQuizStore((s) => s.currentView)
  const path = window.location.pathname

  // Pages host — indépendantes du store participant
  if (path.startsWith('/host/control')) return <HostControlPage />
  if (path.startsWith('/host/display')) return <HostDisplayPage />

  // Pages participant
  if (currentView === 'join') return <JoinPage />
  return <LobbyPage />
}

// Stubs host pour S2 (seront implémentés en S3)
function HostControlPage() {
  return (
    <div style={{ padding: '2rem', fontFamily: 'sans-serif' }}>
      <h1>Host Control — S3</h1>
    </div>
  )
}

function HostDisplayPage() {
  return (
    <div style={{ padding: '2rem', fontFamily: 'sans-serif' }}>
      <h1>Host Display — S3</h1>
    </div>
  )
}
