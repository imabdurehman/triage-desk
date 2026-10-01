// Throw this for every expected error. The error middleware turns it into
// the contract format: { error: { code, message, details } }
export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }

  static badRequest(message = 'Invalid request', details) {
    return new ApiError(400, 'VALIDATION_ERROR', message, details);
  }
  static unauthorized(message = 'Authentication required') {
    return new ApiError(401, 'UNAUTHORIZED', message);
  }
  static forbidden(message = 'You do not have permission to do this') {
    return new ApiError(403, 'FORBIDDEN', message);
  }
  static notFound(what = 'Resource') {
    const code = `${what.toUpperCase().replace(/\s+/g, '_')}_NOT_FOUND`;
    return new ApiError(404, code, `${what} not found`);
  }
  static conflict(code, message) {
    return new ApiError(409, code, message);
  }
}
