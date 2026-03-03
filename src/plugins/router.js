import { config } from '../config.js'
import { health } from '../routes/health.js'
import { organisations } from '../routes/organisation.js'
import { spreadsheet, testSpreadsheetRoutes } from '../routes/spreadsheet.js'
import { apiCodeRoutes } from '../routes/api-code.js'

const router = {
  plugin: {
    name: 'router',
    register: (server, _options) => {
      server.route([health, ...organisations, ...spreadsheet, ...apiCodeRoutes])
      if (config.get('isTestRoutesEnabled')) {
        server.route(testSpreadsheetRoutes)
      }
    }
  }
}

export { router }
