import mongoose from "mongoose";
import { ROLES, CATEGORIES } from "../config/contract.js";

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 100 },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: ROLES, default: "customer", index: true },
    active: { type: Boolean, default: true },
    // For agents: which categories they handle. Empty = handles everything.
    categories: [{ type: String, enum: CATEGORIES }],
    // Hash of the id of the ONE currently valid refresh token. Rotated on every refresh.
    refreshTokenHash: { type: String, default: null, select: false },
  },
  { timestamps: true },
);

userSchema.methods.toSafeJSON = function toSafeJSON() {
  return {
    id: this._id.toString(),
    name: this.name,
    email: this.email,
    role: this.role,
    active: this.active,
    categories: this.categories ?? [],
    createdAt: this.createdAt,
  };
};

export const User = mongoose.models.User || mongoose.model("User", userSchema);
