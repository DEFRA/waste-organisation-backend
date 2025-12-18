import { ensureUserInOrg } from './organisation.js'
import { createLogger } from '../common/helpers/logging/logger.js'

const logger = createLogger()

const defaultHandler = (message) => {
  logger.info('Cannot handle message with metadata:', message?.metadata)
}

// TODO do we need this?
const updateDefraAddressDetails = ({ metadata }) => {
  return {}
}

// TODO do we need this?
const createDefraAddressDetails = ({ metadata }) => {
  return { metadata }
}

// TODO do we need this?
const updateDefraLobServiceuserLink = ({ metadata }) => {
  return { metadata }
}

const saveAccount = ({ account }) => {
  return { account }
}

const saveContact = ({ metadata }) => {
  return { metadata }
}

const connectionRf = (conns, c) => {
  if (c.record1id_type === 'contact') {
    conns[c.connectionid] = c.record1id
  } else if (c.record2id_type === 'contact') {
    conns[c.connectionid] = c.record2id
  }
  return conns
}

const createDefraLobServiceuserLink = (org, { recorddata }) => {
  const connections = recorddata?.connections?.reduce(
    connectionRf,
    org?.connections || {}
  )
  return Object.values(connections).reduce(ensureUserInOrg, {
    organisationId: recorddata.account.accountid,
    name: recorddata.account.name,
    connections,
    users: org?.users
  })
}

const saveConnection = ({ metadata }) => {
  return { metadata }
}

const dispatcher = {
  account: {
    update: saveAccount,
    create: saveAccount // no create?
  },
  defra_addressdetails: {
    update: updateDefraAddressDetails,
    create: createDefraAddressDetails
  },
  contact: {
    update: saveContact,
    create: saveContact //no create?
  },
  defra_lobserviceuserlink: {
    update: updateDefraLobServiceuserLink,
    create: createDefraLobServiceuserLink
  },
  connection: {
    update: saveConnection,
    create: saveConnection // no create?
  }
}

export const transformMessage = (organisation, message) => {
  const entity = message?.metadata?.entity
  const operationType = message?.metadata?.operationtype
  if (dispatcher[entity] && dispatcher[entity][operationType]) {
    return dispatcher[entity][operationType](organisation, message)
  } else {
    return defaultHandler(message)
  }
}
