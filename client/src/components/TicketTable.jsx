import { Link } from 'react-router-dom';
import PriorityTag from './PriorityTag.jsx';
import StatusText from './StatusText.jsx';
import SlaDue from './SlaDue.jsx';
import { label, relative } from '../utils/format.js';

// One list for every role. Staff see who asked, the category and the SLA;
// customers see their subject, status and when it last moved. Managers also see
// who each ticket is with; an agent's own queue does not repeat their name.
export default function TicketTable({ tickets, staff, showAgent }) {
  return (
    <div className="ticket-list" role="table" aria-label="Tickets">
      <div className={`ticket-row ticket-row--head${staff ? ' ticket-row--staff' : ''}`} role="row">
        <span role="columnheader">Ticket</span>
        {staff && <span role="columnheader">Category</span>}
        <span role="columnheader">Status</span>
        <span role="columnheader">{staff ? 'SLA' : 'Updated'}</span>
      </div>
      {tickets.map((t) => (
        <Link key={t._id} to={`/tickets/${t._id}`} role="row"
              className={staff ? `ticket-row ticket-row--staff strip--${t.priority}` : 'ticket-row'}>
          <span role="cell" className="ticket-row__main">
            <span className="ticket-row__subject">{t.subject}</span>
            {staff && (
              <span className="muted">
                From {t.customer?.name}
                {showAgent && t.assignedAgent ? `, with ${t.assignedAgent.name}` : ''}
                {t.needsTriage ? ', needs triage' : ''}
              </span>
            )}
          </span>
          {staff && <span role="cell"><PriorityTag priority={t.priority} /> {label(t.category)}</span>}
          <span role="cell"><StatusText status={t.status} /></span>
          <span role="cell">{staff ? <SlaDue ticket={t} /> : relative(t.updatedAt)}</span>
        </Link>
      ))}
    </div>
  );
}
