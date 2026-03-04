import { useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { forceLogout } from '../api/client';
import { useUser } from '../context/UserContext';

interface NavItem {
  label: string;
  path: string;
  adminOnly?: boolean;
}

interface NavSection {
  label: string;
  icon: string;
  items: NavItem[];
  /** If true, the entire section is hidden for non-admin users */
  adminOnly?: boolean;
}

const NAV_SECTIONS: NavSection[] = [
  {
    label: 'Auth',
    icon: '\u{1F464}',
    adminOnly: true, // Entire section is admin-only (Users, API Keys)
    items: [
      { label: 'Users', path: '/manage/users' },
      { label: 'API Keys', path: '/manage/apikeys' },
    ],
  },
  {
    label: 'Skills',
    icon: '\u{1F527}',
    items: [
      { label: 'Skill List', path: '/skills' },
      { label: 'Skill Stats', path: '/skills/stats' },
    ],
  },
  {
    label: 'Evolution',
    icon: '\u{1F9EC}',
    items: [
      { label: 'Assets', path: '/evolution/assets' },
      { label: 'Nodes', path: '/evolution/nodes', adminOnly: true },
      { label: 'Pipeline', path: '/evolution/pipeline', adminOnly: true },
    ],
  },
  {
    label: 'Update',
    icon: '\u{1F504}',
    items: [
      { label: 'Releases', path: '/update/releases' },
      { label: 'Update Stats', path: '/update/stats' },
    ],
  },
  {
    label: 'Telemetry',
    icon: '\u{1F4CA}',
    items: [{ label: 'Insights', path: '/telemetry' }],
  },
  {
    label: 'Community',
    icon: '\u{1F4AC}',
    items: [
      { label: 'Channels', path: '/community/channels' },
      { label: 'Topics', path: '/community/topics' },
      { label: 'Moderation', path: '/community/moderation', adminOnly: true },
    ],
  },
  {
    label: 'Platform',
    icon: '\u{2728}',
    items: [
      { label: 'Values', path: '/platform/values' },
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

  // Filter sections and items based on role
  const visibleSections = NAV_SECTIONS
    .filter((section) => !section.adminOnly || isAdmin)
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => !item.adminOnly || isAdmin),
    }))
    .filter((section) => section.items.length > 0);

  function toggleSection(label: string) {
    setCollapsed((prev) => ({ ...prev, [label]: !prev[label] }));
  }

  function isSectionOpen(section: NavSection): boolean {
    if (collapsed[section.label] !== undefined) {
      return !collapsed[section.label];
    }
    return isSectionActive(section, location.pathname);
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <div className="sidebar-logo">
          <span className="sidebar-logo-icon">G</span>
          <div>
            <div className="sidebar-title">GRC {isAdmin ? 'Admin' : 'Dashboard'}</div>
            <div className="sidebar-subtitle">Dashboard</div>
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
          <span>Overview</span>
        </NavLink>

        {visibleSections.map((section) => {
          const open = isSectionOpen(section);
          const active = isSectionActive(section, location.pathname);
          return (
            <div key={section.label} className="sidebar-section">
              <button
                className={`sidebar-section-btn${active ? ' active' : ''}`}
                onClick={() => toggleSection(section.label)}
              >
                <span className="nav-icon">{section.icon}</span>
                <span className="section-label">{section.label}</span>
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
                      {item.label}
                    </NavLink>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      <div className="sidebar-footer">
        <button
          className="sidebar-logout-btn"
          onClick={() => {
            forceLogout();
          }}
          title="Logout"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
            <polyline points="16 17 21 12 16 7" />
            <line x1="21" y1="12" x2="9" y2="12" />
          </svg>
          <span>Logout</span>
        </button>
        <div className="sidebar-footer-text">GRC v0.1.0</div>
      </div>
    </aside>
  );
}
