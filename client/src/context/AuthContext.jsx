import { useCallback, useEffect, useMemo, useState } from 'react';
import * as auth from '../services/authService.js';
import { refreshSession, setAccessToken, setSessionEndHandler } from '../services/api.js';
import { AuthContext } from './useAuth.js';

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);

  const endSession = useCallback(() => {
    setAccessToken(null);
    setUser(null);
  }, []);

  // On first load, the refresh cookie (if any) restores the session silently.
  useEffect(() => {
    setSessionEndHandler(endSession);
    refreshSession()
      .then((data) => setUser(data.user))
      .catch(endSession)
      .finally(() => setReady(true));
  }, [endSession]);

  const start = useCallback((data) => {
    setAccessToken(data.accessToken);
    setUser(data.user);
    return data.user;
  }, []);

  const value = useMemo(() => ({
    user,
    ready,
    login: (email, password) => auth.login(email, password).then(start),
    register: (name, email, password) => auth.register(name, email, password).then(start),
    logout: () => auth.logout().finally(endSession),
  }), [user, ready, start, endSession]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
