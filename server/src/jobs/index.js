// Registers the five jobs with node-cron and records every run in JobRun.
// A job never overlaps with itself: if the previous run is still going, the
// next tick is skipped rather than stacked.
import cron from 'node-cron';
import { JobRun } from '../models/JobRun.js';
import * as slaEscalation from './slaEscalation.js';
import * as staleTicketSweep from './staleTicketSweep.js';
import * as nightlyRetrain from './nightlyRetrain.js';
import * as dailyDigest from './dailyDigest.js';
import * as attachmentCleanup from './attachmentCleanup.js';

const JOBS = [slaEscalation, staleTicketSweep, nightlyRetrain, dailyDigest, attachmentCleanup];
export const JOB_NAMES = JOBS.map((j) => j.name);

const running = new Set();
const tasks = [];

async function execute(job, trigger) {
  if (running.has(job.name)) return { job: job.name, status: 'skipped', reason: 'already running' };
  running.add(job.name);
  const started = Date.now();
  const record = await JobRun.create({ job: job.name, trigger, startedAt: new Date(started) });
  try {
    const result = await job.run();
    Object.assign(record, { status: 'succeeded', result });
    return { job: job.name, status: 'succeeded', result };
  } catch (err) {
    Object.assign(record, { status: 'failed', error: err.message });
    console.error(`[jobs] ${job.name} failed: ${err.message}`);
    return { job: job.name, status: 'failed', error: err.message };
  } finally {
    record.finishedAt = new Date();
    record.durationMs = Date.now() - started;
    await record.save().catch(() => {});
    running.delete(job.name);
  }
}

export function startScheduler() {
  for (const job of JOBS) {
    if (!cron.validate(job.schedule)) throw new Error(`Invalid schedule for ${job.name}`);
    tasks.push(cron.schedule(job.schedule, () => execute(job, 'schedule')));
  }
  console.log(`[jobs] scheduled: ${JOBS.map((j) => `${j.name} (${j.schedule})`).join(', ')}`);
}

export function stopScheduler() {
  tasks.splice(0).forEach((t) => t.stop());
}

export function runJobNow(name) {
  const job = JOBS.find((j) => j.name === name);
  if (!job) throw new Error(`Unknown job ${name}`);
  return execute(job, 'manual');
}

