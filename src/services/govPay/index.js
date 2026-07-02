import { config } from '../../config.js'
import { CREATED, SUCCESS } from '../httpStatusCodes.js'
import { createLogger } from '../../common/helpers/logging/logger.js'
import wreck from '@hapi/wreck'
import { createAgent } from '../../common/helpers/proxy/setup-proxy.js'
import { setTimeout } from 'timers/promises'

const fallbackLogger = createLogger()

const agent = createAgent()

export const createGovPayPayment = async ({ reference, amount, description, returnUrl, metadata, idempotencyKey }, logger) => {
  const log = logger ?? fallbackLogger
  try {
    const { apiUrl, apiKey } = config.get('govPay')
    log.info(`initiating payment ${apiUrl.replace(/\/$/, '')}/payments`)
    const { res, payload } = await wreck.post(`${apiUrl.replace(/\/$/, '')}/payments`, {
      json: true,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey
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
      },
      agent
    })
    return { payload, status: res?.statusCode === SUCCESS ? 'success' : 'error', statusCode: res?.statusCode }
  } catch (e) {
    log.error(`Error initiating payment ${e} ${e.stack}`)
    return { status: 'error', error: e }
  }
}

const formatDate = (d) => d.toISOString().replace(/.[0-9][0-9][0-9]Z$/, 'Z')

/* 
  from: https://docs.payments.service.gov.uk/api_reference/#pagination
Pagination links
Search endpoints also return a _links object, which includes href and method fields you can use to move between pages. Use the fields in:

self to run the same search again
first_page to get the first page of results
last_page to get the last page
prev_page to get the previous page
next_page to get the next page
 */
export async function* getRefundsBetween(start, end, logger) {
  const log = logger ?? fallbackLogger
  const maxRetries = 5
  logger.debug(`fetching refund data between ${start} and ${end}`)
  const { apiUrl, apiKey } = config.get('govPay')
  let nextUrl = `${apiUrl.replace(/\/$/, '')}/refunds?from_date=${formatDate(start)}&to_date=${formatDate(end)}&display_size=10`
  let i = 0
  while (nextUrl) {
    try {
      const { res, payload } = await wreck.get(nextUrl, {
        json: true,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        agent
      })
      logger.debug(`fetched ${res?.statusCode}`)
      if (res?.statusCode === SUCCESS) {
        i = maxRetries + 1
        nextUrl = payload?._links?.next_page?.href
        logger.debug(` >> ${payload.results}`)
        yield* payload.results
      } else {
        throw new Error('error status code')
      }
    } catch (e) {
      log.error(`Error initiating payment ${e}  >> retry ${i} ${e.stack}`)
      i++
      if (i > 100) {
        throw e
      } else {
        await setTimeout(i * config.get('govPay.schedulingPollingTaskRetrySleepStep'))
      }
    }
  }
}
