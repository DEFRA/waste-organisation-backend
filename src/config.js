import convict from 'convict'
import convictFormatWithValidator from 'convict-format-with-validator'

import { convictValidateMongoUri } from './config/validate-mongo-uri.js'

convict.addFormat(convictValidateMongoUri)
convict.addFormats(convictFormatWithValidator)

const isString = (val) => typeof val === 'string' || val instanceof String

convict.addFormat({
  name: 'date',
  validate: (val) => {
    if (!(val instanceof Date)) {
      throw new Error('must be a Date object')
    }
  },
  coerce: (val) => {
    if (isString(val)) {
      const parsed = new Date(val)
      if (isNaN(parsed.getTime())) {
        throw new Error('must be a valid date string')
      }
      return parsed
    }
    return val
  }
})

const productionEnvironments = ['perf-test', 'ext-test', 'prod']
const isProduction = productionEnvironments.includes(process.env.ENVIRONMENT)
const isTest = process.env.NODE_ENV === 'test'

export const config = convict({
  auth: {
    clients: {
      doc: 'API Client pre-shared-keys',
      format: Array,
      default: []
    }
  },
  bulkUpload: {
    endpoint: {
      doc: 'Endpoint for Bulk Import API',
      format: String,
      env: 'BULK_UPLOAD_ENDPOINT',
      default: ''
    },
    url: {
      doc: 'Path for Bulk Import API',
      format: String,
      default: '/bulk/{bulkUploadId}/movements/receive',
      env: 'BULK_UPLOAD_URL'
    },
    basicAuth: {
      username: {
        doc: 'Username for Bulk Import API',
        format: String,
        env: 'BULK_UPLOAD_USERNAME',
        default: ''
      },
      password: {
        doc: 'Password for Bulk Import API',
        format: String,
        env: 'BULK_UPLOAD_PASSWORD',
        default: ''
      }
    },
    copySpreadsheetToDisk: {
      doc:
        'Make a copy of the spreadsheet on disk when generating errors (only use in local development ' +
        'to get hold of a copy of the generated spreadsheet without a GOV Notify login)',
      format: Boolean,
      env: 'BULK_UPLOAD_COPY_SPREADSHEET_TO_DISK',
      default: false
    },
    spreadsheetTimezone: {
      doc: 'The timezone to assume that dates in the spreadsheet are in',
      format: String,
      env: 'BULK_UPLOAD_SPREADSHEET_TIMEZONE',
      default: 'Europe/London'
    }
  },
  notify: {
    govNotifyKey: {
      doc: 'Gov Notify Key',
      format: String,
      nullable: true,
      default: null,
      env: 'GOV_NOTIFY_KEY'
    },
    successTemplate: {
      doc: 'Gov Notify success template Id',
      format: String,
      nullable: true,
      default: '2ffe3792-f097-421d-b3e2-9de5af81609f',
      env: 'GOV_NOTIFY_SUCCESSFUL_TEMPLATE'
    },
    failedTemplate: {
      doc: 'Gov Notify failed template Id',
      format: String,
      nullable: true,
      default: '8ad2881f-4904-4c22-a0fb-b001d8d72349',
      env: 'GOV_NOTIFY_FAILED_TEMPLATE'
    },
    failedWithFileTemplate: {
      doc: 'Gov Notify failed with file template Id',
      format: String,
      nullable: true,
      default: 'e6f9eb36-c2cc-4838-b7ae-1e79847afdd6',
      env: 'GOV_NOTIFY_FAILED_WITH_FILE_TEMPLATE'
    }
  },
  govPay: {
    apiUrl: {
      doc: 'The base URL for the GovPay Public API.',
      format: String,
      nullable: false,
      default: 'https://publicapi.payments.service.gov.uk/v1',
      env: 'GOVPAY_API_URL'
    },
    apiKey: {
      doc: 'GovPay API key for creating payments.',
      format: String,
      nullable: false,
      env: 'GOVPAY_API_KEY',
      default: 'test123',
      sensitive: true
    },
    serviceChargeAmountPence: {
      doc: 'Service charge amount in pence.',
      format: Number,
      nullable: false,
      default: 2600,
      env: 'GOVPAY_SERVICE_CHARGE_AMOUNT_PENCE'
    },
    webhookSigningSecret: {
      doc: 'The signing secret unique to the GOV.UK Pay webhook',
      format: String,
      nullable: true,
      sensitive: true,
      default: null
    },
    serviceChargeFreePeriodEnd: {
      doc: 'The date the free period ends and the service change kicks in.',
      format: 'date',
      nullable: true,
      default: '2026-10-01T00:00:00.000Z',
      env: 'GOVPAY_SERVICE_FREE_PERIOD_END'
    },
    serviceChargePaymentWindowStart: {
      doc: 'The date the payment window opens in "dd-mm" format.',
      format: String,
      validate: (val) => {
        /* v8 ignore start */
        if (isString(val) && val.match(/^([0123]?[0-9])-(1[012]|0?[1-9])$/)) {
          return val
        }
        throw new Error('payment window should be in format `DD-MM`')
        /* v8 ignore stop */
      },
      nullable: true,
      default: '07-01',
      env: 'GOVPAY_SERVICE_PAYMENT_WINDOW_START'
    },
    maxAgeOfPaymentPollingMessage: {
      doc: 'Time after which a message polling for the status of a payment will be dropped if it is still pending',
      format: Number,
      nullable: false,
      default: 3 * 24 * 60 * 60 * 1000,
      env: 'GOVPAY_SERVICE_CHARGE_PAYMENT_POLLING_MAX_AGE'
    }
  },
  aws: {
    region: {
      doc: 'AWS region',
      format: String,
      default: 'eu-west-2',
      env: 'AWS_REGION'
    },
    s3Endpoint: {
      doc: 'AWS S3 endpoint',
      format: String,
      default: 'http://127.0.0.1:4566',
      env: 'S3_ENDPOINT'
    },
    spreadsheetS3Bucket: {
      doc: 'AWS S3 bucket for spreadsheet uploads',
      format: String,
      default: 'spreadsheet-bucket',
      env: 'SPREADSHEET_S3_BUCKET'
    },
    forcePathStyle: {
      doc: 'S3 Client path config',
      format: Boolean,
      default: !isProduction,
      env: 'AWS_S3_FORCE_PATH_STYLE'
    },
    checksumMode: {
      doc: 'S3 Client Checksum Mode',
      format: ['ENABLED', 'DISABLED'],
      default: 'ENABLED',
      env: 'AWS_S3_CHECKSUM_MODE'
    },
    sqsEndpoint: {
      doc: 'AWS SQS endpoint',
      format: String,
      default: 'http://127.0.0.1:4566',
      env: 'SQS_ENDPOINT'
    },
    backgroundProcessQueue: {
      doc: 'AWS SQS queue - used for scheduling background processes',
      format: String,
      default: 'waste-receiver-background-process',
      env: 'SPREADSHEET_SQS_QUEUE'
    }
  },
  serviceVersion: {
    doc: 'The service version, this variable is injected into your docker container in CDP environments',
    format: String,
    nullable: true,
    default: null,
    env: 'SERVICE_VERSION'
  },
  host: {
    doc: 'The IP address to bind',
    format: 'ipaddress',
    default: '0.0.0.0',
    env: 'HOST'
  },
  port: {
    doc: 'The port to bind',
    format: 'port',
    default: 3001,
    env: 'PORT'
  },
  serviceName: {
    doc: 'Api Service Name',
    format: String,
    default: 'waste-organisation-backend'
  },
  cdpEnvironment: {
    doc: 'The CDP environment the app is running in. With the addition of "local" for local development',
    format: ['local', 'infra-dev', 'management', 'dev', 'test', 'perf-test', 'ext-test', 'prod'],
    default: 'local',
    env: 'ENVIRONMENT'
  },
  log: {
    isEnabled: {
      doc: 'Is logging enabled',
      format: Boolean,
      default: !isTest,
      env: 'LOG_ENABLED'
    },
    level: {
      doc: 'Logging level',
      format: ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'],
      default: 'info',
      env: 'LOG_LEVEL'
    },
    format: {
      doc: 'Format to output logs in',
      format: ['ecs', 'pino-pretty'],
      default: isProduction ? 'ecs' : 'pino-pretty',
      env: 'LOG_FORMAT'
    },
    redact: {
      doc: 'Log paths to redact',
      format: Array,
      default: isProduction ? ['req.headers.authorization', 'req.headers.cookie', 'res.headers'] : ['req', 'res', 'responseTime']
    }
  },
  mongo: {
    mongoUrl: {
      doc: 'URI for mongodb',
      format: String,
      default: 'mongodb://127.0.0.1:27017/',
      env: 'MONGO_URI'
    },
    databaseName: {
      doc: 'database for mongodb',
      format: String,
      default: 'waste-organisation-backend',
      env: 'MONGO_DATABASE'
    },
    mongoOptions: {
      retryWrites: {
        doc: 'Enable Mongo write retries, overrides mongo URI when set.',
        format: Boolean,
        default: null,
        nullable: true,
        env: 'MONGO_RETRY_WRITES'
      },
      readPreference: {
        doc: 'Mongo read preference, overrides mongo URI when set.',
        format: ['primary', 'primaryPreferred', 'secondary', 'secondaryPreferred', 'nearest'],
        default: null,
        nullable: true,
        env: 'MONGO_READ_PREFERENCE'
      }
    }
  },
  httpProxy: {
    doc: 'HTTP Proxy URL',
    format: String,
    nullable: true,
    default: null,
    env: 'HTTP_PROXY'
  },
  isMetricsEnabled: {
    doc: 'Enable metrics reporting',
    format: Boolean,
    default: isProduction,
    env: 'ENABLE_METRICS'
  },
  tracing: {
    header: {
      doc: 'CDP tracing header name',
      format: String,
      default: 'x-cdp-request-id',
      env: 'TRACING_HEADER'
    }
  },
  encryptionKey: {
    doc: 'base64 encryption key used for encrypting strings',
    format: String,
    env: 'ENCRYPTION_KEY',
    default: '1r1S98SiPcNEN0vtKm3uiXchW0KYzScxArmmKrYkfKg='
  },
  isSwaggerEnabled: {
    doc: 'Enable swagger documentation. Disabled in perf-test, ext-test and prod.',
    format: Boolean,
    default: !isProduction,
    env: 'ENABLE_SWAGGER'
  },
  isTestRoutesEnabled: {
    doc: 'Enable test-only routes. Disabled in perf-test, ext-test and prod.',
    format: Boolean,
    default: !isProduction,
    env: 'ENABLE_TEST_ROUTES'
  }
})

export const updateClientAuthKeys = () => {
  const apiKeys = Object.entries(process.env)
    .filter(([k]) => k.startsWith('WASTE_CLIENT_AUTH_'))
    .map(([, v]) => v)
  config.set('auth.clients', apiKeys)
}

updateClientAuthKeys()

config.validate({ allowed: 'strict' })
