// Errors and confirmations share one component so they read the same everywhere.
export default function Notice({ kind = 'error', children }) {
  if (!children) return null;
  return (
    <p className={`notice notice--${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
      {children}
    </p>
  );
}
