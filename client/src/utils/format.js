// Contract values are stored lowercase and snake_case; people read labels.
export const label = (value) =>
  value ? value.charAt(0).toUpperCase() + value.slice(1).replaceAll('_', ' ') : 'Not set';

const MINUTE = 60_000;

function span(ms) {
  const minutes = Math.round(Math.abs(ms) / MINUTE);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ${minutes % 60}m`;
  return `${Math.floor(hours / 24)}d`;
}

/** "Due in 3h 20m" / "Overdue by 45m", and whether it is overdue. */
export function slaText(slaDueAt, now = Date.now()) {
  if (!slaDueAt) return { text: 'No SLA', overdue: false };
  const ms = new Date(slaDueAt).getTime() - now;
  return ms >= 0
    ? { text: `Due in ${span(ms)}`, overdue: false }
    : { text: `Overdue by ${span(ms)}`, overdue: true };
}

export const dateTime = (value) =>
  new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

export const relative = (value, now = Date.now()) => {
  const ms = now - new Date(value).getTime();
  return ms < MINUTE ? 'just now' : `${span(ms)} ago`;
};

export const percent = (value) => (value == null ? 'No data' : `${Math.round(value * 100)}%`);

/** One readable line for a ticket history entry. */
export function describeHistory(h) {
  const who = h.by?.name ? ` by ${h.by.name}` : '';
  switch (h.action) {
    case 'created':
      return `Opened${who}${h.note ? ` (${h.note})` : ''}`;
    case 'status':
      return `Moved from ${label(h.from).toLowerCase()} to ${label(h.to).toLowerCase()}${who}${h.note ? ` (${h.note})` : ''}`;
    case 'assigned':
      return h.note?.startsWith('auto') ? `Assigned automatically${h.note.length > 4 ? ` (${h.note.slice(6)})` : ''}`
        : `Reassigned${who}`;
    case 'triaged':
      return `Triaged as ${label(h.to.category).toLowerCase()}, ${h.to.priority} priority${who}`;
    case 'sla_breached':
      return `Missed its SLA; priority raised from ${h.from} to ${h.to}`;
    default:
      return label(h.action);
  }
}
