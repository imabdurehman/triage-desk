// Builds the training data the ML service learns from in production.
//
// Only HUMAN-CONFIRMED labels are exported: a ticket counts once a person has
// triaged it, or an agent has worked it through to "resolved". Tickets whose
// labels came only from the model are never exported. Training the model on
// its own unchecked predictions would teach it its mistakes, more confidently
// each night.
import { Ticket } from "../models/Ticket.js";

const MAX_EXPORT = 20_000;

export async function confirmedTickets() {
  const tickets = await Ticket.find({
    category: { $ne: null },
    $or: [{ resolvedAt: { $exists: true } }, { "history.action": "triaged" }],
  })
    .sort({ updatedAt: -1 })
    .limit(MAX_EXPORT)
    .select("subject body category priority")
    .lean();
  return tickets.map(({ subject, body, category, priority }) => ({
    subject,
    body,
    category,
    priority,
  }));
}
