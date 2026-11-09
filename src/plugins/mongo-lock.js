import { setTimeout as sleep } from 'node:timers/promises'
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

/*
Acquire or mandatorily wait for a lock (useful for e.g. waiting for the end of migrations). If the lock cannot be acquired within timeoutMs, throws Error.

Migrations >timeout (60s by default) will cause waiting pods to fail to startup  
*/
export const acquireLockWithWait = async (locker, resource, logger, { intervalMs = 2000, timeoutMs = 120000 } = {}) => {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const lock = await locker.lock(resource)
    if (lock) {
      return lock
    }
    if (Date.now() >= deadline) {
      throw new Error(`Timed out after ${timeoutMs}ms waiting for '${resource}' lock`)
    }
    logger.info(`Waiting for '${resource}' lock...`)
    await sleep(intervalMs)
  }
}

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
