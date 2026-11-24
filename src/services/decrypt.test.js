import { faker } from '@faker-js/faker'
import crypto from 'node:crypto'
import { decrypt } from './decrypt'
import { encrypt } from '../test-utils/encrypt.js'

describe('Decription', () => {
  let mockEmail
  const key = crypto.randomBytes(32).toString('base64')

  beforeAll(() => {
    mockEmail = faker.internet.email()
  })

  test('should encrypt string', () => {
    const iv = crypto.randomBytes(12)

    const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(key, 'base64'), iv)

    const ciphertext = Buffer.concat([cipher.update(mockEmail, 'utf8'), cipher.final()])

    const tag = cipher.getAuthTag()

    const encryptionArray = [iv.toString('base64'), ciphertext.toString('base64'), tag.toString('base64')]

    const resp = decrypt(encryptionArray, key)

    expect(resp).toBe(mockEmail)
  })

  test('decrypts with the first key when that key matches', () => {
    const currentKey = crypto.randomBytes(32).toString('base64')
    const previousKey = crypto.randomBytes(32).toString('base64')
    const encryptionArray = encrypt(mockEmail, currentKey)

    expect(decrypt(encryptionArray, [currentKey, previousKey])).toBe(mockEmail)
  })

  test('falls back to the next key when the first key fails the auth tag check', () => {
    const currentKey = crypto.randomBytes(32).toString('base64')
    const previousKey = crypto.randomBytes(32).toString('base64')
    const encryptionArray = encrypt(mockEmail, previousKey)

    expect(decrypt(encryptionArray, [currentKey, previousKey])).toBe(mockEmail)
  })

  test('decrypts with the remaining key when the new key is unset', () => {
    const previousKey = crypto.randomBytes(32).toString('base64')
    const encryptionArray = encrypt(mockEmail, previousKey)

    expect(decrypt(encryptionArray, [null, previousKey])).toBe(mockEmail)
  })

  test('throws when every configured key fails the auth tag check', () => {
    const encryptionArray = encrypt(mockEmail, crypto.randomBytes(32).toString('base64'))
    const wrongKeys = [crypto.randomBytes(32).toString('base64'), crypto.randomBytes(32).toString('base64')]

    expect(() => decrypt(encryptionArray, wrongKeys)).toThrow(/unable to authenticate data/)
  })

  test('throws when no key is configured', () => {
    const encryptionArray = encrypt(mockEmail, key)

    expect(() => decrypt(encryptionArray, [null, undefined, ''])).toThrow('No encryption key is configured')
  })

  test('does not try a later key when the first key fails for a reason other than the auth tag', () => {
    const previousKey = crypto.randomBytes(32).toString('base64')
    const encryptionArray = encrypt(mockEmail, previousKey)
    const invalidKey = crypto.randomBytes(8).toString('base64')

    expect(() => decrypt(encryptionArray, [invalidKey, previousKey])).toThrow(/Invalid key length/)
  })
})
