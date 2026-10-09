import api from './api.js';

export const login = (email, password) =>
  api.post('/auth/login', { email, password }).then((r) => r.data);
export const register = (name, email, password) =>
  api.post('/auth/register', { name, email, password }).then((r) => r.data);
export const logout = () => api.post('/auth/logout');
