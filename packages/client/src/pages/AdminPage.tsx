import { useEffect, useState } from 'react'
import type { Quiz, Question, QuestionType, QuestionSection, GameType } from '@lya-quiz/shared'
import { DIFFICULTY_POINTS } from '@lya-quiz/shared'
import { QuestionImage } from '../components/QuestionImage'
import { toExport, downloadJson, slugify, parseQuizJson } from '../quiz-io'
import {
  checkPw,
  setPw,
  getPw,
  listQuizzes,
  fetchQuiz,
  createQuiz,
  updateQuiz,
  deleteQuiz,
  launchQuiz,
  type QuizSummary,
  type QuizInput,
} from '../admin-api'

// ── Modèle d'édition (formulaire) ────────────────────────────
interface EQ {
  type: QuestionType
  text: string
  choices: string[] // 4 entrées (mcq)
  correctIndex: number // mcq
  freeAnswers: string // free/ordering/buzzer : une réponse par ligne
  closestValue: string // closest
  mediaUrl: string // image optionnelle (URL)
  timeLimit: number
  // Mode buzzer (partie famille)
  section: QuestionSection
  ownerName: string
  themeName: string // nom d'affichage du thème (masque l'owner sur TV/téléphones)
  points: number
}
interface EditDraft {
  id: string | null
  title: string
  defaultTimeLimit: number
  gameType: GameType
  questions: EQ[]
}

const newEQ = (timeLimit: number): EQ => ({
  type: 'mcq',
  text: '',
  choices: ['', '', '', ''],
  correctIndex: 0,
  freeAnswers: '',
  closestValue: '',
  mediaUrl: '',
  timeLimit,
  section: 'culture',
  ownerName: '',
  themeName: '',
  points: 2,
})

function fromQuestion(q: Question): EQ {
  const choices = [...(q.choices ?? [])].slice(0, 4)
  while (choices.length < 4) choices.push('')
  return {
    type: q.type,
    text: q.text,
    choices,
    correctIndex: q.type === 'mcq' ? Math.max(0, choices.indexOf(q.correctAnswers[0] ?? '')) : 0,
    // buzzer : la réponse de référence est stockée comme 'free' (correctAnswers)
    freeAnswers:
      q.type === 'free' || q.type === 'ordering' ? q.correctAnswers.join('\n') : '',
    closestValue: q.type === 'closest' ? (q.correctAnswers[0] ?? '') : '',
    mediaUrl: q.mediaUrl ?? '',
    timeLimit: q.timeLimit,
    section: q.section ?? 'culture',
    ownerName: q.ownerName ?? '',
    themeName: q.themeName ?? '',
    points: q.points ?? (q.difficulty ? DIFFICULTY_POINTS[q.difficulty] : 2),
  }
}

function toDraft(quiz: Quiz): EditDraft {
  return {
    id: quiz.id,
    title: quiz.title,
    defaultTimeLimit: quiz.defaultTimeLimit,
    gameType: quiz.gameType ?? 'classic',
    questions: quiz.questions.map(fromQuestion),
  }
}

