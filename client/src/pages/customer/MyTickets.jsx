import { useState } from 'react';
import { Link } from 'react-router-dom';
import Notice from '../../components/Notice.jsx';
import Pager from '../../components/Pager.jsx';
import TicketTable from '../../components/TicketTable.jsx';
import { useLoad } from '../../hooks/useLoad.js';
import { listTickets } from '../../services/ticketService.js';

export default function MyTickets() {
  const [page, setPage] = useState(1);
  const { data, error, loading } = useLoad(() => listTickets({ page }), page);

  return (
    <div className="page">
      <header className="page__head">
        <h1>My tickets</h1>
        <Link className="btn" to="/tickets/new">New ticket</Link>
      </header>
      <Notice>{error}</Notice>
      {data && data.total === 0 && (
        <div className="empty">
          <p>You have not opened a ticket yet. Describe a problem and we will route it to the right
             person.</p>
          <Link className="btn" to="/tickets/new">Open your first ticket</Link>
        </div>
      )}
      {data?.total > 0 && <TicketTable tickets={data.items} />}
      {data && <Pager page={data.page} pages={data.pages} onPage={setPage} />}
      {loading && !data && <p className="muted">Loading your tickets</p>}
    </div>
  );
}
