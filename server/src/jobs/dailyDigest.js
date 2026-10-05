// 08:00: yesterday in numbers, emailed to every manager and shown on the overview.
import { Ticket } from '../models/Ticket.js';
import { ACTIVE_STATUSES } from '../config/contract.js';
import { managerEmails, send } from '../services/mailService.js';
import { env } from '../config/env.js';

export const name = 'dailyDigest';
export const schedule = '0 8 * * *';

export async function run(now = new Date()) {
  const end = new Date(now);
  end.setHours(0, 0, 0, 0);
  const start = new Date(end.getTime() - 24 * 60 * 60 * 1000);
  const inDay = { $gte: start, $lt: end };
  const [created, resolved, breached, stillOpen] = await Promise.all([
    Ticket.countDocuments({ createdAt: inDay }),
    Ticket.countDocuments({ resolvedAt: inDay }),
    Ticket.countDocuments({ slaBreachedAt: inDay }),
    Ticket.countDocuments({ status: { $in: ACTIVE_STATUSES } }),
  ]);
  const digest = { date: start.toISOString().slice(0, 10), created, resolved, breached, stillOpen };
  await send(await managerEmails(), `TriageDesk ${digest.date}: ${created} new, ${resolved} resolved`, [
    `Yesterday, ${digest.date}:`,
    `New tickets: ${created}\nResolved: ${resolved}\nMissed their SLA: ${breached}\nStill open this morning: ${stillOpen}`,
  ], { label: 'Open the overview', url: `${env.clientOrigin}/manager` });
  return digest;
}
