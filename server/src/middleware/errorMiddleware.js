import mongoose from 'mongoose';
import { ApiError } from '../utils/ApiError.js';
import { env } from '../config/env.js';

export function notFound(req, _res, next) {
  next(new ApiError(404, 'ROUTE_NOT_FOUND', `No route for ${req.method} ${req.originalUrl}`));
}

// Converts every error - ours, Mongoose's, JSON parse errors - into the contract shape.
export function errorHandler(err, req, res, _next) {
  let status = 500;
  let code = 'INTERNAL_ERROR';
  let message = 'Something went wrong';
  let details;

  if (err instanceof ApiError) {
    ({ status, code, message, details } = err);
  } else if (err instanceof mongoose.Error.ValidationError) {
    status = 400;
    code = 'VALIDATION_ERROR';
    message = 'Invalid data';
    details = Object.fromEntries(Object.entries(err.errors).map(([k, v]) => [k, v.message]));
  } else if (err instanceof mongoose.Error.CastError) {
    status = 400;
    code = 'INVALID_ID';
    message = `Invalid ${err.path}`;
  } else if (err?.code === 11000) {
    status = 409;
    code = 'DUPLICATE';
    message = `${Object.keys(err.keyValue ?? {}).join(', ') || 'Value'} already exists`;
  } else if (err?.name === 'MulterError') {
    status = 400;
    code = 'VALIDATION_ERROR';
    message = {
      LIMIT_FILE_SIZE: 'Each image must be 2 MB or smaller',
      LIMIT_FILE_COUNT: 'Upload at most 3 images at a time',
    }[err.code] ?? 'Upload images in the "images" field';
  } else if (err?.type === 'entity.parse.failed') {
    status = 400;
    code = 'INVALID_JSON';
    message = 'Request body is not valid JSON';
  }

  if (status >= 500 && !env.isTest) {
    console.error(`[error] ${req.method} ${req.originalUrl}`, err);
  }

  const body = { error: { code, message } };
  if (details !== undefined) body.error.details = details;
  if (status >= 500 && !env.isProduction && err?.stack) body.error.stack = err.stack;

  res.status(status).json(body);
}
