import bcrypt from 'bcryptjs';
import { User } from '../models/User.js';
import { ApiError } from '../utils/ApiError.js';
import {
  hashTokenId,
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
} from '../utils/tokens.js';

const BCRYPT_ROUNDS = 12;

export const hashPassword = (plain) => bcrypt.hash(plain, BCRYPT_ROUNDS);

async function issueTokens(user) {
  const accessToken = signAccessToken(user);
  const { token: refreshToken, jti } = signRefreshToken(user);
  // Only one refresh token is valid per user at a time. Storing its hash, not
  // the token, means a database leak does not hand out working sessions.
  await User.updateOne({ _id: user._id }, { refreshTokenHash: hashTokenId(jti) });
  return { accessToken, refreshToken };
}

export async function register({ name, email, password }) {
  if (await User.exists({ email })) {
    throw ApiError.conflict('EMAIL_TAKEN', 'An account with this email already exists');
  }
  // Public sign-up is always a customer. Staff accounts are created by a manager.
  const user = await User.create({
    name,
    email,
    passwordHash: await hashPassword(password),
    role: 'customer',
  });
  return { user: user.toSafeJSON(), ...(await issueTokens(user)) };
}

export async function login({ email, password }) {
  const user = await User.findOne({ email }).select('+passwordHash');
  // Same message for unknown email and wrong password: don't reveal which exists.
  const valid = user && (await bcrypt.compare(password, user.passwordHash));
  if (!valid) throw new ApiError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect');
  if (!user.active) throw new ApiError(403, 'ACCOUNT_INACTIVE', 'This account has been deactivated');
  return { user: user.toSafeJSON(), ...(await issueTokens(user)) };
}

/**
 * Rotation with reuse detection. Each refresh token works exactly once. If an
 * already-used token comes back, someone has a copy of it, so every session
 * for that user is revoked and they must log in again.
 */
export async function refresh(refreshToken) {
  if (!refreshToken) throw new ApiError(401, 'NO_REFRESH_TOKEN', 'Not signed in');

  let payload;
  try {
    payload = verifyRefreshToken(refreshToken);
  } catch {
    throw new ApiError(401, 'INVALID_REFRESH_TOKEN', 'Session expired, please sign in again');
  }

  const user = await User.findById(payload.sub).select('+refreshTokenHash');
  if (!user || !user.active) {
    throw new ApiError(401, 'INVALID_REFRESH_TOKEN', 'Session expired, please sign in again');
  }

  if (user.refreshTokenHash !== hashTokenId(payload.jti)) {
    await User.updateOne({ _id: user._id }, { refreshTokenHash: null });
    throw new ApiError(401, 'REFRESH_TOKEN_REUSED', 'Session invalidated, please sign in again');
  }

  return { user: user.toSafeJSON(), ...(await issueTokens(user)) };
}

export async function logout(userId) {
  await User.updateOne({ _id: userId }, { refreshTokenHash: null });
}

export async function me(userId) {
  const user = await User.findById(userId);
  if (!user) throw ApiError.notFound('User');
  return user.toSafeJSON();
}
