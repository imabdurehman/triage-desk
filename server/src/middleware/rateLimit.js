import rateLimit from 'express-rate-limit';
import { env } from '../config/env.js';

// Slows password guessing. Disabled in tests so suites can log in freely.
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: () => env.isTest,
  handler: (_req, res) =>
    res.status(429).json({
      error: { code: 'TOO_MANY_REQUESTS', message: 'Too many attempts, try again in 15 minutes' },
    }),
});
