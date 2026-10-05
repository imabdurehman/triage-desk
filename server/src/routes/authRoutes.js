import { Router } from "express";
import * as c from "../controllers/authController.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { validate } from "../middleware/validate.js";
import { requireAuth } from "../middleware/authMiddleware.js";
import { authLimiter } from "../middleware/rateLimit.js";
import { registerSchema, loginSchema } from "../validators/authValidators.js";

const r = Router();
r.post(
  "/register",
  authLimiter,
  validate({ body: registerSchema }),
  asyncHandler(c.register),
);
r.post(
  "/login",
  authLimiter,
  validate({ body: loginSchema }),
  asyncHandler(c.login),
);
r.post("/refresh", asyncHandler(c.refresh));
r.post("/logout", requireAuth, asyncHandler(c.logout));
r.get("/me", requireAuth, asyncHandler(c.me));
export default r;
