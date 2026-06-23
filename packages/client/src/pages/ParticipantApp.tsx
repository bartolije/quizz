import { useQuizStore } from '../store/quiz-store'
import { useParticipantEvents } from '../hooks/useParticipantEvents'
import { LobbyPage } from './LobbyPage'
import { QuestionPage } from './QuestionPage'
import { AnswerPage } from './AnswerPage'
import { LeaderboardPage } from './LeaderboardPage'
import { EndedPage } from './EndedPage'

// Shell participant monté sur /lobby : branche les events temps réel et bascule
// la vue selon l'état du jeu (lobby → question → réponse → … → fin).
export function ParticipantApp() {
  useParticipantEvents()
  const view = useQuizStore((s) => s.currentView)

  switch (view) {
    case 'question':
      return <QuestionPage />
    case 'answer':
      return <AnswerPage />
    case 'leaderboard':
      return <LeaderboardPage />
    case 'ended':
      return <EndedPage />
    default:
      return <LobbyPage />
  }
}
