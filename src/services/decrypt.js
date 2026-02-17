import crypto from 'node:crypto'

export const decrypt = (encryptionArray, key) => {
  const [ivB64, ciphertextB64, tagB64] = encryptionArray

  const iv = Buffer.from(ivB64, 'base64')
  const ciphertext = Buffer.from(ciphertextB64, 'base64')
  const tag = Buffer.from(tagB64, 'base64')

  const decipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(key, 'base64'), iv)
  decipher.setAuthTag(tag)

  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()])

  return plaintext.toString('utf8')
}
