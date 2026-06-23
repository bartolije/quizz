// Badge de version discret (coin bas-droit) : permet de savoir quelle build
// tourne réellement (utile pour vérifier qu'un déploiement est bien pris en
// compte). SHA + date injectés au build (cf. vite.config.ts).
export function BuildBadge() {
  return (
    <div className="fixed bottom-1 right-2 z-30 text-[10px] leading-none text-gray-500/60 pointer-events-none select-none">
      build {__BUILD_SHA__} · {__BUILD_DATE__}
    </div>
  )
}
