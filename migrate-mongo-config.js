import path from 'node:path'
import { config } from './src/config.js'

/*
 * migrate-mongo configuration.
 *
 * The service runs migrations in-process at startup (see src/plugins/mongodb.js),
 * locked by mongo-locks - migrate-mongo's built-in lock is
 * disabled (lockTtl: 0).
 *
 * The "mongodb" block below is only used by the
 * migrate-mongo CLI for local development (db:migrate:status / create / up / down).
 */
const mongo = config.get('mongo')

export default {
  mongodb: {
    url: mongo.mongoUrl,
    databaseName: mongo.databaseName
  },
  migrationsDir: path.join(import.meta.dirname, 'migrations'),
  changelogCollectionName: 'changelog',
  lockTtl: 0,
  migrationFileExtension: '.js',
  useFileHash: false,
  moduleSystem: 'esm'
}
