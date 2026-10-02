import { useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import AuthScreen from '../components/AuthScreen.jsx';
import Notice from '../components/Notice.jsx';
import { useAuth } from '../context/useAuth.js';
import { homeFor } from '../routes/home.js';
import { errorMessage, fieldErrors } from '../services/api.js';

export default function Register() {
  const { user, register } = useAuth();
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  if (user) return <Navigate to={homeFor(user.role)} replace />;

  const submit = async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);
    try {
      await register(form.get('name'), form.get('email'), form.get('password'));
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  };
  const fields = fieldErrors(error);

  return (
    <AuthScreen title="Create an account">
      <form className="form" onSubmit={submit} noValidate>
        <Notice>{error && !Object.keys(fields).length ? errorMessage(error) : ''}</Notice>
        <label className="field">Your name
          <input name="name" autoComplete="name" required />
          {fields.name && <span className="field__error">{fields.name}</span>}
        </label>
        <label className="field">Email
          <input name="email" type="email" autoComplete="email" required />
          {fields.email && <span className="field__error">{fields.email}</span>}
        </label>
        <label className="field">Password
          <input name="password" type="password" autoComplete="new-password" minLength={8} required />
          <span className={fields.password ? 'field__error' : 'field__hint'}>
            {fields.password ?? 'At least 8 characters'}
          </span>
        </label>
        <button className="btn" disabled={busy}>{busy ? 'Creating account' : 'Create account'}</button>
      </form>
      <p className="muted">Already have an account? <Link to="/login">Sign in</Link></p>
    </AuthScreen>
  );
}
