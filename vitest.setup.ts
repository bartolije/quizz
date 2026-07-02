// Exécuté AVANT l'import des modules testés (cf. vitest.config.ts setupFiles).
// - SQLite en mémoire : db.ts lit DATABASE_PATH à l'import → aucune écriture disque.
// - Logs pino coupés : les tests d'intégration passent par les vrais handlers.
process.env['DATABASE_PATH'] = ':memory:'
process.env['LOG_LEVEL'] = 'silent'
