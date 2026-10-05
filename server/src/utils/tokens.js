import jwt from 'jsonwebtoken';
import { createHash, randomUUID } from 'node:crypto';
import { env } from '../config/env.js';

export const REFRESH_COOKIE = 'td_refresh';

export const hashTokenId = (id) => createHash('sha256').update(id).digest('hex');

export function signAccessToken(user) {
  return jwt.sign({ sub: user._id.toString(), role: user.role }, env.jwtAccessSecret, {
    expiresIn: env.accessTokenTtl,
  });
}

/** Returns the token and the id it carries. Only the HASH of the id is stored. */
export function signRefreshToken(user) {
  const jti = randomUUID();
  const token = jwt.sign({ sub: user._id.toString(), jti }, env.jwtRefreshSecret, {
    expiresIn: `${env.refreshTokenTtlDays}d`,
  });
  return { token, jti };
}

export const verifyAccessToken = (token) => jwt.verify(token, env.jwtAccessSecret);
export const verifyRefreshToken = (token) => jwt.verify(token, env.jwtRefreshSecret);

export const refreshCookieOptions = () => ({
  httpOnly: true,
  secure: env.isProduction,
  sameSite: env.isProduction ? 'strict' : 'lax',
  path: '/api/auth',
  maxAge: env.refreshTokenTtlDays * 24 * 60 * 60 * 1000,
});

/** Options for clearing the cookie. Same path/flags, no maxAge (Express warns on it). */
export const clearRefreshCookieOptions = () => {
  const { maxAge: _ignored, ...opts } = refreshCookieOptions();
  return opts;
};
