import { beforeEach, describe, expect, vi } from 'vitest'
import fs from 'node:fs/promises'
import Excel from 'exceljs'

import { encrypt } from './test-utils/encrypt.js'
import { config } from './config.js'

vi.mock('./services/bulkImport.js')
vi.mock('./services/notify/index.js')
vi.mock('./common/helpers/logging/logger.js', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), trace: vi.fn() })
}))

const ENCRYPTION_KEY = config.get('encryptionKey')
const TEST_EMAIL = 'integration-test@example.com'
const TEST_NAME = JSON.stringify({ firstName: 'Test' })

const buildMessage = (overrides = {}) => ({
  Body: JSON.stringify({
    s3Bucket: 'test-bucket',
    s3Key: 'test-key',
    encryptedEmail: encrypt(TEST_EMAIL, ENCRYPTION_KEY),
    encryptedName: encrypt(TEST_NAME, ENCRYPTION_KEY),
    organisationId: 'org-123',
    uploadId: 'upload-integration',
    hasError: false,
    uploadType: 'create',
    ...overrides
  })
})

const buildS3Client = (filenameOrBuffer) => ({
  send: async () => {
    const buffer = Buffer.isBuffer(filenameOrBuffer) ? filenameOrBuffer : await fs.readFile(`./test-resources/${filenameOrBuffer}`)
    return { Body: [buffer] }
  }
})

const loadWorkbookFromEmailCall = async (mockFn) => {
  const { file } = mockFn.mock.calls[0][0]
  const workbook = new Excel.Workbook()
  await workbook.xlsx.load(file)
  return workbook
}

