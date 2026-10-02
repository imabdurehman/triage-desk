import { useState } from 'react';
import Notice from '../../components/Notice.jsx';
import { useLoad } from '../../hooks/useLoad.js';
import { errorMessage } from '../../services/api.js';
import { getJobs, getModel, retrain, runJob, testEmail } from '../../services/managerService.js';
import { dateTime, label, percent } from '../../utils/format.js';

export default function ModelJobs() {
  const model = useLoad(getModel);
  const jobs = useLoad(getJobs);
  const [message, setMessage] = useState({ kind: 'error', text: '' });
  const [busy, setBusy] = useState('');
  const current = model.data?.current;

  const act = async (id, change, describe) => {
    setBusy(id);
    setMessage({ kind: 'error', text: '' });
    try {
      const result = await change();
      setMessage({ kind: 'ok', text: describe(result) });
      await Promise.all([model.reload(), jobs.reload()]);
    } catch (err) {
      setMessage({ kind: 'error', text: errorMessage(err) });
    } finally {
      setBusy('');
    }
  };

  const lastRun = (name) => jobs.data?.runs.find((r) => r.job === name);

  return (
    <div className="page">
      <h1>Model and jobs</h1>
      <Notice>{model.error ?? jobs.error}</Notice>
      <Notice kind={message.kind}>{message.text}</Notice>

      <section className="panel">
        <div className="page__head">
          <h2>Live model</h2>
          <button type="button" className="btn" disabled={busy === 'retrain'}
                  onClick={() => act('retrain', retrain,
                    (r) => `Training started with ${r.confirmedTickets} confirmed tickets. It is promoted only if it scores at least as well as the live model.`)}>
            {busy === 'retrain' ? 'Starting' : 'Retrain now'}
          </button>
        </div>
        {current === null && <p className="muted">No model is live yet. Tickets go to people for triage until one is.</p>}
        {current && (
          <dl className="facts facts--row">
            <div><dt>Version</dt><dd>{current.modelVersion}</dd></div>
            <div><dt>Trained</dt><dd>{dateTime(current.trainedAt)}</dd></div>
            <div><dt>Category macro F1</dt><dd>{percent(current.results.category.model.macro_f1)}</dd></div>
            <div><dt>Priority macro F1</dt><dd>{percent(current.results.priority.model.macro_f1)}</dd></div>
          </dl>
        )}
        {current?.seedData && (
          <p className="flag">Trained on generated seed data only. These scores show the pipeline works, not how
             well it handles real tickets.</p>
        )}
        {model.data?.runs.length > 0 && (
          <table className="table">
            <thead><tr><th>Started</th><th>Trigger</th><th>Result</th><th>Version</th></tr></thead>
            <tbody>
              {model.data.runs.map((r) => (
                <tr key={r.runId}>
                  <td>{dateTime(r.createdAt)}</td>
                  <td>{label(r.trigger)}</td>
                  <td>{r.status === 'succeeded' ? (r.promoted ? 'Promoted' : 'Kept, not better') : label(r.status)}</td>
                  <td>{r.modelVersion ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="panel">
        <div className="page__head">
          <h2>Email</h2>
          <button type="button" className="btn btn--quiet" disabled={busy === 'email'}
                  onClick={() => act('email', testEmail, (r) => (r.smtpConfigured
                    ? `Test email sent to ${r.sentTo}. Check that inbox, and its spam folder.`
                    : 'SMTP_URL is empty, so nothing was sent: the email was printed in the server terminal instead.'))}>
            {busy === 'email' ? 'Sending' : 'Send me a test email'}
          </button>
        </div>
        <p className="muted">Sends one email to your own address to check the mail settings. If the mail server
           refuses it, its reason appears at the top of this page.</p>
      </section>

      <section className="panel">
        <h2>Scheduled jobs</h2>
        <table className="table">
          <thead><tr><th>Job</th><th>Last run</th><th>Result</th><th /></tr></thead>
          <tbody>
            {jobs.data?.jobs.map((name) => {
              const run = lastRun(name);
              return (
                <tr key={name}>
                  <td>{name}</td>
                  <td>{run ? dateTime(run.startedAt) : 'Never'}</td>
                  <td className={run?.status === 'failed' ? 'bad' : undefined}>
                    {run ? (run.error ?? label(run.status)) : ''}
                  </td>
                  <td>
                    <button type="button" className="btn btn--quiet" disabled={busy === name}
                            onClick={() => act(name, () => runJob(name), (r) => `${name}: ${label(r.status)}`)}>
                      Run now
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </div>
  );
}
