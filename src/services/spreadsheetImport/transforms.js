export const coerceRegistrationNumberWhenReasonSupplied = (movement) => {
  if (movement?.carrier?.reasonForNoRegistrationNumber && movement?.carrier?.registrationNumber == null) {
    movement.carrier.registrationNumber = ''
  }
  return movement
}

export const validateWasteTrackingIdExists = (movement) => {
  if (!movement.wasteTrackingId) {
    throw Error('Waste Tracking ID is required')
  }
  return movement
}

export const validateWasteTrackingIdMissing = (movement) => {
  if (movement.wasteTrackingId) {
    throw Error('Waste Tracking ID must not be present on a create upload')
  }
  return movement
}

export const compose = (...fns) => {
  return fns
    .filter((f) => typeof f === 'function')
    .reduceRight(
      (composed, fn) => (x) => fn(composed(x)),
      (x) => x
    )
}
