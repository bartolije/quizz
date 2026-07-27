# Plan — Quiz famille « tontinades » (mode buzzer arbitré)

> Feature en cours. Extension du quiz existant (PAS un nouveau projet) : couche
> optionnelle par-dessus la boucle de jeu, sur le patron du mode équipe.
> Ce document est la source de vérité du design ; il évolue au fil des phases.

## Le concept en une phrase

Un quiz **de salon, en famille**, où **l'admin (le maître du jeu) arbitre tout à
l'oral** : les téléphones ne sont plus que des **buzzers**, rien n'est corrigé
automatiquement, et le scoring est **par difficulté** (Facile 1 / Moyen 2 / Difficile 3).

## Contexte de jeu (fixé avec l'utilisateur)

- **18 personnes** : 17 participants (chacun un téléphone-buzzer) + 1 admin (Mac + TV), qui **ne joue pas**.
- Deux rounds, **un seul barème et un seul classement**.
- **Aucune correction automatique** : l'admin juge vrai/faux à l'oral. On n'utilise
  PAS le matching texte (`isCorrectFreeAnswer`, Levenshtein…) pour ce mode.
- **Pas de chrono automatique** : l'admin rythme (option compte à rebours plus tard).
- Contenu **écrit à la main** par l'admin. Les joueurs donnent leur thème et peuvent
  réviser — **c'est le jeu, pas de la triche**.

## Les deux rounds

### Round 1 — Thèmes perso
- Chaque joueur a **un thème**. L'admin choisit quel thème aborder (`host_start_theme`).
- L'**owner** du thème répond **à l'oral**, question par question (l'admin les lance).
- Admin juge :
  - **Correct** → l'owner marque les points de difficulté → révélation → suivante.
  - **Faux** → ouverture du **vol** : buzzer armé pour tous **sauf l'owner**.
    - 1er qui buzze prend la parole (les autres se bloquent), répond à l'oral.
    - Admin juge : **Correct** → il marque · **Faux + Rouvrir** → il est bloqué,
      les autres re-buzzent · **Personne** → 0 pt → révélation.

### Round 2 — Culture générale
- Même buzzer, **ouvert à tous dès le lancement** (pas d'owner). 1er qui buzze répond
  à l'oral, admin juge, points de difficulté.

### Scoring & fin
- Facile = 1 · Moyen = 2 · Difficile = 3 (`DIFFICULTY_POINTS`). Bonne réponse = ces
  points, à celui qui répond (owner OU voleur, **même valeur**). Aucun malus, **un seul
  gagnant par question**. Classement unique cumulé sur les deux rounds (réutilise le
  leaderboard/rapport existants).
- Avantage de l'owner = **le premier essai sans concurrence** (pas de multiplicateur).
- **Égalité finale** : ~~question en mort subite au buzzer~~ **dé-scopé (27/07/2026)** —
  l'admin tranche à la main (`host_adjust_score` ou une question de plus via les thèmes).
- Équilibrage = responsabilité de l'admin (il fixe les difficultés) : **même nombre de
  questions + même répartition de difficulté par joueur** (gabarit conseillé, ex.
  `[Facile, Facile, Moyen]` à 3 questions/thème pour 17 joueurs).

## Modèle de données (shared, additif — rétro-compatible)

- `Question` gagne 3 champs **optionnels** (absents = quiz classique inchangé) :
  `difficulty` (`Difficulty`), `section` (`'perso' | 'culture'`), `ownerName` (slot joueur).
- `GameType = 'classic' | 'buzzer'` sur `Quiz` et `Session` (défaut `classic`).
- `Difficulty = 'facile' | 'moyen' | 'difficile'` + `DIFFICULTY_POINTS`.
- `BuzzState` = état buzzer **rediffusé complet** à chaque changement (patron `teams_updated`) :
  `phase`, `armed`, `ownerName`, `ownerParticipantId`, `lockedBy`, `lockedOut[]`.
  Le client **dérive** ses affordances (puis-je buzzer ? suis-je l'owner ? suis-je bloqué ?).

## Contrat d'events (shared)

Client → serveur : `buzz`, `host_adjudicate {correct}`, `host_reopen_buzzer`,
`host_pass_question`, `host_start_theme {ownerName}`, `host_assign_owner {ownerName, participantId|null}`.
`host_next_question` est réutilisé (le handler route selon `gameType`).

Serveur → client : `buzz_question_started {question, buzz}`, `buzz_state {…BuzzState}`
(rediffusé à chaque changement), `buzz_question_ended {correctAnswers, difficulty, scorer, scores}`.

## Machine à états d'une question buzzer

```
idle
 └─ host_next_question (perso) ─→ owner_oral         (armed=false)
 └─ host_next_question (culture) ─→ steal (armed=true)
owner_oral
 ├─ adjudicate(true)  → revealed  (owner marque)
 └─ adjudicate(false) → steal (armed=true)           (ouverture du vol)
steal (armed=true)
 └─ buzz(1er) → locked (armed=false, lockedBy=X)
locked
 ├─ adjudicate(true)  → revealed  (X marque)
 └─ adjudicate(false) → steal (armed=false)  + X ∈ lockedOut   (attend host)
steal (armed=false, après vol raté)
 ├─ host_reopen_buzzer → steal (armed=true)
 └─ host_pass_question → revealed (0 pt)
revealed
 └─ host_next_question → question suivante
```

## Reconnexion (priorité absolue du projet)

- `session-snapshot.ts` sérialise l'état buzzer ; `session_restored` l'embarque.
- Un tél/host/TV qui reconnecte retrouve : phase, buzzer armé/verrouillé, s'il est
  owner/bloqué, qui a buzzé. Tests snapshot étendus.

## Séquence des phases

| Phase | Livrable | Point d'étape |
|---|---|---|
| 0 | Fondations shared (modèle, events, types buzzer). Zéro comportement. | Contrat validé |
| 1 | Buzzer brut bout en bout (culture G) + reconnexion + snapshot + tests | On joue un round buzzer |
| 2 | Round perso par-dessus (owner oral → vol, thèmes, binding) | Round perso complet |
| 3 | Partie 2 rounds + classement unifié + mort subite | Soirée bout en bout |
| 4 | Éditeur d'écriture (difficulté/section/owner) + saisie du contenu | Contenu prêt |
| 5 | Polish (sons/haptique/transitions) + cas limites + répète à blanc | Prêt |
