import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DataTable, Column } from '../../components/DataTable';
import { StatusBadge } from '../../components/StatusBadge';
import { Modal } from '../../components/Modal';
import { ErrorMessage } from '../../components/ErrorMessage';
import {
  useRelayMessages,
  useRelayStats,
  useDeleteRelayMessage,
  useCleanupRelayMessages,
  RelayMessage,
} from '../../api/hooks';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('en-US', {
    month: 'short',
    day: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

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

function priorityVariant(priority: string): 'danger' | 'warning' | 'info' | 'default' {
  switch (priority) {
    case 'critical': return 'danger';
    case 'high':     return 'warning';
    case 'normal':   return 'info';
    default:         return 'default';
  }
}

function statusVariant(status: string): 'success' | 'info' | 'warning' | 'danger' | 'default' {
  switch (status) {
    case 'delivered':    return 'success';
    case 'acknowledged': return 'info';
    case 'queued':       return 'warning';
    case 'expired':      return 'default';
    case 'failed':       return 'danger';
    default:             return 'default';
  }
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

interface StatItemProps {
  label: string;
  value: number | string;
  className?: string;
}

function StatItem({ label, value, className }: StatItemProps) {
  return (
    <div className="stat-card">
      <div className={`stat-value${className ? ` ${className}` : ''}`}>{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

interface CleanupForm {
  before: string;
  status: string;
}

const defaultCleanupForm: CleanupForm = { before: '', status: '' };

const STATUS_OPTIONS = ['queued', 'delivered', 'acknowledged', 'expired', 'failed'];
const PRIORITY_OPTIONS = ['critical', 'high', 'normal', 'low'];

export function RelayLog() {
  const { t } = useTranslation('relay');

  // Filter state
  const [filterStatus, setFilterStatus] = useState('');
  const [filterPriority, setFilterPriority] = useState('');
  const [page, setPage] = useState(1);

  // Modal state
  const [detailMsg, setDetailMsg] = useState<RelayMessage | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<RelayMessage | null>(null);
  const [cleanupOpen, setCleanupOpen] = useState(false);
  const [cleanupForm, setCleanupForm] = useState<CleanupForm>(defaultCleanupForm);

  // Data
  const { data, isLoading, error } = useRelayMessages({
    page,
    page_size: 20,
    status: filterStatus || undefined,
  });
  const { data: statsData } = useRelayStats();

  const deleteMsg = useDeleteRelayMessage();
  const cleanup = useCleanupRelayMessages();

  const messages = data?.data ?? [];
  const pagination = data?.pagination;
  const stats = statsData?.stats;

  // Filtered by priority client-side (API does not expose priority filter)
  const displayed = filterPriority
    ? messages.filter((m) => m.priority === filterPriority)
    : messages;

  // ---------------------------------------------------------------------------
  // Columns
  // ---------------------------------------------------------------------------

  const columns: Column<Record<string, unknown>>[] = [
    {
      key: 'id',
      label: 'ID',
      width: '110px',
      render: (_v, row) => (
        <span
          className="mono link"
          title={row.id as string}
          style={{ cursor: 'pointer' }}
          onClick={() => setDetailMsg(row as unknown as RelayMessage)}
        >
          {truncateId(row.id as string)}
        </span>
      ),
    },
    {
      key: 'fromNodeId',
      label: t('table.from'),
      width: '130px',
      render: (_v, row) => (
        <span className="mono" title={row.fromNodeId as string}>
          {truncateId(row.fromNodeId as string)}
        </span>
      ),
    },
    {
      key: 'toNodeId',
      label: t('table.to'),
      width: '130px',
      render: (_v, row) => (
        <span className="mono" title={row.toNodeId as string}>
          {truncateId(row.toNodeId as string)}
        </span>
      ),
    },
    {
      key: 'messageType',
      label: t('table.method'),
      width: '130px',
      render: (_v, row) => (
        <StatusBadge status={row.messageType as string} />
      ),
    },
    {
      key: 'subject',
      label: 'Subject',
      render: (_v, row) => (
        <span className={row.subject ? '' : 'text-muted'}>
          {(row.subject as string | null) ?? 'No subject'}
        </span>
      ),
    },
    {
      key: 'priority',
      label: 'Priority',
      width: '90px',
      render: (_v, row) => (
        <StatusBadge
          status={row.priority as string}
          variant={priorityVariant(row.priority as string)}
        />
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
      key: 'createdAt',
      label: t('table.timestamp'),
      width: '130px',
      render: (_v, row) => (
        <span title={formatDate(row.createdAt as string)} className="text-muted">
          {relativeTime(row.createdAt as string)}
        </span>
      ),
    },
    {
      key: '_actions',
      label: '',
      width: '70px',
      render: (_v, row) => (
        <div className="action-group">
          <button
            className="btn btn-default btn-sm"
            onClick={() => setDetailMsg(row as unknown as RelayMessage)}
            title="View detail"
          >
            View
          </button>
          <button
            className="btn btn-danger btn-sm"
            onClick={() => setDeleteTarget(row as unknown as RelayMessage)}
            title="Delete message"
          >
            Del
          </button>
        </div>
      ),
    },
  ];

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

  function handleDelete() {
    if (!deleteTarget) return;
    deleteMsg.mutate(deleteTarget.id, {
      onSuccess: () => setDeleteTarget(null),
    });
  }

  function handleCleanup() {
    cleanup.mutate(
      { before: cleanupForm.before || undefined, status: cleanupForm.status || undefined },
      {
        onSuccess: () => { setCleanupOpen(false); setCleanupForm(defaultCleanupForm); },
      },
    );
  }

  function handleFilterChange() {
    setPage(1);
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
            onClick={() => { setCleanupOpen(true); setCleanupForm(defaultCleanupForm); }}
          >
            {t('cleanupModal.title')}
          </button>
        </div>
      </div>

      {/* Stats */}
      {stats && (
        <div className="stat-grid" style={{ marginBottom: '1.5rem' }}>
          <StatItem label={t('stats.totalMessages')} value={stats.total} />
          <StatItem
            label="Queued"
            value={stats.byStatus?.queued ?? 0}
            className="text-warning"
          />
          <StatItem
            label="Delivered"
            value={stats.byStatus?.delivered ?? 0}
            className="text-success"
          />
          <StatItem
            label="Acknowledged"
            value={stats.byStatus?.acknowledged ?? 0}
          />
          <StatItem
            label="Expired"
            value={stats.byStatus?.expired ?? 0}
            className="text-muted"
          />
          <StatItem
            label="Failed"
            value={stats.byStatus?.failed ?? 0}
            className="text-danger"
          />
        </div>
      )}

      {/* Priority breakdown */}
      {stats?.byStatus && Object.keys(stats.byType ?? {}).length > 0 && (
        <div className="card" style={{ marginBottom: '1.5rem', padding: '1rem' }}>
          <p className="form-label" style={{ marginBottom: '0.5rem' }}>
            Message Types
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
            {Object.entries(stats.byType).map(([type, count]) => (
              <span key={type} className="tag">
                {type}: <strong>{count}</strong>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="filter-bar">
        <select
          className="select"
          value={filterStatus}
          onChange={(e) => { setFilterStatus(e.target.value); handleFilterChange(); }}
        >
          <option value="">{t('filters.allStatuses')}</option>
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <select
          className="select"
          value={filterPriority}
          onChange={(e) => { setFilterPriority(e.target.value); handleFilterChange(); }}
        >
          <option value="">All priorities</option>
          {PRIORITY_OPTIONS.map((p) => (
            <option key={p} value={p}>{p}</option>
          ))}
        </select>
        {(filterStatus || filterPriority) && (
          <button
            className="btn btn-default btn-sm"
            onClick={() => { setFilterStatus(''); setFilterPriority(''); setPage(1); }}
          >
            Clear filters
          </button>
        )}
        <span className="text-muted" style={{ marginLeft: 'auto', fontSize: '0.875rem' }}>
          {pagination ? `${pagination.total} messages` : ''}
        </span>
      </div>

      {/* Error */}
      {error && <ErrorMessage error={error as Error} />}

      {/* Table */}
      <div className="card">
        <DataTable
          columns={columns}
          data={displayed as unknown as Record<string, unknown>[]}
          loading={isLoading}
          rowKey="id"
          emptyMessage="No relay messages found."
          pagination={
            pagination && pagination.totalPages > 1
              ? {
                  page: pagination.page,
                  totalPages: pagination.totalPages,
                  onPageChange: setPage,
                }
              : undefined
          }
        />
      </div>

      {/* Detail Modal */}
      <Modal
        open={detailMsg !== null}
        onClose={() => setDetailMsg(null)}
        title={`Message: ${detailMsg?.id ?? ''}`}
        size="lg"
      >
        {detailMsg && (
          <div>
            <dl style={{ display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: '0.4rem 1rem', marginBottom: '1rem' }}>
              <dt className="form-label">{t('table.from')}</dt>
              <dd className="mono">{detailMsg.fromNodeId}</dd>

              <dt className="form-label">{t('table.to')}</dt>
              <dd className="mono">{detailMsg.toNodeId}</dd>

              <dt className="form-label">{t('table.method')}</dt>
              <dd><StatusBadge status={detailMsg.messageType} /></dd>

              <dt className="form-label">Subject</dt>
              <dd>{detailMsg.subject ?? <span className="text-muted">No subject</span>}</dd>

              <dt className="form-label">Priority</dt>
              <dd>
                <StatusBadge
                  status={detailMsg.priority}
                  variant={priorityVariant(detailMsg.priority)}
                />
              </dd>

              <dt className="form-label">{t('table.status')}</dt>
              <dd>
                <StatusBadge
                  status={detailMsg.status}
                  variant={statusVariant(detailMsg.status)}
                />
              </dd>

              <dt className="form-label">{t('table.timestamp')}</dt>
              <dd className="text-muted">{formatDate(detailMsg.createdAt)}</dd>

              {detailMsg.deliveredAt && (
                <>
                  <dt className="form-label">Delivered</dt>
                  <dd className="text-muted">{formatDate(detailMsg.deliveredAt)}</dd>
                </>
              )}

              {detailMsg.acknowledgedAt && (
                <>
                  <dt className="form-label">Acknowledged</dt>
                  <dd className="text-muted">{formatDate(detailMsg.acknowledgedAt)}</dd>
                </>
              )}

              {detailMsg.expiresAt && (
                <>
                  <dt className="form-label">Expires</dt>
                  <dd className="text-muted">{formatDate(detailMsg.expiresAt)}</dd>
                </>
              )}
            </dl>

            <p className="form-label" style={{ marginBottom: '0.4rem' }}>Payload</p>
            <textarea
              className="textarea mono"
              readOnly
              rows={14}
              style={{ width: '100%', resize: 'vertical', fontSize: '0.8rem' }}
              value={JSON.stringify(detailMsg.payload, null, 2)}
            />
          </div>
        )}
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        title="Delete Message"
        footer={
          <div className="modal-footer-actions">
            <button
              className="btn btn-default"
              onClick={() => setDeleteTarget(null)}
              disabled={deleteMsg.isPending}
            >
              Cancel
            </button>
            <button
              className="btn btn-danger"
              onClick={handleDelete}
              disabled={deleteMsg.isPending}
            >
              {deleteMsg.isPending ? 'Deleting…' : 'Delete'}
            </button>
          </div>
        }
      >
        {deleteTarget && (
          <p>
            Delete message{' '}
            <span className="mono">{truncateId(deleteTarget.id)}</span>
            {' '}from <span className="mono">{truncateId(deleteTarget.fromNodeId)}</span>?
            This action cannot be undone.
          </p>
        )}
        {deleteMsg.error && (
          <ErrorMessage error={deleteMsg.error as Error} />
        )}
      </Modal>

      {/* Cleanup Modal */}
      <Modal
        open={cleanupOpen}
        onClose={() => setCleanupOpen(false)}
        title={t('cleanupModal.title')}
        footer={
          <div className="modal-footer-actions">
            <button
              className="btn btn-default"
              onClick={() => setCleanupOpen(false)}
              disabled={cleanup.isPending}
            >
              Cancel
            </button>
            <button
              className="btn btn-danger"
              onClick={handleCleanup}
              disabled={cleanup.isPending}
            >
              {cleanup.isPending ? t('cleanupModal.cleaning') : t('cleanupModal.button')}
            </button>
          </div>
        }
      >
        <p className="text-muted" style={{ marginBottom: '1rem' }}>
          {t('cleanupModal.confirm')}
        </p>

        <div className="form-group">
          <label className="form-label" htmlFor="cleanup-before">
            Created before
          </label>
          <input
            id="cleanup-before"
            className="input"
            type="datetime-local"
            value={cleanupForm.before}
            onChange={(e) => setCleanupForm((f) => ({ ...f, before: e.target.value }))}
          />
          <span className="text-muted" style={{ fontSize: '0.8rem' }}>
            Leave empty to ignore date filter.
          </span>
        </div>

        <div className="form-group">
          <label className="form-label" htmlFor="cleanup-status">
            {t('table.status')}
          </label>
          <select
            id="cleanup-status"
            className="select"
            value={cleanupForm.status}
            onChange={(e) => setCleanupForm((f) => ({ ...f, status: e.target.value }))}
          >
            <option value="">{t('filters.allStatuses')}</option>
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>

        {cleanup.error && (
          <ErrorMessage error={cleanup.error as Error} />
        )}
      </Modal>
    </div>
  );
}
