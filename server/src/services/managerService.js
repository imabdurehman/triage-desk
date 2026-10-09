import { Ticket } from '../models/Ticket.js';
import { ACTIVE_STATUSES } from '../config/contract.js';
import { JobRun } from '../models/JobRun.js';
import { ModelRun } from '../models/ModelRun.js';
import { User } from '../models/User.js';
import { env } from '../config/env.js';
import { ApiError } from '../utils/ApiError.js';
import * as ml from './mlService.js';
import { confirmedTickets } from './trainingDataService.js';
import { greeting, send } from './mailService.js';

const countBy = (field, match = {}) =>
  Ticket.aggregate([{ $match: match }, { $group: { _id: `$${field}`, n: { $sum: 1 } } }]).then(
    (rows) => Object.fromEntries(rows.map((r) => [r._id ?? 'none', r.n])),
  );

export async function metrics() {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const [byStatus, openMatrix, openBreached, needsTriage, reviewed, overridden, resolved] =
    await Promise.all([
      countBy('status'),
      // Open tickets by category AND priority: the dashboard's 3D chart. A null
      // category is a ticket still waiting for triage.
      Ticket.aggregate([
        { $match: { status: { $in: ACTIVE_STATUSES } } },
        { $group: { _id: { category: '$category', priority: '$priority' }, count: { $sum: 1 } } },
      ]).then((rows) => rows.map((r) => ({
        category: r._id.category ?? null, priority: r._id.priority, count: r.count,
      }))),
      // Overdue right now, whether or not the 5-minute escalation job has flagged it
      // yet, so this always agrees with the "Overdue by" shown in the queue.
      Ticket.countDocuments({
        status: { $in: ACTIVE_STATUSES },
        $or: [{ slaBreached: true }, { slaDueAt: { $lt: new Date() } }],
      }),
      Ticket.countDocuments({ needsTriage: true, status: { $ne: 'closed' } }),
      // Only tickets a person actually looked at: auto-routed tickets nobody checked
      // would make the model look better than anyone knows it to be.
      Ticket.countDocuments({ predictedCategory: { $ne: null }, 'history.action': 'triaged' }),
      Ticket.countDocuments({ overriddenBy: { $ne: null } }),
      Ticket.find({ resolvedAt: { $gte: since } }).select('createdAt resolvedAt').lean(),
    ]);

  const hours = resolved.map((t) => (t.resolvedAt - t.createdAt) / 3_600_000);
  const avgResolutionHours = hours.length
    ? Math.round((hours.reduce((a, b) => a + b, 0) / hours.length) * 10) / 10
    : null;

  return {
    byStatus,
    openMatrix,
    openBreached,
    needsTriage,
    model: {
      // Of the predictions a person reviewed, how often they changed it. Lower is better.
      overrideRate: reviewed ? Math.round((overridden / reviewed) * 1000) / 1000 : null,
      reviewedTickets: reviewed,
      overridden,
    },
    avgResolutionHours,
    resolvedLast30Days: resolved.length,
  };
}

export const recentJobRuns = (limit = 30) =>
  JobRun.find().sort({ startedAt: -1 }).limit(limit).lean();

/**
 * Recent training runs. Runs still marked "started" are refreshed from the ML
 * service first, so the dashboard shows whether each finished and was promoted.
 */
export async function recentModelRuns(limit = 20) {
  const pending = await ModelRun.find({ status: 'started' });
  await Promise.all(pending.map(async (run) => {
    try {
      const r = await ml.runStatus(run.runId);
      if (r.status === 'started') return;
      Object.assign(run, {
        status: r.status,
        modelVersion: r.version ?? null,
        promoted: Boolean(r.promoted),
        metrics: r.metrics ?? null,
        error: r.error ?? null,
        finishedAt: r.finishedAt ? new Date(r.finishedAt) : new Date(),
      });
      await run.save();
    } catch {
      // ML service unreachable: leave the run as it is and try again next time.
    }
  }));
  return ModelRun.find().sort({ createdAt: -1 }).limit(limit).lean();
}

/** The most recent daily digest (yesterday in numbers), or null before the first one. */
export const latestDigest = async () =>
  (await JobRun.findOne({ job: 'dailyDigest', status: 'succeeded' }).sort({ startedAt: -1 }).lean())?.result ?? null;

/**
 * Sends every human-confirmed ticket to the ML service, starts a training run and
 * records it. Used by "Retrain now" (manual) and the 02:00 job (scheduled).
 */
export async function startTraining(trigger) {
  const tickets = await confirmedTickets();
  const run = await ml.train(tickets); // throws ApiError(502) if the ML service is down
  await ModelRun.create({ runId: run.runId, trigger, status: 'started' });
  return { ...run, confirmedTickets: tickets.length };
}

/** Sends one email to this user, to check the mail settings; the mail server's reason if it refuses. */
export async function sendTestEmail(userId) {
  const me = await User.findById(userId).select('name email').lean();
  try {
    await send([me.email], 'TriageDesk test email', [
      greeting(me.name), 'This is a test email from TriageDesk. If you can read it, email is set up correctly.',
    ]);
  } catch (err) {
    throw new ApiError(502, 'MAIL_FAILED', `The mail server refused the email: ${err.message}`);
  }
  return { sentTo: me.email, smtpConfigured: Boolean(env.smtpUrl) };
}
