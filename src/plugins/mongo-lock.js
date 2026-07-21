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

export const waitForMongoLocksReady = async (locker, { timeoutMs = 15000, pollMs = 100 } = {}) => {
  const deadline = Date.now() + timeoutMs
  let lastError

  while (Date.now() < deadline) {
    try {
      const indexes = await locker.collection.indexes()

      const hasActionUnique = indexes.some((i) => i.unique === true && i.key?.action === 1)
      const hasTtl = indexes.some((i) => i.key?.expiresAt === 1 && i.expireAfterSeconds === 0)

      if (hasActionUnique && hasTtl) {
        return
      }
    } catch (err) {
      // During startup, collection/index metadata can briefly be unavailable.
      // Keep polling for known transient states.

      const codeName = err?.codeName
      const code = err?.code
      const message = String(err?.message ?? '')
      const transientErrorCode = 26

      const isTransient =
        codeName === 'NamespaceNotFound' || code === transientErrorCode || message.includes('ns does not exist') || message.includes('NamespaceNotFound')

      if (!isTransient) {
        throw err
      }

      lastError = err
    }

    await new Promise((resolve) => setTimeout(resolve, pollMs))
  }

  const suffix = lastError ? ` Last error: ${lastError.message}` : ''
  throw new Error(`mongo-locks unique action index was not ready within ${timeoutMs}ms.${suffix}`)
}

export const lockManager = async (db) => {
  const lm = new LockManager(db.collection('mongo-locks'))
  await waitForMongoLocksReady(lm)
  return lm
}

export const singletonRunner = (() => {
  const lockManagers = new WeakMap()
  return async (db, label, logger, func, noLockFunc) => {
    logger.debug(`db ${db.databaseName}`)
    if (lockManagers.get(db) == null) {
      lockManagers.set(db, await lockManager(db))
    }
    const lm = lockManagers.get(db)
    logger.debug(`Acquiring lock for ${label} with lock manager ${lm}`)
    const lock = await acquireLock(lm, label, logger)
    if (!lock) {
      if (typeof noLockFunc === 'function') {
        noLockFunc(label, logger)
      }
      return
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
