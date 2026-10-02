import { useCallback, useEffect, useRef, useState } from 'react';
import { errorMessage } from '../services/api.js';

/**
 * Runs `load` on mount and whenever `key` changes; reload() runs it again after a
 * change. Only the most recent request may update the state, so a slow, older
 * response can never overwrite a newer one.
 */
export function useLoad(load, key) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const latest = useRef(load);
  const request = useRef(0);

  useEffect(() => {
    latest.current = load;
  });

  const reload = useCallback(() => {
    const id = ++request.current;
    return latest.current().then(
      (data) => id === request.current && setState({ data, error: null, loading: false }),
      (err) => id === request.current && setState({ data: null, error: errorMessage(err), loading: false }),
    );
  }, []);

  useEffect(() => {
    reload();
  }, [reload, key]);

  return { ...state, reload };
}
