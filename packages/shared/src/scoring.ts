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
 * Échelle de notation du « au plus proche » : écart au ~80ᵉ percentile des
 * écarts observés. L'ancien barème (écart MAX) devenait binaire dès qu'une
 * seule réponse absurde arrivait (ex : 999 999 999) : tous les écarts
 * raisonnables représentaient ≈ 0 % de l'échelle → ~1000 pts pour tout le
 * monde, plus aucune discrimination. Le percentile ignore les aberrants,
 * qui sortent de l'échelle et prennent 0.
 */
export function computeClosestScale(deviations: number[]): number {
  if (deviations.length === 0) return 0
  const sorted = [...deviations].sort((a, b) => a - b)
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round(0.8 * sorted.length) - 1))
  return sorted[idx] ?? 0
}

/**
 * Score pour le mode "au plus proche" (numérique).
 * Le plus proche de la bonne réponse reçoit 1000 pts.
 * Les autres reçoivent un score relatif décroissant.
 *
 * @param correctValue  - la bonne valeur numérique
 * @param submitted     - la valeur soumise par le participant
 * @param maxDeviation  - l'écart au-delà duquel on reçoit 0 pts
 *                        (échelle robuste : cf. computeClosestScale)
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
 * Tolérance de fautes de frappe PROPORTIONNELLE à la longueur de la bonne
 * réponse (normalisée). Une tolérance fixe de 2 acceptait n'importe quoi sur
 * les réponses courtes : « 1898 » validait « 1998 », « Lyo n'importe » ≈ « Lyon ».
 *   ≤ 4 caractères → 0 faute (années, sigles, petits mots)
 *   5–7 caractères → 1 faute
 *   ≥ 8 caractères → 2 fautes
 */
export function freeAnswerTolerance(normalizedCorrectLength: number): number {
  if (normalizedCorrectLength <= 4) return 0
  if (normalizedCorrectLength <= 7) return 1
  return 2
}

/**
 * Vérifie si une réponse soumise matche une des bonnes réponses acceptées.
 * Matching en deux passes :
 *   1. Égalité exacte après normalisation (rapide)
 *   2. Levenshtein ≤ tolérance proportionnelle (tolère les fautes de frappe
 *      sans valider de fausses réponses courtes)
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

    const tolerance = freeAnswerTolerance(normalizedCorrect.length)
    if (tolerance === 0) continue

    // Garde : levenshtein(a,b) ≥ |len(a)−len(b)| — si l'écart de longueur dépasse
    // déjà la tolérance, inutile de payer le calcul plein-matrice (et une entrée
    // démesurée ne coûte plus rien).
    if (Math.abs(normalizedSubmit.length - normalizedCorrect.length) > tolerance) continue

    // Passe 2 : tolérance fautes de frappe
    if (levenshtein(normalizedSubmit, normalizedCorrect) <= tolerance) return true
  }

  return false
}
