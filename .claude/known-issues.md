# Limitations connues & retours de test — LYA QUIZ

## Corrigé — retours de test (juillet 2026)

1. **Lancement du quiz invisible côté téléphone** : entre le clic « Démarrer » du
   host et la première question, rien ne changeait (le store ne suivait que le
   statut `ended`). **Fix :** le store trace `sessionStatus` ; à `running`, le
   lobby bascule sur un écran « 🚀 C'est parti ! » + petite vibration (Android).
2. **Réordonnancement `ordering` peu visible via ↑/↓** : le déplacement marchait
   mais la liste se re-rendait instantanément. **Fix :** animation FLIP maison
   (Web Animations API, ~200 ms, `OrderingList.tsx`) — les lignes GLISSENT vers
   leur nouvelle place. Sautée pendant un drag (dnd-kit anime déjà) et si
   `prefers-reduced-motion`.

## Corrigé — tri par ordre & bouton d'action (test à 3, juin 2026)

Deux bugs remontés lors d'un test rapide à 3 joueurs, corrigés :

1. **Tri par ordre non fonctionnel** (impossible de réordonner). Cause racine :
   `<QuestionPage>` était rendu sans `key` → React gardait la **même instance**
   d'une question à l'autre, et le `useState` lazy de `order`
   (`() => [...question.choices]`) ne s'exécute qu'au montage. Une question
   `ordering` non-première repartait donc avec les choix de la question précédente
   (ou `[]` si la 1ʳᵉ était `free`/`closest` → liste vide). **Fix :**
   `key={question.index}` dans `ParticipantApp` → état neuf garanti à chaque question.
   Boutons ↑/↓ passés à 44px (cible tactile iOS) + `aria-label`.

2. **Bouton « Valider » non fixé** : conteneur `min-h-screen`, bouton en fin de
   colonne flex → passait sous la ligne de flottaison, il fallait scroller. **Fix :**
   hauteur calée sur le viewport (`h-[100dvh]`), contenu central scrollable
   (`overflow-y-auto` + `min-h-0`), bouton d'action en `flex-shrink-0` (toujours visible).

## Drag & drop pour `ordering` (fait)

Le réordonnancement se fait au **glisser-déposer** (via `@dnd-kit`) **et** via les
boutons ↑/↓ (fallback). Composant : `client/src/components/OrderingList.tsx`.
Points clés de robustesse (priorité « stabilité ») :
- Seule la **poignée ⠿** porte les listeners de drag + `touch-none`
  (`touch-action:none`) → le drag n'entre pas en conflit avec le scroll de la liste
  (on scrolle en touchant ailleurs sur la ligne).
- `PointerSensor` avec `activationConstraint.distance = 6` → un tap sur ↑/↓ n'est
  pas interprété comme un début de drag.
- `restrictToVerticalAxis` + `restrictToParentElement`, `KeyboardSensor` pour l'a11y.
- `id` de tri = la valeur de l'item (les items d'un `ordering` sont uniques).

## Points d'attention (pas des bugs, à garder en tête)

- **État local de `QuestionPage`** : tout nouvel état dépendant de la question doit
  rester compatible avec le remount par `key` (il repart de zéro à chaque question —
  c'est voulu).
- **Sessions snapshotées (depuis 07/2026)** : les parties en cours sont sauvegardées
  dans SQLite (`session_snapshots`, cf. `session-snapshot.ts`) et restaurées au boot.
  Un restart/redeploy ne perd plus PIN, participants ni scores — les téléphones se
  reconnectent seuls (token) ; seule la question OUVERTE au moment du crash est
  rejouée par le host. Éviter quand même un redeploy en pleine soirée (coupure de
  quelques secondes pour tout le monde).
- **Anti-triche** : le WebSocket n'envoie jamais les bonnes réponses avant la
  révélation (`question_started` n'expose qu'une `QuestionPublic` sans `correctAnswers` ;
  elles ne partent qu'à `question_ended`). L'éditeur `/admin` (qui, lui, expose les
  réponses) est **verrouillé par défaut en prod** : `ADMIN_PASSWORD` est obligatoire,
  plus aucun mot de passe par défaut shippé. Résiduel mineur : `GET /api/sessions/:id/report`
  expose les `correctAnswers` des questions **déjà révélées** (pas les suivantes) sans
  auth — pas un vecteur de triche en direct, mais à gater si besoin.
- **CORS `*` par défaut**, surchargeable depuis 08/2026 : poser `CORS_ORIGIN=https://…`
  sur Railway pour verrouiller (laisser vide pour la voie Vercel cross-origin).
- **Navigateurs minimum** : Tailwind 4 (depuis la montée de versions 08/2026) exige
  Safari 16.4+ / Chrome 111+ — plancher plus haut que l'ancien prérequis `dvh`
  (iOS 15.4+). OK pour les téléphones actuels ; à savoir si un vieux device coince.
