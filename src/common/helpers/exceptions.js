//@ts-check

// Signals an error in an API call that could be successfully retried
export class TransientApiError extends Error {
  /**
   * @param {string} message
   * @param {Object} o
   * @param {number | null} [o.statusCode]
   * @param {Error | null} [o.cause]
   */
  constructor(message, { statusCode, cause } = {}) {
    super(message, { cause })
    this.name = 'TransientApiError'
    this.statusCode = statusCode
  }
}

// Signals an error in an API call that won't be successfully retried
export class PermanentApiError extends Error {
  /**
   * @param {string} message
   * @param {Object} o
   * @param {number | null} [o.statusCode]
   * @param {Error | null} [o.cause]
   */
  constructor(message, { statusCode, cause } = {}) {
    super(message, { cause })
    this.name = 'PermanentApiError'
    this.statusCode = statusCode
  }
}
