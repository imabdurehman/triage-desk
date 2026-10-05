// Every 5 minutes: warn before an SLA is missed, and escalate once it is.
//   A quarter of the window left (urgent 30 min, high 2 h, medium 6 h, low 18 h):
//     email the assigned agent, or the managers if nobody is assigned. Once per ticket.
//   Past due: mark it breached, raise its priority one step, email the managers.
// waiting_customer is left out: its clock is paused (see ticketService).
import { Ticket } from '../models/Ticket.js';
import { PRIORITIES, SLA_HOURS } from '../config/contract.js';
import { escalatePriority } from '../services/slaService.js';
import { managerEmails, send, ticketLink, ticketRef } from '../services/mailService.js';

export const name = 'slaEscalation';
export const schedule = '*/5 * * * *';

const HOUR = 60 * 60 * 1000;
const WATCHED = ['open', 'assigned', 'in_progress'];
const left = (ms) => (ms < 2 * HOUR ? `${Math.round(ms / 60_000)} minutes` : `${Math.round(ms / HOUR)} hours`);

export async function run(now = new Date()) {
  const managers = await managerEmails();
  const failed = [];
  const mail = (to, subject, t, text) =>
    send(to, `${ticketRef(t)} ${subject}`, [text], ticketLink(t)).then(() => true, (err) => failed.push(err.message) && false);

  const nearlyDue = await Ticket.find({
    status: { $in: WATCHED },
    slaWarnedAt: null,
    $or: PRIORITIES.map((p) => ({
      priority: p,
      slaDueAt: { $gt: now, $lte: new Date(now.getTime() + SLA_HOURS[p] * HOUR * 0.25) },
    })),
  }).populate('assignedAgent', 'email');
  let warned = 0;
  for (const t of nearlyDue) {
    const to = t.assignedAgent ? [t.assignedAgent.email] : managers;
    const due = left(t.slaDueAt - now);
    const text = `This ${t.priority} priority ticket must be answered within ${due}: "${t.subject}".`;
    if (await mail(to, `Due in ${due}: ${t.subject}`, t, text)) {
      t.slaWarnedAt = now;
      await t.save();
      warned += 1;
    }
  }

  const overdue = await Ticket.find({ status: { $in: WATCHED }, slaBreached: false, slaDueAt: { $lt: now } })
    .populate('assignedAgent', 'email');
  for (const t of overdue) {
    const from = t.priority;
    Object.assign(t, { slaBreached: true, slaBreachedAt: now, priority: escalatePriority(from) });
    t.history.push({ action: 'sla_breached', from, to: t.priority, note: 'escalated by scheduler' });
    await t.save();
    const to = [...new Set([...managers, t.assignedAgent?.email].filter(Boolean))];
    await mail(to, `SLA missed: ${t.subject}`, t,
      `"${t.subject}" was not answered in time. Its priority has been raised from ${from} to ${t.priority}.`);
  }

  if (failed.length) throw new Error(`${failed.length} email(s) not sent: ${failed[0]}`);
  return { warned, escalated: overdue.length };
}
