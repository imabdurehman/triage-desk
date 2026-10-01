import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../context/useAuth.js';
import { homeFor } from './home.js';

// The server enforces every permission; this only keeps people on pages they can use.
export default function RequireRole({ roles }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (roles && !roles.includes(user.role)) return <Navigate to={homeFor(user.role)} replace />;
  return <Outlet />;
}
