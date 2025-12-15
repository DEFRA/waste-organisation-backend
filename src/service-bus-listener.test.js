import {
  listenForDefraIdMessages,
  sendSomeMessages
} from './service-bus-listener.js'

describe('should do', async () => {
  test.skip('something', async () => {
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
    await sendSomeMessages(messages)
    const result = await listenForDefraIdMessages()
    expect(result).toEqual(messages)
  })
})
