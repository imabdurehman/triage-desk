// Wrap every async controller with this. It forwards rejections to the error
// middleware, so controllers never need their own try/catch.
export const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);
