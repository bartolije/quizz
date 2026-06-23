import type { Quiz, QuestionType } from '@lya-quiz/shared'
import type { QuizInput, QuestionInput } from './admin-api'

const TYPES: QuestionType[] = ['mcq', 'free', 'closest', 'ordering']

// Quiz (DB) → format d'échange JSON (sans id technique). C'est exactement le
// format accepté par l'import → round-trip + format à donner à un LLM.
export function toExport(quiz: Quiz): QuizInput {
  return {
    title: quiz.title,
    defaultTimeLimit: quiz.defaultTimeLimit,
    questions: quiz.questions.map((q) => ({
      type: q.type,
      text: q.text,
      ...(q.choices ? { choices: q.choices } : {}),
      correctAnswers: q.correctAnswers,
      timeLimit: q.timeLimit,
      ...(q.mediaUrl ? { mediaUrl: q.mediaUrl } : {}),
    })),
  }
}

export function downloadJson(filename: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'quiz'
  )
}

// Parse + valide un JSON de quiz. Tolérant (timeLimit/defaultTimeLimit optionnels)
// mais strict sur la structure essentielle, pour des erreurs claires.
export function parseQuizJson(text: string): { quiz: QuizInput | null; error: string | null } {
  const err = (error: string) => ({ quiz: null, error })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let raw: any
  try {
    raw = JSON.parse(text)
  } catch {
    return err('JSON invalide (vérifie la syntaxe).')
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return err('Le JSON doit être un objet { title, questions }.')
  if (typeof raw.title !== 'string' || !raw.title.trim()) return err('Champ "title" (texte) manquant.')
  if (!Array.isArray(raw.questions) || raw.questions.length === 0)
    return err('Champ "questions" (liste non vide) manquant.')

  const defaultTimeLimit = Number(raw.defaultTimeLimit) > 0 ? Number(raw.defaultTimeLimit) : 20
  const questions: QuestionInput[] = []

  for (let i = 0; i < raw.questions.length; i++) {
    const q = raw.questions[i]
    const n = i + 1
    if (!q || typeof q !== 'object') return err(`Question ${n} : objet invalide.`)
    if (!TYPES.includes(q.type)) return err(`Question ${n} : "type" doit être mcq, free, closest ou ordering.`)
    if (typeof q.text !== 'string' || !q.text.trim()) return err(`Question ${n} : "text" manquant.`)
    if (!Array.isArray(q.correctAnswers) || q.correctAnswers.length === 0)
      return err(`Question ${n} : "correctAnswers" (liste non vide) manquant.`)

    const type = q.type as QuestionType
    const correctAnswers = q.correctAnswers.map((x: unknown) => String(x))
    const timeLimit = Number(q.timeLimit) > 0 ? Number(q.timeLimit) : defaultTimeLimit

    if (type === 'mcq') {
      if (!Array.isArray(q.choices) || q.choices.length < 2)
        return err(`Question ${n} (mcq) : "choices" (au moins 2) manquant.`)
    }
    if (type === 'ordering' && correctAnswers.length < 2)
      return err(`Question ${n} (ordering) : au moins 2 éléments dans "correctAnswers".`)
    if (type === 'closest' && Number.isNaN(Number(correctAnswers[0])))
      return err(`Question ${n} (closest) : "correctAnswers[0]" doit être un nombre.`)

    questions.push({
      type,
      text: q.text.trim(),
      correctAnswers,
      timeLimit,
      ...(type === 'mcq' ? { choices: (q.choices as unknown[]).map((c) => String(c)) } : {}),
      ...(typeof q.mediaUrl === 'string' && q.mediaUrl.trim() ? { mediaUrl: q.mediaUrl.trim() } : {}),
    })
  }

  return { quiz: { title: raw.title.trim(), defaultTimeLimit, questions }, error: null }
}
