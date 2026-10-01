// One axios instance for the whole app. The access token lives only in memory;
// the refresh token is an httpOnly cookie the browser sends to /api/auth itself.
import axios from 'axios';

let accessToken = null;
let onSessionEnd = () => {};
let refreshing = null;

export const setAccessToken = (token) => {
  accessToken = token;
};
export const setSessionEndHandler = (fn) => {
  onSessionEnd = fn;
};

const api = axios.create({ baseURL: '/api', withCredentials: true });

api.interceptors.request.use((config) => {
  if (accessToken) config.headers.Authorization = `Bearer ${accessToken}`;
  return config;
});

/** Swaps the refresh cookie for a new access token. Concurrent callers share one request. */
export function refreshSession() {
  refreshing ??= axios
    .post('/api/auth/refresh', null, { withCredentials: true })
    .then(({ data }) => {
      accessToken = data.accessToken;
      return data;
    })
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

// An expired access token is renewed once and the request retried, so a
// 15-minute token never interrupts someone mid-task.
api.interceptors.response.use(undefined, async (error) => {
  const { config, response } = error;
  if (response?.status === 401 && response.data?.error?.code === 'TOKEN_EXPIRED' && !config.retried) {
    config.retried = true;
    try {
      await refreshSession();
      return api(config);
    } catch {
      onSessionEnd();
    }
  }
  return Promise.reject(error);
});

/** The server's message for a failed request, or a plain explanation when it never answered. */
export const errorMessage = (err) =>
  err?.response?.data?.error?.message ?? 'The server could not be reached. Check your connection and try again.';

/** Per-field messages from a 400 VALIDATION_ERROR, keyed by field name. */
export const fieldErrors = (err) => err?.response?.data?.error?.details ?? {};

export default api;
