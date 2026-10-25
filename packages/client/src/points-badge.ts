// Badge de points des questions buzzer (couleur selon la valeur — les « ultra dur » ressortent).
export const ptsBadge = (pts: number): { label: string; cls: string } => ({
  label: `${pts} pt${pts > 1 ? 's' : ''}`,
  cls: pts >= 4 ? 'bg-fuchsia-700' : pts === 3 ? 'bg-rose-700' : pts === 2 ? 'bg-amber-700' : 'bg-emerald-700',
})
