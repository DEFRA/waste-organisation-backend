import crypto from 'node:crypto'

const GCM_IV_BYTE_LENGTH = 12

export const encrypt = (plaintext, key) => {
  const iv = crypto.randomBytes(GCM_IV_BYTE_LENGTH)
  const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(key, 'base64'), iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return [iv.toString('base64'), ciphertext.toString('base64'), tag.toString('base64')]
}
