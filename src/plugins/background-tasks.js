import process from 'node:process'
import { startWorker } from '../backgroundProcessor.js'
import { startTasks } from '../scheduledJobs.js'

export const backgroundTasksPlugin = {
  plugin: {
    name: 'backgroundTasks',
    version: '1.0.0',
    register: async function (server, _options) {
      startWorker()
      const { stopScheduling } = await startTasks(server.db)

      process.on('exit', async () => {
        await stopScheduling()
      })
    }
  }
}
