import { config } from '../../config.js'
import { CREATED } from '../httpStatusCodes.js'
import { createLogger } from '../../common/helpers/logging/logger.js'
import wreck from '@hapi/wreck'
import { createAgent } from '../../common/helpers/proxy/setup-proxy.js'

const fallbackLogger = createLogger()

const agent = createAgent()

export const createGovPayPayment = async ({ reference, amount, description, returnUrl, metadata }, logger) => {
  const log = logger ?? fallbackLogger
  try {
    const { apiUrl, apiKey } = config.get('govPay')
    log.info(`initiating payment ${apiUrl.replace(/\/$/, '')}/payments`)
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
      },
      agent
    })
    return { payload, status: res?.statusCode === CREATED ? 'success' : 'error', statusCode: res?.statusCode }
  } catch (e) {
    log.error(`Error initiating payment ${e} ${e.stack}`)
    // TODO delete log
    log.error(`ERROR DATA: ${JSON.stringify(e.data?.payload, null, 4)}`)
    return { status: 'error', error: e }
  }
}
