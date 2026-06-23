import type { GameReport } from '@lya-quiz/shared'

function downloadCsv(filename: string, rows: (string | number)[][]): void {
  const csv = rows
    .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','))
    .join('\n')
  // BOM pour qu'Excel ouvre l'UTF-8 correctement (accents)
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

const accuracy = (correct: number, answered: number): string =>
  answered > 0 ? `${Math.round((correct / answered) * 100)}%` : '—'

export function ReportView({ report, onClose }: { report: GameReport; onClose: () => void }) {
  const exportPlayers = () =>
    downloadCsv('joueurs.csv', [
      ['Rang', 'Joueur', 'Score', 'Bonnes réponses', 'Total questions'],
      ...report.players.map((p) => [p.rank, p.pseudo, p.score, p.correct, report.totalQuestions]),
    ])

  const exportQuestions = () =>
    downloadCsv('questions.csv', [
      ['#', 'Question', 'Type', 'Bonne(s) réponse(s)', 'Répondu', 'Trouvé', 'Réussite'],
      ...report.questions.map((q) => [
        q.index + 1,
        q.text,
        q.type,
        q.correctAnswers.join(' / '),
        q.answeredCount,
        q.type === 'closest' ? '—' : q.correctCount,
        q.type === 'closest' ? '—' : accuracy(q.correctCount, q.answeredCount),
      ]),
    ])

  return (
    <div className="fixed inset-0 z-50 bg-gray-950/95 overflow-y-auto p-6">
      <div className="max-w-3xl mx-auto text-white">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-black">📊 Rapport — {report.title}</h2>
          <button onClick={onClose} className="px-4 py-2 rounded-xl bg-gray-800 hover:bg-gray-700">
            Fermer
          </button>
        </div>

        <div className="flex gap-3 mb-6">
          <button onClick={exportPlayers} className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-sm font-bold">
            ⬇ CSV joueurs
          </button>
          <button onClick={exportQuestions} className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-sm font-bold">
            ⬇ CSV questions
          </button>
        </div>

        <h3 className="text-lg font-bold mb-2">Classement</h3>
        <ol className="space-y-1 mb-8">
          {report.players.map((p) => (
            <li key={p.participantId} className="flex items-center gap-3 bg-gray-900 rounded-xl px-4 py-2">
              <span className="w-8 text-center font-black text-indigo-400">{p.rank}</span>
              <span className="flex-1 font-medium">{p.pseudo}</span>
              <span className="text-gray-400 text-sm">
                {p.correct}/{report.totalQuestions} bonnes
              </span>
              <span className="font-mono font-bold w-16 text-right">{p.score}</span>
            </li>
          ))}
        </ol>

        <h3 className="text-lg font-bold mb-2">Par question</h3>
        <ul className="space-y-2">
          {report.questions.map((q) => {
            const pct = q.type === 'closest' ? 0 : q.answeredCount > 0 ? (q.correctCount / q.answeredCount) * 100 : 0
            return (
              <li key={q.index} className="bg-gray-900 rounded-xl px-4 py-3">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="font-medium">
                    {q.index + 1}. {q.text}
                  </span>
                  <span className="text-sm text-gray-400 whitespace-nowrap">
                    {q.type === 'closest'
                      ? `${q.answeredCount} réponses`
                      : `${q.correctCount}/${q.answeredCount} · ${accuracy(q.correctCount, q.answeredCount)}`}
                  </span>
                </div>
                {q.type !== 'closest' && (
                  <div className="mt-2 h-2 bg-gray-800 rounded-full overflow-hidden">
                    <div className="h-full bg-emerald-500" style={{ width: `${pct}%` }} />
                  </div>
                )}
                <p className="text-xs text-gray-500 mt-1">Réponse : {q.correctAnswers.join(' / ')}</p>
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}
