import { ApiError } from '../utils/ApiError.js';

// validate({ body: schema, query: schema, params: schema })
// Parsed values replace the raw ones, so controllers only ever see clean input.
export const validate = (schemas) => (req, _res, next) => {
  for (const part of ['params', 'query', 'body']) {
    const schema = schemas[part];
    if (!schema) continue;
    const result = schema.safeParse(req[part] ?? {});
    if (!result.success) {
      const details = Object.fromEntries(
        result.error.issues.map((i) => [i.path.join('.') || part, i.message]),
      );
      return next(ApiError.badRequest('Invalid request', details));
    }
    if (part === 'query') req.validatedQuery = result.data;
    else req[part] = result.data;
  }
  next();
};
