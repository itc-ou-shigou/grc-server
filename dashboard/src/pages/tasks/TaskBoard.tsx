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

function formatDeadline(deadline: string | null): string {
  if (!deadline) return '—';
  return new Date(deadline).toLocaleDateString();
}

const COLUMNS: Column[] = [
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

export function TaskBoard() {
  const { t } = useTranslation('tasks');
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [priority, setPriority] = useState('');
  const [category, setCategory] = useState('');

  const { data, isLoading, error } = useAdminTasks({
    page,
    status: status || undefined,
    priority: priority || undefined,
    category: category || undefined,
  });

  const tasks = data?.data ?? [];
  const totalPages = data?.pagination?.totalPages ?? 1;

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

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">{t('board.title')}</h1>
          <p className="page-subtitle">{t('board.subtitle')}</p>
        </div>
        <div className="action-group">
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
        </div>

        {error ? (
          <ErrorMessage error={error as Error} />
        ) : (
          <DataTable
            columns={COLUMNS as never}
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
