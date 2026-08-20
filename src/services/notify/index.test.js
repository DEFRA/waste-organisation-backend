import { beforeAll, describe, expect, it, vi } from 'vitest'
import { config } from '../../config.js'

describe('Notify', () => {
  const sendEmailMock = vi.fn()
  const loggerErrorMock = vi.fn()
  const loggerInfoMock = vi.fn()
  const email = 'foo@example.com'

  beforeAll(() => {
    // Note: string concatenation is workaround for security regex false positive
    vi.doMock('@hapi/wreck', () => ({
      default: {
        post: sendEmailMock.mockReturnValue({ payload: { post: 'response' } })
      }
    }))

    vi.doMock('pino', () => ({
      pino: vi.fn().mockReturnValue({
        info: loggerInfoMock,
        debug: loggerInfoMock,
        error: loggerErrorMock
      })
    }))
  })

  beforeEach(() => {
    config.set('notify.govNotifyKey', 'fishy_testing_thing-' + 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa-aaaaaaaa' + '-aaaa-aaaa-aaaa-aaaaaaaaaaaa')
  })

  afterAll(() => {
    vi.clearAllMocks()
  })

  it('should return email response', async () => {
    sendEmailMock.mockImplementation(async () => {
      return { payload: { data: 'response' } }
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
      payload: { email_address: email, template_id: expect.anything(), personalisation },
      agent: expect.anything()
    })
    expect(actualResponse).toBe(sendEmailMock())
    expect(loggerInfoMock).toHaveBeenCalledWith('Email Sent')
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
    expect(sendEmailMock).toHaveBeenCalledWith(expect.anything(), {
      json: 'strict',
      headers: {
        Authorization: expect.anything()
      },
      payload: { email_address: email, template_id: expect.anything(), personalisation },
      agent: expect.anything()
    })
    expect(actualResponse).toBe(sendEmailMock())
    expect(loggerInfoMock).toHaveBeenCalledWith('Email Sent')
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
    expect(sendEmailMock).toHaveBeenCalledWith(expect.anything(), {
      json: 'strict',
      headers: {
        Authorization: expect.anything()
      },
      payload: { email_address: email, template_id: expect.anything(), personalisation },
      agent: expect.anything()
    })
    expect(actualResponse).toBe(sendEmailMock())
    expect(loggerInfoMock).toHaveBeenCalledWith('Email Sent')
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
      link_to_file: {
        confirm_email_before_download: null,
        file: 'AA==', // base 64 encoded file byte array
        filename: null,
        retention_period: null
      }
    }

    expect(sendEmailMock).toHaveBeenCalledWith(expect.anything(), {
      json: 'strict',
      headers: {
        Authorization: expect.anything()
      },
      payload: { email_address: email, template_id: expect.anything(), personalisation },
      agent: expect.anything()
    })
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
    expect(sendEmailMock).toHaveBeenCalledWith(expect.anything(), {
      json: 'strict',
      headers: {
        Authorization: expect.anything()
      },
      payload: { email_address: email, template_id: expect.anything(), personalisation },
      agent: expect.anything()
    })
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
    expect(sendEmailMock).toHaveBeenCalledWith(expect.anything(), {
      json: 'strict',
      headers: {
        Authorization: expect.anything()
      },
      payload: { email_address: email, template_id: expect.anything(), personalisation },
      agent: expect.anything()
    })
  })

  it('should handle exception correctly', async () => {
    sendEmailMock.mockRejectedValue('Mock Error')
    const { sendEmail } = await import('./index.js')
    await sendEmail.sendSuccess({ email, name: JSON.stringify({ firstName: 'Joe Bloggs' }) })
    expect(loggerErrorMock).toHaveBeenCalledWith('Error sending emails: Mock Error')
  })

  it('should error when file is too large', async () => {
    const { sendEmail } = await import('./index.js')
    const file = { length: 2048 * 1024 + 1 }
    await sendEmail.sendSuccess({ email, name: JSON.stringify({ firstName: 'Joe Bloggs' }), file })
    expect(loggerErrorMock).toHaveBeenCalledWith('Error sending emails: Error: File is larger than 2MB.')
  })

  it('should error when gov notify key is not set', async () => {
    config.set('notify.govNotifyKey', null)
    const { sendEmail } = await import('./index.js')
    await sendEmail.sendSuccess({ email, name: JSON.stringify({ firstName: 'Joe Bloggs' }) })
    expect(loggerErrorMock).toHaveBeenCalledWith('Error sending emails: Error: Notify key not set')
  })
})
