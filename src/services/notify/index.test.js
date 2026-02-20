import { describe, expect, it, vi } from 'vitest'

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

describe('Notify', () => {
  const prepareUploadMock = vi.fn()
  const sendEmailMock = vi.fn()
  const loggerErrorMock = vi.fn()
  const loggerInfoMock = vi.fn()
  const email = 'foo@example.com'

  // const formatValidationFailed = '8ad2881f-4904-4c22-a0fb-b001d8d72349'
  // const dataValidationFailed = 'e6f9eb36-c2cc-4838-b7ae-1e79847afdd6'
  const successfulSubmission = '2ffe3792-f097-421d-b3e2-9de5af81609f'

  beforeAll(() => {
    vi.doMock('notifications-node-client', () => ({
      NotifyClient: vi.fn().mockImplementation(() => ({
        prepareUpload: prepareUploadMock.mockReturnValue('link'),
        sendEmail: sendEmailMock
      }))
    }))

    vi.doMock('pino', () => ({
      pino: vi.fn().mockImplementation(() => ({
        info: loggerInfoMock,
        error: loggerErrorMock
      }))
    }))
  })

  it('should return email response', async () => {
    sendEmailMock.mockReturnValue('response')
    const { sendEmail } = await import('./index.js')
    const actualResponse = await sendEmail.sendSuccess({ email })
    const personalisation = {
      'first name': 'Joe Bloggs'
    }

    expect(sendEmailMock).toBeCalledWith(successfulSubmission, email, { personalisation })
    expect(actualResponse).toBe(sendEmailMock())
    expect(loggerInfoMock).toBeCalledWith('Email Response response')
  })

  it('should return email response with file link', async () => {
    sendEmailMock.mockReturnValue('response')
    const { sendEmail } = await import('./index.js')
    const file = Buffer.from([{ foo: 'bar' }])
    await sendEmail.sendSuccess({ email, file })
    const personalisation = {
      'first name': 'Joe Bloggs',
      link_to_file: 'link'
    }

    expect(sendEmailMock).toBeCalledWith(successfulSubmission, email, { personalisation })
    expect(prepareUploadMock).toBeCalledWith(file)
  })

  it('should handle exception correctly', async () => {
    sendEmailMock.mockRejectedValue('Mock Error')

    const { sendEmail } = await import('./index.js')

    await sendEmail.sendSuccess({ email })

    expect(loggerErrorMock).toBeCalled('Error sending emails: Mock Error')
  })
})
