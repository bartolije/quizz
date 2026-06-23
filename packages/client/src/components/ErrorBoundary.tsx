import { Component, type ReactNode } from 'react'
import { reportClientError } from '../error-reporting'

interface Props {
  children: ReactNode
}
interface State {
  crashed: boolean
}

// Évite l'écran blanc en cas de crash React : affiche un écran de secours et
// remonte l'erreur au serveur (S10).
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { crashed: false }

  static getDerivedStateFromError(): State {
    return { crashed: true }
  }

  override componentDidCatch(error: Error, info: { componentStack?: string | null }): void {
    reportClientError(error.message, error.stack, {
      componentStack: info.componentStack ?? undefined,
    })
  }

  override render(): ReactNode {
    if (this.state.crashed) {
      return (
        <div className="min-h-screen bg-gray-950 text-white flex flex-col items-center justify-center p-6 text-center gap-4">
          <div className="text-5xl">😵</div>
          <p className="text-xl font-bold">Oups, un souci est survenu</p>
          <button
            onClick={() => window.location.reload()}
            className="px-6 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 font-bold"
          >
            Recharger
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
