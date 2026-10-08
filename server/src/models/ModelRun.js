import mongoose from "mongoose";

// One record per training run requested from the ML service.
const modelRunSchema = new mongoose.Schema(
  {
    runId: { type: String, required: true, unique: true },
    trigger: { type: String, enum: ["manual", "scheduled"], required: true },
    status: {
      type: String,
      enum: ["started", "succeeded", "failed"],
      default: "started",
    },
    modelVersion: { type: String, default: null },
    promoted: { type: Boolean, default: false },
    metrics: { type: mongoose.Schema.Types.Mixed, default: null },
    error: { type: String, default: null },
    finishedAt: Date,
  },
  { timestamps: true },
);

export const ModelRun =
  mongoose.models.ModelRun || mongoose.model("ModelRun", modelRunSchema);