function toInput(d: EditDraft): { input: QuizInput; error: string | null } {
  if (!d.title.trim()) return { input: null as never, error: 'Donne un titre au quiz.' }
  if (d.questions.length === 0) return { input: null as never, error: 'Ajoute au moins une question.' }
  const questions: QuizInput['questions'] = []
  for (let i = 0; i < d.questions.length; i++) {
    const q = d.questions[i]!
    const n = i + 1
    const media = q.mediaUrl.trim() ? { mediaUrl: q.mediaUrl.trim() } : {}
    if (!q.text.trim()) return { input: null as never, error: `Question ${n} : l'énoncé est vide.` }

    // Mode buzzer : question arbitrée à l'oral → stockée en 'free' (réponse de
    // référence), + section/owner/difficulté. Pas de type mcq/closest/ordering.
    if (d.gameType === 'buzzer') {
      const answers = q.freeAnswers.split('\n').map((s) => s.trim()).filter(Boolean)
      if (answers.length === 0) return { input: null as never, error: `Question ${n} : ajoute une réponse de référence.` }
      if (q.section === 'perso' && !q.ownerName.trim()) return { input: null as never, error: `Question ${n} : indique le joueur (thème perso).` }
      if (!(q.points >= 1)) return { input: null as never, error: `Question ${n} : les points doivent être ≥ 1.` }
      questions.push({
        type: 'free',
        text: q.text.trim(),
        correctAnswers: answers,
        timeLimit: 0,
        points: Math.round(q.points),
        section: q.section,
        ...(q.section === 'perso' ? { ownerName: q.ownerName.trim() } : {}),
        ...(q.section === 'perso' && q.themeName.trim() ? { themeName: q.themeName.trim() } : {}),
        ...media,
      })
      continue
    }

    if (q.type === 'mcq') {
      const choices = q.choices.map((c) => c.trim())
      if (choices.some((c) => !c)) return { input: null as never, error: `Question ${n} : les 4 choix doivent être remplis.` }
      questions.push({ type: 'mcq', text: q.text.trim(), choices, correctAnswers: [choices[q.correctIndex] ?? choices[0]!], timeLimit: q.timeLimit, ...media })
    } else if (q.type === 'free') {
      const answers = q.freeAnswers.split('\n').map((s) => s.trim()).filter(Boolean)
      if (answers.length === 0) return { input: null as never, error: `Question ${n} : ajoute au moins une bonne réponse.` }
      questions.push({ type: 'free', text: q.text.trim(), correctAnswers: answers, timeLimit: q.timeLimit, ...media })
    } else if (q.type === 'ordering') {
      const items = q.freeAnswers.split('\n').map((s) => s.trim()).filter(Boolean)
      if (items.length < 2) return { input: null as never, error: `Question ${n} : mets au moins 2 éléments à ordonner.` }
      questions.push({ type: 'ordering', text: q.text.trim(), correctAnswers: items, timeLimit: q.timeLimit, ...media })
    } else {
      const v = q.closestValue.trim()
      if (v === '' || Number.isNaN(Number(v))) return { input: null as never, error: `Question ${n} : la bonne valeur doit être un nombre.` }
      questions.push({ type: 'closest', text: q.text.trim(), correctAnswers: [v], timeLimit: q.timeLimit, ...media })
    }
  }
  return {
    input: { title: d.title.trim(), defaultTimeLimit: d.defaultTimeLimit, questions, gameType: d.gameType },
    error: null,
  }
}

const input = 'bg-gray-800 rounded-lg px-3 py-2 border border-gray-700 focus:border-indigo-500 outline-hidden'

