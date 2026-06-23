// Vibration tactile (API Web Vibration).
// Compatibilité : Android = OK (Chrome, Samsung Internet, Firefox…). iPhone = NON
// (iOS force WebKit sur tous les navigateurs, qui n'implémente pas l'API).
const KEY = 'lya_vibration'

export function vibrationSupported(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function'
}

export function isVibrationEnabled(): boolean {
  return localStorage.getItem(KEY) !== 'off' // activé par défaut
}

export function setVibrationEnabled(on: boolean): void {
  localStorage.setItem(KEY, on ? 'on' : 'off')
}

function doVibrate(pattern: number | number[]): void {
  try {
    if (vibrationSupported()) navigator.vibrate(pattern)
  } catch {
    /* ignore */
  }
}

// Vibrations en jeu : respectent le toggle utilisateur.
export function vibrate(pattern: number | number[]): void {
  if (isVibrationEnabled()) doVibrate(pattern)
}

// Bouton « Tester » : vibre quoi qu'il arrive (vérifie le support de l'appareil).
export function vibrateTest(pattern: number | number[] = [80, 40, 80]): void {
  doVibrate(pattern)
}
