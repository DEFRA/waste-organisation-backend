export const scheduledTasksCollection = 'scheduledTasks'

export const createScheduledTasksIndexes = async (db) => {
  await db.collection(scheduledTasksCollection).createIndex({ name: 1 })
}

export const findScheduledTaskByName = (db, name) => {
  return db.collection(scheduledTasksCollection).findOne({ name: { $eq: name } }, { projection: { _id: 0 } })
}
