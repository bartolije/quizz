# Limitations connues & retours de test — LYA QUIZ

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
- **Sessions en mémoire** : un redéploiement / restart serveur perd les parties en
  cours (PIN, scores). Seuls les quiz (contenu) sont persistés. Acceptable pour
  l'usage interne, mais à connaître avant de redéployer en pleine session.
- **Anti-triche** : le WebSocket n'envoie jamais les bonnes réponses avant la
  révélation (`question_started` n'expose qu'une `QuestionPublic` sans `correctAnswers` ;
  elles ne partent qu'à `question_ended`). L'éditeur `/admin` (qui, lui, expose les
  réponses) est **verrouillé par défaut en prod** : `ADMIN_PASSWORD` est obligatoire,
  plus aucun mot de passe par défaut shippé. Résiduel mineur : `GET /api/sessions/:id/report`
  expose les `correctAnswers` des questions **déjà révélées** (pas les suivantes) sans
  auth — pas un vecteur de triche en direct, mais à gater si besoin.
- **CORS `*`** : à restreindre si exposition publique (n'empêche pas les appels directs).
- **`dvh`** : `h-[100dvh]` suppose un navigateur récent (iOS 15.4+/Chrome 108+). OK
  pour les téléphones actuels ; à surveiller si un très vieux device pose souci.
