import { useSearchParams } from 'react-router-dom';
import Notice from '../../components/Notice.jsx';
import Pager from '../../components/Pager.jsx';
import TicketTable from '../../components/TicketTable.jsx';
import { useMeta } from '../../context/useMeta.js';
import { useLoad } from '../../hooks/useLoad.js';
import { listTickets } from '../../services/ticketService.js';
import { label } from '../../utils/format.js';

const FILTERS = ['status', 'category', 'priority', 'needsTriage'];

// Filters live in the URL, so a filtered view can be bookmarked or shared.
export default function AllTickets() {
  const meta = useMeta();
  const [params, setParams] = useSearchParams();
  const query = Object.fromEntries(FILTERS.concat('page').filter((k) => params.get(k))
    .map((k) => [k, params.get(k)]));
  const { data, error, loading } = useLoad(() => listTickets(query), params.toString());

  const set = (name, value) => {
    const nextParams = new URLSearchParams(params);
    if (value) nextParams.set(name, value);
    else nextParams.delete(name);
    if (name !== 'page') nextParams.delete('page');
    setParams(nextParams);
  };
  const select = (name, options) => (
    <label className="field field--inline">{label(name)}
      <select value={params.get(name) ?? ''} onChange={(e) => set(name, e.target.value)}>
        <option value="">All</option>
        {options.map((o) => <option key={o} value={o}>{label(o)}</option>)}
      </select>
    </label>
  );

  return (
    <div className="page">
      <h1>All tickets</h1>
      {meta && (
        <div className="filters">
          {select('status', meta.statuses)}
          {select('category', meta.categories)}
          {select('priority', meta.priorities)}
          <label className="check">
            <input type="checkbox" checked={params.get('needsTriage') === 'true'}
                   onChange={(e) => set('needsTriage', e.target.checked ? 'true' : '')} />
            Needs triage only
          </label>
        </div>
      )}
      <Notice>{error}</Notice>
      {data?.total === 0 && <p className="empty">No tickets match these filters.</p>}
      {data?.total > 0 && <TicketTable tickets={data.items} staff showAgent />}
      {data && <Pager page={data.page} pages={data.pages} onPage={(p) => set('page', String(p))} />}
      {loading && !data && <p className="muted">Loading tickets</p>}
    </div>
  );
}
