import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../context/useAuth.js';

const NAV = {
  customer: [['/tickets', 'My tickets'], ['/tickets/new', 'New ticket']],
  agent: [['/queue', 'Queue']],
  manager: [['/manager', 'Overview'], ['/manager/tickets', 'All tickets'], ['/manager/users', 'People'],
            ['/manager/model', 'Model and jobs']],
};

export default function AppLayout() {
  const { user, logout } = useAuth();
  return (
    <div className="shell">
      <aside className="sidebar">
        <span className="brand">TriageDesk</span>
        <nav className="nav" aria-label="Main">
          {NAV[user.role].map(([to, text]) => (
            <NavLink key={to} to={to} end className="nav__link">{text}</NavLink>
          ))}
        </nav>
        <div className="whoami">
          <span>{user.name}</span>
          <button type="button" className="btn btn--quiet" onClick={logout}>Sign out</button>
        </div>
      </aside>
      <main className="main">
        <Outlet />
      </main>
    </div>
  );
}
