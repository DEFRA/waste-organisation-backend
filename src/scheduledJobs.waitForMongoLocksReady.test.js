import { describe, expect } from 'vitest'
import { waitForMongoLocksReady } from './plugins/mongo-lock.js'

class TransientError extends Error {
  constructor(message, codeName, code) {
    super(message)
    this.codeName = codeName
    this.code = code
  }
}

describe('scheduled tasks waitForMongoLocksReady', () => {
  it('locker should throw error', async () => {
    const testError = new TransientError('Blah', 'Meh', 1)

    const fakerLocker = {
      collection: {
        indexes: async () => {
          return Promise.reject(testError)
        }
      }
    }

    await expect(waitForMongoLocksReady(fakerLocker)).rejects.toThrow(testError)
  })

  it('should throw error when error is never thrown', async () => {
    const timeoutMs = 1500

    const fakerLocker = {
      collection: {
        indexes: async () => {
          return []
        }
      }
    }

    const expectedError = Error(`mongo-locks unique action index was not ready within ${timeoutMs}ms.`)

    await expect(waitForMongoLocksReady(fakerLocker, { timeoutMs })).rejects.toThrow(expectedError)
  })

  it.each([
    { message: 'Random Message', codeName: 'NamespaceNotFound', code: 1 },
    { message: 'Random Message', codeName: 'Random Code Name', code: 26 },
    { message: 'Random Message ns does not exist', codeName: 'Random Code Name', code: 1 },
    { message: 'Random Message NamespaceNotFound', codeName: 'Random Code Name', code: 1 },
    { message: 'Random Message NamespaceNotFound', codeName: 'NamespaceNotFound', code: 26 }
  ])('should throw error when transient erros are thrown', async ({ message, codeName, code }) => {
    const timeoutMs = 1500
    const testError = new TransientError(message, codeName, code)

    const fakerLocker = {
      collection: {
        indexes: async () => {
          return Promise.reject(testError)
        }
      }
    }

    const expectedError = Error(`mongo-locks unique action index was not ready within ${timeoutMs}ms. Last error: ${message}`)
    await expect(waitForMongoLocksReady(fakerLocker, { timeoutMs })).rejects.toThrow(expectedError)
  })
})
