import { useState } from 'react';
import Notice from '../../components/Notice.jsx';
import Pager from '../../components/Pager.jsx';
import TicketTable from '../../components/TicketTable.jsx';
import { useLoad } from '../../hooks/useLoad.js';
import { getWorkload, listTickets } from '../../services/ticketService.js';

const VIEWS = {
  mine: { name: 'Assigned to me', params: { needsTriage: 'false', active: 'true' } },
  triage: { name: 'Needs triage', params: { needsTriage: 'true', active: 'true' } },
};

// Sorted by SLA on the server: the ticket at the top is the one due soonest.
export default function Queue() {
  const [view, setView] = useState('mine');
  const [page, setPage] = useState(1);
  const workload = useLoad(getWorkload);
  const me = workload.data?.[0];
  const { data, error, loading } = useLoad(() => listTickets({ ...VIEWS[view].params, page }), `${view}:${page}`);

  const choose = (next) => {
    setView(next);
    setPage(1);
  };

  return (
    <div className="page">
      <header className="page__head">
        <h1>Queue</h1>
        {me && (
          <dl className="workload">
            <div><dt>Pending</dt><dd>{me.pending}</dd></div>
            <div><dt>Resolved today</dt><dd>{me.resolvedToday}</dd></div>
          </dl>
        )}
        <div className="segmented" role="tablist" aria-label="Queue view">
          {Object.entries(VIEWS).map(([id, v]) => (
            <button key={id} type="button" role="tab" aria-selected={view === id}
                    className="segmented__item" onClick={() => choose(id)}>{v.name}</button>
          ))}
        </div>
      </header>
      <Notice>{error}</Notice>
      {data?.total === 0 && (
        <p className="empty">{view === 'mine' ? 'Nothing assigned to you is open.' : 'Every ticket has been triaged.'}</p>
      )}
      {data?.total > 0 && <TicketTable tickets={data.items} staff />}
      {data && <Pager page={data.page} pages={data.pages} onPage={setPage} />}
      {loading && !data && <p className="muted">Loading the queue</p>}
    </div>
  );
}
