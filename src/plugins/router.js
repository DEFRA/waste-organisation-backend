import { health } from '../routes/health.js'
import { organisations } from '../routes/organisation.js'
import { spreadsheet } from '../routes/spreadsheet.js'

const router = {
  plugin: {
    name: 'router',
    register: (server, _options) => {
      server.route([health, ...organisations, ...spreadsheet])
    }
  }
}

export { router }
