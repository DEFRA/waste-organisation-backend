import {
  delay,
  ServiceBusClient // ServiceBusMessage
} from '@azure/service-bus'
import {} from //DefaultAzureCredential
'@azure/identity'

// TODO keep event sourced data in s3 bucket
// TODO tidy up example and process actual data structures

const connectionStr =
  'Endpoint=sb://localhost;SharedAccessKeyName=RootManageSharedAccessKey;SharedAccessKey=SAS_KEY_VALUE;UseDevelopmentEmulator=true;'

// name of the queue
const queueName = 'queue.1'

const listenForDefraIdMessages = async () => {
  // create a Service Bus client using the passwordless authentication to the Service Bus namespace
  const sbClient = new ServiceBusClient(connectionStr)

  // createReceiver() can also be used to create a receiver for a subscription.
  const receiver = sbClient.createReceiver(queueName)

  const msgs = []
  // function to handle messages
  const myMessageHandler = async (messageReceived) => {
    console.log(`Received message: ${messageReceived.body}`)
    msgs.push({ body: messageReceived.body })
  }

  // function to handle any errors
  const myErrorHandler = async (error) => {
    console.log(error)
  }

  // subscribe and specify the message and error handlers
  receiver.subscribe({
    processMessage: myMessageHandler,
    processError: myErrorHandler
  })

  // Waiting long enough before closing the sender to send messages
  await delay(2000) // NOSONAR

  await receiver.close()
  await sbClient.close()

  return msgs
}

const sendSomeMessages = async (messages) => {
  // create a Service Bus client using the passwordless authentication to the Service Bus namespace
  const sbClient = new ServiceBusClient(connectionStr)

  // createSender() can also be used to create a sender for a topic.
  const sender = sbClient.createSender(queueName)

  try {
    // Tries to send all messages in a single batch.
    // Will fail if the messages cannot fit in a batch.
    // await sender.sendMessages(messages);

    // create a batch object
    let batch = await sender.createMessageBatch()
    for (let i = 0; i < messages.length; i++) {
      // for each message in the array

      // try to add the message to the batch
      if (!batch.tryAddMessage(messages[i])) {
        // if it fails to add the message to the current batch
        // send the current batch as it is full
        await sender.sendMessages(batch)

        // then, create a new batch
        batch = await sender.createMessageBatch()

        // now, add the message failed to be added to the previous batch to this batch
        // prettier-ignore
        if (!batch.tryAddMessage(messages[i])) { // NOSONAR
          // if it still can't be added to the batch, the message is probably too big to fit in a batch
          throw new Error('Message too big to fit in a batch')
        }
      }
    }

    // Send the last created batch of messages to the queue
    await sender.sendMessages(batch)

    console.log(`Sent a batch of messages to the queue: ${queueName}`)

    // Close the sender
    await sender.close()
  } finally {
    await sbClient.close()
  }
}

export { listenForDefraIdMessages, sendSomeMessages }
