import { ApiError } from "../utils/ApiError.js";

// Use after requireAuth:  router.get('/', requireAuth, requireRole('manager'), handler)
export const requireRole =
  (...roles) =>
  (req, _res, next) => {
    if (!req.user) return next(ApiError.unauthorized());
    if (!roles.includes(req.user.role)) return next(ApiError.forbidden());
    next();
  };
