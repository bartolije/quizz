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

## Limitation — pas de vrai drag & drop pour `ordering`

Le réordonnancement se fait **uniquement** via les boutons ↑/↓. Il n'y a pas de
glisser-déposer. C'était un choix de robustesse (le DnD tactile dans un conteneur
scrollable entre en conflit avec le geste de scroll, ce qui va à l'encontre de la
priorité « stabilité »). Si on veut l'ajouter un jour, privilégier `@dnd-kit` avec
un *drag handle* dédié pour ne pas casser le scroll.

## Points d'attention (pas des bugs, à garder en tête)

- **État local de `QuestionPage`** : tout nouvel état dépendant de la question doit
  rester compatible avec le remount par `key` (il repart de zéro à chaque question —
  c'est voulu).
- **Sessions en mémoire** : un redéploiement / restart serveur perd les parties en
  cours (PIN, scores). Seuls les quiz (contenu) sont persistés. Acceptable pour
  l'usage interne, mais à connaître avant de redéployer en pleine session.
- **CORS `*`** et `ADMIN_PASSWORD` par défaut (`lyaquiz`) : à durcir si exposition publique.
- **`dvh`** : `h-[100dvh]` suppose un navigateur récent (iOS 15.4+/Chrome 108+). OK
  pour les téléphones actuels ; à surveiller si un très vieux device pose souci.
