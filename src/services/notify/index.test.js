import { expect, it } from 'vitest'
import { sendEmail } from '.'
import { config } from '../../config'
const apiKey = config.get('notify.govNotifyKey')

const email = 'someone@example.com'

describe.skipIf(!apiKey)('Intergration tests when apiCode is set', () => {
  const file = Buffer.from('{"test": "123"}', 'utf8')

  it('should send success email', async () => {
    const emailResonse = await sendEmail.sendSuccess({ email, file })
    expect(emailResonse.status).toBe(201)
  })

  it('should send data validation failed email', async () => {
    const emailResonse = await sendEmail.sendValidationFailed({ email, file })
    expect(emailResonse.status).toBe(201)
  })

  it('should send upload failed email', async () => {
    const emailResonse = await sendEmail.sendFailed({ email, file })
    expect(emailResonse.status).toBe(201)
  })

  it('should send email with an attachment', async () => {
    const emailResonse = await sendEmail.sendSuccess({ email, file })
    expect(emailResonse.status).toBe(201)
  })
})
