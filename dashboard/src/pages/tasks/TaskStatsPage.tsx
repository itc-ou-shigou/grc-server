import { useTranslation } from 'react-i18next';
import { useTaskStats } from '../../api/hooks';
import { ErrorMessage } from '../../components/ErrorMessage';

const STATUS_ORDER = [
  'draft',
  'pending',
  'in_progress',
  'blocked',
  'review',
  'approved',
  'completed',
  'cancelled',
];

const PRIORITY_ORDER = ['critical', 'high', 'medium', 'low'];

const STATUS_COLORS: Record<string, string> = {
  draft: 'var(--color-muted, #aaa)',
  pending: 'var(--color-info, #4a90d9)',
  in_progress: 'var(--color-primary, #2d6be4)',
  blocked: 'var(--color-danger, #e03e3e)',
  review: 'var(--color-warning, #e09c00)',
  approved: 'var(--color-success, #2a9d5c)',
  completed: 'var(--color-success, #2a9d5c)',
  cancelled: 'var(--color-muted, #aaa)',
};

const PRIORITY_COLORS: Record<string, string> = {
  critical: 'var(--color-danger, #e03e3e)',
  high: 'var(--color-warning, #e09c00)',
  medium: 'var(--color-info, #4a90d9)',
  low: 'var(--color-muted, #aaa)',
};

