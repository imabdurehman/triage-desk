import mongoose from "mongoose";
import { CATEGORIES, PRIORITIES, STATUSES } from "../config/contract.js";

const { Schema } = mongoose;
const ref = (model) => ({ type: Schema.Types.ObjectId, ref: model });

const commentSchema = new Schema(
  {
    author: { ...ref("User"), required: true },
    body: { type: String, required: true, trim: true, maxlength: 10_000 },
    // Internal notes are visible to agents and managers only.
    internal: { type: Boolean, default: false },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

const historySchema = new Schema(
  {
    action: { type: String, required: true },
    by: { ...ref("User"), default: null }, // null = system (scheduler, ML)
    from: Schema.Types.Mixed,
    to: Schema.Types.Mixed,
    note: String,
    at: { type: Date, default: Date.now },
  },
  { _id: false },
);

// An image attached to the ticket. The file lives in UPLOAD_DIR under `filename`.
const attachmentSchema = new Schema(
  {
    filename: { type: String, required: true },
    mimetype: { type: String, required: true },
    size: Number,
    uploadedBy: ref("User"),
    uploadedAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

const ticketSchema = new Schema(
  {
    subject: { type: String, required: true, trim: true, maxlength: 300 },
    body: { type: String, required: true, trim: true, maxlength: 20_000 },
    customer: { ...ref("User"), required: true, index: true },
    status: { type: String, enum: STATUSES, default: "open", index: true },

    // What the system acts on.
    category: {
      type: String,
      enum: [...CATEGORIES, null],
      default: null,
      index: true,
    },
    priority: {
      type: String,
      enum: PRIORITIES,
      default: "medium",
      index: true,
    },

    // What the model said. Kept separately so overrides can be measured.
    predictedCategory: {
      type: String,
      enum: [...CATEGORIES, null],
      default: null,
    },
    predictedPriority: {
      type: String,
      enum: [...PRIORITIES, null],
      default: null,
    },
    predictionConfidence: {
      category: { type: Number, min: 0, max: 1, default: 0 },
      priority: { type: Number, min: 0, max: 1, default: 0 },
    },
    modelVersion: { type: String, default: null },
    needsTriage: { type: Boolean, default: false, index: true },
    overriddenBy: { ...ref("User"), default: null },

    assignedAgent: { ...ref("User"), default: null, index: true },
    slaDueAt: { type: Date, index: true },
    slaBreached: { type: Boolean, default: false, index: true },
    slaBreachedAt: Date,
    slaWarnedAt: { type: Date, default: null }, // the "SLA nearly due" email went out
    waitingSince: { type: Date, default: null }, // SLA clock paused while waiting on the customer
    resolution: { type: String, trim: true, maxlength: 1000 }, // how it was fixed, shown to the customer
    resolvedAt: Date,
    closedAt: Date,

    comments: [commentSchema],
    history: [historySchema],
    attachments: [attachmentSchema],
  },
  { timestamps: true },
);

ticketSchema.index({ status: 1, slaDueAt: 1 });
ticketSchema.index({ assignedAgent: 1, status: 1 });

export const Ticket =
  mongoose.models.Ticket || mongoose.model("Ticket", ticketSchema);
