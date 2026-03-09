import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DataTable, Column } from '../../components/DataTable';
import { Modal } from '../../components/Modal';
import { ErrorMessage } from '../../components/ErrorMessage';
import { useApiKeys, useRevokeApiKey, ApiKey } from '../../api/hooks';

export function ApiKeys() {
  const { t } = useTranslation('apikeys');
  const [page, setPage] = useState(1);
  const [revokeTarget, setRevokeTarget] = useState<ApiKey | null>(null);

  const { data, isLoading, error } = useApiKeys({ page, page_size: 20 });
  const revokeKey = useRevokeApiKey();

  const columns: Column<Record<string, unknown>>[] = [
    {
      key: 'id',
      label: 'ID',
      render: (v) => <span className="mono text-sm">{String(v).slice(0, 8)}…</span>,
    },
    {
      key: 'keyPrefix',
      label: t('table.key'),
      render: (v) => <span className="mono">{String(v)}…</span>,
    },
    { key: 'userEmail', label: t('table.owner') },
    { key: 'name', label: 'Name' },
    {
      key: 'scopes',
      label: t('table.scopes'),
      render: (v) => {
        const scopes = (v as string[] | null) ?? [];
        return (
          <div className="tag-list">
            {scopes.slice(0, 3).map((s) => (
              <span key={s} className="tag">{s}</span>
            ))}
            {scopes.length > 3 && <span className="tag">+{scopes.length - 3}</span>}
          </div>
        );
      },
    },
    {
      key: 'lastUsedAt',
      label: t('table.lastUsed'),
      render: (v) => v ? new Date(String(v)).toLocaleDateString() : <span className="text-muted">Never</span>,
    },
    {
      key: 'expiresAt',
      label: t('table.expires'),
      render: (v) => {
        if (!v) return <span className="text-muted">Never</span>;
        const d = new Date(String(v));
        const expired = d < new Date();
        return <span className={expired ? 'text-danger' : ''}>{d.toLocaleDateString()}</span>;
      },
    },
    {
      key: 'id',
      label: 'Actions',
      render: (_, row) => {
        const key = row as unknown as ApiKey;
        return (
          <button
            className="btn btn-danger btn-sm"
            onClick={() => setRevokeTarget(key)}
          >
            {t('revokeModal.button')}
          </button>
        );
      },
    },
  ];

  async function handleRevoke() {
    if (!revokeTarget) return;
    await revokeKey.mutateAsync(revokeTarget.id);
    setRevokeTarget(null);
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">{t('title')}</h1>
        <p className="page-subtitle">{t('subtitle')}</p>
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
        />
      </div>

      <Modal
        open={!!revokeTarget}
        onClose={() => setRevokeTarget(null)}
        title={t('revokeModal.title')}
        footer={
          <div className="modal-footer-actions">
            <button className="btn btn-default" onClick={() => setRevokeTarget(null)}>Cancel</button>
            <button
              className="btn btn-danger"
              onClick={handleRevoke}
              disabled={revokeKey.isPending}
            >
              {revokeKey.isPending ? t('revokeModal.revoking') : t('revokeModal.button')}
            </button>
          </div>
        }
      >
        {revokeTarget && (
          <p>
            {t('revokeModal.confirm', { prefix: revokeTarget.keyPrefix })}
            {revokeTarget.name ? ` (${revokeTarget.name})` : ''}
          </p>
        )}
      </Modal>
    </div>
  );
}
