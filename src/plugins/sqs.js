import { SQSClient } from '@aws-sdk/client-sqs'

const constructSqsClient = ({ region, endpoint }) => {
  return new SQSClient({ region, endpoint })
}

export const sqsPlugin = {
  plugin: {
    name: 'sqsPlugin',
    version: '1.0.0',
    register: async (server, options) => {
      server.decorate('request', 'sqsClient', constructSqsClient(options))
      server.decorate('request', options.queueKey, options.queueUrl)
    }
  }
}
