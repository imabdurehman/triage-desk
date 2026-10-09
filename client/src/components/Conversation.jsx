import { useState } from 'react';
import Notice from './Notice.jsx';
import { errorMessage } from '../services/api.js';
import { addComment } from '../services/ticketService.js';
import { dateTime, label } from '../utils/format.js';

// The customer's original message, then every reply in order. Internal notes
// are only ever returned to staff, and are drawn differently so they are never
// mistaken for something the customer can read.
export default function Conversation({ ticket, staff, onChange }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const closed = ticket.status === 'closed';

  const submit = async (event) => {
    event.preventDefault();
    const formEl = event.currentTarget;
    const form = new FormData(formEl);
    setBusy(true);
    setError('');
    try {
      await addComment(ticket._id, form.get('body'), form.get('internal') === 'on');
      formEl.reset();
      await onChange();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="conversation" aria-label="Conversation">
      <article className="message">
        <header><strong>{ticket.customer?.name ?? 'Customer'}</strong> {dateTime(ticket.createdAt)}</header>
        <p>{ticket.body}</p>
      </article>
      {ticket.comments.map((c) => (
        <article key={c._id} className={c.internal ? 'message message--internal' : 'message'}>
          <header>
            <strong>{c.author?.name}</strong> {label(c.author?.role)}, {dateTime(c.createdAt)}
            {c.internal && <span className="message__flag">Internal note</span>}
          </header>
          <p>{c.body}</p>
        </article>
      ))}
      {closed ? (
        <p className="muted">This ticket is closed. Open a new ticket if the problem comes back.</p>
      ) : (
        <form className="form reply" onSubmit={submit}>
          <Notice>{error}</Notice>
          <label className="field">{staff ? 'Reply or note' : 'Reply'}
            <textarea name="body" rows={4} required />
            {!staff && ticket.status === 'resolved' && (
              <span className="field__hint">Not fixed? Reply here and the ticket reopens.</span>
            )}
          </label>
          <div className="reply__actions">
            {staff && (
              <label className="check">
                <input type="checkbox" name="internal" /> Internal note, only staff can see it
              </label>
            )}
            <button className="btn" disabled={busy}>{busy ? 'Sending' : 'Send'}</button>
          </div>
        </form>
      )}
    </section>
  );
}
