import mongoose from 'mongoose';

// One record per scheduled job execution. The manager dashboard reads these.
const jobRunSchema = new mongoose.Schema(
  {
    job: { type: String, required: true, index: true },
    status: { type: String, enum: ['running', 'succeeded', 'failed'], default: 'running' },
    trigger: { type: String, enum: ['schedule', 'manual'], default: 'schedule' },
    startedAt: { type: Date, default: Date.now },
    finishedAt: Date,
    durationMs: Number,
    result: { type: mongoose.Schema.Types.Mixed, default: null },
    error: { type: String, default: null },
  },
  { timestamps: false },
);

jobRunSchema.index({ job: 1, startedAt: -1 });

export const JobRun = mongoose.models.JobRun || mongoose.model('JobRun', jobRunSchema);
