import { faker } from '@faker-js/faker'
import crypto from 'node:crypto'
import { decrypt } from './decrypt'

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
})
