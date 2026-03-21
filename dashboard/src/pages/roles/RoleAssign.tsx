import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useRoleTemplate, useEmployees, useAssignRole } from '../../api/hooks';
import { StatusBadge } from '../../components/StatusBadge';
import { Modal } from '../../components/Modal';
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

interface AssignModalState {
  open: boolean;
  nodeId: string;
  employeeName: string;
}

export function RoleAssign() {
  const { t } = useTranslation('roles');
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: roleData, isLoading: roleLoading, error: roleError } = useRoleTemplate(id ?? '');
  const role = roleData?.data;
  const { data: employeesData, isLoading: empLoading, error: empError } = useEmployees();
  const employees = employeesData?.data ?? [];
  const assignRole = useAssignRole();

  const [assignModal, setAssignModal] = useState<AssignModalState>({ open: false, nodeId: '', employeeName: '' });
  const [selectedMode, setSelectedMode] = useState<'autonomous' | 'copilot'>('autonomous');
  const [variablesJson, setVariablesJson] = useState('');
  const [jsonError, setJsonError] = useState('');
  const [search, setSearch] = useState('');

  const unassigned = employees.filter(e => e.roleId === null);
  const filtered = search
    ? unassigned.filter(e =>
        (e.employeeName ?? '').toLowerCase().includes(search.toLowerCase()) ||
        (e.employeeEmail ?? '').toLowerCase().includes(search.toLowerCase()) ||
        (e.nodeId ?? '').toLowerCase().includes(search.toLowerCase())
      )
    : unassigned;

  const alreadyAssigned = employees.filter(e => e.roleId === id);

  const handleOpenAssign = (nodeId: string, employeeName: string) => {
    setAssignModal({ open: true, nodeId, employeeName });
    setSelectedMode((role?.mode) ?? 'autonomous');
    setVariablesJson('');
    setJsonError('');
  };

  const handleAssign = async () => {
    let variables: unknown = undefined;
    if (variablesJson.trim()) {
      try {
        variables = JSON.parse(variablesJson);
        setJsonError('');
      } catch {
        setJsonError('Invalid JSON. Please fix before assigning.');
        return;
      }
    }

    await assignRole.mutateAsync({
      nodeId: assignModal.nodeId,
      roleId: id!,
      mode: selectedMode,
      ...(variables !== undefined && { variables: variables as Record<string, string> }),
    });

    setAssignModal({ open: false, nodeId: '', employeeName: '' });
  };

  const handleVariablesChange = (value: string) => {
    setVariablesJson(value);
    if (value.trim()) {
      try {
        JSON.parse(value);
        setJsonError('');
      } catch {
        setJsonError('Invalid JSON');
      }
    } else {
      setJsonError('');
    }
  };

  const isLoading = roleLoading || empLoading;
  const error = roleError || empError;

  if (isLoading) {
    return (
      <div className="page">
        <p className="text-muted">Loading…</p>
      </div>
    );
  }

  if (error) return <ErrorMessage error={error as Error} />;
  if (!role) return <ErrorMessage error={new Error(`Role "${id}" not found`)} />;

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">{t('assignTitle', { name: role.name })}</h1>
          <p className="page-subtitle">{t('assign.subtitle')}</p>
        </div>
        <div className="action-group">
          <button className="btn btn-default" onClick={() => navigate('/roles')}>
            Back to Roles
          </button>
        </div>
      </div>

      {/* Role Info Card */}
      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
              <h2 style={{ fontSize: '1.125rem', fontWeight: 600, margin: 0 }}>{role.name}</h2>
              {role.isBuiltin && <span className="tag">{t('table.builtin')}</span>}
            </div>
            <span className="mono text-muted" style={{ fontSize: '0.8125rem' }}>{role.id}</span>
          </div>
          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
            <div>
              <div className="text-muted" style={{ fontSize: '0.75rem' }}>{t('editor.mode')}</div>
              <StatusBadge status={role.mode} variant={role.mode === 'autonomous' ? 'success' : 'warning'} />
            </div>
            {role.department && (
              <div>
                <div className="text-muted" style={{ fontSize: '0.75rem' }}>{t('editor.department')}</div>
                <span style={{ fontSize: '0.875rem' }}>{role.department}</span>
              </div>
            )}
            {role.industry && (
              <div>
                <div className="text-muted" style={{ fontSize: '0.75rem' }}>{t('editor.industry')}</div>
                <span style={{ fontSize: '0.875rem' }}>{role.industry}</span>
              </div>
            )}
          </div>
        </div>

        {alreadyAssigned.length > 0 && (
          <div style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid var(--color-border)' }}>
            <div className="text-muted" style={{ fontSize: '0.75rem', marginBottom: '0.5rem' }}>
              Currently assigned ({alreadyAssigned.length})
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.375rem' }}>
              {alreadyAssigned.map(emp => {
                const online = emp.lastHeartbeat ? isOnline(emp.lastHeartbeat) : false;
                return (
                  <span
                    key={emp.nodeId}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.375rem',
                      padding: '0.25rem 0.625rem',
                      borderRadius: '9999px',
                      background: 'rgba(29, 37, 59, 0.50)',
                      fontSize: '0.8125rem',
                    }}
                  >
                    <span
                      style={{
                        width: '6px',
                        height: '6px',
                        borderRadius: '50%',
                        background: online ? 'var(--color-success, #22c55e)' : 'var(--color-muted, #9ca3af)',
                        flexShrink: 0,
                      }}
                    />
                    {emp.employeeName ?? 'Unknown'}
                  </span>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Unassigned Employees */}
      <div style={{ marginBottom: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
          <h2 style={{ fontSize: '1rem', fontWeight: 600, margin: 0 }}>
            {t('assign.unassignedAgents')}
            <span className="text-muted" style={{ fontWeight: 400, marginLeft: '0.375rem' }}>
              ({filtered.length} unassigned)
            </span>
          </h2>
          <input
            className="input"
            type="text"
            placeholder="Search agents…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ width: '220px' }}
          />
        </div>

        {filtered.length === 0 && (
          <div className="card" style={{ textAlign: 'center', padding: '2.5rem' }}>
            <p className="text-muted">
              {unassigned.length === 0
                ? t('assign.noUnassigned')
                : 'No agents match your search.'}
            </p>
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '0.75rem' }}>
          {filtered.map(emp => {
            const online = emp.lastHeartbeat ? isOnline(emp.lastHeartbeat) : false;
            const nodeId = emp.nodeId ?? '';
            const employeeName = emp.employeeName ?? 'Unknown';
            return (
              <div
                key={nodeId}
                className="card"
                style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.625rem' }}>
                  <span
                    style={{
                      width: '10px',
                      height: '10px',
                      borderRadius: '50%',
                      flexShrink: 0,
                      marginTop: '4px',
                      background: online ? 'var(--color-success, #22c55e)' : 'var(--color-muted, #9ca3af)',
                    }}
                    title={online ? 'Online' : emp.lastHeartbeat ? `Last seen ${timeAgo(emp.lastHeartbeat)}` : 'Never seen'}
                  />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontWeight: 500, fontSize: '0.9375rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {employeeName}
                    </div>
                    <div className="text-muted" style={{ fontSize: '0.75rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {emp.employeeEmail}
                    </div>
                  </div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem' }}>
                    <span className="text-muted">Node</span>
                    <span className="mono" style={{ fontSize: '0.7rem' }}>
                      {nodeId.length > 14 ? `${nodeId.slice(0, 7)}…${nodeId.slice(-5)}` : nodeId}
                    </span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem' }}>
                    <span className="text-muted">Platform</span>
                    <span>{emp.platform}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem' }}>
                    <span className="text-muted">Last seen</span>
                    <span className={online ? 'text-success' : 'text-muted'}>
                      {online ? 'online' : emp.lastHeartbeat ? timeAgo(emp.lastHeartbeat) : 'never'}
                    </span>
                  </div>
                </div>

                <button
                  className="btn btn-primary btn-sm"
                  style={{ width: '100%' }}
                  onClick={() => handleOpenAssign(nodeId, employeeName)}
                >
                  {t('assign.assignButton')} {role.name}
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* Assignment Modal */}
      <Modal
        open={assignModal.open}
        onClose={() => setAssignModal({ open: false, nodeId: '', employeeName: '' })}
        title={`Assign — ${assignModal.employeeName}`}
        footer={
          <div className="modal-footer-actions">
            <button
              className="btn btn-default"
              onClick={() => setAssignModal({ open: false, nodeId: '', employeeName: '' })}
            >
              Cancel
            </button>
            <button
              className="btn btn-primary"
              onClick={handleAssign}
              disabled={!!jsonError || assignRole.isPending}
            >
              {assignRole.isPending ? t('assign.assigning') : t('assign.assignButton')}
            </button>
          </div>
        }
      >
        <div className="form-group">
          <label className="form-label">Role</label>
          <input className="input" type="text" value={`${role.name} (${role.id})`} readOnly style={{ opacity: 0.6, cursor: 'not-allowed' }} />
        </div>

        <div className="form-group">
          <label className="form-label">{t('editor.mode')}</label>
          <select
            className="select"
            value={selectedMode}
            onChange={e => setSelectedMode(e.target.value as 'autonomous' | 'copilot')}
          >
            <option value="autonomous">Autonomous</option>
            <option value="copilot">Copilot</option>
          </select>
          <p className="text-muted" style={{ fontSize: '0.75rem', marginTop: '0.25rem' }}>
            {selectedMode === 'autonomous'
              ? 'Agent acts independently without requiring approval.'
              : 'Agent suggests actions and waits for human approval.'}
          </p>
        </div>

        <div className="form-group">
          <label className="form-label">
            Variables (JSON, optional)
          </label>
          <textarea
            className="textarea"
            value={variablesJson}
            onChange={e => handleVariablesChange(e.target.value)}
            rows={5}
            placeholder={'{\n  "key": "value"\n}'}
            style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: '0.8125rem', width: '100%', resize: 'vertical' }}
          />
          {jsonError && (
            <p style={{ color: 'var(--color-danger, #ef4444)', fontSize: '0.75rem', marginTop: '0.25rem' }}>
              {jsonError}
            </p>
          )}
          <p className="text-muted" style={{ fontSize: '0.75rem', marginTop: '0.25rem' }}>
            Optional key-value pairs injected into the agent environment.
          </p>
        </div>

        {assignRole.error && <ErrorMessage error={assignRole.error as Error} />}
      </Modal>
    </div>
  );
}
