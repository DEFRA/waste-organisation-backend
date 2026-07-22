import { LockManager } from 'mongo-locks'

export const acquireLock = async (locker, resource, logger) => {
  const lock = await locker.lock(resource)
  if (!lock) {
    if (logger) {
      logger.error(`Failed to acquire lock for ${resource}`)
    }
    return null
  }
  return lock
}

export const requireLock = async (locker, resource) => {
  const lock = await locker.lock(resource)
  if (!lock) {
    throw new Error(`Failed to acquire lock for ${resource}`)
  }
  return lock
}

export const createLockManager = async (db) => new LockManager(db.collection('mongo-locks'))

export const singletonRunner = (() => {
  const lockManagers = new WeakMap()
  return async (db, label, logger, func, noLockFunc) => {
    logger.debug(`db ${db.databaseName}`)
    if (lockManagers.get(db) == null) {
      lockManagers.set(db, await createLockManager(db))
    }
    const lm = lockManagers.get(db)
    logger.debug(`Acquiring lock for ${label} with lock manager ${lm}`)
    const lock = await acquireLock(lm, label, logger)
    if (!lock) {
      if (typeof noLockFunc === 'function') {
        noLockFunc(label, logger)
      }
      return null
    }
    logger.debug(`Lock for ${label} acquired - running func`)
    try {
      return await func()
    } finally {
      logger.debug(`freeing lock for ${label}`)
      await lock.free()
    }
  }
})()
