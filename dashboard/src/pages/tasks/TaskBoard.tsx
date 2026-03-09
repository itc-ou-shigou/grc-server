import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAdminTasks } from '../../api/hooks';
import { DataTable } from '../../components/DataTable';
import { StatusBadge } from '../../components/StatusBadge';
import { ErrorMessage } from '../../components/ErrorMessage';
import type { Task } from '../../api/hooks';

type Column = {
  key: string;
  label: string;
  render?: (value: unknown, row: Task) => React.ReactNode;
};

type Variant = 'success' | 'warning' | 'danger' | 'info' | 'default';

const PRIORITY_VARIANT: Record<string, Variant> = {
  critical: 'danger',
  high: 'warning',
  medium: 'info',
  low: 'default',
};

const STATUS_OPTIONS = [
  { value: '', labelKey: 'filters.allStatuses' },
  { value: 'draft', label: 'Draft' },
  { value: 'pending', label: 'Pending' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'blocked', label: 'Blocked' },
  { value: 'review', label: 'Review' },
  { value: 'approved', label: 'Approved' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
];

const PRIORITY_OPTIONS = [
  { value: '', labelKey: 'filters.allPriorities' },
  { value: 'critical', labelKey: 'priority.critical' },
  { value: 'high', labelKey: 'priority.high' },
  { value: 'medium', labelKey: 'priority.medium' },
  { value: 'low', labelKey: 'priority.low' },
];

const CATEGORY_OPTIONS = [
  { value: '', labelKey: 'filters.allCategories' },
  { value: 'strategic', label: 'Strategic' },
  { value: 'operational', label: 'Operational' },
  { value: 'administrative', label: 'Administrative' },
  { value: 'expense', label: 'Expense' },
];

const ASSIGNED_BY_OPTIONS = [
  { value: '', label: 'All Creators' },
  { value: 'human-ceo', label: 'CEO' },
  { value: 'human-cto', label: 'CTO' },
  { value: 'human-cfo', label: 'CFO' },
  { value: 'human-marketing', label: 'Marketing' },
  { value: 'human-sales', label: 'Sales' },
  { value: 'human-engineering', label: 'Engineering' },
  { value: 'human-hr', label: 'HR' },
  { value: 'human-legal', label: 'Legal' },
  { value: 'human-support', label: 'Support' },
  { value: 'system', label: 'System' },
];

const ROLE_DISPLAY: Record<string, string> = {
  ceo: 'CEO', cto: 'CTO', cfo: 'CFO',
  marketing: 'Marketing', sales: 'Sales', engineering: 'Engineering',
  hr: 'HR', legal: 'Legal', support: 'Support',
};

function resolveCreatorDisplay(assignedBy: string): { name: string; badge: string } {
  if (!assignedBy) return { name: '—', badge: '' };
  if (assignedBy.startsWith('human-')) {
    const role = assignedBy.replace('human-', '');
    return { name: ROLE_DISPLAY[role] || role, badge: '👤' };
  }
  if (assignedBy === 'grc-admin') return { name: 'GRC Admin', badge: '👤' };
  const agentMatch = assignedBy.match(/^agent:(\w[\w-]*):(.+)$/);
  if (agentMatch) {
    return { name: `${ROLE_DISPLAY[agentMatch[1]] || agentMatch[1]} (AI)`, badge: '🤖' };
  }
  const sysMatch = assignedBy.match(/^system:(\w+)$/);
  if (sysMatch) {
    const sysNames: Record<string, string> = { strategy: 'Strategy Deploy', meeting: 'Meeting', escalation: 'Escalation' };
    return { name: sysNames[sysMatch[1]] || sysMatch[1], badge: '⚙️' };
  }
  return { name: assignedBy, badge: '❓' };
}

function formatDeadline(deadline: string | null): string {
  if (!deadline) return '—';
  return new Date(deadline).toLocaleDateString();
}

const BASE_COLUMNS: Column[] = [
  {
    key: 'taskCode',
    label: 'Code',
    render: (_value, row) => (
      <Link to={`/tasks/${row.id}`} className="link mono">
        {row.taskCode}
      </Link>
    ),
  },
  {
    key: 'title',
    label: 'Title',
    render: (_value, row) => <span>{row.title}</span>,
  },
  {
    key: 'priority',
    label: 'Priority',
    render: (_value, row) => (
      <StatusBadge status={row.priority} variant={PRIORITY_VARIANT[row.priority]} />
    ),
  },
  {
    key: 'status',
    label: 'Status',
    render: (_value, row) => <StatusBadge status={row.status} />,
  },
  {
    key: 'assignedRoleId',
    label: 'Assigned Role',
    render: (_value, row) => (
      <span className={row.assignedRoleId ? 'mono' : 'text-muted'}>
        {row.assignedRoleId ?? '—'}
      </span>
    ),
  },
  {
    key: 'deadline',
    label: 'Deadline',
    render: (_value, row) => (
      <span className={row.deadline ? '' : 'text-muted'}>
        {formatDeadline(row.deadline)}
      </span>
    ),
  },
  {
    key: 'category',
    label: 'Category',
    render: (_value, row) => (
      <span className={row.category ? '' : 'text-muted'}>
        {row.category ?? '—'}
      </span>
    ),
  },
];

const CREATOR_COLUMN: Column = {
  key: 'assignedBy',
  label: 'Creator',
  render: (_value, row) => {
    const assignedBy = (row as unknown as Record<string, string>).assignedBy ?? '';
    const { name, badge } = resolveCreatorDisplay(assignedBy);
    return (
      <span className={assignedBy ? '' : 'text-muted'} style={{ whiteSpace: 'nowrap' }}>
        {badge ? <span style={{ marginRight: '0.25rem' }}>{badge}</span> : null}
        {name}
      </span>
    );
  },
};

const PROGRESS_COLUMN: Column = {
  key: 'progress',
  label: 'Progress',
  render: (_value, row) => {
    const progress = (row as unknown as Record<string, unknown>).progress;
    if (!progress) return <span className="text-muted">—</span>;
    if (Array.isArray(progress) && progress.length > 0) {
      return (
        <span className="mono" style={{ fontSize: '0.75rem' }}>
          {progress.length} entries
        </span>
      );
    }
    if (typeof progress === 'number') {
      return (
        <span className="mono" style={{ fontSize: '0.75rem' }}>
          {progress}%
        </span>
      );
    }
    return <span className="text-muted">—</span>;
  },
};

export function TaskBoard() {
  const { t } = useTranslation('tasks');
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [priority, setPriority] = useState('');
  const [category, setCategory] = useState('');
  const [monitoringMode, setMonitoringMode] = useState(false);
  const [assignedByFilter, setAssignedByFilter] = useState('');

  const effectiveCategory = monitoringMode && category === '' ? undefined : category || undefined;

  const { data, isLoading, error } = useAdminTasks({
    page,
    status: status || undefined,
    priority: priority || undefined,
    category: effectiveCategory,
    assigned_by: monitoringMode && assignedByFilter ? assignedByFilter : undefined,
  });

  const tasks = data?.data ?? [];
  const totalPages = data?.pagination?.totalPages ?? 1;

  const columns: Column[] = monitoringMode
    ? [...BASE_COLUMNS, CREATOR_COLUMN, PROGRESS_COLUMN]
    : BASE_COLUMNS;

  function handleStatusChange(e: React.ChangeEvent<HTMLSelectElement>) {
    setStatus(e.target.value);
    setPage(1);
  }

  function handlePriorityChange(e: React.ChangeEvent<HTMLSelectElement>) {
    setPriority(e.target.value);
    setPage(1);
  }

  function handleCategoryChange(e: React.ChangeEvent<HTMLSelectElement>) {
    setCategory(e.target.value);
    setPage(1);
  }

  function handleAssignedByChange(e: React.ChangeEvent<HTMLSelectElement>) {
    setAssignedByFilter(e.target.value);
    setPage(1);
  }

  function handleToggleMonitoring() {
    setMonitoringMode((prev) => {
      if (!prev) {
        // Entering monitoring mode: default category to exclude administrative
        // We leave category empty so effectiveCategory skips empty-string logic
        setCategory('');
      }
      return !prev;
    });
    setAssignedByFilter('');
    setPage(1);
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">{t('board.title')}</h1>
          <p className="page-subtitle">{t('board.subtitle')}</p>
        </div>
        <div className="action-group">
          <button
            className={monitoringMode ? 'btn btn-primary' : 'btn btn-default'}
            type="button"
            onClick={handleToggleMonitoring}
          >
            {monitoringMode ? t('board.monitoringOn', 'Monitoring: ON') : t('board.monitoringOff', 'Monitoring Mode')}
          </button>
          <Link to="/tasks/create" className="btn btn-primary">
            {t('board.createTask')}
          </Link>
        </div>
      </div>

      <div className="card">
        <div className="filter-bar">
          <select
            className="select"
            value={status}
            onChange={handleStatusChange}
            aria-label="Filter by status"
          >
            {STATUS_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.labelKey ? t(opt.labelKey) : opt.label}
              </option>
            ))}
          </select>

          <select
            className="select"
            value={priority}
            onChange={handlePriorityChange}
            aria-label="Filter by priority"
          >
            {PRIORITY_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {t(opt.labelKey)}
              </option>
            ))}
          </select>

          <select
            className="select"
            value={category}
            onChange={handleCategoryChange}
            aria-label="Filter by category"
          >
            {CATEGORY_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.labelKey ? t(opt.labelKey) : opt.label}
              </option>
            ))}
          </select>

          {monitoringMode && (
            <select
              className="select"
              value={assignedByFilter}
              onChange={handleAssignedByChange}
              aria-label="Filter by creator"
            >
              {ASSIGNED_BY_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          )}
        </div>

        {error ? (
          <ErrorMessage error={error as Error} />
        ) : (
          <DataTable
            columns={columns as never}
            data={tasks as never}
            loading={isLoading}
            rowKey="id"
            pagination={{
              page,
              totalPages,
              onPageChange: setPage,
            }}
          />
        )}
      </div>
    </div>
  );
}
