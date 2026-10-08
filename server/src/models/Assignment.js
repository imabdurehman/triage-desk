import mongoose from "mongoose";

// Append-only log of who a ticket was given to, and how.
const assignmentSchema = new mongoose.Schema(
  {
    ticket: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Ticket",
      required: true,
      index: true,
    },
    agent: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    assignedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    }, // null = auto
    method: { type: String, enum: ["auto", "manual"], required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

export const Assignment =
  mongoose.models.Assignment || mongoose.model("Assignment", assignmentSchema);
