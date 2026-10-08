// Who handles a ticket. The model has already said what the ticket is (category
// and priority); this decides who should take it: first from how the managers
// assign such tickets, then from each agent's own results.
import { User } from "../models/User.js";
import { Ticket } from "../models/Ticket.js";
import { Assignment } from "../models/Assignment.js";
import { env } from "../config/env.js";

const ACTIVE_WORK = ["assigned", "in_progress", "waiting_customer"];
const HOUR = 60 * 60 * 1000;
const HISTORY_DAYS = 90;
const MIN_RECORD = 3; // fewer resolved tickets than this is not yet a track record
const MIN_TAUGHT = 3; // a manager's choice becomes a habit after this many tickets

/** Open tickets, and tickets resolved since midnight, per agent id. */
export async function workload(agentIds) {
  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);
  const countBy = (match) =>
    Ticket.aggregate([
      { $match: { assignedAgent: { $in: agentIds }, ...match } },
      { $group: { _id: "$assignedAgent", n: { $sum: 1 } } },
    ]).then((rows) => new Map(rows.map((r) => [r._id.toString(), r.n])));
  const [open, resolved] = await Promise.all([
    countBy({ status: { $in: ACTIVE_WORK } }),
    countBy({ resolvedAt: { $gte: midnight } }),
  ]);
  return new Map(
    agentIds.map((id) => [
      id.toString(),
      {
        pending: open.get(id.toString()) ?? 0,
        resolvedToday: resolved.get(id.toString()) ?? 0,
      },
    ]),
  );
}

/**
 * Average hours from a ticket arriving to its final resolution, per agent, for this
 * category over the last 90 days. A reopened ticket counts until it is resolved
 * again, so fast but wrong is not fast. Agents without a record get the team average.
 */
async function hoursPerTicket(agentIds, category) {
  const since = new Date(Date.now() - HISTORY_DAYS * 24 * HOUR);
  const done = await Ticket.find({
    category,
    assignedAgent: { $in: agentIds },
    resolvedAt: { $gte: since },
  })
    .select("assignedAgent createdAt resolvedAt")
    .lean();
  const record = new Map();
  for (const t of done) {
    const r = record.get(t.assignedAgent.toString()) ?? {
      tickets: 0,
      hours: 0,
    };
    record.set(t.assignedAgent.toString(), {
      tickets: r.tickets + 1,
      hours: r.hours + (t.resolvedAt - t.createdAt) / HOUR,
    });
  }
  const proven = [...record].filter(([, r]) => r.tickets >= MIN_RECORD);
  const team = proven.length
    ? proven.reduce((s, [, r]) => s + r.hours / r.tickets, 0) / proven.length
    : 0;
  const hours = new Map(agentIds.map((id) => [id.toString(), team]));
  for (const [id, r] of proven) hours.set(id, r.hours / r.tickets);
  return { hours, proven: new Set(proven.map(([id]) => id)) };
}

/**
 * Who the managers gave tickets of this category to over the last 90 days, most
 * often first: for this priority, and for the category as a whole. Each ticket
 * counts once, by its final manual assignment and its confirmed category and
 * priority, so a corrected prediction teaches the corrected answer.
 */
async function taught(category, priority) {
  const since = new Date(Date.now() - HISTORY_DAYS * 24 * HOUR);
  const manual = await Assignment.find({
    method: "manual",
    createdAt: { $gte: since },
  })
    .sort({ createdAt: 1 })
    .select("ticket agent")
    .lean();
  const finalPick = new Map(
    manual.map((a) => [a.ticket.toString(), a.agent.toString()]),
  );
  const tickets = await Ticket.find({
    _id: { $in: [...finalPick.keys()] },
    category,
    needsTriage: false,
  })
    .select("priority")
    .lean();
  const habits = (list) => {
    const picks = new Map();
    for (const t of list) {
      const agent = finalPick.get(t._id.toString());
      picks.set(agent, (picks.get(agent) ?? 0) + 1);
    }
    return [...picks]
      .filter(([, n]) => n >= MIN_TAUGHT)
      .sort((a, b) => b[1] - a[1])
      .map(([id]) => id);
  };
  return [
    [
      habits(tickets.filter((t) => t.priority === priority)),
      `${priority} ${category}`,
    ],
    [habits(tickets), category],
  ];
}

/**
 * Picks who handles a ticket, with the reason, or null when there are no active agents.
 *  1. As the managers do: the agent they have given such tickets to at least
 *     MIN_TAUGHT times (same priority and category first, then the category).
 *  2. Otherwise, candidates are the active agents who handle the category (no
 *     categories = all); if nobody does, every active agent. Urgent and high go
 *     to whoever resolves this category fastest; medium and low to whoever has
 *     the least open work.
 * Agents at MAX_OPEN_TICKETS are skipped while anyone else has room.
 */
export async function pickAgent(category, priority) {
  const active = await User.find({ role: "agent", active: true })
    .select("name email categories")
    .lean();
  if (!active.length) return null;
  const load = await workload(active.map((a) => a._id));
  const open = (a) => load.get(a._id.toString()).pending;
  const hasRoom = (a) => open(a) < env.maxOpenTickets;

  for (const [habit, kind] of await taught(category, priority)) {
    const agent = habit
      .map((id) => active.find((a) => a._id.toString() === id))
      .find((a) => a && hasRoom(a));
    if (agent) return { agent, reason: `as managers assign ${kind} tickets` };
  }

  const handlers = active.filter(
    (a) => !a.categories.length || a.categories.includes(category),
  );
  const agents = handlers.length ? handlers : active;
  const speed = await hoursPerTicket(
    agents.map((a) => a._id),
    category,
  );
  const hours = (a) => speed.hours.get(a._id.toString());
  const withRoom = agents.filter(hasRoom);
  const fastest =
    withRoom.length > 0 &&
    ["urgent", "high"].includes(priority) &&
    speed.proven.size > 0;
  const [agent] = (withRoom.length ? withRoom : agents).sort(
    fastest
      ? (a, b) => hours(a) - hours(b) || open(a) - open(b)
      : (a, b) => open(a) - open(b) || hours(a) - hours(b),
  );
  const reason = !withRoom.length
    ? "everyone is at capacity; least open work"
    : fastest && speed.proven.has(agent._id.toString())
      ? `fastest at ${category}`
      : "least open work";
  return { agent, reason };
}

/** Pending and resolved-today counts: an agent sees their own, a manager every active agent. */
export async function teamWorkload(user) {
  const agents = await User.find({
    role: "agent",
    active: true,
    ...(user.role === "agent" && { _id: user.id }),
  })
    .select("name categories")
    .sort({ name: 1 })
    .lean();
  const load = await workload(agents.map((a) => a._id));
  return agents.map((a) => ({
    id: a._id,
    name: a.name,
    categories: a.categories,
    ...load.get(a._id.toString()),
  }));
}
