import { addUserConnection, updateUserConnection } from './organisation.js'
import { createLogger } from '../common/helpers/logging/logger.js'

const logger = createLogger()

const defaultHandler = (message) => {
  logger.info('Cannot handle message with metadata:', message?.metadata)
}

const noop = (_org, _msg) => {}

// TODO do we need this?
const updateDefraLobServiceuserLink = (org, { recorddata }) => {
  const o = { ...org }
  if (recorddata?.account?.accountid) {
    o.organisationId = recorddata.account.accountid
  }
  if (recorddata?.account?.name) {
    o.name = recorddata.account.name
  }
  return convertConnections(recorddata?.connections)
    .filter((userId) => userId)
    .reduce(updateUserConnection, o)
}

const saveAccount = (org, { recorddata }) => {
  return {
    ...org,
    name: recorddata.account.name,
    organisationId: recorddata.account.accountid
  }
}

const convertConnections = (connections) =>
  (connections || []).map(
    ({
      connectionid,
      record1id,
      record2id,
      record1id_type,
      record2id_type
    }) => {
      let userId = null
      if (record1id_type === 'contact' && record2id_type === 'account') {
        userId = record1id
      } else if (record2id_type === 'contact' && record1id_type === 'account') {
        userId = record2id
      }
      return {
        id: connectionid,
        userId
      }
    }
  )

const createDefraLobServiceuserLink = (org, { recorddata }) => {
  return convertConnections(recorddata?.connections)
    .filter((userId) => userId)
    .reduce(addUserConnection, {
      ...org,
      organisationId: recorddata.account.accountid,
      name: recorddata.account.name,
      users: org?.users
    })
}

const updateConnection = (org, { recorddata }) => {
  return convertConnections(recorddata?.connections).reduce(
    updateUserConnection,
    org
  )
}

const findByOrgId = (_message) => {
  return {}
}

const findByConnectionId = (_message) => {
  return {}
}

const skipMessage = (_message) => null

const dispatcher = {
  account: {
    update: { func: saveAccount, query: findByOrgId }
  },
  defra_addressdetails: {
    update: { func: noop, query: skipMessage },
    create: { func: noop, query: skipMessage }
  },
  contact: {
    update: { func: noop, query: skipMessage }
  },
  defra_lobserviceuserlink: {
    update: { func: updateDefraLobServiceuserLink, query: findByOrgId },
    create: { func: createDefraLobServiceuserLink, query: findByOrgId }
  },
  connection: {
    update: { func: updateConnection, query: findByConnectionId }
  }
}

export const transformMessage = (organisation, message) => {
  const entity = message?.metadata?.entity
  const operationType = message?.metadata?.operationtype
  // TODO validate and handle errors
  if (dispatcher[entity] && dispatcher[entity][operationType]) {
    return dispatcher[entity][operationType].func(organisation, message)
  } else {
    return defaultHandler(message)
  }
}

export const findOrgQuery = (message) => {
  const entity = message?.metadata?.entity
  const operationType = message?.metadata?.operationtype
  if (dispatcher[entity] && dispatcher[entity][operationType]) {
    return dispatcher[entity][operationType].query
  } else {
    return null
  }
}
