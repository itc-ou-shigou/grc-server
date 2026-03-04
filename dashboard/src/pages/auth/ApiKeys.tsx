import { useState } from 'react';
import { DataTable, Column } from '../../components/DataTable';
import { Modal } from '../../components/Modal';
import { ErrorMessage } from '../../components/ErrorMessage';
import { useApiKeys, useRevokeApiKey, ApiKey } from '../../api/hooks';

export function ApiKeys() {
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
      label: 'Key Prefix',
      render: (v) => <span className="mono">{String(v)}…</span>,
    },
    { key: 'userEmail', label: 'User' },
    { key: 'name', label: 'Name' },
    {
      key: 'scopes',
      label: 'Scopes',
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
      label: 'Last Used',
      render: (v) => v ? new Date(String(v)).toLocaleDateString() : <span className="text-muted">Never</span>,
    },
    {
      key: 'expiresAt',
      label: 'Expires',
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
            Revoke
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
        <h1 className="page-title">API Keys</h1>
        <p className="page-subtitle">Manage API keys issued to platform users</p>
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
        title="Revoke API Key"
        footer={
          <div className="modal-footer-actions">
            <button className="btn btn-default" onClick={() => setRevokeTarget(null)}>Cancel</button>
            <button
              className="btn btn-danger"
              onClick={handleRevoke}
              disabled={revokeKey.isPending}
            >
              {revokeKey.isPending ? 'Revoking…' : 'Revoke Key'}
            </button>
          </div>
        }
      >
        {revokeTarget && (
          <p>
            Revoke API key <strong>{revokeTarget.keyPrefix}…</strong>
            {revokeTarget.name ? ` (${revokeTarget.name})` : ''}? This action cannot be undone.
          </p>
        )}
      </Modal>
    </div>
  );
}
