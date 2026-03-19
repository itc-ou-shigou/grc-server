import { useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { forceLogout } from '../api/client';
import { useUser } from '../context/UserContext';
import { NotificationCenter } from './NotificationCenter';

interface NavItem {
  /** i18n key for sidebar.items.{labelKey} */
  labelKey: string;
  path: string;
  adminOnly?: boolean;
}

interface NavSection {
  /** i18n key for sidebar.sections.{sectionKey} */
  sectionKey: string;
  icon: string;
  items: NavItem[];
  /** If true, the entire section is hidden for non-admin users */
  adminOnly?: boolean;
}

const NAV_SECTIONS: NavSection[] = [
  // ── 龙虾节点 ──
  {
    sectionKey: 'lobsterNodes',
    icon: '\u{1F99E}',
    adminOnly: true,
    items: [
      { labelKey: 'nodes', path: '/evolution/nodes' },
      { labelKey: 'users', path: '/manage/users' },
      { labelKey: 'insights', path: '/telemetry' },
    ],
  },
  // ── 任务 ──
  {
    sectionKey: 'tasks',
    icon: '\u{1F4CB}',
    adminOnly: true,
    items: [
      { labelKey: 'taskBoard', path: '/tasks' },
      { labelKey: 'taskStats', path: '/tasks/stats' },
      { labelKey: 'expenses', path: '/tasks/expenses' },
    ],
  },
  // ── 会议 ──
  {
    sectionKey: 'meetings',
    icon: '\u{1F91D}',
    adminOnly: true,
    items: [
      { labelKey: 'allMeetings', path: '/meetings' },
      { labelKey: 'createMeeting', path: '/meetings/create' },
      { labelKey: 'autoTriggers', path: '/meetings/triggers' },
    ],
  },
  // ── 组织 (含组织价值观 + 战略) ──
  {
    sectionKey: 'platform',
    icon: '\u{2728}',
    items: [
      { labelKey: 'values', path: '/platform/values' },
      { labelKey: 'strategy', path: '/strategy', adminOnly: true },
    ],
  },
  // ── 角色 ──
  {
    sectionKey: 'roles',
    icon: '\u{1F3AD}',
    adminOnly: true,
    items: [
      { labelKey: 'roleTemplates', path: '/roles' },
      { labelKey: 'createRole', path: '/roles/create' },
      { labelKey: 'aiWizard', path: '/roles/create-wizard', adminOnly: true },
    ],
  },
  // ── 员工 ──
  {
    sectionKey: 'employees',
    icon: '\u{1F465}',
    adminOnly: true,
    items: [
      { labelKey: 'employeeList', path: '/employees' },
      { labelKey: 'orgChart', path: '/employees/org' },
    ],
  },
  // ── 技能 ──
  {
    sectionKey: 'skills',
    icon: '\u{1F527}',
    items: [
      { labelKey: 'skillList', path: '/skills' },
      { labelKey: 'skillStats', path: '/skills/stats' },
    ],
  },
  // ── マーケティング・営業 ──
  {
    sectionKey: 'marketing',
    icon: '\u{1F4CA}',
    adminOnly: true,
    items: [
      { labelKey: 'campaigns', path: '/campaigns', adminOnly: true },
      { labelKey: 'pipelineBoard', path: '/pipeline', adminOnly: true },
      { labelKey: 'roadmap', path: '/roadmap', adminOnly: true },
      { labelKey: 'kpi', path: '/kpi', adminOnly: true },
    ],
  },
  // ── 进化 ──
  {
    sectionKey: 'evolution',
    icon: '\u{1F9EC}',
    items: [
      { labelKey: 'assets', path: '/evolution/assets' },
      { labelKey: 'pipeline', path: '/evolution/pipeline', adminOnly: true },
      { labelKey: 'leaderboard', path: '/evolution/leaderboard' },
    ],
  },
  // ── 社区 ──
  {
    sectionKey: 'community',
    icon: '\u{1F4AC}',
    items: [
      { labelKey: 'channels', path: '/community/channels' },
      { labelKey: 'topics', path: '/community/topics' },
      { labelKey: 'moderation', path: '/community/moderation', adminOnly: true },
    ],
  },
  // ── 更新 ──
  {
    sectionKey: 'update',
    icon: '\u{1F504}',
    items: [
      { labelKey: 'releases', path: '/update/releases' },
      { labelKey: 'updateStats', path: '/update/stats' },
    ],
  },
  // ── 密钥管理 ──
  {
    sectionKey: 'auth',
    icon: '\u{1F511}',
    adminOnly: true,
    items: [
      { labelKey: 'modelKeys', path: '/manage/model-keys' },
      { labelKey: 'keyDistribute', path: '/manage/model-keys/distribute' },
    ],
  },
];

function isSectionActive(section: NavSection, pathname: string): boolean {
  return section.items.some((item) => pathname.startsWith(item.path));
}

export function Sidebar() {
  const location = useLocation();
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const { isAdmin } = useUser();
  const { t } = useTranslation('sidebar');

  // Filter sections and items based on role
  const visibleSections = NAV_SECTIONS
    .filter((section) => !section.adminOnly || isAdmin)
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => !item.adminOnly || isAdmin),
    }))
    .filter((section) => section.items.length > 0);

  function toggleSection(key: string) {
    setCollapsed((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  function isSectionOpen(section: NavSection): boolean {
    if (collapsed[section.sectionKey] !== undefined) {
      return !collapsed[section.sectionKey];
    }
    return isSectionActive(section, location.pathname);
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <div className="sidebar-logo">
          <span className="sidebar-logo-icon">G</span>
          <div>
            <div className="sidebar-title">{isAdmin ? t('header.admin') : t('header.dashboard')}</div>
            <div className="sidebar-subtitle">{t('header.subtitle')}</div>
          </div>
        </div>
      </div>

      <nav className="sidebar-nav">
        <NavLink
          to="/"
          end
          className={({ isActive }) => `sidebar-nav-single${isActive ? ' active' : ''}`}
        >
          <span className="nav-icon">🏠</span>
          <span>{t('nav.overview')}</span>
        </NavLink>

        {visibleSections.map((section) => {
          const open = isSectionOpen(section);
          const active = isSectionActive(section, location.pathname);
          return (
            <div key={section.sectionKey} className="sidebar-section">
              <button
                className={`sidebar-section-btn${active ? ' active' : ''}`}
                onClick={() => toggleSection(section.sectionKey)}
              >
                <span className="nav-icon">{section.icon}</span>
                <span className="section-label">{t(`sections.${section.sectionKey}`)}</span>
                <span className={`section-chevron${open ? ' open' : ''}`}>›</span>
              </button>
              {open && (
                <div className="sidebar-section-items">
                  {section.items.map((item) => (
                    <NavLink
                      key={item.path}
                      to={item.path}
                      end={item.path === '/skills'}
                      className={({ isActive }) => `sidebar-nav-item${isActive ? ' active' : ''}`}
                    >
                      {t(`items.${item.labelKey}`)}
                    </NavLink>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      <div className="sidebar-footer">
        {/* Quick Meeting button */}
        <div style={{ padding: '6px 12px', marginBottom: '4px' }}>
          <button
            onClick={() => navigate('/meetings/create')}
            style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              padding: '7px 12px',
              background: 'var(--color-primary, #3b82f6)',
              color: '#fff',
              border: 'none',
              borderRadius: 'var(--radius-md, 6px)',
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'opacity 0.15s',
            }}
            onMouseOver={(e) => (e.currentTarget.style.opacity = '0.85')}
            onMouseOut={(e) => (e.currentTarget.style.opacity = '1')}
          >
            <span>&#9889;</span>
            <span>クイック会議</span>
          </button>
        </div>

        {/* Notification Center — community bell */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '6px 12px',
          borderBottom: '1px solid var(--color-sidebar-border)',
          marginBottom: '4px',
        }}>
          <span style={{ fontSize: '12px', color: 'var(--color-sidebar-text)', fontWeight: 500 }}>
            Community
          </span>
          <NotificationCenter />
        </div>

        {/* Settings link */}
        <NavLink
          to="/settings"
          className={({ isActive }) => `sidebar-settings-btn${isActive ? ' active' : ''}`}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
          <span>{t('footer.settings')}</span>
        </NavLink>

        {/* Logout button */}
        <button
          className="sidebar-logout-btn"
          onClick={() => {
            forceLogout();
          }}
          title={t('footer.logout')}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
            <polyline points="16 17 21 12 16 7" />
            <line x1="21" y1="12" x2="9" y2="12" />
          </svg>
          <span>{t('footer.logout')}</span>
        </button>
        <div className="sidebar-footer-text">{t('footer.version', { version: '0.1.0' })}</div>
      </div>
    </aside>
  );
}
