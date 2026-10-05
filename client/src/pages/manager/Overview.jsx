import { lazy, Suspense } from 'react';
import { Link } from 'react-router-dom';
import Notice from '../../components/Notice.jsx';
import { useMeta } from '../../context/useMeta.js';
import { useLoad } from '../../hooks/useLoad.js';
import { getMetrics } from '../../services/managerService.js';
import { getWorkload } from '../../services/ticketService.js';
import { label, percent } from '../../utils/format.js';

const QueueChart3D = lazy(() => import('../../components/QueueChart3D.jsx'));

export default function Overview() {
  const meta = useMeta();
  const { data, error } = useLoad(getMetrics);
  const team = useLoad(getWorkload);
  const t = data?.tickets;
  const open = t ? t.openMatrix.reduce((sum, c) => sum + c.count, 0) : 0;
  const ml = data?.mlService;

  return (
    <div className="page">
      <h1>Overview</h1>
      <Notice>{error}</Notice>
      {t && meta && (
        <div className="overview">
          <Suspense fallback={<div className="chart3d chart3d--loading" />}>
            <QueueChart3D matrix={t.openMatrix} categories={meta.categories} priorities={meta.priorities} />
          </Suspense>
          <dl className="facts">
            <div><dt>Open tickets</dt><dd>{open}</dd></div>
            <div><dt>Past their SLA</dt><dd className={t.openBreached ? 'bad' : undefined}>{t.openBreached}</dd></div>
            <div>
              <dt>Waiting for triage</dt>
              <dd><Link to="/manager/tickets?needsTriage=true">{t.needsTriage}</Link></dd>
            </div>
            <div>
              <dt>Model corrected by people</dt>
              <dd>{percent(t.model.overrideRate)}</dd>
              <span className="muted">of {t.model.reviewedTickets} tickets people reviewed</span>
            </div>
            <div>
              <dt>Average time to resolve</dt>
              <dd>{t.avgResolutionHours == null ? 'No data' : `${t.avgResolutionHours} h`}</dd>
              <span className="muted">last 30 days</span>
            </div>
            {data.yesterday && (
              <div>
                <dt>Yesterday ({data.yesterday.date})</dt>
                <dd>{data.yesterday.created} new</dd>
                <span className="muted">
                  {data.yesterday.resolved} resolved, {data.yesterday.breached} missed their SLA
                </span>
              </div>
            )}
            <div>
              <dt>ML service</dt>
              <dd className={ml.reachable ? undefined : 'bad'}>
                {ml.reachable ? (ml.modelLoaded ? `Model ${ml.modelVersion}` : 'No model yet') : 'Unreachable'}
              </dd>
            </div>
          </dl>
        </div>
      )}
      {team.data?.length > 0 && (
        <section className="panel team">
          <h2>Team today</h2>
          <table className="table">
            <thead><tr><th>Agent</th><th>Handles</th><th>Pending</th><th>Resolved today</th></tr></thead>
            <tbody>
              {team.data.map((a) => (
                <tr key={a.id}>
                  <td>{a.name}</td>
                  <td>{a.categories.length ? a.categories.map(label).join(', ') : 'Everything'}</td>
                  <td>{a.pending}</td>
                  <td>{a.resolvedToday}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
