import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { DataTable, Column } from '../../components/DataTable';
import { StatusBadge } from '../../components/StatusBadge';
import { ErrorMessage } from '../../components/ErrorMessage';
import {
  useMeetings,
  useMeetingStats,
  Meeting,
} from '../../api/hooks';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function relativeTime(iso: string | null): string {
  if (!iso) return '—';
  const diffMs = Date.now() - new Date(iso).getTime();
  const absDiff = Math.abs(diffMs);
  const seconds = Math.floor(absDiff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  return `${seconds}s ago`;
}

function truncateId(id: string): string {
  if (id.length <= 12) return id;
  return `${id.slice(0, 8)}…`;
}

function statusVariant(status: string): 'success' | 'info' | 'warning' | 'danger' | 'default' {
  switch (status) {
    case 'active':    return 'success';
    case 'scheduled': return 'info';
    case 'paused':    return 'warning';
    case 'concluded': return 'default';
    case 'cancelled': return 'danger';
    default:          return 'default';
  }
}

function typeEmoji(type: string): string {
  switch (type) {
    case 'discussion':  return '💬';
    case 'review':      return '📋';
    case 'brainstorm':  return '💡';
    case 'decision':    return '⚖️';
    default:            return '📌';
  }
}

function StatItem({ label, value, className }: { label: string; value: number | string; className?: string }) {
  return (
    <div className="stat-card">
      <div className={`stat-value${className ? ` ${className}` : ''}`}>{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

const STATUS_OPTIONS = ['scheduled', 'active', 'paused', 'concluded', 'cancelled'];
const TYPE_OPTIONS = ['discussion', 'review', 'brainstorm', 'decision'];

export function MeetingList() {
  const { t } = useTranslation('meetings');
  const navigate = useNavigate();
  const [filterStatus, setFilterStatus] = useState('');
  const [filterType, setFilterType] = useState('');
  const [page, setPage] = useState(1);

  const { data, isLoading, error } = useMeetings({
    page,
    page_size: 20,
    status: filterStatus || undefined,
    type: filterType || undefined,
  });
  const { data: statsData } = useMeetingStats();

  const meetings = data?.data ?? [];
  const pagination = data?.pagination;
  const stats = statsData?.stats;

  // ---------------------------------------------------------------------------
  // Columns
  // ---------------------------------------------------------------------------

  const columns: Column<Record<string, unknown>>[] = [
    {
      key: 'id',
      label: 'ID',
      width: '100px',
      render: (_v, row) => (
        <span
          className="mono link"
          title={row.id as string}
          style={{ cursor: 'pointer' }}
          onClick={() => navigate(`/meetings/${row.id}`)}
        >
          {truncateId(row.id as string)}
        </span>
      ),
    },
    {
      key: 'title',
      label: t('table.title'),
      render: (_v, row) => (
        <span
          style={{ cursor: 'pointer' }}
          onClick={() => navigate(`/meetings/${row.id}`)}
        >
          {row.title as string}
        </span>
      ),
    },
    {
      key: 'type',
      label: t('table.type'),
      width: '120px',
      render: (_v, row) => (
        <span>{typeEmoji(row.type as string)} {row.type as string}</span>
      ),
    },
    {
      key: 'status',
      label: t('table.status'),
      width: '110px',
      render: (_v, row) => (
        <StatusBadge
          status={row.status as string}
          variant={statusVariant(row.status as string)}
        />
      ),
    },
    {
      key: 'initiatorType',
      label: 'Initiator',
      width: '90px',
      render: (_v, row) => (
        <span>{row.initiatorType === 'agent' ? '🤖' : '👤'} {row.initiatorType as string}</span>
      ),
    },
    {
      key: 'facilitatorNodeId',
      label: 'Facilitator',
      width: '130px',
      render: (_v, row) => (
        <span className="mono" title={row.facilitatorNodeId as string}>
          {truncateId(row.facilitatorNodeId as string)}
        </span>
      ),
    },
    {
      key: 'createdAt',
      label: 'Created',
      width: '110px',
      render: (_v, row) => (
        <span className="text-muted">{relativeTime(row.createdAt as string)}</span>
      ),
    },
    {
      key: '_actions',
      label: '',
      width: '100px',
      render: (_v, row) => (
        <div className="action-group">
          <button
            className="btn btn-default btn-sm"
            onClick={() => navigate(`/meetings/${row.id}`)}
          >
            View
          </button>
          {(row as unknown as Meeting).status === 'active' && (
            <button
              className="btn btn-sm"
              style={{ backgroundColor: 'var(--color-success)', color: '#080e1d' }}
              onClick={() => navigate(`/meetings/${row.id}/live`)}
            >
              Live
            </button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">{t('list.title')}</h1>
          <p className="page-subtitle">
            {t('list.subtitle')}
          </p>
        </div>
        <div className="action-group">
          <button
            className="btn btn-primary btn-sm"
            onClick={() => navigate('/meetings/create')}
          >
            {t('list.createButton')}
          </button>
        </div>
      </div>

      {/* Stats */}
      {stats && (
        <div className="stat-grid" style={{ marginBottom: '1.5rem' }}>
          <StatItem label={t('stats.totalMeetings')} value={stats.total} />
          <StatItem label={t('stats.activeMeetings')} value={stats.byStatus?.active ?? 0} className="text-success" />
          <StatItem label="Scheduled" value={stats.byStatus?.scheduled ?? 0} className="text-info" />
          <StatItem label={t('stats.completedMeetings')} value={stats.byStatus?.concluded ?? 0} />
          <StatItem label="Agent-initiated" value={stats.byInitiatorType?.agent ?? 0} />
          <StatItem label="Human-initiated" value={stats.byInitiatorType?.human ?? 0} />
        </div>
      )}

      {/* Filters */}
      <div className="filter-bar">
        <select
          className="select"
          value={filterStatus}
          onChange={(e) => { setFilterStatus(e.target.value); setPage(1); }}
        >
          <option value="">All statuses</option>
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <select
          className="select"
          value={filterType}
          onChange={(e) => { setFilterType(e.target.value); setPage(1); }}
        >
          <option value="">All types</option>
          {TYPE_OPTIONS.map((t) => (
            <option key={t} value={t}>{typeEmoji(t)} {t}</option>
          ))}
        </select>
        {(filterStatus || filterType) && (
          <button
            className="btn btn-default btn-sm"
            onClick={() => { setFilterStatus(''); setFilterType(''); setPage(1); }}
          >
            Clear filters
          </button>
        )}
        <span className="text-muted" style={{ marginLeft: 'auto', fontSize: '0.875rem' }}>
          {pagination ? `${pagination.total} meetings` : ''}
        </span>
      </div>

      {/* Error */}
      {error && <ErrorMessage error={error as Error} />}

      {/* Table */}
      <div className="card">
        <DataTable
          columns={columns}
          data={meetings as unknown as Record<string, unknown>[]}
          loading={isLoading}
          rowKey="id"
          emptyMessage="No meetings found."
          pagination={
            pagination && pagination.totalPages > 1
              ? { page: pagination.page, totalPages: pagination.totalPages, onPageChange: setPage }
              : undefined
          }
        />
      </div>
    </div>
  );
}
