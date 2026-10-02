import { useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import AuthScreen from '../components/AuthScreen.jsx';
import Notice from '../components/Notice.jsx';
import { useAuth } from '../context/useAuth.js';
import { homeFor } from '../routes/home.js';
import { errorMessage } from '../services/api.js';

export default function Login() {
  const { user, login } = useAuth();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  if (user) return <Navigate to={homeFor(user.role)} replace />;

  const submit = async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError('');
    try {
      await login(form.get('email'), form.get('password'));
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <AuthScreen title="Sign in">
      <form className="form" onSubmit={submit}>
        <Notice>{error}</Notice>
        <label className="field">Email
          <input name="email" type="email" autoComplete="email" required />
        </label>
        <label className="field">Password
          <input name="password" type="password" autoComplete="current-password" required />
        </label>
        <button className="btn" disabled={busy}>{busy ? 'Signing in' : 'Sign in'}</button>
      </form>
      <p className="muted">New here? <Link to="/register">Create an account</Link> to open a ticket.</p>
    </AuthScreen>
  );
}
