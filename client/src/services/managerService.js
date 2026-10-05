import api from './api.js';

export const getMeta = () => api.get('/meta').then((r) => r.data);
export const getMetrics = () => api.get('/manager/metrics').then((r) => r.data);
export const getModel = () => api.get('/manager/model').then((r) => r.data);
export const retrain = () => api.post('/manager/model/retrain').then((r) => r.data);
export const getJobs = () => api.get('/manager/jobs').then((r) => r.data);
export const runJob = (name) => api.post(`/manager/jobs/${name}/run`).then((r) => r.data);
export const listUsers = (role) => api.get('/users', { params: { role } }).then((r) => r.data.users);
export const createUser = (user) => api.post('/users', user).then((r) => r.data.user);
export const updateUser = (id, changes) => api.patch(`/users/${id}`, changes).then((r) => r.data.user);
export const testEmail = () => api.post('/manager/test-email').then((r) => r.data);
