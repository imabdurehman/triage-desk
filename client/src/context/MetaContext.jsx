// Fetches the shared enums once; every dropdown and label reads them from here,
// never from a local copy.
import { useEffect, useState } from 'react';
import { getMeta } from '../services/managerService.js';
import { MetaContext } from './useMeta.js';

export function MetaProvider({ children }) {
  const [meta, setMeta] = useState(null);
  useEffect(() => {
    getMeta().then(setMeta);
  }, []);
  return <MetaContext.Provider value={meta}>{children}</MetaContext.Provider>;
}
