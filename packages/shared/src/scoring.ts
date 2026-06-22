// ─────────────────────────────────────────────────────────────
// SCORING LINÉAIRE
// ─────────────────────────────────────────────────────────────

/**
 * Calcule le score pour une bonne réponse.
 * Linéaire : 1000 pts si répondu immédiatement, 0 si timeLimit atteint.
 *
 * @param timeLimit  - durée totale de la question en secondes
 * @param elapsed    - temps écoulé en secondes quand la réponse est soumise
 * @returns score entre 0 et 1000
 */
export function calculateScore(timeLimit: number, elapsed: number): number {
  if (elapsed >= timeLimit) return 0
  return Math.round(1000 * Math.max(0, (timeLimit - elapsed) / timeLimit))
}

/**
 * Score pour le mode "au plus proche" (numérique).
 * Le plus proche de la bonne réponse reçoit 1000 pts.
 * Les autres reçoivent un score relatif décroissant.
 *
 * @param correctValue  - la bonne valeur numérique
 * @param submitted     - la valeur soumise par le participant
 * @param maxDeviation  - l'écart max au-delà duquel on reçoit 0 pts
 *                        (calculé comme le max des écarts parmi tous les participants)
 */
export function calculateClosestScore(
  correctValue: number,
  submitted: number,
  maxDeviation: number,
): number {
  if (maxDeviation === 0) return 1000
  const deviation = Math.abs(correctValue - submitted)
  return Math.round(1000 * Math.max(0, 1 - deviation / maxDeviation))
}

// ─────────────────────────────────────────────────────────────
// NORMALISATION TEXTE (saisie libre)
// ─────────────────────────────────────────────────────────────

/**
 * Normalise une chaîne pour la comparaison en saisie libre.
 * Pipeline : trim → lowercase → supprime accents → supprime tirets/apostrophes/espaces multiples
 *
 * Exemples :
 *   "Pâris"        → "paris"
 *   "paris-france" → "parisfrance"
 *   "L'Élysée"     → "lelysee"
 *   "  LYON  "     → "lyon"
 */
export function normalizeAnswer(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .normalize('NFD')                      // décompose les caractères accentués
    .replace(/[\u0300-\u036f]/g, '')       // supprime les diacritiques
    .replace(/['\-\s]+/g, '')              // supprime apostrophes, tirets, espaces
}

/**
 * Calcule la distance de Levenshtein entre deux chaînes normalisées.
 * Utilisée pour accepter les fautes de frappe légères (≤ 2 caractères d'écart).
 */
export function levenshtein(a: string, b: string): number {
  const m = a.length
  const n = b.length
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  )

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const row = dp[i]
      const prevRow = dp[i - 1]
      if (!row || !prevRow) continue
      if (a[i - 1] === b[j - 1]) {
        row[j] = prevRow[j - 1] ?? 0
      } else {
        row[j] = 1 + Math.min(
          prevRow[j]     ?? Infinity,
          row[j - 1]     ?? Infinity,
          prevRow[j - 1] ?? Infinity,
        )
      }
    }
  }

  return dp[m]?.[n] ?? Infinity
}

/**
 * Vérifie si une réponse soumise matche une des bonnes réponses acceptées.
 * Matching en deux passes :
 *   1. Égalité exacte après normalisation (rapide)
 *   2. Levenshtein ≤ 2 (tolère fautes de frappe)
 *
 * @param submitted     - réponse brute du participant
 * @param correctAnswers - tableau de réponses acceptées (brutes, normalisées en interne)
 */
export function isCorrectFreeAnswer(
  submitted: string,
  correctAnswers: string[],
): boolean {
  const normalizedSubmit = normalizeAnswer(submitted)

  for (const correct of correctAnswers) {
    const normalizedCorrect = normalizeAnswer(correct)

    // Passe 1 : égalité exacte après normalisation
    if (normalizedSubmit === normalizedCorrect) return true

    // Passe 2 : tolérance fautes de frappe (Levenshtein ≤ 2)
    if (levenshtein(normalizedSubmit, normalizedCorrect) <= 2) return true
  }

  return false
}