export function AdminPage() {
  const [authed, setAuthed] = useState<boolean | null>(null)
  const [pwInput, setPwInput] = useState('')
  const [loginError, setLoginError] = useState('')
  const [quizzes, setQuizzes] = useState<QuizSummary[]>([])
  const [draft, setDraft] = useState<EditDraft | null>(null)
  const [error, setError] = useState('')
  const [importing, setImporting] = useState(false)
  const [importText, setImportText] = useState('')
  const [importErr, setImportErr] = useState('')

  useEffect(() => {
    if (!getPw()) {
      setAuthed(false)
      return
    }
    listQuizzes()
      .then((qs) => {
        setQuizzes(qs)
        setAuthed(true)
      })
      .catch(() => setAuthed(false))
  }, [])

  async function reload() {
    setQuizzes(await listQuizzes())
  }

  async function doLogin() {
    if (!(await checkPw(pwInput))) {
      setLoginError('Mot de passe incorrect.')
      return
    }
    setPw(pwInput)
    setAuthed(true)
    void reload()
  }

  async function openEdit(id: string) {
    setDraft(toDraft(await fetchQuiz(id)))
  }

  function openNew() {
    setDraft({ id: null, title: '', defaultTimeLimit: 20, gameType: 'classic', questions: [newEQ(20)] })
  }

  async function save() {
    if (!draft) return
    const { input: payload, error: err } = toInput(draft)
    if (err) {
      setError(err)
      return
    }
    setError('')
    if (draft.id) await updateQuiz(draft.id, payload)
    else await createQuiz(payload)
    setDraft(null)
    void reload()
  }

  async function launch(id: string) {
    const { pin, sessionId, hostKey } = await launchQuiz(id)
    // Stocker le hostKey → /host/control reprend CETTE session (le bon quiz) au
    // lieu d'en recréer une avec le quiz par défaut.
    localStorage.setItem('lya_host_session', JSON.stringify({ sessionId, pin, hostKey }))
    window.location.href = '/host/control'
  }

  async function remove(id: string) {
    if (!confirm('Supprimer ce quiz ?')) return
    await deleteQuiz(id)
    void reload()
  }

  async function exportQuiz(id: string) {
    const quiz = await fetchQuiz(id)
    downloadJson(`${slugify(quiz.title)}.json`, toExport(quiz))
  }

  async function doImport() {
    const { quiz, error: e } = parseQuizJson(importText)
    if (e || !quiz) {
      setImportErr(e ?? 'Erreur.')
      return
    }
    await createQuiz(quiz)
    setImporting(false)
    setImportText('')
    setImportErr('')
    void reload()
  }

  // mutation immuable d'une question du draft
  function patchQ(i: number, patch: Partial<EQ>) {
    setDraft((d) =>
      d ? { ...d, questions: d.questions.map((q, j) => (j === i ? { ...q, ...patch } : q)) } : d,
    )
  }
  function moveQ(i: number, dir: -1 | 1) {
    setDraft((d) => {
      if (!d) return d
      const j = i + dir
      if (j < 0 || j >= d.questions.length) return d
      const qs = [...d.questions]
      ;[qs[i], qs[j]] = [qs[j]!, qs[i]!]
      return { ...d, questions: qs }
    })
  }

  if (authed === null) {
    return <div className="min-h-screen bg-gray-950 text-gray-400 flex items-center justify-center">Chargement…</div>
  }

  // ── Connexion ──
  if (!authed) {
    return (
      <div className="min-h-screen bg-gray-950 text-white flex flex-col items-center justify-center p-6 gap-4">
        <h1 className="text-3xl font-bold">Éditeur LYA QUIZ</h1>
        <p className="text-gray-400">Accès protégé</p>
        <input
          type="password"
          value={pwInput}
          onChange={(e) => setPwInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && doLogin()}
          placeholder="Mot de passe"
          className={`${input} w-64 text-center`}
          autoFocus
        />
        {loginError && <p className="text-rose-400 text-sm">{loginError}</p>}
        <button onClick={doLogin} className="px-8 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 font-bold">
          Entrer
        </button>
      </div>
    )
  }

  // ── Éditeur d'un quiz ──
  if (draft) {
    return (
      <div className="min-h-screen bg-gray-950 text-white p-6 max-w-3xl mx-auto">
        <h1 className="text-2xl font-bold mb-4">{draft.id ? 'Éditer le quiz' : 'Nouveau quiz'}</h1>

        <div className="flex flex-wrap gap-3 mb-2">
          <input
            value={draft.title}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            placeholder="Titre du quiz"
            className={`${input} flex-1 text-lg`}
          />
          <label className="flex items-center gap-2 text-sm text-gray-400">
            Type
            <select
              value={draft.gameType}
              onChange={(e) => setDraft({ ...draft, gameType: e.target.value as GameType })}
              className={input}
            >
              <option value="classic">Classique (Kahoot)</option>
              <option value="buzzer">Famille (buzzer)</option>
            </select>
          </label>
          {draft.gameType === 'classic' && (
            <label className="flex items-center gap-2 text-sm text-gray-400">
              Temps/déf.
              <input
                type="number"
                value={draft.defaultTimeLimit}
                onChange={(e) => setDraft({ ...draft, defaultTimeLimit: Number(e.target.value) })}
                className={`${input} w-20`}
              />
            </label>
          )}
        </div>
        {draft.gameType === 'buzzer' && (
          <p className="text-gray-500 text-sm mb-6">
            Partie famille : tu arbitres à l'oral (bon/faux), pas de chrono. Chaque question a une
            <b> difficulté</b> (Facile 1 · Moyen 2 · Difficile 3) et une <b>section</b> : « perso »
            (thème d'un joueur, répondu d'abord par lui puis volable) ou « culture » (ouvert à tous).
          </p>
        )}
        {draft.gameType === 'classic' && <div className="mb-6" />}

        <div className="space-y-4">
          {draft.questions.map((q, i) => (
            <div key={i} className="bg-gray-900 rounded-2xl p-4 space-y-3">
              <div className="flex items-center gap-2">
                <span className="font-bold text-indigo-400">Q{i + 1}</span>
                {draft.gameType === 'classic' ? (
                  <select
                    value={q.type}
                    onChange={(e) => patchQ(i, { type: e.target.value as QuestionType })}
                    className={input}
                  >
                    <option value="mcq">Choix multiple</option>
                    <option value="free">Saisie libre</option>
                    <option value="closest">Au plus proche</option>
                    <option value="ordering">Remettre dans l'ordre</option>
                  </select>
                ) : (
                  <>
                    <select
                      value={q.section}
                      onChange={(e) => patchQ(i, { section: e.target.value as QuestionSection })}
                      className={input}
                    >
                      <option value="perso">Thème perso</option>
                      <option value="culture">Culture G</option>
                    </select>
                    {q.section === 'perso' && (
                      <>
                        <input
                          value={q.ownerName}
                          onChange={(e) => patchQ(i, { ownerName: e.target.value })}
                          placeholder="Joueur (thème)"
                          className={`${input} w-36`}
                        />
                        <input
                          value={q.themeName}
                          onChange={(e) => patchQ(i, { themeName: e.target.value })}
                          placeholder="Nom du thème (ex. Disney)"
                          title="Affiché sur la TV et les téléphones à la place du prénom — le thème reste anonyme"
                          className={`${input} w-44`}
                        />
                      </>
                    )}
                    <label className="flex items-center gap-1 text-sm text-gray-400">
                      Points
                      <input
                        type="number"
                        min={1}
                        value={q.points}
                        onChange={(e) => patchQ(i, { points: Number(e.target.value) })}
                        className={`${input} w-16`}
                        title="Nombre de points (libre — ex. « ultra dur » = 5)"
                      />
                    </label>
                    <div className="flex gap-1">
                      {[1, 2, 3].map((p) => (
                        <button
                          key={p}
                          type="button"
                          onClick={() => patchQ(i, { points: p })}
                          className={`px-2 py-1 rounded-sm text-xs ${q.points === p ? 'bg-indigo-600' : 'bg-gray-800 hover:bg-gray-700'}`}
                          title={`${p} point${p > 1 ? 's' : ''}`}
                        >
                          {p}
                        </button>
                      ))}
                    </div>
                  </>
                )}
                <div className="ml-auto flex gap-1">
                  <button onClick={() => moveQ(i, -1)} className="px-2 py-1 rounded-sm bg-gray-800 hover:bg-gray-700">↑</button>
                  <button onClick={() => moveQ(i, 1)} className="px-2 py-1 rounded-sm bg-gray-800 hover:bg-gray-700">↓</button>
                  <button
                    onClick={() => setDraft({ ...draft, questions: draft.questions.filter((_, j) => j !== i) })}
                    className="px-2 py-1 rounded-sm bg-rose-900/60 hover:bg-rose-800 text-rose-200"
                  >
                    🗑
                  </button>
                </div>
              </div>

              <input
                value={q.text}
                onChange={(e) => patchQ(i, { text: e.target.value })}
                placeholder="Énoncé de la question"
                className={`${input} w-full`}
              />

              {draft.gameType === 'buzzer' && (
                <textarea
                  value={q.freeAnswers}
                  onChange={(e) => patchQ(i, { freeAnswers: e.target.value })}
                  placeholder="Réponse(s) de référence (une par ligne) — affichée à la révélation, c'est toi qui juges à l'oral"
                  rows={2}
                  className={`${input} w-full`}
                />
              )}

              {draft.gameType === 'classic' && q.type === 'mcq' && (
                <div className="space-y-2">
                  {q.choices.map((c, ci) => (
                    <label key={ci} className="flex items-center gap-2">
                      <input
                        type="radio"
                        name={`correct-${i}`}
                        checked={q.correctIndex === ci}
                        onChange={() => patchQ(i, { correctIndex: ci })}
                        title="Bonne réponse"
                      />
                      <input
                        value={c}
                        onChange={(e) =>
                          patchQ(i, { choices: q.choices.map((x, j) => (j === ci ? e.target.value : x)) })
                        }
                        placeholder={`Choix ${ci + 1}`}
                        className={`${input} flex-1`}
                      />
                    </label>
                  ))}
                  <p className="text-xs text-gray-500">Coche le rond de la bonne réponse.</p>
                </div>
              )}

              {draft.gameType === 'classic' && (q.type === 'free' || q.type === 'ordering') && (
                <textarea
                  value={q.freeAnswers}
                  onChange={(e) => patchQ(i, { freeAnswers: e.target.value })}
                  placeholder={
                    q.type === 'ordering'
                      ? 'Éléments DANS LE BON ORDRE (un par ligne) — ils seront mélangés pour les joueurs'
                      : 'Bonnes réponses acceptées (une par ligne)'
                  }
                  rows={4}
                  className={`${input} w-full`}
                />
              )}

              {draft.gameType === 'classic' && q.type === 'closest' && (
                <input
                  type="number"
                  value={q.closestValue}
                  onChange={(e) => patchQ(i, { closestValue: e.target.value })}
                  placeholder="La bonne valeur (nombre)"
                  className={`${input} w-full`}
                />
              )}

              {/* Image : disponible dans les deux modes (classique ET buzzer) */}
              <div className="space-y-1">
                <input
                  value={q.mediaUrl}
                  onChange={(e) => patchQ(i, { mediaUrl: e.target.value })}
                  placeholder="URL d'une image (optionnel, https://…)"
                  className={`${input} w-full`}
                />
                {q.mediaUrl.trim() && (
                  <QuestionImage key={q.mediaUrl} url={q.mediaUrl.trim()} className="max-h-32" />
                )}
              </div>

              {draft.gameType === 'classic' && (
                <label className="flex items-center gap-2 text-sm text-gray-400">
                  Temps (s)
                  <input
                    type="number"
                    value={q.timeLimit}
                    onChange={(e) => patchQ(i, { timeLimit: Number(e.target.value) })}
                    className={`${input} w-20`}
                  />
                </label>
              )}
            </div>
          ))}
        </div>

        <button
          onClick={() => setDraft({ ...draft, questions: [...draft.questions, newEQ(draft.defaultTimeLimit)] })}
          className="mt-4 px-4 py-2 rounded-xl bg-gray-800 hover:bg-gray-700"
        >
          + Ajouter une question
        </button>

        {error && <p className="text-rose-400 mt-4">{error}</p>}

        <div className="flex gap-3 mt-6">
          <button onClick={save} className="px-8 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 font-bold">
            Enregistrer
          </button>
          <button onClick={() => { setDraft(null); setError('') }} className="px-6 py-3 rounded-xl bg-gray-800 hover:bg-gray-700">
            Annuler
          </button>
        </div>
      </div>
    )
  }

  // ── Import JSON ──
  if (importing) {
    return (
      <div className="min-h-screen bg-gray-950 text-white p-6 max-w-3xl mx-auto">
        <h1 className="text-2xl font-bold mb-2">Importer un quiz (JSON)</h1>
        <p className="text-gray-400 text-sm mb-3">
          Colle le JSON d'un quiz, ou charge un fichier <code>.json</code>. Format = celui de
          l'export (idéal pour générer un quiz avec un LLM puis l'importer).
        </p>
        <input
          type="file"
          accept="application/json,.json"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) void f.text().then(setImportText)
          }}
          className="mb-3 text-sm text-gray-300"
        />
        <textarea
          value={importText}
          onChange={(e) => setImportText(e.target.value)}
          rows={14}
          placeholder={'{\n  "title": "Mon quiz",\n  "defaultTimeLimit": 20,\n  "questions": [\n    { "type": "mcq", "text": "...", "choices": ["a","b","c","d"], "correctAnswers": ["a"], "timeLimit": 20 }\n  ]\n}'}
          className={`${input} w-full font-mono text-sm`}
        />
        {importErr && <p className="text-rose-400 mt-2">{importErr}</p>}
        <div className="flex gap-3 mt-4">
          <button onClick={doImport} className="px-8 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 font-bold">
            Importer
          </button>
          <button
            onClick={() => {
              setImporting(false)
              setImportText('')
              setImportErr('')
            }}
            className="px-6 py-3 rounded-xl bg-gray-800 hover:bg-gray-700"
          >
            Annuler
          </button>
        </div>
      </div>
    )
  }

  // ── Liste des quiz ──
  return (
    <div className="min-h-screen bg-gray-950 text-white p-6 max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Mes quiz</h1>
        <div className="flex gap-2">
          <button
            onClick={() => setImporting(true)}
            className="px-4 py-2 rounded-xl bg-gray-800 hover:bg-gray-700 font-bold"
          >
            ⬆ Importer JSON
          </button>
          <button onClick={openNew} className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 font-bold">
            + Nouveau quiz
          </button>
        </div>
      </div>

      {quizzes.length === 0 ? (
        <p className="text-gray-500">Aucun quiz. Crée le premier !</p>
      ) : (
        <ul className="space-y-2">
          {quizzes.map((q) => (
            <li key={q.id} className="flex items-center gap-3 bg-gray-900 rounded-xl px-4 py-3">
              <div className="flex-1">
                <p className="font-medium">{q.title}</p>
                <p className="text-xs text-gray-500">{q.questionCount} question{q.questionCount > 1 ? 's' : ''}</p>
              </div>
              <button onClick={() => launch(q.id)} className="px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-sm font-bold">
                Lancer
              </button>
              <button onClick={() => openEdit(q.id)} className="px-3 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-sm">
                Éditer
              </button>
              <button onClick={() => void exportQuiz(q.id)} className="px-3 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-sm">
                Export
              </button>
              <button onClick={() => remove(q.id)} className="px-3 py-2 rounded-lg bg-rose-900/60 hover:bg-rose-800 text-rose-200 text-sm">
                Suppr.
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
