# Revue de code — mode buzzer famille (27/07/2026)

Revue approfondie de la branche `feat/quiz-famille-buzzer` (37 fichiers, +3089)
après merge dans `main`. Sert de checklist pour la phase 6 du plan de montée de
versions ([plan-upgrade-deps.md](plan-upgrade-deps.md)). Cocher au fil des commits.

## CRITIQUE

- [ ] **C1 — Reload d'un téléphone en pleine question buzzer : buzzer inutilisable
  jusqu'à la question suivante.** `handlers/join.ts` (`handleRejoinWithParticipant`,
  ~l.177-251) n'émet jamais `BUZZ_QUESTION_STARTED` — contrairement au retardataire
  nouveau (`handleJoinSession`) et au host/TV (`attachAndSendState`). `session_restored`
  porte `buzz` mais pas l'énoncé ; côté client `onSessionRestored` ne restaure jamais
  `buzzQuestion`, et `BuzzerParticipant.tsx` exige `question` non-null. Un blip socket
  passe (store zustand survit) mais un **reload de page** (téléphone verrouillé →
  onglet déchargé, cas le plus fréquent en soirée) laisse le joueur sans buzzer en
  pleine phase `steal` armée. Le test existant ne vérifie que le payload serveur.
  **Fix** : répliquer le bloc buzzer de `handleJoinSession` dans
  `handleRejoinWithParticipant` (+ test de rendu du payload complet).

## HAUTE

- [ ] **H1 — Micro-coupure/refresh host-TV pendant la révélation : affiche
  « Personne n'a trouvé » à tort.** `attachAndSendState` (host.ts:63) ré-émet
  `BUZZ_QUESTION_STARTED` même en phase `revealed`, et `onBuzzStarted`
  (useHostSession) remet `buzzReveal` à null ; comme `host_join` est ré-émis à
  chaque `connect` (fix P0-1), toute micro-coupure efface réponse + scorer.
  Le scorer n'est stocké nulle part côté serveur.
  **Fix** : stocker le dernier reveal buzzer (correctAnswers/difficulty/scorer)
  dans `SessionState` et ré-émettre `BUZZ_QUESTION_ENDED` au reattach si `revealed`.

- [ ] **H2 — Kick d'un joueur qui a buzzé (ou owner en cours) : état incohérent.**
  `handleKickParticipant` (host.ts:142-179) nettoie `ownerBindings` mais pas
  `session.buzz` : kické = `lockedBy` → phase `locked` sur un fantôme (Correct =
  0 pt silencieux, Faux = fantôme dans `lockedOut`) ; kické = owner en `owner_oral`
  → id supprimé toujours dans le BuzzState, aucun rebroadcast.
  **Fix** : si `lockedBy` = kické → `steal` armé + broadcast ; si owner = kické →
  `ownerParticipantId = null` + broadcast.

## MOYENNE

- [ ] **M1 — Mort subite absente** (plan phase 3 : « égalité finale = mort subite au
  buzzer », aucune occurrence dans le code ; `finishQuiz` termine dès que tout est
  joué). Implémenter (bloquer sur égalité au rang 1 + question bonus) OU dé-scoper
  le plan explicitement. Idem « option compte à rebours » (jamais implémentée).
- [ ] **M2 — Snapshot : `session.buzz` non sérialisé** (restauré `null`,
  session-snapshot.ts:167) → au restart en pleine question, `lockedOut` perdu :
  un joueur « grillé » peut re-buzzer. `awardAndReveal` ne peuple pas
  `lastQuestionResults` (piège futur : `lastResult.myDelta = 0`). `currentTheme`,
  `playedQuestionIndices`, `ownerBindings`, `manual`, `bonus` sont bien couverts
  mais **aucun test snapshot** ne les vérifie. Ajouter un roundtrip buzzer au test.
- [ ] **M3 — `host_assign_owner.participantId` non validé** (buzzer.ts:231) : pas de
  `String()`, pas de vérif d'existence dans `session.participants` → owner fantôme
  ou objet arbitraire rebroadcasté. Et un re-binding pendant `steal` du même thème
  ne met pas à jour `buzz.ownerParticipantId` → le nouvel owner peut voler son
  propre thème.
- [ ] **M4 — « Terminer » sans confirm()** (BuzzerHostControl.tsx:309,
  HostControlPage.tsx:282) alors que ça supprime le snapshot (irréversible).
- [ ] **M5 — « Correct » sur thème non attribué = 0 pt silencieux**
  (buzzer.ts:283-285, `awardAndReveal(null)`). Désactiver ✓ côté client ou refuser
  côté serveur.
- [ ] **M6 — `handleAddManualParticipant`** : pas de `isPseudoTaken`, borne 40 vs
  `PSEUDO_MAX_LEN = 20`, pas de garde `gameType`.

## BASSE

- [ ] **B1 — Dead code** : `cleanupDisconnectedParticipants` (state.ts:138-146) et
  `deleteSession` (state.ts:129) jamais appelées, `SESSION_TOKEN_TTL_MS = 30_000`
  (socket-config.ts:48) sans effet et commentaire mensonger. Supprimer (ou brancher
  une purge des sessions `ended` qui s'accumulent en mémoire).
- [ ] **B2 — Doc drift** : `events-contract.md` ne documente aucun des 12 events
  buzzer ; `deployment.md` dit « max 5 » restarts vs `railway.json` = 10.
- [ ] **B3 — Duplication** : `ptsBadge` ×3 (nuances divergentes `*-700`/`*-600`),
  `ranksOf` ×2 (quiz-store, useHostSession), `findSessionByHostSocket` ×2
  (game.ts, session-helpers.ts), 3 variantes de « fin de quiz » — à factoriser.
- [ ] **B4 — `myScore` périmé sur le tél après `host_adjust_score`** :
  `onTeamsUpdated`/`onLeaderboard` ne recalculent pas `myScore` → header faux
  jusqu'à la fin de question suivante.
- [ ] **B5 — Routes admin sans validation serveur** (`POST/PUT /api/admin/quizzes`,
  index.ts:111-127) : body inséré tel quel, seule validation côté client.
- [ ] **B6 — Gros fichiers** : AdminPage.tsx 602 l., useHostSession.ts 459 l.,
  buzzer.test.ts 486 l.

## Vérifié et sain (pour mémoire)

- Race de deux buzz simultanés : serveur mono-thread, premier reçu gagne, testé.
- Doubles clics host : tous idempotents via guards de phase.
- `buzz_state` null au retour sélecteur : émis et testé.
- Joueurs sans téléphone : jamais buzzables, scorables, ajustements snapshotés.

## Ordre de traitement recommandé (phase 6)

1. C1 (rejoin participant) — LE trou dans la priorité n°1 du projet, ~10 lignes + test.
2. H1 (reveal persistant au reattach host/TV).
3. H2 + M3 (kick + validation assign_owner) — ferme la machine à états.
4. M2 (test snapshot roundtrip buzzer) + décision M1 (mort subite : implémenter ou dé-scoper).
5. M4, M5, M6 puis B1-B5 (nettoyage à faible coût).
