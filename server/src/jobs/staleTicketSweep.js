// Hourly: close tickets nobody will act on. A customer who never replied, or a
// resolution nobody disputed, should not sit in the queue forever.
import { Ticket } from '../models/Ticket.js';
import { env } from '../config/env.js';

export const name = 'staleTicketSweep';
export const schedule = '0 * * * *';

const DAY = 24 * 60 * 60 * 1000;

async function closeWhere(filter, note, now) {
  const tickets = await Ticket.find(filter);
  for (const t of tickets) {
    t.history.push({ action: 'status', from: t.status, to: 'closed', note });
    t.status = 'closed';
    t.closedAt = now;
    await t.save();
  }
  return tickets.length;
}

export async function run(now = new Date()) {
  const noReply = await closeWhere(
    { status: 'waiting_customer', waitingSince: { $lt: new Date(now - env.staleWaitingDays * DAY) } },
    `no customer reply in ${env.staleWaitingDays} days`,
    now,
  );
  const resolved = await closeWhere(
    { status: 'resolved', resolvedAt: { $lt: new Date(now - env.autoCloseResolvedDays * DAY) } },
    `resolved ${env.autoCloseResolvedDays} days ago with no follow-up`,
    now,
  );
  return { closedNoReply: noReply, closedResolved: resolved };
}
