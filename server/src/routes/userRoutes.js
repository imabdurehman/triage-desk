import { Router } from "express";
import * as c from "../controllers/userController.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { validate } from "../middleware/validate.js";
import { requireAuth } from "../middleware/authMiddleware.js";
import { requireRole } from "../middleware/roleMiddleware.js";
import { idParam } from "../validators/ticketValidators.js";
import {
  createUserSchema,
  updateUserSchema,
  listUsersSchema,
} from "../validators/userValidators.js";

const r = Router();
r.use(requireAuth, requireRole("manager"));
r.get("/", validate({ query: listUsersSchema }), asyncHandler(c.list));
r.post("/", validate({ body: createUserSchema }), asyncHandler(c.create));
r.patch(
  "/:id",
  validate({ params: idParam, body: updateUserSchema }),
  asyncHandler(c.update),
);
export default r;
