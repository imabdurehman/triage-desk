import { Router } from "express";
import multer from "multer";
import * as c from "../controllers/ticketController.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { validate } from "../middleware/validate.js";
import { requireAuth } from "../middleware/authMiddleware.js";
import { requireRole } from "../middleware/roleMiddleware.js";
import * as v from "../validators/ticketValidators.js";

const r = Router();
r.use(requireAuth);

// Images only, at most 2 MB each and 3 per upload, held in memory until checked.
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMAGE_BYTES, files: 3 },
});

r.post(
  "/",
  requireRole("customer"),
  validate({ body: v.createTicketSchema }),
  asyncHandler(c.create),
);
r.get("/", validate({ query: v.listTicketsSchema }), asyncHandler(c.list));
r.get("/workload", requireRole("agent", "manager"), asyncHandler(c.workload)); // before /:id
r.get("/:id", validate({ params: v.idParam }), asyncHandler(c.get));
r.patch(
  "/:id/status",
  requireRole("agent", "manager"),
  validate({ params: v.idParam, body: v.statusSchema }),
  asyncHandler(c.updateStatus),
);
r.patch(
  "/:id/assign",
  requireRole("manager"),
  validate({ params: v.idParam, body: v.assignSchema }),
  asyncHandler(c.assign),
);
r.patch(
  "/:id/triage",
  requireRole("agent", "manager"),
  validate({ params: v.idParam, body: v.triageSchema }),
  asyncHandler(c.triage),
);
r.post(
  "/:id/comments",
  validate({ params: v.idParam, body: v.commentSchema }),
  asyncHandler(c.addComment),
);
r.post(
  "/:id/images",
  validate({ params: v.idParam }),
  upload.array("images"),
  asyncHandler(c.addImages),
);
r.get(
  "/:id/images/:filename",
  validate({ params: v.imageParams }),
  asyncHandler(c.image),
);
export default r;
