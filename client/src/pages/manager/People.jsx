import { useState } from 'react';
import Notice from '../../components/Notice.jsx';
import { useAuth } from '../../context/useAuth.js';
import { useMeta } from '../../context/useMeta.js';
import { useLoad } from '../../hooks/useLoad.js';
import { errorMessage } from '../../services/api.js';
import { createUser, listUsers, updateUser } from '../../services/managerService.js';
import { label } from '../../utils/format.js';

export default function People() {
  const meta = useMeta();
  const { user: me } = useAuth();
  const { data: users, error, reload } = useLoad(() => listUsers());
  const [message, setMessage] = useState({ kind: 'error', text: '' });
  const [editing, setEditing] = useState(null); // id of the user whose email is being corrected

  const run = async (change, done) => {
    setMessage({ kind: 'error', text: '' });
    try {
      await change();
      await reload();
      if (done) setMessage({ kind: 'ok', text: done });
    } catch (err) {
      setMessage({ kind: 'error', text: errorMessage(err) });
    }
  };

  const add = (event) => {
    event.preventDefault();
    const formEl = event.currentTarget;
    const form = new FormData(formEl);
    run(async () => {
      await createUser({
        name: form.get('name'), email: form.get('email'), password: form.get('password'),
        role: form.get('role'), categories: form.getAll('categories'),
      });
      formEl.reset();
    }, `${form.get('name')} can now sign in.`);
  };

  const toggleCategory = (u, category) => {
    const categories = u.categories.includes(category)
      ? u.categories.filter((c) => c !== category)
      : [...u.categories, category];
    run(() => updateUser(u.id, { categories }));
  };

  return (
    <div className="page">
      <h1>People</h1>
      <Notice>{error}</Notice>
      <Notice kind={message.kind}>{message.text}</Notice>
      {users && meta && (
        <div className="people">
          <table className="table">
            <thead>
              <tr><th>Name</th><th>Role</th><th>Handles</th><th>Access</th></tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className={u.active ? undefined : 'inactive'}>
                  <td>
                    {u.name}<br />
                    {editing === u.id ? (
                      <form className="inline-edit" onSubmit={(e) => {
                        e.preventDefault();
                        const email = new FormData(e.currentTarget).get('email');
                        run(async () => {
                          await updateUser(u.id, { email });
                          setEditing(null);
                        }, `${u.name}'s email is now ${email}.`);
                      }}>
                        <input name="email" type="email" defaultValue={u.email} aria-label="Email" required />
                        <button className="btn btn--quiet">Save</button>
                        <button type="button" className="btn btn--quiet" onClick={() => setEditing(null)}>Cancel</button>
                      </form>
                    ) : (
                      <span className="muted">
                        {u.email}{' '}
                        <button type="button" className="link-button" onClick={() => setEditing(u.id)}>Change</button>
                      </span>
                    )}
                  </td>
                  <td>{label(u.role)}</td>
                  <td>
                    {u.role === 'agent' ? (
                      <div className="chips">
                        {meta.categories.map((c) => (
                          <button key={c} type="button" aria-pressed={u.categories.includes(c)}
                                  className="chip" onClick={() => toggleCategory(u, c)}>{label(c)}</button>
                        ))}
                      </div>
                    ) : <span className="muted">{u.role === 'manager' ? 'Everything' : 'Own tickets'}</span>}
                  </td>
                  <td>
                    {u.id === me.id ? <span className="muted">You</span> : (
                      <button type="button" className="btn btn--quiet"
                              onClick={() => run(() => updateUser(u.id, { active: !u.active }))}>
                        {u.active ? 'Deactivate' : 'Reactivate'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <form className="form panel" onSubmit={add}>
            <h2>Add a staff member</h2>
            <label className="field">Name<input name="name" required /></label>
            <label className="field">Email<input name="email" type="email" required /></label>
            <label className="field">Temporary password
              <input name="password" type="text" minLength={8} required />
              <span className="field__hint">At least 8 characters. Share it with them privately.</span>
            </label>
            <label className="field">Role
              <select name="role" defaultValue="agent">
                <option value="agent">Agent</option>
                <option value="manager">Manager</option>
              </select>
            </label>
            <fieldset className="field">
              <legend>Handles (agents only; none means every category)</legend>
              <div className="chips">
                {meta.categories.map((c) => (
                  <label key={c} className="check"><input type="checkbox" name="categories" value={c} /> {label(c)}</label>
                ))}
              </div>
            </fieldset>
            <button className="btn">Add staff member</button>
          </form>
        </div>
      )}
    </div>
  );
}
