// Thin HTTP layer: read the request, call authService, shape the response.
// The refresh token travels ONLY in an httpOnly cookie, never in a JSON body,
// so browser JavaScript (and therefore an XSS bug) can never read it.
import * as auth from '../services/authService.js';
import {
  REFRESH_COOKIE,
  refreshCookieOptions,
  clearRefreshCookieOptions,
} from '../utils/tokens.js';

const setRefreshCookie = (res, token) =>
  res.cookie(REFRESH_COOKIE, token, refreshCookieOptions());
const clearRefreshCookie = (res) => res.clearCookie(REFRESH_COOKIE, clearRefreshCookieOptions());

export async function register(req, res) {
  const { user, accessToken, refreshToken } = await auth.register(req.body);
  setRefreshCookie(res, refreshToken);
  res.status(201).json({ user, accessToken });
}

export async function login(req, res) {
  const { user, accessToken, refreshToken } = await auth.login(req.body);
  setRefreshCookie(res, refreshToken);
  res.json({ user, accessToken });
}

export async function refresh(req, res) {
  try {
    const { user, accessToken, refreshToken } = await auth.refresh(req.cookies?.[REFRESH_COOKIE]);
    setRefreshCookie(res, refreshToken);
    res.json({ user, accessToken });
  } catch (err) {
    clearRefreshCookie(res); // a failed refresh must not leave a dead cookie behind
    throw err;
  }
}

export async function logout(req, res) {
  await auth.logout(req.user.id);
  clearRefreshCookie(res);
  res.status(204).end();
}

export async function me(req, res) {
  res.json({ user: await auth.me(req.user.id) });
}
