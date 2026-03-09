import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { DataTable, Column } from '../../components/DataTable';
import { StatusBadge } from '../../components/StatusBadge';
import { Modal } from '../../components/Modal';
import { ErrorMessage } from '../../components/ErrorMessage';
import {
  useAgentCards,
  useAgentCardStats,
  useDeleteAgent,
  useCleanupAgents,
  useChangeAgentStatus,
  AgentCard,
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

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('en-US', {
    month: 'short',
    day: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function truncateId(id: string): string {
  if (id.length <= 16) return id;
  return `${id.slice(0, 14)}…`;
}

function statusVariant(status: string): 'success' | 'warning' | 'danger' | 'default' {
  switch (status) {
    case 'online':   return 'success';
    case 'busy':     return 'warning';
    case 'offline':  return 'danger';
    default:         return 'default';
  }
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

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

const STATUS_OPTIONS = ['online', 'offline', 'busy'];

export function AgentList() {
  const { t } = useTranslation('agents');
  const navigate = useNavigate();
  const [filterStatus, setFilterStatus] = useState('');
  const [page, setPage] = useState(1);
  const [deleteTarget, setDeleteTarget] = useState<AgentCard | null>(null);
  const [cleanupOpen, setCleanupOpen] = useState(false);
  const [staleMinutes, setStaleMinutes] = useState('30');

  const { data, isLoading, error } = useAgentCards({
    page,
    page_size: 20,
    status: filterStatus || undefined,
  });
  const { data: statsData } = useAgentCardStats();

  const deleteAgent = useDeleteAgent();
  const cleanup = useCleanupAgents();
  const changeStatus = useChangeAgentStatus();

  const agents = data?.data ?? [];
  const pagination = data?.pagination;
  const stats = statsData?.stats;

  // ---------------------------------------------------------------------------
  // Columns
  // ---------------------------------------------------------------------------

  const columns: Column<Record<string, unknown>>[] = [
    {
      key: 'nodeId',
      label: t('table.nodeId'),
      width: '180px',
      render: (_v, row) => (
        <span
          className="mono link"
          title={row.nodeId as string}
          style={{ cursor: 'pointer' }}
          onClick={() => navigate(`/a2a/agents/${row.nodeId}`)}
        >
          {truncateId(row.nodeId as string)}
        </span>
      ),
    },
    {
      key: 'agentCard',
      label: t('table.agentName'),
      render: (_v, row) => {
        const card = row.agentCard as Record<string, unknown> | null;
        return <span>{(card?.name as string) ?? '—'}</span>;
      },
    },
    {
      key: 'skills',
      label: t('table.capabilities'),
      width: '80px',
      render: (_v, row) => {
        const skills = row.skills as unknown[] | null;
        return <span>{skills?.length ?? 0}</span>;
      },
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
      key: 'lastSeenAt',
      label: t('table.lastHeartbeat'),
      width: '130px',
      render: (_v, row) => (
        <span className="text-muted" title={formatDate(row.lastSeenAt as string | null)}>
          {relativeTime(row.lastSeenAt as string | null)}
        </span>
      ),
    },
    {
      key: 'createdAt',
      label: 'Registered',
      width: '130px',
      render: (_v, row) => (
        <span className="text-muted">
          {relativeTime(row.createdAt as string)}
        </span>
      ),
    },
    {
      key: '_actions',
      label: '',
      width: '140px',
      render: (_v, row) => (
        <div className="action-group">
          <button
            className="btn btn-default btn-sm"
            onClick={() => navigate(`/a2a/agents/${row.nodeId}`)}
            title="View details"
          >
            View
          </button>
          <select
            className="select btn-sm"
            value={row.status as string}
            style={{ width: '90px', padding: '0.2rem' }}
            onChange={(e) => {
              changeStatus.mutate({ nodeId: row.nodeId as string, status: e.target.value });
            }}
            title="Change status"
          >
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
      ),
    },
  ];

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

  function handleDelete() {
    if (!deleteTarget) return;
    deleteAgent.mutate(deleteTarget.nodeId, {
      onSuccess: () => setDeleteTarget(null),
    });
  }

  function handleCleanup() {
    cleanup.mutate(
      { stale_minutes: Number.parseInt(staleMinutes, 10) || 30 },
      { onSuccess: () => setCleanupOpen(false) },
    );
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">{t('title')}</h1>
          <p className="page-subtitle">
            {t('subtitle')}
          </p>
        </div>
        <div className="action-group">
          <button
            className="btn btn-default btn-sm"
            onClick={() => setCleanupOpen(true)}
          >
            {t('cleanupModal.title')}
          </button>
        </div>
      </div>

      {/* Stats */}
      {stats && (
        <div className="stat-grid" style={{ marginBottom: '1.5rem' }}>
          <StatItem label={t('stats.totalAgents')} value={stats.total} />
          <StatItem label={t('stats.onlineAgents')} value={stats.byStatus?.online ?? 0} className="text-success" />
          <StatItem label="Busy" value={stats.byStatus?.busy ?? 0} className="text-warning" />
          <StatItem label={t('stats.offlineAgents')} value={stats.byStatus?.offline ?? 0} className="text-danger" />
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
        {filterStatus && (
          <button
            className="btn btn-default btn-sm"
            onClick={() => { setFilterStatus(''); setPage(1); }}
          >
            Clear filters
          </button>
        )}
        <span className="text-muted" style={{ marginLeft: 'auto', fontSize: '0.875rem' }}>
          {pagination ? `${pagination.total} agents` : ''}
        </span>
      </div>

      {/* Error */}
      {error && <ErrorMessage error={error as Error} />}

      {/* Table */}
      <div className="card">
        <DataTable
          columns={columns}
          data={agents as unknown as Record<string, unknown>[]}
          loading={isLoading}
          rowKey="nodeId"
          emptyMessage="No agent cards registered."
          pagination={
            pagination && pagination.totalPages > 1
              ? { page: pagination.page, totalPages: pagination.totalPages, onPageChange: setPage }
              : undefined
          }
        />
      </div>

      {/* Delete Modal */}
      <Modal
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        title="Delete Agent Card"
        footer={
          <div className="modal-footer-actions">
            <button className="btn btn-default" onClick={() => setDeleteTarget(null)} disabled={deleteAgent.isPending}>
              Cancel
            </button>
            <button className="btn btn-danger" onClick={handleDelete} disabled={deleteAgent.isPending}>
              {deleteAgent.isPending ? 'Deleting…' : 'Delete'}
            </button>
          </div>
        }
      >
        {deleteTarget && (
          <p>
            Remove agent card <span className="mono">{truncateId(deleteTarget.nodeId)}</span>?
            This action cannot be undone.
          </p>
        )}
        {deleteAgent.error && <ErrorMessage error={deleteAgent.error as Error} />}
      </Modal>

      {/* Cleanup Modal */}
      <Modal
        open={cleanupOpen}
        onClose={() => setCleanupOpen(false)}
        title={t('cleanupModal.title')}
        footer={
          <div className="modal-footer-actions">
            <button className="btn btn-default" onClick={() => setCleanupOpen(false)} disabled={cleanup.isPending}>
              Cancel
            </button>
            <button className="btn btn-danger" onClick={handleCleanup} disabled={cleanup.isPending}>
              {cleanup.isPending ? t('cleanupModal.cleaning') : t('cleanupModal.button')}
            </button>
          </div>
        }
      >
        <p className="text-muted" style={{ marginBottom: '1rem' }}>
          {t('cleanupModal.confirm')}
        </p>
        <div className="form-group">
          <label className="form-label" htmlFor="stale-minutes">
            Stale threshold (minutes)
          </label>
          <input
            id="stale-minutes"
            className="input"
            type="number"
            min="5"
            max="1440"
            value={staleMinutes}
            onChange={(e) => setStaleMinutes(e.target.value)}
          />
        </div>
        {cleanup.error && <ErrorMessage error={cleanup.error as Error} />}
      </Modal>
    </div>
  );
}
