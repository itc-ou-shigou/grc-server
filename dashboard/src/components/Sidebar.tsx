import { NavLink, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { forceLogout } from '../api/client';
import { useUser } from '../context/UserContext';
import { useNavigation, type TopCategory } from '../hooks/useNavigation';

// ── Types ─────────────────────────────────────────────────────────────────────

interface NavItem {
  /** i18n key for sidebar.items.{labelKey} */
  labelKey: string;
  path: string;
  adminOnly?: boolean;
  /** Pass `true` for paths where an exact match is needed (e.g. /skills) */
  exact?: boolean;
}

interface NavSection {
  /** Matches the TopCategory key */
  categoryKey: TopCategory;
  items: NavItem[];
}

// ── Section definitions ───────────────────────────────────────────────────────

const NAV_SECTIONS: NavSection[] = [
  // overview — no sub-items; sidebar is hidden
  {
    categoryKey: 'overview',
    items: [],
  },
  // 龙虾节点
  {
    categoryKey: 'lobsterNodes',
    items: [
      { labelKey: 'nodes',    path: '/evolution/nodes' },
      { labelKey: 'users',    path: '/manage/users' },
      { labelKey: 'insights', path: '/telemetry' },
    ],
  },
  // 任务
  {
    categoryKey: 'tasks',
    items: [
      { labelKey: 'taskBoard',  path: '/tasks',          exact: true },
      { labelKey: 'taskStats',  path: '/tasks/stats' },
      { labelKey: 'expenses',   path: '/tasks/expenses' },
    ],
  },
  // 会議
  {
    categoryKey: 'meetings',
    items: [
      { labelKey: 'allMeetings',   path: '/meetings',          exact: true },
      { labelKey: 'createMeeting', path: '/meetings/create' },
      { labelKey: 'autoTriggers',  path: '/meetings/triggers' },
    ],
  },
  // 组织
  {
    categoryKey: 'platform',
    items: [
      { labelKey: 'values',   path: '/platform/values' },
      { labelKey: 'strategy', path: '/strategy', adminOnly: true },
    ],
  },
  // 角色
  {
    categoryKey: 'roles',
    items: [
      { labelKey: 'roleTemplates', path: '/roles',               exact: true },
      { labelKey: 'createRole',    path: '/roles/create',        exact: true },
      { labelKey: 'aiWizard',      path: '/roles/create-wizard', adminOnly: true },
      { labelKey: 'skillCatalog',  path: '/roles/skills',        adminOnly: true },
    ],
  },
  // 员工
  {
    categoryKey: 'employees',
    items: [
      { labelKey: 'employeeList', path: '/employees',     exact: true },
      { labelKey: 'orgChart',     path: '/employees/org' },
    ],
  },
  // 技能
  {
    categoryKey: 'skills',
    items: [
      { labelKey: 'skillList',  path: '/skills',       exact: true },
      { labelKey: 'skillStats', path: '/skills/stats' },
    ],
  },
  // マーケティング
  {
    categoryKey: 'marketing',
    items: [
      { labelKey: 'campaigns',     path: '/campaigns', adminOnly: true },
      { labelKey: 'pipelineBoard', path: '/pipeline',  adminOnly: true },
      { labelKey: 'roadmap',       path: '/roadmap',   adminOnly: true },
      { labelKey: 'kpi',           path: '/kpi',       adminOnly: true },
    ],
  },
  // 进化
  {
    categoryKey: 'evolution',
    items: [
      { labelKey: 'assets',      path: '/evolution/assets',       exact: true },
      { labelKey: 'pipeline',    path: '/evolution/pipeline',     adminOnly: true },
      { labelKey: 'leaderboard', path: '/evolution/leaderboard' },
    ],
  },
  // 社区
  {
    categoryKey: 'community',
    items: [
      { labelKey: 'channels',   path: '/community/channels' },
      { labelKey: 'topics',     path: '/community/topics',     exact: true },
      { labelKey: 'moderation', path: '/community/moderation', adminOnly: true },
    ],
  },
  // Settings (update + auth combined)
  {
    categoryKey: 'settings',
    items: [
      { labelKey: 'modelKeys',    path: '/manage/model-keys',            exact: true, adminOnly: true },
      { labelKey: 'keyDistribute',path: '/manage/model-keys/distribute', adminOnly: true },
      { labelKey: 'releases',     path: '/update/releases' },
      { labelKey: 'updateStats',  path: '/update/stats' },
      { labelKey: 'relayLog',     path: '/relay',                        adminOnly: true },
    ],
  },
];

// ── Component ─────────────────────────────────────────────────────────────────

export function Sidebar() {
  const navigate = useNavigate();
  const { isAdmin } = useUser();
  const { t } = useTranslation('sidebar');
  const { activeCategory } = useNavigation();

  // Find the section that matches the active top-level category
  const section = NAV_SECTIONS.find((s) => s.categoryKey === activeCategory);

  // Filter items based on admin role
  const visibleItems = (section?.items ?? []).filter(
    (item) => !item.adminOnly || isAdmin,
  );

  // Hide sidebar entirely on overview or when there are no items
  if (activeCategory === 'overview' || visibleItems.length === 0) {
    return null;
  }

  return (
    <aside
      style={{
        position: 'fixed',
        top: '56px',
        left: 0,
        bottom: 0,
        width: '256px',
        display: 'flex',
        flexDirection: 'column',
        background: 'rgba(12,19,36,0.60)',
        backdropFilter: 'blur(24px)',
        WebkitBackdropFilter: 'blur(24px)',
        borderRight: '1px solid rgba(66,72,89,0.15)',
        zIndex: 90,
        overflowY: 'auto',
        scrollbarWidth: 'thin',
        scrollbarColor: 'rgba(66,72,89,0.4) transparent',
      }}
    >
      {/* ── Nav items ── */}
      <nav style={{ flex: 1, paddingTop: '12px', paddingBottom: '8px' }}>
        {visibleItems.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            end={item.exact}
            style={{ display: 'block', textDecoration: 'none' }}
          >
            {({ isActive }) => (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  height: '40px',
                  paddingLeft: '20px',
                  paddingRight: '16px',
                  marginBottom: '2px',
                  fontSize: '13px',
                  fontWeight: isActive ? 600 : 400,
                  borderLeft: isActive
                    ? '4px solid #81ecff'
                    : '4px solid transparent',
                  background: isActive
                    ? 'linear-gradient(90deg, rgba(129,236,255,0.15) 0%, transparent 100%)'
                    : 'transparent',
                  color: isActive
                    ? '#81ecff'
                    : 'rgba(224,229,251,0.55)',
                  cursor: 'pointer',
                  transition: 'color 0.15s, background 0.15s, border-color 0.15s',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
                onMouseEnter={(e) => {
                  if (!isActive) {
                    const el = e.currentTarget as HTMLDivElement;
                    el.style.color = '#e0e5fb';
                    el.style.background = 'rgba(29,37,59,0.3)';
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isActive) {
                    const el = e.currentTarget as HTMLDivElement;
                    el.style.color = 'rgba(224,229,251,0.55)';
                    el.style.background = 'transparent';
                  }
                }}
              >
                {t(`items.${item.labelKey}`)}
              </div>
            )}
          </NavLink>
        ))}
      </nav>

      {/* ── Footer ── */}
      <div
        style={{
          flexShrink: 0,
          borderTop: '1px solid rgba(66,72,89,0.15)',
          paddingTop: '8px',
          paddingBottom: '12px',
        }}
      >
        {/* Quick Meeting button */}
        <div style={{ padding: '4px 12px 6px' }}>
          <button
            onClick={() => navigate('/meetings/create')}
            style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
              padding: '7px 12px',
              background: 'linear-gradient(135deg, rgba(129,236,255,0.2) 0%, rgba(178,135,254,0.2) 100%)',
              border: '1px solid rgba(129,236,255,0.25)',
              borderRadius: '8px',
              color: '#81ecff',
              fontSize: '12px',
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'opacity 0.15s, border-color 0.15s',
              letterSpacing: '0.02em',
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.opacity = '0.8';
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.opacity = '1';
            }}
          >
            <span>&#9889;</span>
            <span>クイック会議</span>
          </button>
        </div>

        {/* Logout button */}
        <button
          onClick={() => forceLogout()}
          title={t('footer.logout')}
          style={{
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '8px 20px',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            fontSize: '12px',
            fontWeight: 500,
            color: 'rgba(224,229,251,0.4)',
            transition: 'color 0.15s',
            textAlign: 'left',
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.color =
              'rgba(255,100,100,0.8)';
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.color =
              'rgba(224,229,251,0.4)';
          }}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
            <polyline points="16 17 21 12 16 7" />
            <line x1="21" y1="12" x2="9" y2="12" />
          </svg>
          <span>{t('footer.logout')}</span>
        </button>

        {/* Version */}
        <div
          style={{
            padding: '2px 20px 0',
            fontSize: '10px',
            color: 'rgba(224,229,251,0.2)',
            letterSpacing: '0.04em',
          }}
        >
          {t('footer.version', { version: '0.1.0' })}
        </div>
      </div>
    </aside>
  );
}
