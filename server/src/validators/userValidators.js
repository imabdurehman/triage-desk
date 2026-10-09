import { z } from "zod";
import { CATEGORIES, ROLES } from "../config/contract.js";

export const createUserSchema = z.object({
  name: z.string().trim().min(2).max(100),
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8).max(128),
  role: z
    .enum(ROLES)
    .refine((r) => r !== "customer", "Customers register themselves"),
  categories: z.array(z.enum(CATEGORIES)).optional().default([]),
});

export const updateUserSchema = z
  .object({
    email: z.string().trim().toLowerCase().email().optional(),
    role: z.enum(ROLES).optional(),
    active: z.boolean().optional(),
    categories: z.array(z.enum(CATEGORIES)).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "Nothing to update" });

export const listUsersSchema = z.object({ role: z.enum(ROLES).optional() });
