import convict from 'convict'
import convictFormatWithValidator from 'convict-format-with-validator'

import { convictValidateMongoUri } from './config/validate-mongo-uri.js'

convict.addFormat(convictValidateMongoUri)
convict.addFormats(convictFormatWithValidator)

const isProduction = process.env.NODE_ENV === 'production'
const isTest = process.env.NODE_ENV === 'test'

export const config = convict({
  auth: {
    clients: {
      doc: 'API Client pre-shared-keys',
      format: Array,
      default: []
    }
  },
  notify: {
    govNotifyKey: {
      doc: 'Gov Notify Key',
      format: String,
      nullable: true,
      default: null,
      env: 'GOV_NOTIFY_KEY'
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
