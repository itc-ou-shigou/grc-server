import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DataTable, Column } from '../../components/DataTable';
import { StatusBadge } from '../../components/StatusBadge';
import { ErrorMessage } from '../../components/ErrorMessage';
import { useAdminNodes, Node } from '../../api/hooks';

const HOURS_24 = 24 * 60 * 60 * 1000;

function isActive(lastHeartbeat: string | null): boolean {
  if (!lastHeartbeat) return false;
  return Date.now() - new Date(lastHeartbeat).getTime() < HOURS_24;
}

function formatHeartbeat(lastHeartbeat: string | null): string {
  if (!lastHeartbeat) return 'Never';
  const diffMs = Date.now() - new Date(lastHeartbeat).getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return `${Math.floor(diffHr / 24)}d ago`;
}

export function Nodes() {
  const { t } = useTranslation('evolution');
  const [page, setPage] = useState(1);

  const { data, isLoading, error } = useAdminNodes({ page, page_size: 20 });

  const columns: Column<Record<string, unknown>>[] = [
    {
      key: 'nodeId',
      label: t('nodes.table.nodeId'),
      render: (v) => <span className="mono text-sm">{String(v).slice(0, 12)}…</span>,
    },
    { key: 'displayName', label: 'Display Name' },
    {
      key: 'employeeId',
      label: 'Employee ID',
      render: (v) => v ? <span className="mono text-sm">{String(v)}</span> : <span className="text-muted">—</span>,
    },
    {
      key: 'employeeName',
      label: 'Employee',
      render: (v) => v ? <span>{String(v)}</span> : <span className="text-muted">—</span>,
    },
    {
      key: 'employeeEmail',
      label: 'Email',
      render: (v) => v ? <span className="text-sm">{String(v)}</span> : <span className="text-muted">—</span>,
    },
    {
      key: 'platform',
      label: t('nodes.table.platform'),
      render: (v) => {
        if (!v) return <span className="text-muted">—</span>;
        const p = String(v);
        const icon = p.includes('win') ? '🪟' : p.includes('mac') ? '🍎' : '🐧';
        return <span>{icon} {p}</span>;
      },
    },
    {
      key: 'winclawVersion',
      label: t('nodes.table.version'),
      render: (v) => v ? <span className="mono">{String(v)}</span> : <span className="text-muted">—</span>,
    },
    {
      key: 'geneCount',
      label: 'Genes',
      render: (v) => <span className="badge-count">{String(v)}</span>,
    },
    {
      key: 'capsuleCount',
      label: 'Capsules',
      render: (v) => <span className="badge-count">{String(v)}</span>,
    },
    {
      key: 'lastHeartbeat',
      label: t('nodes.table.lastSeen'),
      render: (v) => {
        const active = isActive(v as string | null);
        return (
          <span className={active ? 'text-success' : 'text-muted'}>
            {formatHeartbeat(v as string | null)}
          </span>
        );
      },
    },
    {
      key: 'nodeStatus',
      label: t('nodes.table.status'),
      render: (_, row) => {
        const active = isActive((row as Record<string, unknown>).lastHeartbeat as string | null);
        return <StatusBadge status={active ? 'Active' : 'Inactive'} />;
      },
    },
    {
      key: 'createdAt',
      label: 'Registered',
      render: (v) => new Date(String(v)).toLocaleDateString(),
    },
  ];

  const activeCount = (data?.data ?? []).filter((n) => {
    const node = n as unknown as Node;
    return isActive(node.lastHeartbeat);
  }).length;

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">{t('nodes.title')}</h1>
        <p className="page-subtitle">
          {t('nodes.subtitle')}
          {data && (
            <span className="page-subtitle-extra">
              {' — '}{activeCount} active of {data.pagination.total} total
            </span>
          )}
        </p>
      </div>

      {error && <ErrorMessage error={error as Error} />}

      <div className="card">
        <DataTable
          columns={columns}
          data={(data?.data ?? []) as unknown as Record<string, unknown>[]}
          loading={isLoading}
          rowKey="id"
          pagination={
            data
              ? { page, totalPages: data.pagination.totalPages, onPageChange: setPage }
              : undefined
          }
          emptyMessage="No nodes registered."
        />
      </div>
    </div>
  );
}
