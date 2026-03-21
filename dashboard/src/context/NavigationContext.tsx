import { type ReactNode } from 'react';
import { NavigationContext, useNavigationState } from '../hooks/useNavigation';

/**
 * Wraps the app (inside BrowserRouter) to provide top-level navigation state
 * shared between TopBar and Sidebar.
 */
export function NavigationProvider({ children }: { children: ReactNode }) {
  const value = useNavigationState();
  return (
    <NavigationContext.Provider value={value}>
      {children}
    </NavigationContext.Provider>
  );
}
