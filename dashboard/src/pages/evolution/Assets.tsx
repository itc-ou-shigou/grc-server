import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { DataTable, Column } from '../../components/DataTable';
import { StatusBadge } from '../../components/StatusBadge';
import { Modal } from '../../components/Modal';
import { ErrorMessage } from '../../components/ErrorMessage';
import { useAdminAssets, useChangeAssetStatus, Asset } from '../../api/hooks';
import { useUser } from '../../context/UserContext';

const ASSET_TYPES = ['gene', 'capsule'];
const STATUSES = ['pending', 'approved', 'promoted', 'quarantined', 'rejected'];
const CATEGORIES = ['reasoning', 'coding', 'data', 'communication', 'research', 'creative', 'other'];

export function Assets() {
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [assetType, setAssetType] = useState('');
  const [status, setStatus] = useState('');
  const [category, setCategory] = useState('');
  const [actionModal, setActionModal] = useState<{ asset: Asset; action: string; newStatus: string } | null>(null);
  const { isAdmin } = useUser();

  const { data, isLoading, error } = useAdminAssets({
    page,
    page_size: 20,
    asset_type: assetType || undefined,
    status: status || undefined,
    category: category || undefined,
  });
  const changeStatus = useChangeAssetStatus();

  const columns: Column<Record<string, unknown>>[] = [
    {
      key: 'id',
      label: 'Asset ID',
      render: (v) => (
        <a
          href={`/evolution/assets/${String(v)}`}
          onClick={(e) => { e.preventDefault(); navigate(`/evolution/assets/${String(v)}`); }}
          className="mono text-sm link"
        >
          {String(v).slice(0, 12)}...
        </a>
      ),
    },
    {
      key: 'assetType',
      label: 'Type',
      render: (v) => (
        <StatusBadge
          status={String(v)}
          variant={v === 'gene' ? 'info' : 'default'}
        />
      ),
    },
    {
      key: 'assetId',
      label: 'Asset Ref',
      render: (v, row) => {
        const a = row as unknown as Asset;
        return (
          <a
            href={`/evolution/assets/${a.id}`}
            onClick={(e) => { e.preventDefault(); navigate(`/evolution/assets/${a.id}`); }}
            className="mono text-sm link"
            title={String(v)}
          >
            {String(v).length > 20 ? `${String(v).slice(0, 20)}...` : String(v)}
          </a>
        );
      },
    },
    {
      key: 'category',
      label: 'Category',
      render: (v) => v ? <StatusBadge status={String(v)} variant="default" /> : <span className="text-muted">—</span>,
    },
    {
      key: 'status',
      label: 'Status',
      render: (v) => <StatusBadge status={String(v)} />,
    },
    {
      key: 'useCount',
      label: 'Use Count',
      render: (v) => Number(v).toLocaleString(),
    },
    {
      key: 'successRate',
      label: 'Success Rate',
      render: (v) => {
        const pct = Number(v) * 100;
        return (
          <span className={pct >= 80 ? 'text-success' : pct >= 50 ? 'text-warning' : 'text-danger'}>
            {pct.toFixed(1)}%
          </span>
        );
      },
    },
    {
      key: 'safetyScore',
      label: 'Safety',
      render: (v) => {
        if (v === null || v === undefined) return <span className="text-muted">—</span>;
        const score = Number(v);
        return (
          <div className="score-bar-wrapper">
            <div className="score-bar">
              <div
                className="score-bar-fill"
                style={{
                  width: `${score * 100}%`,
                  background: score >= 0.8 ? '#06d6a0' : score >= 0.5 ? '#ffbe0b' : '#ff006e',
                }}
              />
            </div>
            <span className="score-label">{(score * 100).toFixed(0)}</span>
          </div>
        );
      },
    },
    {
      key: 'id',
      label: 'Actions',
      render: (_, row) => {
        const asset = row as unknown as Asset;
        const actions = [
          { label: 'Promote', newStatus: 'promoted' },
          { label: 'Approve', newStatus: 'approved' },
          { label: 'Quarantine', newStatus: 'quarantined' },
        ];
        return (
          <div className="action-group">
            {actions.map(({ label, newStatus }) => (
              <button
                key={label}
                className={`btn btn-sm ${label === 'Quarantine' ? 'btn-danger' : label === 'Promote' ? 'btn-primary' : 'btn-default'}`}
                onClick={() => setActionModal({ asset, action: label, newStatus })}
                disabled={asset.status === newStatus}
              >
                {label}
              </button>
            ))}
          </div>
        );
      },
    },
  ];

  async function handleAction() {
    if (!actionModal) return;
    await changeStatus.mutateAsync({ assetId: actionModal.asset.id, status: actionModal.newStatus });
    setActionModal(null);
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">Assets</h1>
        <p className="page-subtitle">Manage genes and capsules in the evolution system</p>
      </div>

      {error && <ErrorMessage error={error as Error} />}

      <div className="card">
        <div className="filter-bar">
          <select className="select" value={assetType} onChange={(e) => { setAssetType(e.target.value); setPage(1); }}>
            <option value="">All Types</option>
            {ASSET_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <select className="select" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
            <option value="">All Statuses</option>
            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select className="select" value={category} onChange={(e) => { setCategory(e.target.value); setPage(1); }}>
            <option value="">All Categories</option>
            {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>

        <DataTable
          columns={isAdmin ? columns : columns.filter(c => c.label !== 'Actions')}
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
        open={!!actionModal}
        onClose={() => setActionModal(null)}
        title={`${actionModal?.action} Asset`}
        footer={
          <div className="modal-footer-actions">
            <button className="btn btn-default" onClick={() => setActionModal(null)}>Cancel</button>
            <button
              className={`btn ${actionModal?.action === 'Quarantine' ? 'btn-danger' : 'btn-primary'}`}
              onClick={handleAction}
              disabled={changeStatus.isPending}
            >
              {changeStatus.isPending ? 'Processing…' : 'Confirm'}
            </button>
          </div>
        }
      >
        {actionModal && (
          <p>
            {actionModal.action} asset <strong>{actionModal.asset.assetId}</strong>? This will set
            its status to <strong>{actionModal.newStatus}</strong>.
          </p>
        )}
      </Modal>
    </div>
  );
}
