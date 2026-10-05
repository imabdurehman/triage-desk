import { createContext, useContext } from 'react';

// The shared enums from shared/contract.json, served by GET /api/meta.
export const MetaContext = createContext(null);
export const useMeta = () => useContext(MetaContext);
