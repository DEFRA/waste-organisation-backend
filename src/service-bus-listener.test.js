import { delay, ServiceBusClient } from '@azure/service-bus'
import {
  listenForDefraIdMessages,
  connectionStr,
  queueName,
  dbMessageHandler
} from './service-bus-listener.js'
import {
  initInMemMongo,
  stopInMemMongo
} from './common/helpers/initialse-test-server.js'
import { config } from './config.js'
import { plugins } from './api-server.js'

describe('should do', async () => {
  test('something', async () => {
    const messages = [
      { body: 'Albert Einstein' },
      { body: 'Werner Heisenberg' },
      { body: 'Marie Curie' },
      { body: 'Steven Hawking' },
      { body: 'Isaac Newton' },
      { body: 'Niels Bohr' },
      { body: 'Michael Faraday' },
      { body: 'Galileo Galilei' },
      { body: 'Johannes Kepler' },
      { body: 'Nikolaus Kopernikus' }
    ]

    const result = []
    // function to handle messages
    const myMessageHandler = {
      handleMessage: async (messageReceived) => {
        result.push({ body: messageReceived.body })
      }
    }

    await sendSomeMessages(messages)
    let listener = null
    try {
      listener = await listenForDefraIdMessages(myMessageHandler)
      // Waiting long enough before closing the sender to send messages
      await delay(2000) // NOSONAR
      expect(result).toEqual(messages)
    } finally {
      listener?.close()
    }
  })
})

const sendSomeMessages = async (messages) => {
  const sbClient = new ServiceBusClient(connectionStr)
  const sender = sbClient.createSender(queueName)

  try {
    let batch = await sender.createMessageBatch()
    for (let i = 0; i < messages.length; i++) {
      if (!batch.tryAddMessage(messages[i])) {
        await sender.sendMessages(batch)
        batch = await sender.createMessageBatch()
        // prettier-ignore
        if (!batch.tryAddMessage(messages[i])) { // NOSONAR
          throw new Error('Message too big to fit in a batch')
        }
      }
    }
    await sender.sendMessages(batch)
    await sender.close()
  } finally {
    await sbClient.close()
  }
}

describe('db messenge handler', () => {
  beforeAll(async () => {
    await initInMemMongo()
  })
  afterAll(async () => {
    // await stopInMemMongo()
  })

  test('updates organisation', async () => {
    const id = '123'
    const { handleMessage, close } = await dbMessageHandler(
      (x) => {
        console.log('THIS ONE _: ', x)
        return { test: 'data', id }
      },
      (_) => ({ id }), // { id: { $eq: id } }
      plugins.mongoDb.options
      //config.get('mongo')
    )
    try {
      await handleMessage()
      // TODO assert data has been saved?
    } finally {
      await close()
    }
  })
})
