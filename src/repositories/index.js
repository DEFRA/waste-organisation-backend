import { createLogger } from '../common/helpers/logging/logger.js'

const logger = createLogger()

export const updateWithOptimisticLock = async (
  collection,
  query,
  updateFunction,
  maxRetries = 5
) => {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const doc = await collection.findOne(query)
    const updatedDoc = updateFunction(doc || query)
    if (updatedDoc) {
      const result = await collection.findOneAndUpdate(
        {
          ...query,
          version: doc ? doc.version : { $exists: false }
        },
        {
          $set: { ...updatedDoc },
          $inc: { version: 1 }
        },
        { returnDocument: 'after', upsert: true }
      )

      if (result) {
        delete result['_id']
        return result
      }
      logger.warn(
        `Optimistic lock conflict, retrying... (attempt ${attempt + 1})`
      )
    } else {
      return null
    }
  }
  throw new Error('Max retries exceeded - too much contention')
}
