import { beforeAll, describe, expect, it, vi } from 'vitest'

describe('Notify', () => {
  const prepareUploadMock = vi.fn()
  const sendEmailMock = vi.fn()
  const loggerErrorMock = vi.fn()
  const loggerInfoMock = vi.fn()
  const email = 'foo@example.com'
  const successfulSubmission = '2ffe3792-f097-421d-b3e2-9de5af81609f'

  beforeAll(() => {
    vi.doMock('@hapi/wreck', () => ({
      default: {
        post: sendEmailMock.mockReturnValue({ payload: { post: 'response' } })
      }
    }))

    vi.doMock('pino', () => ({
      pino: vi.fn().mockReturnValue({
        info: loggerInfoMock,
        error: loggerErrorMock
      })
    }))
  })

  afterAll(() => {
    vi.clearAllMocks()
  })

  it('should return email response', async () => {
    sendEmailMock.mockImplementation(async () => {
      return { data: 'response' }
    })
    const { sendEmail } = await import('./index.js')
    const actualResponse = await sendEmail.sendSuccess({ email, name: JSON.stringify({ firstName: 'Joe Bloggs' }) })
    const personalisation = {
      'first name': 'Joe Bloggs',
      'upload id': null,
      filename: null
    }
    expect(sendEmailMock).toHaveBeenCalledWith(expect.anything(), {
      json: 'strict',
      headers: {
        Authorization: expect.anything()
      },
      payload: { email_address: email, template_id: expect.anything(), personalisation }
    })
    expect(actualResponse).toBe(sendEmailMock())
    expect(loggerInfoMock).toBeCalledWith('Email Sent')
  })

  it('should return email response if name is not parsable to JSON', async () => {
    sendEmailMock.mockReturnValue({ data: 'response' })
    const { sendEmail } = await import('./index.js')
    const actualResponse = await sendEmail.sendSuccess({ email, name: 'Random String' })
    const personalisation = {
      'first name': null,
      'upload id': null,
      filename: null
    }
    expect(sendEmailMock).toBeCalledWith(successfulSubmission, email, { personalisation })
    expect(actualResponse).toBe(sendEmailMock())
    expect(loggerInfoMock).toBeCalledWith('Email Sent')
  })

  it('should handle if there is no name', async () => {
    sendEmailMock.mockReturnValue({ data: 'response' })
    const { sendEmail } = await import('./index.js')
    const actualResponse = await sendEmail.sendSuccess({ email })
    const personalisation = {
      'first name': null,
      'upload id': null,
      filename: null
    }
    expect(sendEmailMock).toBeCalledWith(successfulSubmission, email, { personalisation })
    expect(actualResponse).toBe(sendEmailMock())
    expect(loggerInfoMock).toBeCalledWith('Email Sent')
  })

  it('should return email response with file link', async () => {
    sendEmailMock.mockReturnValue('response')
    const { sendEmail } = await import('./index.js')
    const file = Buffer.from([{ foo: 'bar' }])
    await sendEmail.sendSuccess({ email, name: JSON.stringify({ firstName: 'Joe Bloggs' }), file })
    const personalisation = {
      'first name': 'Joe Bloggs',
      'upload id': null,
      filename: null,
      link_to_file: 'link'
    }

    expect(sendEmailMock).toBeCalledWith(successfulSubmission, email, { personalisation })
    expect(prepareUploadMock).toBeCalledWith(file)
  })

  it('should include upload id in personalisation when provided', async () => {
    sendEmailMock.mockReturnValue({ data: 'response' })
    const { sendEmail } = await import('./index.js')
    const referenceNumber = 'abc-123'
    await sendEmail.sendSuccess({ email, name: JSON.stringify({ firstName: 'Joe Bloggs' }), referenceNumber })
    const personalisation = {
      'first name': 'Joe Bloggs',
      'upload id': 'abc-123',
      filename: null
    }
    expect(sendEmailMock).toBeCalledWith(successfulSubmission, email, { personalisation })
  })

  it('should include filename in personalisation when provided', async () => {
    sendEmailMock.mockReturnValue({ data: 'response' })
    const { sendEmail } = await import('./index.js')
    await sendEmail.sendSuccess({ email, name: JSON.stringify({ firstName: 'Joe Bloggs' }), filename: 'test.xlsx' })
    const personalisation = {
      'first name': 'Joe Bloggs',
      'upload id': null,
      filename: 'test.xlsx'
    }
    expect(sendEmailMock).toBeCalledWith(successfulSubmission, email, { personalisation })
  })

  it('should handle exception correctly', async () => {
    sendEmailMock.mockRejectedValue('Mock Error')
    const { sendEmail } = await import('./index.js')
    await sendEmail.sendSuccess({ email, name: JSON.stringify({ firstName: 'Joe Bloggs' }) })
    expect(loggerErrorMock).toBeCalledWith('Error sending emails: Mock Error')
  })
})
