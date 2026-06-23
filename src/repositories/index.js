import { createLogger } from '../common/helpers/logging/logger.js'

const logger = createLogger()

const setCreatedAtIfMissing = (doc) => (updatedDoc) => {
  if (updatedDoc) {
    delete updatedDoc['version']
    if (doc?.createdAt == null) {
      updatedDoc.createdAt = doc?._id ? doc._id.getTimestamp() : new Date()
    }
  }
  return updatedDoc
}

export const updateWithOptimisticLock = async (collection, query, updateFunction, maxRetries = 5) => {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const doc = await collection.findOne(query)
    const version = doc ? doc.version : { $exists: false }
    const updatedDoc = setCreatedAtIfMissing(doc)(updateFunction(doc || query))
    if (updatedDoc) {
      const result = await collection.findOneAndUpdate(
        { ...query, version },
        {
          $set: { ...updatedDoc, updatedAt: new Date() },
          $inc: { version: 1 }
        },
        { returnDocument: 'after', upsert: true }
      )
      if (result) {
        delete result['_id']
        return result
      }
      logger.warn(`Optimistic lock conflict, retrying... (attempt ${attempt + 1})`)
    } else {
      return null
    }
  }
  throw new Error('Max retries exceeded - too much contention')
}
