import { User } from "../models/User.js";
import { ApiError } from "../utils/ApiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { verifyAccessToken } from "../utils/tokens.js";

// Verifies the Bearer access token and loads the user, so a deactivated
// account loses access immediately rather than when its token expires.
export const requireAuth = asyncHandler(async (req, _res, next) => {
  const header = req.headers.authorization ?? "";
  const [scheme, token] = header.split(" ");
  if (scheme !== "Bearer" || !token) throw ApiError.unauthorized();

  let payload;
  try {
    payload = verifyAccessToken(token);
  } catch (err) {
    throw new ApiError(
      401,
      err.name === "TokenExpiredError" ? "TOKEN_EXPIRED" : "INVALID_TOKEN",
      err.name === "TokenExpiredError"
        ? "Access token expired"
        : "Invalid access token",
    );
  }

  const user = await User.findById(payload.sub)
    .select("name role active")
    .lean();
  if (!user || !user.active)
    throw new ApiError(401, "ACCOUNT_INACTIVE", "Account is not active");

  req.user = { id: user._id.toString(), role: user.role, name: user.name };
  next();
});
