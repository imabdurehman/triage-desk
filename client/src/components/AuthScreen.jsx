import { lazy, Suspense } from 'react';

// three.js loads after the form, so signing in never waits for the 3D scene.
const TriageScene = lazy(() => import('./TriageScene.jsx'));

export default function AuthScreen({ title, children }) {
  return (
    <div className="auth">
      <section className="auth__visual">
        <Suspense fallback={null}>
          <TriageScene />
        </Suspense>
        <div className="auth__pitch">
          <span className="brand brand--large">TriageDesk</span>
          <p>Support tickets, sorted by what they are about and how urgent they are, then sent to the
             right person.</p>
        </div>
      </section>
      <section className="auth__panel">
        <h1>{title}</h1>
        {children}
      </section>
    </div>
  );
}
