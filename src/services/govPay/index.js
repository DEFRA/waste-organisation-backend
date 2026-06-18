import wreck from '@hapi/wreck'
import { config } from '../../config.js'
import { CREATED, SUCCESS } from '../httpStatusCodes.js'
import { createLogger } from '../../common/helpers/logging/logger.js'

const fallbackLogger = createLogger()

export const createGovPayPayment = async ({ reference, amount, description, returnUrl, metadata }, logger) => {
  const log = logger ?? fallbackLogger
  try {
    const { apiUrl, apiKey } = config.get('govPay')
    const { res, payload } = await wreck.post(`${apiUrl.replace(/\/$/, '')}/payments`, {
      json: true,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      payload: {
        amount,
        description,
        metadata,
        reference,
        return_url: returnUrl
      }
    })
    return { payload, status: res?.statusCode === CREATED ? 'success' : 'error', statusCode: res?.statusCode }
  } catch (e) {
    log.error(`Error initiating payment ${e} ${e.stack}`)
    return { status: 'error', error: e }
  }
}

export const getPaymentStatus = async (paymentId, logger) => {
  const log = logger ?? fallbackLogger
  try {
    const { apiUrl, apiKey } = config.get('govPay')
    const { res, payload } = await wreck.get(`${apiUrl.replace(/\/$/, '')}/payments/${paymentId}`, {
      json: true,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      }
    })
    return { payload, status: res?.statusCode === SUCCESS ? 'success' : 'error', statusCode: res?.statusCode }
  } catch (e) {
    log.error(`Error initiating payment ${e} ${e.stack}`)
    // TODO delete log
    log.error(`ERROR DATA: ${JSON.stringify(e.data?.payload, null, 4)}`)
    return { status: 'error', error: e }
  }
}
