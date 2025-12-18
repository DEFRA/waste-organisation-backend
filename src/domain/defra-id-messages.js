// import { mergeAndValidate } from './organisation.js'
import { createLogger } from '../common/helpers/logging/logger.js'

const logger = createLogger()

const defaultHandler = (message) => {
  logger.log('Cannot handle message with metadata:', message?.metadata)
}

const saveAccount = ({ account }) => {
  return { account }
}

const updateDefraAddressDetails = ({ metadata }) => {
  return {}
}

const createDefraAddressDetails = ({ metadata }) => {
  return { metadata }
}

const saveContact = ({ metadata }) => {
  return { metadata }
}

const updateDefraLobServiceuserLink = ({ metadata }) => {
  return { metadata }
}

const createDefraLobServiceuserLink = ({ metadata }) => {
  return { metadata }
}

const saveConnection = ({ metadata }) => {
  return { metadata }
}

const dispatcher = {
  account: { update: saveAccount, create: saveAccount /* no create? */ },
  defra_addressdetails: {
    update: updateDefraAddressDetails,
    create: createDefraAddressDetails
  },
  contact: { update: saveContact, create: saveContact /* no create? */ },
  defra_lobserviceuserlink: {
    update: updateDefraLobServiceuserLink,
    create: createDefraLobServiceuserLink
  },
  connection: {
    update: saveConnection,
    create: saveConnection /* no create? */
  }
}

export const transformMessage = (message) => {
  const entity = message?.metadata?.entity
  const operationType = message?.metadata?.operationType
  if (dispatcher[entity] && dispatcher[entity][operationType]) {
    dispatcher[entity][operationType](message)
  } else {
    defaultHandler(message)
  }
}
