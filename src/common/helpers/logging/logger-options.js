import { ecsFormat } from '@elastic/ecs-pino-format'
import { config } from '../../../config.js'
import { getTraceId } from '@defra/hapi-tracing'

const logConfig = config.get('log')
const serviceName = config.get('serviceName')
const serviceVersion = config.get('serviceVersion')

const formatters = {
  ecs: {
    ...ecsFormat({
      serviceVersion,
      serviceName
    })
  },
  'pino-pretty': { transport: { target: 'pino-pretty' } }
}

const tracingHeader = config.get('tracing.header')

export const loggerOptions = (traceId) => ({
  enabled: logConfig.isEnabled,
  ignorePaths: ['/health'],
  redact: {
    paths: logConfig.redact,
    remove: true
  },
  level: logConfig.level,
  ...formatters[logConfig.format],
  nesting: true,
  getChildBindings(request) {
    const headerTraceId = request.headers[tracingHeader]
    console.log(`DEBUG getChildBindings - all headers: ${JSON.stringify(request.headers)}`)
    console.log(`DEBUG getChildBindings - tracingHeader [${tracingHeader}]: ${headerTraceId}`)
    console.log(`DEBUG getChildBindings - getTraceId(): ${getTraceId()}`)
    return headerTraceId ? { req: request, trace: { id: headerTraceId } } : { req: request }
  },
  mixin() {
    const mixinValues = {}
    if (traceId) {
      mixinValues.trace = { id: traceId }
      return mixinValues
    }

    const headerTraceId = getTraceId()
    if (headerTraceId) {
      mixinValues.trace = { id: headerTraceId }
    }

    return mixinValues
  }
})
