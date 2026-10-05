import { Link, useLocation, useParams } from 'react-router-dom';
import Conversation from '../components/Conversation.jsx';
import Images from '../components/Images.jsx';
import Notice from '../components/Notice.jsx';
import PriorityTag from '../components/PriorityTag.jsx';
import SlaDue from '../components/SlaDue.jsx';
import StaffPanel from '../components/StaffPanel.jsx';
import StatusText from '../components/StatusText.jsx';
import { useAuth } from '../context/useAuth.js';
import { useMeta } from '../context/useMeta.js';
import { useLoad } from '../hooks/useLoad.js';
import { getTicket } from '../services/ticketService.js';
import { label } from '../utils/format.js';

export default function TicketPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const meta = useMeta();
  const { state } = useLocation();
  const { data: ticket, error, reload } = useLoad(() => getTicket(id), id);
  const staff = user.role !== 'customer';

  if (error) {
    return (
      <div className="page">
        <Notice>{error}</Notice>
        <Link to="/">Back to tickets</Link>
      </div>
    );
  }
  if (!ticket || !meta) return <div className="page"><p className="muted">Loading ticket</p></div>;

  return (
    <div className="page">
      <header className={staff ? `ticket-head strip--${ticket.priority}` : 'ticket-head'}>
        <h1>{ticket.subject}</h1>
        <div className="ticket-head__facts">
          <StatusText status={ticket.status} />
          {staff && <PriorityTag priority={ticket.priority} />}
          {staff && <span>{label(ticket.category)}</span>}
          {staff && <SlaDue ticket={ticket} />}
          {staff && ticket.assignedAgent && <span>Assigned to {ticket.assignedAgent.name}</span>}
        </div>
      </header>
      {state?.created && <Notice kind="ok">Ticket sent. Replies will appear on this page.</Notice>}
      <Notice>{state?.imagesFailed && `The images were not added: ${state.imagesFailed} Add them below.`}</Notice>
      {ticket.resolution && (
        <section className="resolution">
          <h2>How it was resolved</h2>
          <p>{ticket.resolution}</p>
        </section>
      )}
      <Images ticket={ticket} onChange={reload} />
      <div className={staff ? 'ticket-grid' : undefined}>
        <Conversation ticket={ticket} staff={staff} onChange={reload} />
        {staff && <StaffPanel ticket={ticket} meta={meta} user={user} onChange={reload} />}
      </div>
    </div>
  );
}
