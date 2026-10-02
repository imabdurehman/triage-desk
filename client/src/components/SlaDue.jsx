import { slaText } from '../utils/format.js';

export default function SlaDue({ ticket }) {
  if (['resolved', 'closed'].includes(ticket.status)) return <span className="muted">Done</span>;
  const { text, overdue } = slaText(ticket.slaDueAt);
  return <span className={overdue ? 'sla sla--overdue' : 'sla'}>{text}</span>;
}