function labelOf(key: string): string {
  return key
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function pct(value: number, total: number): number {
  if (total === 0) return 0;
  return Math.round((value / total) * 100);
}

interface BreakdownBarProps {
  label: string;
  count: number;
  total: number;
  color: string;
}

function BreakdownBar({ label, count, total, color }: BreakdownBarProps) {
  const percentage = pct(count, total);
  return (
    <div style={{ marginBottom: '0.6rem' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '0.25rem',
          fontSize: '0.875rem',
        }}
      >
        <span>{label}</span>
        <span className="mono" style={{ color: 'var(--text-muted, #888)' }}>
          {count} ({percentage}%)
        </span>
      </div>
      <div
        style={{
          height: '8px',
          background: 'rgba(66, 72, 89, 0.20)',
          borderRadius: '4px',
          overflow: 'hidden',
        }}
        role="progressbar"
        aria-valuenow={percentage}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${label}: ${count}`}
      >
        <div
          style={{
            height: '100%',
            width: `${percentage}%`,
            background: color,
            borderRadius: '4px',
            transition: 'width 0.3s ease',
          }}
        />
      </div>
    </div>
  );
}

export function TaskStatsPage() {
  const { t } = useTranslation('tasks');
  const { data: stats, isLoading, error } = useTaskStats();

  if (isLoading) {
    return (
      <div className="page">
        <div className="page-header">
          <h1 className="page-title">{t('stats.title')}</h1>
        </div>
        <p className="text-muted">Loading statistics...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="page">
        <div className="page-header">
          <h1 className="page-title">{t('stats.title')}</h1>
        </div>
        <ErrorMessage error={error as Error} />
      </div>
    );
  }

  if (!stats) return null;

  const byStatus = stats.byStatus ?? {};
  const byPriority = stats.byPriority ?? {};
  const byCategory = stats.byCategory ?? {};

  // Build ordered lists, falling back to sorted keys for any extra entries
  const statusKeys = [
    ...STATUS_ORDER.filter((k) => k in byStatus),
    ...Object.keys(byStatus)
      .filter((k) => !STATUS_ORDER.includes(k))
      .sort(),
  ];

  const priorityKeys = [
    ...PRIORITY_ORDER.filter((k) => k in byPriority),
    ...Object.keys(byPriority)
      .filter((k) => !PRIORITY_ORDER.includes(k))
      .sort(),
  ];

  const categoryKeys = Object.keys(byCategory).sort();

  const totalForStatus = Object.values(byStatus).reduce((a, b) => a + b, 0);
  const totalForPriority = Object.values(byPriority).reduce((a, b) => a + b, 0);
  const totalForCategory = Object.values(byCategory).reduce((a, b) => a + b, 0);

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">{t('stats.title')}</h1>
          <p className="page-subtitle">{t('stats.subtitle')}</p>
        </div>
      </div>

      {/* Top-level stat cards */}
      <div className="stat-grid" style={{ marginBottom: '1.5rem' }}>
        <div className="stat-card">
          <div className="stat-value">{stats.total.toLocaleString()}</div>
          <div className="stat-label">{t('stats.totalTasks')}</div>
        </div>

        <div className="stat-card">
          <div className="stat-value">
            {(stats.completionRate * 100).toFixed(1)}
            <span style={{ fontSize: '0.6em', marginLeft: '2px' }}>%</span>
          </div>
          <div className="stat-label">{t('stats.completionRate')}</div>
        </div>

        <div className="stat-card">
          <div className="stat-value">
            {(Number(stats.avgCompletionDays) || 0).toFixed(1)}
            <span style={{ fontSize: '0.6em', marginLeft: '2px' }}>d</span>
          </div>
          <div className="stat-label">{t('stats.avgCompletionTime')}</div>
        </div>

        <div className="stat-card">
          <div className="stat-value">{stats.pendingExpenses.toLocaleString()}</div>
          <div className="stat-label">Pending Expenses</div>
        </div>
      </div>

      {/* Breakdown panels */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
          gap: '1rem',
        }}
      >
        {/* By Status */}
        <div className="card">
          <h2
            className="page-subtitle"
            style={{ marginBottom: '1rem', fontSize: '1rem', fontWeight: 600 }}
          >
            By Status
          </h2>
          {statusKeys.length === 0 ? (
            <p className="text-muted">No data.</p>
          ) : (
            statusKeys.map((key) => (
              <BreakdownBar
                key={key}
                label={labelOf(key)}
                count={byStatus[key]}
                total={totalForStatus}
                color={STATUS_COLORS[key] ?? 'var(--color-primary, #2d6be4)'}
              />
            ))
          )}
          <div
            className="text-muted"
            style={{ fontSize: '0.8rem', marginTop: '0.75rem', textAlign: 'right' }}
          >
            Total: {totalForStatus}
          </div>
        </div>

        {/* By Priority */}
        <div className="card">
          <h2
            className="page-subtitle"
            style={{ marginBottom: '1rem', fontSize: '1rem', fontWeight: 600 }}
          >
            By Priority
          </h2>
          {priorityKeys.length === 0 ? (
            <p className="text-muted">No data.</p>
          ) : (
            priorityKeys.map((key) => (
              <BreakdownBar
                key={key}
                label={labelOf(key)}
                count={byPriority[key]}
                total={totalForPriority}
                color={PRIORITY_COLORS[key] ?? 'var(--color-primary, #2d6be4)'}
              />
            ))
          )}
          <div
            className="text-muted"
            style={{ fontSize: '0.8rem', marginTop: '0.75rem', textAlign: 'right' }}
          >
            Total: {totalForPriority}
          </div>
        </div>

        {/* By Category */}
        <div className="card">
          <h2
            className="page-subtitle"
            style={{ marginBottom: '1rem', fontSize: '1rem', fontWeight: 600 }}
          >
            By Category
          </h2>
          {categoryKeys.length === 0 ? (
            <p className="text-muted">No data.</p>
          ) : (
            categoryKeys.map((key) => (
              <BreakdownBar
                key={key}
                label={labelOf(key)}
                count={byCategory[key]}
                total={totalForCategory}
                color="var(--color-primary, #2d6be4)"
              />
            ))
          )}
          <div
            className="text-muted"
            style={{ fontSize: '0.8rem', marginTop: '0.75rem', textAlign: 'right' }}
          >
            Total: {totalForCategory}
          </div>
        </div>
      </div>

      {/* Summary row */}
      <div className="card" style={{ marginTop: '1rem' }}>
        <h2
          className="page-subtitle"
          style={{ marginBottom: '0.75rem', fontSize: '1rem', fontWeight: 600 }}
        >
          Summary
        </h2>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
            gap: '0.5rem 1.5rem',
            fontSize: '0.875rem',
          }}
        >
          <SummaryRow
            label="Completed"
            value={byStatus['completed'] ?? 0}
            className="text-success"
          />
          <SummaryRow
            label="In Progress"
            value={byStatus['in_progress'] ?? 0}
            className="text-warning"
          />
          <SummaryRow
            label="Blocked"
            value={byStatus['blocked'] ?? 0}
            className="text-danger"
          />
          <SummaryRow
            label="Pending Review"
            value={byStatus['review'] ?? 0}
            className=""
          />
          <SummaryRow
            label="Critical Priority"
            value={byPriority['critical'] ?? 0}
            className="text-danger"
          />
          <SummaryRow
            label="High Priority"
            value={byPriority['high'] ?? 0}
            className="text-warning"
          />
        </div>
      </div>
    </div>
  );
}

function SummaryRow({
  label,
  value,
  className,
}: {
  label: string;
  value: number;
  className: string;
}) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.2rem 0' }}>
      <span className="text-muted">{label}</span>
      <span className={`mono ${className}`} style={{ fontWeight: 600 }}>
        {value.toLocaleString()}
      </span>
    </div>
  );
}
