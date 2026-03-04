import { Navigate } from 'react-router-dom';
import { useUser } from '../context/UserContext';

/**
 * Route guard for admin-only pages.
 * - Loading: renders nothing (prevents redirect flash)
 * - Non-admin: redirects to "/"
 * - Admin: renders children
 */
export function AdminRoute({ children }: { children: React.ReactNode }) {
  const { isAdmin, isLoading } = useUser();

  if (isLoading) {
    return null;
  }

  if (!isAdmin) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}
