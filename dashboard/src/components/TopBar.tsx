import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useUser } from '../context/UserContext';
import { useNavigation, type TopCategory } from '../hooks/useNavigation';
import { NotificationCenter } from './NotificationCenter';

// ── Category definitions ──────────────────────────────────────────────────────

interface TopCategory_ {
  key: TopCategory;
  /** i18n key under sidebar.sections.* (or sidebar.nav.* for overview) */
  labelKey: string;
  /** Default path to navigate to when the tab is clicked */
  defaultPath: string;
  adminOnly?: boolean;
}

const TOP_CATEGORIES: TopCategory_[] = [
  { key: 'overview',     labelKey: 'nav.overview',        defaultPath: '/' },
  { key: 'lobsterNodes', labelKey: 'sections.lobsterNodes', defaultPath: '/evolution/nodes', adminOnly: true },
  { key: 'tasks',        labelKey: 'sections.tasks',       defaultPath: '/tasks',            adminOnly: true },
  { key: 'meetings',     labelKey: 'sections.meetings',    defaultPath: '/meetings',         adminOnly: true },
  { key: 'platform',     labelKey: 'sections.platform',    defaultPath: '/platform/values' },
  { key: 'roles',        labelKey: 'sections.roles',       defaultPath: '/roles',            adminOnly: true },
  { key: 'employees',    labelKey: 'sections.employees',   defaultPath: '/employees',        adminOnly: true },
  { key: 'skills',       labelKey: 'sections.skills',      defaultPath: '/skills' },
  { key: 'marketing',   labelKey: 'sections.marketing',   defaultPath: '/campaigns',        adminOnly: true },
  { key: 'evolution',    labelKey: 'sections.evolution',   defaultPath: '/evolution/assets' },
  { key: 'community',   labelKey: 'sections.community',   defaultPath: '/community/channels' },
  { key: 'settings',    labelKey: 'footer.settings',      defaultPath: '/settings' },
];

// ── Component ─────────────────────────────────────────────────────────────────

export function TopBar() {
  const { t } = useTranslation('sidebar');
  const { isAdmin, user } = useUser();
  const { activeCategory, setActiveCategory } = useNavigation();
  const navigate = useNavigate();

  const visibleCategories = TOP_CATEGORIES.filter(
    (cat) => !cat.adminOnly || isAdmin,
  );

  function handleTabClick(cat: TopCategory_) {
    setActiveCategory(cat.key);
    navigate(cat.defaultPath);
  }

  // User initials for avatar
  const initials = user?.displayName
    ? user.displayName
        .split(' ')
        .map((w) => w[0])
        .slice(0, 2)
        .join('')
        .toUpperCase()
    : 'U';

  return (
    <header
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        height: '56px',
        zIndex: 100,
        display: 'flex',
        alignItems: 'center',
        gap: 0,
        background: 'rgba(12,19,36,0.90)',
        backdropFilter: 'blur(24px)',
        WebkitBackdropFilter: 'blur(24px)',
        borderBottom: '1px solid rgba(66,72,89,0.15)',
      }}
    >
      {/* ── Logo ── */}
      <div
        style={{
          flexShrink: 0,
          width: '256px',
          display: 'flex',
          alignItems: 'center',
          paddingLeft: '20px',
          gap: '10px',
        }}
      >
        <span
          style={{
            fontSize: '20px',
            fontWeight: 800,
            letterSpacing: '-0.5px',
            background: 'linear-gradient(135deg, #81ecff 0%, #b287fe 100%)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            backgroundClip: 'text',
            lineHeight: 1,
          }}
        >
          GRC
        </span>
        <span
          style={{
            fontSize: '11px',
            fontWeight: 500,
            color: 'rgba(224,229,251,0.35)',
            letterSpacing: '0.05em',
          }}
        >
          Nebula
        </span>
      </div>

      {/* ── Tab bar ── */}
      <nav
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'stretch',
          height: '100%',
          overflowX: 'auto',
          scrollbarWidth: 'none',
        }}
      >
        {visibleCategories.map((cat) => {
          const isActive = activeCategory === cat.key;
          return (
            <button
              key={cat.key}
              onClick={() => handleTabClick(cat)}
              style={{
                flexShrink: 0,
                height: '100%',
                padding: '0 14px',
                background: 'none',
                border: 'none',
                borderBottom: isActive
                  ? '2px solid #81ecff'
                  : '2px solid transparent',
                borderTop: '2px solid transparent',
                cursor: 'pointer',
                fontSize: '13px',
                fontWeight: isActive ? 600 : 400,
                color: isActive
                  ? '#81ecff'
                  : 'rgba(224,229,251,0.55)',
                letterSpacing: '0.01em',
                transition: 'color 0.15s, border-color 0.15s',
                whiteSpace: 'nowrap',
              }}
              onMouseEnter={(e) => {
                if (!isActive) {
                  (e.currentTarget as HTMLButtonElement).style.color = '#e0e5fb';
                }
              }}
              onMouseLeave={(e) => {
                if (!isActive) {
                  (e.currentTarget as HTMLButtonElement).style.color =
                    'rgba(224,229,251,0.55)';
                }
              }}
            >
              {t(cat.labelKey)}
            </button>
          );
        })}
      </nav>

      {/* ── Right controls ── */}
      <div
        style={{
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          gap: '4px',
          paddingRight: '16px',
        }}
      >
        {/* Notification Center */}
        <NotificationCenter />

        {/* User avatar */}
        <div
          style={{
            width: '32px',
            height: '32px',
            borderRadius: '50%',
            background: 'linear-gradient(135deg, rgba(129,236,255,0.25) 0%, rgba(178,135,254,0.25) 100%)',
            border: '1px solid rgba(129,236,255,0.3)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '11px',
            fontWeight: 700,
            color: '#81ecff',
            cursor: 'default',
            flexShrink: 0,
            marginLeft: '4px',
          }}
          title={user?.displayName ?? user?.email ?? ''}
        >
          {initials}
        </div>
      </div>
    </header>
  );
}
