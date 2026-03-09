import { useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { forceLogout } from '../api/client';
import { useUser } from '../context/UserContext';

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
  {
    sectionKey: 'auth',
    icon: '\u{1F464}',
    adminOnly: true,
    items: [
      { labelKey: 'users', path: '/manage/users' },
      { labelKey: 'apiKeys', path: '/manage/apikeys' },
    ],
  },
  {
    sectionKey: 'skills',
    icon: '\u{1F527}',
    items: [
      { labelKey: 'skillList', path: '/skills' },
      { labelKey: 'skillStats', path: '/skills/stats' },
    ],
  },
  {
    sectionKey: 'evolution',
    icon: '\u{1F9EC}',
    items: [
      { labelKey: 'assets', path: '/evolution/assets' },
      { labelKey: 'nodes', path: '/evolution/nodes', adminOnly: true },
      { labelKey: 'pipeline', path: '/evolution/pipeline', adminOnly: true },
    ],
  },
  {
    sectionKey: 'update',
    icon: '\u{1F504}',
    items: [
      { labelKey: 'releases', path: '/update/releases' },
      { labelKey: 'updateStats', path: '/update/stats' },
    ],
  },
  {
    sectionKey: 'telemetry',
    icon: '\u{1F4CA}',
    items: [{ labelKey: 'insights', path: '/telemetry' }],
  },
  {
    sectionKey: 'community',
    icon: '\u{1F4AC}',
    items: [
      { labelKey: 'channels', path: '/community/channels' },
      { labelKey: 'topics', path: '/community/topics' },
      { labelKey: 'moderation', path: '/community/moderation', adminOnly: true },
    ],
  },
  {
    sectionKey: 'employees',
    icon: '\u{1F465}',
    adminOnly: true,
    items: [
      { labelKey: 'employeeList', path: '/employees' },
      { labelKey: 'orgChart', path: '/employees/org' },
    ],
  },
  {
    sectionKey: 'roles',
    icon: '\u{1F3AD}',
    adminOnly: true,
    items: [
      { labelKey: 'roleTemplates', path: '/roles' },
      { labelKey: 'createRole', path: '/roles/create' },
    ],
  },
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
  {
    sectionKey: 'strategy',
    icon: '\u{1F3AF}',
    adminOnly: true,
    items: [
      { labelKey: 'strategy', path: '/strategy' },
    ],
  },
  {
    sectionKey: 'a2aAgents',
    icon: '\u{1F916}',
    adminOnly: true,
    items: [
      { labelKey: 'agentCards', path: '/a2a/agents' },
    ],
  },
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
  {
    sectionKey: 'relay',
    icon: '\u{1F4E8}',
    adminOnly: true,
    items: [
      { labelKey: 'relayLog', path: '/relay' },
    ],
  },
  {
    sectionKey: 'platform',
    icon: '\u{2728}',
    items: [
      { labelKey: 'values', path: '/platform/values' },
    ],
  },
];

function isSectionActive(section: NavSection, pathname: string): boolean {
  return section.items.some((item) => pathname.startsWith(item.path));
}

export function Sidebar() {
  const location = useLocation();
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
