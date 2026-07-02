import { defineConfig } from 'vitest/config'

// Tests des 3 packages (dossiers packages/*/test, hors src → jamais dans les builds).
// Environnement node partout : les tests client ciblent la logique pure (store).
export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.test.ts'],
    environment: 'node',
    setupFiles: ['./vitest.setup.ts'],
    testTimeout: 10_000,
    hookTimeout: 10_000,
  },
})
