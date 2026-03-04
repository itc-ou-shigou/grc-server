import { createContext, useContext, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiClient, forceLogout } from '../api/client';

// ── Types ────────────────────────────────────────────────────────

interface UserProfile {
  id: string;
  displayName: string;
  email: string;
  tier: string;
  role: string;
  provider: string;
}

interface UserContextValue {
  /** User profile data (null while loading or on error) */
  user: UserProfile | null;
  /** Whether the current user has admin role */
  isAdmin: boolean;
  /** Whether the profile is still being fetched */
  isLoading: boolean;
  /** Error message if the fetch failed (non-401) */
  error: string | null;
}

// ── Context ──────────────────────────────────────────────────────

const UserContext = createContext<UserContextValue>({
  user: null,
  isAdmin: false,
  isLoading: true,
  error: null,
});

// ── Provider ─────────────────────────────────────────────────────

export function UserProvider({ children }: { children: ReactNode }) {
  const { data, isLoading, error } = useQuery<{ user: UserProfile }>({
    queryKey: ['auth', 'me'],
    queryFn: async () => {
      try {
        return await apiClient.get<{ user: UserProfile }>('/api/v1/admin/auth/me');
      } catch (err: unknown) {
        // 401 is handled by apiClient (forceLogout), but just in case
        if (err instanceof Error && err.message.includes('401')) {
          forceLogout();
        }
        throw err;
      }
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
    retry: false, // Don't retry auth failures
  });

  const user = data?.user ?? null;

  const value: UserContextValue = {
    user,
    // Safe default: not admin until proven otherwise
    isAdmin: user?.role === 'admin',
    isLoading,
    error: error instanceof Error ? error.message : null,
  };

  return (
    <UserContext.Provider value={value}>
      {children}
    </UserContext.Provider>
  );
}

// ── Hook ─────────────────────────────────────────────────────────

export function useUser(): UserContextValue {
  return useContext(UserContext);
}
