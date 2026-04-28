import wreck from '@hapi/wreck'
import { config } from '../../config/paths.js'
import { SUCCESS } from '../httpStatusCodes.js'

export const createGovPayPayment = async ({ reference, amount, description, returnUrl, metadata }, logger) => {
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
    return { payload, status: res?.statusCode === SUCCESS ? 'success' : 'error', statusCode: res?.statusCode }
  } catch (e) {
    logger.error(`Error initiating payment ${e} ${e.stack}`)
    return { status: 'error' }
  }
}
