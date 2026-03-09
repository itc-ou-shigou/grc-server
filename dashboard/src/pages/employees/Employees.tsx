import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useEmployees, useRoleTemplates, useAssignRole, useUnassignRole } from '../../api/hooks';
import { DataTable } from '../../components/DataTable';
import { StatusBadge } from '../../components/StatusBadge';
import { Modal } from '../../components/Modal';
import { ErrorMessage } from '../../components/ErrorMessage';

function timeAgo(date: string | null): string {
  if (date === null) return 'never';
  const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

interface AssignModalState {
  open: boolean;
  nodeId: string;
  employeeName: string;
}

interface UnassignModalState {
  open: boolean;
  nodeId: string;
  employeeName: string;
}

export function Employees() {
  const { t } = useTranslation('employees');
  const { data: employeesData, isLoading, error } = useEmployees();
  const employees = employeesData?.data ?? [];
  const { data: rolesData } = useRoleTemplates();
  const roles = rolesData?.data ?? [];
  const assignRole = useAssignRole();
  const unassignRole = useUnassignRole();

  const [roleFilter, setRoleFilter] = useState<string>('');
  const [assignModal, setAssignModal] = useState<AssignModalState>({ open: false, nodeId: '', employeeName: '' });
  const [unassignModal, setUnassignModal] = useState<UnassignModalState>({ open: false, nodeId: '', employeeName: '' });
  const [selectedRoleId, setSelectedRoleId] = useState<string>('');
  const [selectedMode, setSelectedMode] = useState<'autonomous' | 'copilot'>('autonomous');

  const filtered = roleFilter
    ? employees.filter(e => e.roleId === roleFilter)
    : employees;

  type EmpRow = typeof employees[0];

  const columns = [
    {
      key: 'employeeId',
      label: 'Employee ID',
      render: (_v: unknown, row: Record<string, unknown>) => {
        const emp = row as unknown as EmpRow;
        return <span className="mono">{emp.employeeId ?? '—'}</span>;
      },
    },
    {
      key: 'employeeName',
      label: t('table.name'),
      render: (_v: unknown, row: Record<string, unknown>) => {
        const emp = row as unknown as EmpRow;
        return (
          <div>
            <div>{emp.employeeName ?? '—'}</div>
            <div className="text-muted" style={{ fontSize: '0.75rem' }}>{emp.employeeEmail}</div>
          </div>
        );
      },
    },
    {
      key: 'nodeId',
      label: t('table.nodeId'),
      render: (_v: unknown, row: Record<string, unknown>) => {
        const emp = row as unknown as EmpRow;
        const nodeId = emp.nodeId ?? '';
        return (
          <span className="mono" title={nodeId}>
            {nodeId.length > 16 ? `${nodeId.slice(0, 8)}…${nodeId.slice(-6)}` : nodeId}
          </span>
        );
      },
    },
    {
      key: 'roleId',
      label: t('table.role'),
      render: (_v: unknown, row: Record<string, unknown>) => {
        const emp = row as unknown as EmpRow;
        return emp.roleId ? (
          <StatusBadge status={emp.roleId} />
        ) : (
          <span className="text-muted">—</span>
        );
      },
    },
    {
      key: 'roleMode',
      label: 'Mode',
      render: (_v: unknown, row: Record<string, unknown>) => {
        const emp = row as unknown as EmpRow;
        return emp.roleMode ? (
          <StatusBadge status={emp.roleMode} variant={emp.roleMode === 'autonomous' ? 'success' : 'warning'} />
        ) : (
          <span className="text-muted">—</span>
        );
      },
    },
    {
      key: 'sync',
      label: t('table.configSync'),
      render: (_v: unknown, row: Record<string, unknown>) => {
        const emp = row as unknown as EmpRow;
        const synced = emp.configRevision === emp.configAppliedRevision;
        return (
          <span className={synced ? 'text-success' : 'text-warning'}>
            {synced ? '✓ Synced' : `⚠ Behind (${emp.configAppliedRevision}/${emp.configRevision})`}
          </span>
        );
      },
    },
    {
      key: 'lastHeartbeat',
      label: t('table.lastSync'),
      render: (_v: unknown, row: Record<string, unknown>) => {
        const emp = row as unknown as EmpRow;
        if (!emp.lastHeartbeat) return <span className="text-muted">never</span>;
        const ago = timeAgo(emp.lastHeartbeat);
        const seconds = Math.floor((Date.now() - new Date(emp.lastHeartbeat as string).getTime()) / 1000);
        const isOnline = seconds < 300;
        return <span className={isOnline ? 'text-success' : 'text-muted'}>{ago}</span>;
      },
    },
    {
      key: 'actions',
      label: 'Actions',
      render: (_v: unknown, row: Record<string, unknown>) => {
        const emp = row as unknown as EmpRow;
        return (
          <div className="action-group">
            <button
              className="btn btn-primary btn-sm"
              onClick={() => {
                setAssignModal({ open: true, nodeId: emp.nodeId ?? '', employeeName: emp.employeeName ?? '' });
                setSelectedRoleId(emp.roleId ?? '');
                setSelectedMode((emp.roleMode as 'autonomous' | 'copilot') ?? 'autonomous');
              }}
            >
              {t('assignModal.button')}
            </button>
            {emp.roleId && (
              <button
                className="btn btn-danger btn-sm"
                onClick={() => setUnassignModal({ open: true, nodeId: emp.nodeId ?? '', employeeName: emp.employeeName ?? '' })}
              >
                {t('unassignModal.button')}
              </button>
            )}
          </div>
        );
      },
    },
  ];

  const handleAssign = async () => {
    if (!selectedRoleId) return;
    await assignRole.mutateAsync({ nodeId: assignModal.nodeId, roleId: selectedRoleId, mode: selectedMode });
    setAssignModal({ open: false, nodeId: '', employeeName: '' });
  };

  const handleUnassign = async () => {
    await unassignRole.mutateAsync(unassignModal.nodeId);
    setUnassignModal({ open: false, nodeId: '', employeeName: '' });
  };

  if (error) return <ErrorMessage error={error as Error} />;

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">{t('title')}</h1>
          <p className="page-subtitle">{t('subtitle')}</p>
        </div>
      </div>

      <div className="filter-bar">
        <select
          className="select"
          value={roleFilter}
          onChange={e => setRoleFilter(e.target.value)}
        >
          <option value="">All Roles</option>
          {roles.map(r => (
            <option key={r.id} value={r.id}>{r.name}</option>
          ))}
          <option value="__unassigned__">{t('noRole')}</option>
        </select>
        <span className="text-muted" style={{ fontSize: '0.875rem' }}>
          {filtered.length} employee{filtered.length !== 1 ? 's' : ''}
        </span>
      </div>

      <DataTable
        columns={columns as never}
        data={filtered as never}
        loading={isLoading}
        rowKey="nodeId"
      />

      <Modal
        open={assignModal.open}
        onClose={() => setAssignModal({ open: false, nodeId: '', employeeName: '' })}
        title={t('assignModal.title', { name: assignModal.employeeName })}
        footer={
          <div className="modal-footer-actions">
            <button className="btn btn-default" onClick={() => setAssignModal({ open: false, nodeId: '', employeeName: '' })}>
              Cancel
            </button>
            <button
              className="btn btn-primary"
              onClick={handleAssign}
              disabled={!selectedRoleId || assignRole.isPending}
            >
              {assignRole.isPending ? t('assignModal.assigning') : t('assignModal.button')}
            </button>
          </div>
        }
      >
        <div className="form-group">
          <label className="form-label">Role</label>
          <select
            className="select"
            value={selectedRoleId}
            onChange={e => setSelectedRoleId(e.target.value)}
          >
            <option value="">{t('assignModal.selectRole')}</option>
            {roles.map(r => (
              <option key={r.id} value={r.id}>{r.name} ({r.id})</option>
            ))}
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">Mode</label>
          <select
            className="select"
            value={selectedMode}
            onChange={e => setSelectedMode(e.target.value as 'autonomous' | 'copilot')}
          >
            <option value="autonomous">Autonomous</option>
            <option value="copilot">Copilot</option>
          </select>
        </div>
        {assignRole.error && <ErrorMessage error={assignRole.error as Error} />}
      </Modal>

      <Modal
        open={unassignModal.open}
        onClose={() => setUnassignModal({ open: false, nodeId: '', employeeName: '' })}
        title={t('unassignModal.title', { name: unassignModal.employeeName })}
        footer={
          <div className="modal-footer-actions">
            <button className="btn btn-default" onClick={() => setUnassignModal({ open: false, nodeId: '', employeeName: '' })}>
              Cancel
            </button>
            <button
              className="btn btn-danger"
              onClick={handleUnassign}
              disabled={unassignRole.isPending}
            >
              {unassignRole.isPending ? t('unassignModal.unassigning') : t('unassignModal.button')}
            </button>
          </div>
        }
      >
        <p>
          Remove the role assignment from <strong>{unassignModal.employeeName}</strong>? The agent will run without a role until reassigned.
        </p>
        {unassignRole.error && <ErrorMessage error={unassignRole.error as Error} />}
      </Modal>
    </div>
  );
}