describe('backgroundProcessor integration', () => {
  let processJob
  let bulkImportModule
  let notifyModule

  beforeEach(async () => {
    vi.clearAllMocks()
    bulkImportModule = await import('./services/bulkImport.js')
    notifyModule = await import('./services/notify/index.js')
    const processor = await import('./backgroundProcessor.js')
    processJob = processor.processJob
  })

  it('happy path create - sends success email with waste tracking IDs', { timeout: 30000 }, async () => {
    bulkImportModule.bulkImport.mockResolvedValue({
      movements: [{ wasteTrackingId: 'WTID001' }]
    })
    notifyModule.sendEmail.sendSuccess.mockResolvedValue()

    const s3Client = buildS3Client('valid-spreadsheet.xlsx')
    await processJob(s3Client, buildMessage())

    expect(bulkImportModule.bulkImport).toHaveBeenCalled()
    const [uploadId, movements] = bulkImportModule.bulkImport.mock.calls[0]
    expect(uploadId).toBe('upload-integration')
    expect(movements[0].submittingOrganisation.defraCustomerOrganisationId).toBe('org-123')

    expect(notifyModule.sendEmail.sendSuccess).toHaveBeenCalledTimes(1)
    const emailArg = notifyModule.sendEmail.sendSuccess.mock.calls[0][0]
    expect(emailArg.email).toBe(TEST_EMAIL)

    const workbook = await loadWorkbookFromEmailCall(notifyModule.sendEmail.sendSuccess)
    const ws = workbook.getWorksheet('7. Waste movement level')
    const wtidCell = ws.getCell('B9')
    const wtidText = wtidCell.value?.richText?.[0]?.text ?? wtidCell.value
    expect(wtidText).toBe('WTID001')
  })

  it('parse errors - sends validation failed email with annotated spreadsheet', { timeout: 30000 }, async () => {
    notifyModule.sendEmail.sendValidationFailed.mockResolvedValue()

    const s3Client = buildS3Client('example-spreadsheet.xlsx')
    await processJob(s3Client, buildMessage())

    expect(bulkImportModule.bulkImport).not.toHaveBeenCalled()
    expect(notifyModule.sendEmail.sendValidationFailed).toHaveBeenCalledTimes(1)

    const emailArg = notifyModule.sendEmail.sendValidationFailed.mock.calls[0][0]
    expect(emailArg.email).toBe(TEST_EMAIL)
    expect(emailArg.file).toBeInstanceOf(Buffer)

    const workbook = await loadWorkbookFromEmailCall(notifyModule.sendEmail.sendValidationFailed)
    const ws = workbook.getWorksheet('8. Waste item level')
    const errorCell = ws.getCell('A10')
    expect(errorCell.value.richText.length).toBeGreaterThan(0)
    expect(errorCell.value.richText[0].text).toContain('No waste movements for unique reference')
    expect(errorCell.value.richText[0].font.color.argb).toBe('FFD4351C')
  })

  it('API validation errors - sends validation failed email with error annotations', { timeout: 30000 }, async () => {
    bulkImportModule.bulkImport.mockResolvedValue({
      errors: [
        {
          errorType: 'ValidationError',
          key: '0.wasteItems.0.ewcCodes.0',
          message: '"[0].wasteItems[0].ewcCodes[0]" must be a valid EWC code from the official list'
        }
      ]
    })
    notifyModule.sendEmail.sendValidationFailed.mockResolvedValue()

    const s3Client = buildS3Client('valid-spreadsheet.xlsx')
    await processJob(s3Client, buildMessage())

    expect(notifyModule.sendEmail.sendValidationFailed).toHaveBeenCalledTimes(1)
    const emailArg = notifyModule.sendEmail.sendValidationFailed.mock.calls[0][0]
    expect(emailArg.email).toBe(TEST_EMAIL)

    const workbook = await loadWorkbookFromEmailCall(notifyModule.sendEmail.sendValidationFailed)
    const ws = workbook.getWorksheet('8. Waste item level')
    const errorCell = ws.getCell('A9')
    expect(errorCell.value.richText.length).toBeGreaterThan(0)
    expect(errorCell.value.richText[0].text).toContain('ewc codes must be a valid EWC code')
    expect(errorCell.value.richText[0].font.color.argb).toBe('FFD4351C')
    const dataCell = ws.getCell('C9')
    expect(dataCell.style.fill.fgColor.argb).toBe('FFFFCCCC')
  })

  it('API permanent failure - sends failed email without file', { timeout: 30000 }, async () => {
    bulkImportModule.bulkImport.mockResolvedValue({ failed: true })
    notifyModule.sendEmail.sendFailed.mockResolvedValue()

    const s3Client = buildS3Client('valid-spreadsheet.xlsx')
    await processJob(s3Client, buildMessage())

    expect(notifyModule.sendEmail.sendFailed).toHaveBeenCalledTimes(1)
    expect(notifyModule.sendEmail.sendFailed).toHaveBeenCalledWith({
      email: TEST_EMAIL,
      name: TEST_NAME
    })
    expect(notifyModule.sendEmail.sendSuccess).not.toHaveBeenCalled()
    expect(notifyModule.sendEmail.sendValidationFailed).not.toHaveBeenCalled()
  })

  it('transient API error (503) - rejects for SQS retry', { timeout: 30000 }, async () => {
    const transientError = { output: { statusCode: 503 }, stack: 'Service Unavailable' }
    bulkImportModule.bulkImport.mockRejectedValue(transientError)

    const s3Client = buildS3Client('valid-spreadsheet.xlsx')

    await expect(processJob(s3Client, buildMessage())).rejects.toEqual(transientError)
    expect(notifyModule.sendEmail.sendFailed).not.toHaveBeenCalled()
    expect(notifyModule.sendEmail.sendSuccess).not.toHaveBeenCalled()
  })

  it('hasError flag - sends failed email without fetching S3', { timeout: 30000 }, async () => {
    notifyModule.sendEmail.sendFailed.mockResolvedValue()

    const s3Client = { send: vi.fn() }
    await processJob(s3Client, buildMessage({ hasError: true }))

    expect(s3Client.send).not.toHaveBeenCalled()
    expect(notifyModule.sendEmail.sendFailed).toHaveBeenCalledTimes(1)
    expect(notifyModule.sendEmail.sendFailed).toHaveBeenCalledWith({
      email: TEST_EMAIL,
      name: TEST_NAME
    })
  })

  it('missing S3 coords - silently returns without sending email', { timeout: 30000 }, async () => {
    const s3Client = { send: vi.fn() }
    await processJob(s3Client, buildMessage({ s3Bucket: undefined, s3Key: undefined }))

    expect(s3Client.send).not.toHaveBeenCalled()
    expect(notifyModule.sendEmail.sendFailed).not.toHaveBeenCalled()
    expect(notifyModule.sendEmail.sendSuccess).not.toHaveBeenCalled()
    expect(notifyModule.sendEmail.sendValidationFailed).not.toHaveBeenCalled()
  })

  it('non-Excel file - sends failed email without file', { timeout: 30000 }, async () => {
    notifyModule.sendEmail.sendFailed.mockResolvedValue()

    const s3Client = buildS3Client(Buffer.from('not excel'))
    await processJob(s3Client, buildMessage())

    expect(bulkImportModule.bulkImport).not.toHaveBeenCalled()
    expect(notifyModule.sendEmail.sendFailed).toHaveBeenCalledTimes(1)
    expect(notifyModule.sendEmail.sendFailed).toHaveBeenCalledWith({
      email: TEST_EMAIL,
      name: TEST_NAME
    })
  })

  it('update upload happy path - calls bulkUpdate and preserves WTIDs', { timeout: 30000 }, async () => {
    const validBuffer = await fs.readFile('./test-resources/valid-spreadsheet.xlsx')
    const workbook = new Excel.Workbook()
    await workbook.xlsx.load(validBuffer, { ignoreNodes: ['conditionalFormatting'] })
    const ws = workbook.getWorksheet('7. Waste movement level')
    const wtidCell = ws.getCell('B9')
    wtidCell.value = 'EXISTING1'
    const modifiedBuffer = await workbook.xlsx.writeBuffer()

    bulkImportModule.bulkUpdate.mockResolvedValue({
      movements: [{ wasteTrackingId: 'EXISTING1' }]
    })
    notifyModule.sendEmail.sendSuccess.mockResolvedValue()

    const s3Client = buildS3Client(Buffer.from(modifiedBuffer))
    await processJob(s3Client, buildMessage({ uploadType: 'update' }))

    expect(bulkImportModule.bulkUpdate).toHaveBeenCalled()
    expect(bulkImportModule.bulkImport).not.toHaveBeenCalled()

    const [, movements] = bulkImportModule.bulkUpdate.mock.calls[0]
    expect(movements[0].wasteTrackingId).toBe('EXISTING1')

    expect(notifyModule.sendEmail.sendSuccess).toHaveBeenCalledTimes(1)

    const resultWorkbook = await loadWorkbookFromEmailCall(notifyModule.sendEmail.sendSuccess)
    const resultWs = resultWorkbook.getWorksheet('7. Waste movement level')
    const resultWtid = resultWs.getCell('B9')
    const wtidText = resultWtid.value?.richText?.[0]?.text ?? resultWtid.value
    expect(wtidText).toBe('EXISTING1')
  })
})
