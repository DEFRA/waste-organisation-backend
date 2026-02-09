import { sendEmail } from '.'
import { config } from '../../config'
const apiKey = config.get('notify.govNotifyKey')

const emailAddress = 'someone@example.com'

describe.skipIf(!apiKey)('notify', () => {
  it('should send success email', async () => {
    const emailResonse = await sendEmail.sendSuccess({ email: emailAddress })
    expect(emailResonse.status).toBe(201)
  })

  it('should send data validation failed email', async () => {
    const emailResonse = await sendEmail.sendValidationFailed({
      email: emailAddress
    })
    expect(emailResonse.status).toBe(201)
  })

  it('should send upload failed email', async () => {
    const emailResonse = await sendEmail.sendFailed({ email: emailAddress })
    expect(emailResonse.status).toBe(201)
  })
})
