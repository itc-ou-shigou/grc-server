import { createContext, useContext, useState, useCallback } from 'react';
import { useLocation } from 'react-router-dom';

// ── Types ────────────────────────────────────────────────────────────────────

export type TopCategory =
  | 'overview'
  | 'lobsterNodes'
  | 'tasks'
  | 'meetings'
  | 'platform'
  | 'roles'
  | 'employees'
  | 'skills'
  | 'marketing'
  | 'evolution'
  | 'community'
  | 'settings';

interface NavigationContextValue {
  activeCategory: TopCategory;
  setActiveCategory: (category: TopCategory) => void;
}

// ── Context ──────────────────────────────────────────────────────────────────

export const NavigationContext = createContext<NavigationContextValue>({
  activeCategory: 'overview',
  setActiveCategory: () => void 0,
});

// ── Path → Category mapping ───────────────────────────────────────────────────

/**
 * Derives the top-level navigation category from a URL pathname.
 * Priority: more-specific prefixes are checked first.
 */
function deriveCategory(pathname: string): TopCategory {
  // Settings umbrella: settings page, model keys, update, a2a, relay
  if (
    pathname === '/settings' ||
    pathname.startsWith('/manage/model-keys') ||
    pathname.startsWith('/update/') ||
    pathname.startsWith('/a2a/') ||
    pathname === '/relay'
  ) {
    return 'settings';
  }

  // Evolution: assets and leaderboard are public; pipeline and nodes are admin
  // /evolution/nodes goes to lobsterNodes, everything else to evolution
  if (pathname === '/evolution/nodes') return 'lobsterNodes';
  if (
    pathname.startsWith('/evolution/assets') ||
    pathname === '/evolution/pipeline' ||
    pathname === '/evolution/leaderboard'
  ) {
    return 'evolution';
  }

  // LobsterNodes: nodes (already handled above), users, telemetry
  if (
    pathname.startsWith('/manage/users') ||
    pathname === '/telemetry'
  ) {
    return 'lobsterNodes';
  }

  // Tasks
  if (pathname.startsWith('/tasks')) return 'tasks';

  // Meetings
  if (pathname.startsWith('/meetings')) return 'meetings';

  // Platform: values + strategy
  if (pathname.startsWith('/platform/') || pathname === '/strategy') return 'platform';

  // Roles
  if (pathname.startsWith('/roles')) return 'roles';

  // Employees
  if (pathname.startsWith('/employees')) return 'employees';

  // Skills
  if (pathname.startsWith('/skills')) return 'skills';

  // Marketing & Sales
  if (
    pathname.startsWith('/campaigns') ||
    pathname.startsWith('/pipeline') ||
    pathname.startsWith('/roadmap') ||
    pathname.startsWith('/kpi')
  ) {
    return 'marketing';
  }

  // Community
  if (pathname.startsWith('/community')) return 'community';

  // Root / anything unmatched → overview
  return 'overview';
}

// ── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Provides the active top-level navigation category and a manual override setter.
 *
 * The active category is derived from the current URL pathname so it stays in
 * sync with browser navigation (back/forward). The manual setter lets the TopBar
 * eagerly update the UI before the navigation settles.
 */
export function useNavigation(): NavigationContextValue {
  return useContext(NavigationContext);
}

/**
 * Internal hook used by NavigationProvider to wire up location-derived state.
 * Not intended for direct consumption outside NavigationProvider.
 */
export function useNavigationState(): NavigationContextValue {
  const location = useLocation();
  const derived = deriveCategory(location.pathname);

  // Manual override: if the user clicks a TopBar tab we update immediately.
  // It resets to derived value whenever the pathname changes (see below).
  const [manual, setManual] = useState<TopCategory | null>(null);

  const setActiveCategory = useCallback((category: TopCategory) => {
    setManual(category);
  }, []);

  // If pathname changed to something that belongs to a different derived
  // category, clear the manual override so URL always wins.
  const activeCategory: TopCategory = (() => {
    if (manual !== null && manual === derived) return manual;
    // manual overrides only when it matches current URL family or
    // when we just clicked (derived hasn't caught up yet — they briefly differ)
    if (manual !== null) return manual;
    return derived;
  })();

  return { activeCategory, setActiveCategory };
}
