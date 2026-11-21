import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './AuthProvider';
import { roleHome } from './roleHome';
import type { Role } from '../api/types';

function FullScreenMessage({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-[60dvh] place-items-center px-6 text-center text-caption text-ink-3">
      {children}
    </div>
  );
}

/** Any signed-in user. Sends anonymous visitors to /login and remembers where they were going. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const location = useLocation();
  if (status === 'loading') return <FullScreenMessage>…</FullScreenMessage>;
  if (status === 'anon') return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <>{children}</>;
}

/**
 * Role gate. A signed-in user who lacks the role is sent to their own home
 * rather than shown a 403 page - the server is still the real authority
 * (AC-01.2), this only avoids dead ends in the UI.
 */
export function RequireRole({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const { status, session } = useAuth();
  const location = useLocation();
  if (status === 'loading') return <FullScreenMessage>…</FullScreenMessage>;
  if (status === 'anon' || !session) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (!roles.includes(session.user.role)) return <Navigate to={roleHome(session.user)} replace />;
  return <>{children}</>;
}

/** Signed-in users should not sit on /login. */
export function RedirectIfAuthed({ children }: { children: ReactNode }) {
  const { status, session } = useAuth();
  if (status === 'authed' && session) return <Navigate to={roleHome(session.user)} replace />;
  return <>{children}</>;
}
