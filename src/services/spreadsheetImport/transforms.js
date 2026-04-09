export const coerceRegistrationNumberWhenReasonSupplied = (movement) => {
  if (movement?.carrier?.reasonForNoRegistrationNumber && movement?.carrier?.registrationNumber == null) {
    movement.carrier.registrationNumber = ''
  }
  return movement
}

export const validateWasteTrackingIdExists = (movement) => {
  if (!movement.wasteTrackingId) {
    throw new Error('Waste Tracking ID is required')
  }
  return movement
}

export const validateWasteTrackingIdMissing = (movement) => {
  if (movement.wasteTrackingId) {
    throw new Error('Waste Tracking ID must not be present on a create upload')
  }
  return movement
}

export const validateMovementHasWasteItems = (movement) => {
  if (movement.yourUniqueReference && (!Array.isArray(movement.wasteItems) || movement.wasteItems.length <= 0)) {
    const e = new Error('No waste items for unique reference')
    e.colNumber = 3
    throw e
  }
  return movement
}

export const validateUniqueReference = () => {
  const seenUniqueRefs = new Set()
  return (movement) => {
    if (movement.yourUniqueReference && seenUniqueRefs.has(movement.yourUniqueReference)) {
      const e = new Error('Duplicate reference')
      e.colNumber = 3
      throw e
    } else {
      seenUniqueRefs.add(movement.yourUniqueReference)
      return movement
    }
  }
}

const flattenErrors = (e) => {
  if (e.collectedErrors) {
    return e.collectedErrors.flatMap(flattenErrors)
  } else {
    return [e]
  }
}

export const compose = (...fns) => {
  const composed = (es) =>
    fns
      .filter((f) => typeof f === 'function')
      .reduceRight(
        ({ f, errors }, fn) => ({
          f: (x) => {
            try {
              return fn(f(x))
            } catch (e) {
              errors.push(e)
              return x
            }
          },
          errors
        }),
        { errors: es, f: (x) => x }
      )
  return (x) => {
    const { errors, f } = composed([])
    const result = f(x)
    if (errors.length > 0) {
      const e = new Error('Collected Errors')
      e.collectedErrors = errors.flatMap(flattenErrors)
      throw e
    }
    return result
  }
}
