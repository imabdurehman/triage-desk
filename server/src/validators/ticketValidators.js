import { z } from "zod";
import { CATEGORIES, PRIORITIES, STATUSES } from "../config/contract.js";

export const objectId = z.string().regex(/^[a-f\d]{24}$/i, "Invalid id");
export const idParam = z.object({ id: objectId });

export const createTicketSchema = z.object({
  subject: z.string().trim().min(3, "Subject is too short").max(300),
  body: z
    .string()
    .trim()
    .min(10, "Describe the problem in a little more detail")
    .max(20_000),
});

export const listTicketsSchema = z.object({
  status: z.enum(STATUSES).optional(),
  category: z.enum(CATEGORIES).optional(),
  priority: z.enum(PRIORITIES).optional(),
  needsTriage: z
    .enum(["true", "false"])
    .transform((v) => v === "true")
    .optional(),
  // active=true: everything not yet resolved or closed. Ignored when status is given.
  active: z
    .enum(["true", "false"])
    .transform((v) => v === "true")
    .optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const statusSchema = z
  .object({
    status: z.enum(STATUSES),
    note: z.string().trim().max(1000).optional(),
  })
  .refine((v) => v.status !== "resolved" || (v.note?.length ?? 0) >= 10, {
    path: ["note"],
    message:
      "Say how it was resolved, in at least 10 characters. The customer sees this.",
  });

export const imageParams = z.object({
  id: objectId,
  filename: z
    .string()
    .regex(/^[0-9a-f-]{36}\.(png|jpg|gif|webp)$/, "Unknown image"),
});

export const assignSchema = z.object({ agentId: objectId });

export const triageSchema = z
  .object({
    category: z.enum(CATEGORIES).optional(),
    priority: z.enum(PRIORITIES).optional(),
  })
  .refine((v) => v.category || v.priority, {
    message: "Provide a category or a priority",
  });

export const commentSchema = z.object({
  body: z.string().trim().min(1, "Comment cannot be empty").max(10_000),
  internal: z.boolean().optional().default(false),
});
