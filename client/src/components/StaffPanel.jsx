import { useState } from 'react';
import Notice from './Notice.jsx';
import { useLoad } from '../hooks/useLoad.js';
import { errorMessage } from '../services/api.js';
import { listUsers } from '../services/managerService.js';
import { assignTicket, setStatus, triageTicket } from '../services/ticketService.js';
import { dateTime, describeHistory, label, percent } from '../utils/format.js';

export default function StaffPanel({ ticket, meta, user, onChange }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [resolving, setResolving] = useState(false);
  const manager = user.role === 'manager';
  const mine = ticket.assignedAgent?._id === user.id;
  const agents = useLoad(() => (manager ? listUsers('agent') : Promise.resolve([])), manager);
  const next = meta.statusTransitions[ticket.status] ?? [];

  const act = async (change) => {
    setBusy(true);
    setError('');
    try {
      await change();
      await onChange();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  const fromForm = (handler) => (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    act(() => handler(form));
  };

  return (
    <aside className="panel" aria-label="Ticket controls">
      <Notice>{error}</Notice>

      <section className="panel__block">
        <h2>Status</h2>
        {manager || mine ? (
          <div className="button-row">
            {next.map((s) => (
              <button key={s} type="button" className="btn btn--quiet" disabled={busy}
                      onClick={() => (s === 'resolved' ? setResolving(true) : act(() => setStatus(ticket._id, s)))}>
                Move to {label(s).toLowerCase()}
              </button>
            ))}
            {next.length === 0 && <p className="muted">Closed tickets do not change.</p>}
          </div>
        ) : (
          <p className="muted">Only {ticket.assignedAgent?.name ?? 'the assigned agent'} can change the status.</p>
        )}
        {resolving && (
          <form className="form form--compact" onSubmit={fromForm(async (f) => {
            await setStatus(ticket._id, 'resolved', f.get('note'));
            setResolving(false);
          })}>
            <label className="field">How was it resolved?
              <textarea name="note" rows={3} minLength={10} maxLength={1000} required />
              <span className="field__hint">The customer sees this and gets it by email.</span>
            </label>
            <div className="button-row">
              <button className="btn" disabled={busy}>Resolve ticket</button>
              <button type="button" className="btn btn--quiet" onClick={() => setResolving(false)}>Cancel</button>
            </div>
          </form>
        )}
      </section>

      <section className="panel__block">
        <h2>Triage</h2>
        {ticket.predictedCategory ? (
          <p className="muted">
            The model suggested {label(ticket.predictedCategory)} ({percent(ticket.predictionConfidence.category)} sure)
            and {label(ticket.predictedPriority)} priority.
          </p>
        ) : (
          <p className="muted">No suggestion: the model was unavailable when this ticket arrived.</p>
        )}
        {ticket.needsTriage && <p className="flag">Waiting for a person to confirm the category and priority.</p>}
        <form key={ticket.updatedAt} className="form form--compact" onSubmit={fromForm((f) => triageTicket(ticket._id, {
          category: f.get('category'), priority: f.get('priority'),
        }))}>
          <label className="field">Category
            <select name="category" defaultValue={ticket.category ?? ''} required>
              <option value="" disabled>Choose a category</option>
              {meta.categories.map((c) => <option key={c} value={c}>{label(c)}</option>)}
            </select>
          </label>
          <label className="field">Priority
            <select name="priority" defaultValue={ticket.priority}>
              {meta.priorities.map((p) => <option key={p} value={p}>{label(p)}</option>)}
            </select>
          </label>
          <button className="btn" disabled={busy}>Save triage</button>
        </form>
      </section>

      {manager && (
        <section className="panel__block">
          <h2>Assigned to</h2>
          <form key={ticket.updatedAt} className="form form--compact"
                onSubmit={fromForm((f) => assignTicket(ticket._id, f.get('agentId')))}>
            <select name="agentId" aria-label="Agent" defaultValue={ticket.assignedAgent?._id ?? ''} required>
              <option value="" disabled>Choose an agent</option>
              {agents.data?.filter((a) => a.active).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
            <button className="btn btn--quiet" disabled={busy}>Assign</button>
          </form>
        </section>
      )}

      <section className="panel__block">
        <h2>History</h2>
        <ol className="history">
          {ticket.history.map((h, i) => (
            <li key={i}>
              <span>{describeHistory(h)}</span>
              <span className="muted">{dateTime(h.at)}</span>
            </li>
          ))}
        </ol>
      </section>
    </aside>
  );
}
