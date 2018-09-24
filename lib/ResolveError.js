class ResolveError extends Error {
  /**
   *
   * @param {string} error - one of ResolveError GraphQL Enum
   * @param {Error} originalError - the original error
   */
  constructor(error, originalError) {
    super(originalError);
    this.returnedError = error;
  }
}

module.exports = ResolveError;
