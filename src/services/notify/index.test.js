import { beforeAll, describe, expect, it, vi } from 'vitest'

describe('Notify', () => {
  const prepareUploadMock = vi.fn()
  const sendEmailMock = vi.fn()
  const loggerErrorMock = vi.fn()
  const loggerInfoMock = vi.fn()
  const email = 'foo@example.com'

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
