import api from './api.js';

export const listTickets = (params) => api.get('/tickets', { params }).then((r) => r.data);
export const getTicket = (id) => api.get(`/tickets/${id}`).then((r) => r.data.ticket);
export const createTicket = (subject, body) =>
  api.post('/tickets', { subject, body }).then((r) => r.data.ticket);
export const setStatus = (id, status, note) =>
  api.patch(`/tickets/${id}/status`, { status, note }).then((r) => r.data.ticket);
export const assignTicket = (id, agentId) =>
  api.patch(`/tickets/${id}/assign`, { agentId }).then((r) => r.data.ticket);
export const triageTicket = (id, changes) =>
  api.patch(`/tickets/${id}/triage`, changes).then((r) => r.data.ticket);
export const addComment = (id, body, internal) =>
  api.post(`/tickets/${id}/comments`, { body, internal }).then((r) => r.data.ticket);
export const uploadImages = (id, files) => {
  const form = new FormData();
  files.forEach((f) => form.append('images', f));
  return api.post(`/tickets/${id}/images`, form).then((r) => r.data.ticket);
};
export const imageBlob = (id, filename) =>
  api.get(`/tickets/${id}/images/${filename}`, { responseType: 'blob' }).then((r) => r.data);
export const getWorkload = () => api.get('/tickets/workload').then((r) => r.data.agents);
