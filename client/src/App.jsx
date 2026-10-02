import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './context/useAuth.js';
import { MetaProvider } from './context/MetaContext.jsx';
import AppLayout from './layouts/AppLayout.jsx';
import RequireRole from './routes/RequireRole.jsx';
import { homeFor } from './routes/home.js';
import Login from './pages/Login.jsx';
import NotFound from './pages/NotFound.jsx';
import Register from './pages/Register.jsx';
import TicketPage from './pages/TicketPage.jsx';
import Queue from './pages/agent/Queue.jsx';
import MyTickets from './pages/customer/MyTickets.jsx';
import NewTicket from './pages/customer/NewTicket.jsx';
import AllTickets from './pages/manager/AllTickets.jsx';
import ModelJobs from './pages/manager/ModelJobs.jsx';
import Overview from './pages/manager/Overview.jsx';
import People from './pages/manager/People.jsx';

export default function App() {
  const { user, ready } = useAuth();
  if (!ready) return null; // one refresh round-trip, so a signed-in user never sees the login page flash

  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route element={<RequireRole />}>
        <Route element={<MetaProvider><AppLayout /></MetaProvider>}>
          <Route path="/" element={<Navigate to={user ? homeFor(user.role) : '/login'} replace />} />
          <Route path="/tickets/:id" element={<TicketPage />} />
          <Route element={<RequireRole roles={['customer']} />}>
            <Route path="/tickets" element={<MyTickets />} />
            <Route path="/tickets/new" element={<NewTicket />} />
          </Route>
          <Route element={<RequireRole roles={['agent']} />}>
            <Route path="/queue" element={<Queue />} />
          </Route>
          <Route element={<RequireRole roles={['manager']} />}>
            <Route path="/manager" element={<Overview />} />
            <Route path="/manager/tickets" element={<AllTickets />} />
            <Route path="/manager/users" element={<People />} />
            <Route path="/manager/model" element={<ModelJobs />} />
          </Route>
          <Route path="*" element={<NotFound />} />
        </Route>
      </Route>
    </Routes>
  );
}
