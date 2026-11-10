export const scheduledTasksCollection = 'scheduledTasks'

export const findScheduledTaskByName = (db, name) => {
  return db.collection(scheduledTasksCollection).findOne({ name: { $eq: name } }, { projection: { _id: 0 } })
}
