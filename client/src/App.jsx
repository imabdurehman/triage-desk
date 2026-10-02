import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './context/useAuth.js';
import AppLayout from './layouts/AppLayout.jsx';
import RequireRole from './routes/RequireRole.jsx';
import { homeFor } from './routes/home.js';
import Login from './pages/Login.jsx';
import NotFound from './pages/NotFound.jsx';
import Register from './pages/Register.jsx';

export default function App() {
  const { user, ready } = useAuth();
  if (!ready) return null; // one refresh round-trip, so a signed-in user never sees the login page flash

  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route element={<RequireRole />}>
        <Route element={<AppLayout />}>
          <Route path="/" element={<Navigate to={user ? homeFor(user.role) : '/login'} replace />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Route>
    </Routes>
  );
}
