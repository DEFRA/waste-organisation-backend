export const coerceRegistrationNumberWhenReasonSupplied = (movement) => {
  if (movement?.carrier?.reasonForNoRegistrationNumber && movement?.carrier?.registrationNumber == null) {
    movement.carrier.registrationNumber = ''
  }
  return movement
}

export const validateWasteTrackingIdExists = (errColNum) => (movement) => {
  if (!movement.wasteTrackingId) {
    const e = new Error('Waste Tracking ID is required')
    e.colNumber = errColNum
    throw e
  }
  return movement
}

export const validateWasteTrackingIdMissing = (errColNum) => (movement) => {
  if (movement.wasteTrackingId) {
    const e = new Error('Waste Tracking ID must not be present on a create upload')
    e.colNumber = errColNum
    throw e
  }
  return movement
}

export const validateMovementHasWasteItems = (errColNum) => (movement) => {
  if (movement.yourUniqueReference && (!Array.isArray(movement.wasteItems) || movement.wasteItems.length <= 0)) {
    const e = new Error('No waste items for unique reference')
    e.colNumber = errColNum
    throw e
  }
  return movement
}

export const validateUniqueReference = (errColNum) => {
  const seenUniqueRefs = new Set()
  return (movement) => {
    if (movement.yourUniqueReference && seenUniqueRefs.has(movement.yourUniqueReference)) {
      const e = new Error('Duplicate reference')
      e.colNumber = errColNum

      throw e
    } else {
      seenUniqueRefs.add(movement.yourUniqueReference)
      return movement
    }
  }
}

export const populateWholeItemDisposalCodes = (movement) => {
  const wasteItems =
    movement?.wasteItems?.map((i) => {
      if (i?.disposalOrRecoveryCodes?.length === 1) {
        const disposalOrRecoveryCodes = i.disposalOrRecoveryCodes.map((c) => {
          if (c.weight === `whole item`) {
            c.weight = i.weight
          }
          return c
        })
        return { ...i, disposalOrRecoveryCodes }
      } else {
        return i
      }
    }) ?? []
  return { ...movement, wasteItems }
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
