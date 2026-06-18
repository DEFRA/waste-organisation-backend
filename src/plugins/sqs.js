import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs'

const constructSqsClient = ({ region, endpoint }) => {
  return new SQSClient({ region, endpoint })
}

export const sendSqsMessage = async (messageData, jobtype, QueueUrl, logger, client) => {
  const params = {
    QueueUrl,
    MessageBody: JSON.stringify(messageData),
    MessageAttributes: {
      JobType: {
        DataType: 'String',
        StringValue: jobtype ?? 'unknown_job_type'
      }
    }
  }

  try {
    const command = new SendMessageCommand(params)
    const result = await client.send(command)
    logger?.info(`Job sent to queue: ${result.MessageId}`)
    return result.MessageId
  } catch (err) {
    logger?.error(`Error sending message: ${err}`)
    throw err
  }
}

export const sqsPlugin = {
  plugin: {
    name: 'sqsPlugin',
    version: '1.0.0',
    register: async (server, options) => {
      const client = constructSqsClient(options)
      server.decorate('request', 'sqsClient', client)
      server.decorate('request', options.queueKey, options.queueUrl)
    }
  }
}
