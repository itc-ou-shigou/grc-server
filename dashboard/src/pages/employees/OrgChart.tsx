import { useTranslation } from 'react-i18next';
import { useEmployees, useRoleTemplates } from '../../api/hooks';
import { StatusBadge } from '../../components/StatusBadge';
import { ErrorMessage } from '../../components/ErrorMessage';

function timeAgo(date: string | null): string {
  if (!date) return '—';
  const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function isOnline(lastHeartbeat: string | null): boolean {
  if (!lastHeartbeat) return false;
  return Math.floor((Date.now() - new Date(lastHeartbeat).getTime()) / 1000) < 300;
}

export function OrgChart() {
  const { t } = useTranslation('employees');
  const { data: employeesData, isLoading: empLoading, error: empError } = useEmployees();
  const employees = employeesData?.data ?? [];
  const { data: rolesData, isLoading: rolesLoading, error: rolesError } = useRoleTemplates({ page_size: 500 });
  const roles = rolesData?.data ?? [];

  const error = empError || rolesError;
  const isLoading = empLoading || rolesLoading;

  if (error) return <ErrorMessage error={error as Error} />;

  if (isLoading) {
    return (
      <div className="page">
        <div className="page-header">
          <h1 className="page-title">{t('orgTitle')}</h1>
        </div>
        <p className="text-muted">Loading…</p>
      </div>
    );
  }

  // Group employees by roleId
  const grouped: Record<string, typeof employees> = {};
  const unassigned: typeof employees = [];

  for (const emp of employees) {
    if (!emp.roleId) {
      unassigned.push(emp);
    } else {
      if (!grouped[emp.roleId]) grouped[emp.roleId] = [];
      grouped[emp.roleId].push(emp);
    }
  }

  // Build a map from roleId -> role for display names
  const roleMap = new Map(roles.map(r => [r.id, r]));

  // Sort roles: builtin first, then by department
  const sortedRoleIds = Object.keys(grouped).sort((a, b) => {
    const ra = roleMap.get(a);
    const rb = roleMap.get(b);
    if (ra?.isBuiltin && !rb?.isBuiltin) return -1;
    if (!ra?.isBuiltin && rb?.isBuiltin) return 1;
    return (ra?.department ?? a).localeCompare(rb?.department ?? b);
  });

  // Group role columns by department
  const byDepartment: Record<string, string[]> = {};
  for (const roleId of sortedRoleIds) {
    const dept = roleMap.get(roleId)?.department ?? 'Other';
    if (!byDepartment[dept]) byDepartment[dept] = [];
    byDepartment[dept].push(roleId);
  }

  const departments = Object.keys(byDepartment).sort();

  const totalOnline = employees.filter(e => isOnline(e.lastHeartbeat)).length;

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">{t('orgTitle')}</h1>
          <p className="page-subtitle">{t('orgSubtitle')}</p>
        </div>
      </div>

      <div className="stat-grid" style={{ marginBottom: '1.5rem' }}>
        <div className="stat-card">
          <div className="stat-value">{employees.length}</div>
          <div className="stat-label">Total Agents</div>
        </div>
        <div className="stat-card">
          <div className="stat-value text-success">{totalOnline}</div>
          <div className="stat-label">Online</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{sortedRoleIds.length}</div>
          <div className="stat-label">Assigned Roles</div>
        </div>
        <div className="stat-card">
          <div className="stat-value text-warning">{unassigned.length}</div>
          <div className="stat-label">{t('noRole')}</div>
        </div>
      </div>

      {departments.map(dept => (
        <div key={dept} style={{ marginBottom: '2rem' }}>
          <h2 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            <span className="text-muted">{dept}</span>
          </h2>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1.25rem', alignItems: 'flex-start' }}>
            {byDepartment[dept].map(roleId => {
              const role = roleMap.get(roleId);
              const members = grouped[roleId] ?? [];
              const onlineCount = members.filter(e => isOnline(e.lastHeartbeat)).length;

              return (
                <div
                  key={roleId}
                  className="card"
                  style={{ minWidth: '220px', maxWidth: '300px', flex: '1 1 220px' }}
                >
                  <div style={{ borderBottom: '1px solid var(--color-border)', paddingBottom: '0.75rem', marginBottom: '0.75rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
                      <span style={{ fontWeight: 600, fontSize: '0.875rem' }}>
                        {role?.name ?? roleId}
                      </span>
                      {role?.isBuiltin && (
                        <span className="tag">builtin</span>
                      )}
                    </div>
                    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                      <StatusBadge status={role?.mode ?? 'unknown'} />
                      <span className="text-muted" style={{ fontSize: '0.75rem' }}>
                        {onlineCount}/{members.length} online
                      </span>
                    </div>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                    {members.map(emp => {
                      const online = isOnline(emp.lastHeartbeat);
                      return (
                        <div
                          key={emp.nodeId}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.5rem',
                            padding: '0.375rem 0.5rem',
                            borderRadius: '0.25rem',
                            background: 'rgba(12, 19, 36, 0.40)',
                          }}
                        >
                          <span
                            style={{
                              width: '8px',
                              height: '8px',
                              borderRadius: '50%',
                              flexShrink: 0,
                              background: online ? 'var(--color-success, #22c55e)' : 'var(--color-muted, #9ca3af)',
                            }}
                            title={online ? 'Online' : emp.lastHeartbeat ? `Last seen ${timeAgo(emp.lastHeartbeat)}` : 'Never seen'}
                          />
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontSize: '0.8125rem', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {emp.employeeName ?? 'Unknown'}
                            </div>
                            <div className="text-muted" style={{ fontSize: '0.6875rem' }}>
                              {online ? 'online' : timeAgo(emp.lastHeartbeat)}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {unassigned.length > 0 && (
        <div style={{ marginBottom: '2rem' }}>
          <h2 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            <span className="text-muted">{t('noRole')}</span>
          </h2>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
            {unassigned.map(emp => {
              const online = isOnline(emp.lastHeartbeat);
              return (
                <div
                  key={emp.nodeId}
                  className="card"
                  style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.5rem 0.75rem' }}
                >
                  <span
                    style={{
                      width: '8px',
                      height: '8px',
                      borderRadius: '50%',
                      flexShrink: 0,
                      background: online ? 'var(--color-success, #22c55e)' : 'var(--color-muted, #9ca3af)',
                    }}
                  />
                  <div>
                    <div style={{ fontSize: '0.8125rem', fontWeight: 500 }}>{emp.employeeName ?? 'Unknown'}</div>
                    <div className="text-muted" style={{ fontSize: '0.6875rem' }}>
                      {online ? 'online' : timeAgo(emp.lastHeartbeat)}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {employees.length === 0 && (
        <div className="card" style={{ textAlign: 'center', padding: '3rem' }}>
          <p className="text-muted">No agents registered yet.</p>
        </div>
      )}
    </div>
  );
}
