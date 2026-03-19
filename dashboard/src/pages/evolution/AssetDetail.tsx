import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { DataTable, Column } from '../../components/DataTable';
import { StatusBadge } from '../../components/StatusBadge';
import { Modal } from '../../components/Modal';
import { ErrorMessage } from '../../components/ErrorMessage';
import { useAdminAssetDetail, useChangeAssetStatus, AssetReport } from '../../api/hooks';
import { apiClient } from '../../api/client';
import { useUser } from '../../context/UserContext';

export function AssetDetail() {
  const { t } = useTranslation('evolution');
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { isAdmin } = useUser();
  const { data, isLoading, error } = useAdminAssetDetail(id ?? '');
  const changeStatus = useChangeAssetStatus();
  const [actionModal, setActionModal] = useState<{ action: string; newStatus: string } | null>(null);

  if (isLoading) {
    return (
      <div className="page">
        <div className="page-header">
          <h1 className="page-title">Loading...</h1>
        </div>
        <div className="card"><p className="text-muted">Loading asset details...</p></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="page">
        <div className="page-header">
          <h1 className="page-title">Asset Detail</h1>
        </div>
        <ErrorMessage error={error as Error} />
      </div>
    );
  }

  const asset = data?.data;
  if (!asset) {
    return (
      <div className="page">
        <div className="page-header">
          <h1 className="page-title">Asset Not Found</h1>
        </div>
      </div>
    );
  }

  const isGene = asset.assetType === 'gene';
  const successPct = (asset.successRate * 100).toFixed(1);

  const reportColumns: Column<Record<string, unknown>>[] = [
    {
      key: 'reporterNodeId',
      label: 'Reporter Node',
      render: (v) => <span className="mono text-sm">{String(v).slice(0, 20)}...</span>,
    },
    {
      key: 'reportType',
      label: 'Type',
      render: (v) => (
        <StatusBadge
          status={String(v)}
          variant={v === 'success' ? 'success' : v === 'failure' ? 'danger' : 'warning'}
        />
      ),
    },
    {
      key: 'details',
      label: 'Details',
      render: (v) => {
        if (!v) return <span className="text-muted">-</span>;
        const details = v as Record<string, unknown>;
        const text = details.error
          ? String(details.error)
          : details.duration_ms
            ? `${details.duration_ms}ms`
            : JSON.stringify(details).slice(0, 80);
        return <span className="text-sm" title={JSON.stringify(details, null, 2)}>{text}</span>;
      },
    },
    {
      key: 'createdAt',
      label: 'Reported At',
      render: (v) => new Date(String(v)).toLocaleString(),
    },
  ];

  const statusActions = [
    { label: t('assetDetail.promote'), newStatus: 'promoted' },
    { label: 'Approve', newStatus: 'approved' },
    { label: 'Quarantine', newStatus: 'quarantined' },
  ];

  async function handleAction() {
    if (!actionModal || !id) return;
    await changeStatus.mutateAsync({ assetId: id, status: actionModal.newStatus });
    setActionModal(null);
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">
          {isGene ? 'Gene' : 'Capsule'} Detail
        </h1>
        <p className="page-subtitle">
          <a
            href="/evolution/assets"
            onClick={(e) => { e.preventDefault(); navigate('/evolution/assets'); }}
            className="link"
          >
            &larr; {t('assetDetail.backToAssets')}
          </a>
        </p>
      </div>

      {/* Metadata Card */}
      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <div className="card-header">
          <h2 className="card-title">
            <StatusBadge status={asset.assetType} variant={isGene ? 'info' : 'default'} />
            {' '}
            {asset.assetId}
          </h2>
        </div>
        <div className="detail-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', padding: '1rem' }}>
          <div>
            <span className="text-muted text-sm">{t('assetDetail.status')}</span>
            <div><StatusBadge status={asset.status} /></div>
          </div>
          <div>
            <span className="text-muted text-sm">Category</span>
            <div>{asset.category ?? <span className="text-muted">-</span>}</div>
          </div>
          <div>
            <span className="text-muted text-sm">Node ID</span>
            <div className="mono text-sm">{asset.nodeId}</div>
          </div>
          <div>
            <span className="text-muted text-sm">Content Hash</span>
            <div className="mono text-sm" style={{ fontSize: 11, wordBreak: 'break-all' }}>{asset.contentHash?.substring(0, 40)}...</div>
          </div>
          <div>
            <span className="text-muted text-sm">Use Count</span>
            <div className="text-lg">{asset.useCount.toLocaleString()}</div>
          </div>
          <div>
            <span className="text-muted text-sm">Success Rate</span>
            <div className={`text-lg ${Number(successPct) >= 80 ? 'text-success' : Number(successPct) >= 50 ? 'text-warning' : 'text-danger'}`}>
              {successPct}%
            </div>
          </div>
          <div>
            <span className="text-muted text-sm">Fail Count</span>
            <div>{asset.failCount}</div>
          </div>
          <div>
            <span className="text-muted text-sm">Safety Score</span>
            <div>{asset.safetyScore !== null ? `${(asset.safetyScore * 100).toFixed(0)}%` : <span className="text-muted">-</span>}</div>
          </div>
          {isGene && asset.signalsMatch && asset.signalsMatch.length > 0 && (
            <div style={{ gridColumn: '1 / -1' }}>
              <span className="text-muted text-sm">Signals Match</span>
              <div style={{ display: 'flex', gap: '0.25rem', flexWrap: 'wrap', marginTop: '0.25rem' }}>
                {asset.signalsMatch.map((s) => (
                  <span key={s} className="badge badge-outline">{s}</span>
                ))}
              </div>
            </div>
          )}
          {!isGene && asset.geneAssetId && (
            <div>
              <span className="text-muted text-sm">Parent Gene</span>
              <div className="mono text-sm">{asset.geneAssetId}</div>
            </div>
          )}
          {!isGene && asset.confidence !== null && (
            <div>
              <span className="text-muted text-sm">Confidence</span>
              <div>{(asset.confidence! * 100).toFixed(1)}%</div>
            </div>
          )}
          {!isGene && asset.successStreak !== null && (
            <div>
              <span className="text-muted text-sm">Success Streak</span>
              <div>{asset.successStreak}</div>
            </div>
          )}
          <div>
            <span className="text-muted text-sm">Created At</span>
            <div>{new Date(asset.createdAt).toLocaleString()}</div>
          </div>
          <div>
            <span className="text-muted text-sm">Promoted At</span>
            <div>{asset.promotedAt ? new Date(asset.promotedAt).toLocaleString() : <span className="text-muted">-</span>}</div>
          </div>
        </div>
      </div>

      {/* Gene/Capsule Content Description */}
      <GeneContentDescription assetId={asset.assetId} contentHash={asset.contentHash} />

      {/* Strategy / Trigger Data */}
      {isGene && asset.strategy && (
        <div className="card" style={{ marginBottom: '1.5rem' }}>
          <div className="card-header"><h2 className="card-title">Strategy</h2></div>
          <pre className="code-block" style={{ padding: '1rem', fontSize: '0.8rem', overflow: 'auto', maxHeight: '300px', background: 'var(--bg-secondary)', borderRadius: '0.25rem', margin: '0 1rem 1rem' }}>
            {JSON.stringify(asset.strategy, null, 2)}
          </pre>
        </div>
      )}

      {isGene && asset.constraintsData && (
        <div className="card" style={{ marginBottom: '1.5rem' }}>
          <div className="card-header"><h2 className="card-title">Constraints</h2></div>
          <pre className="code-block" style={{ padding: '1rem', fontSize: '0.8rem', overflow: 'auto', maxHeight: '200px', background: 'var(--bg-secondary)', borderRadius: '0.25rem', margin: '0 1rem 1rem' }}>
            {JSON.stringify(asset.constraintsData, null, 2)}
          </pre>
        </div>
      )}

      {isGene && asset.validation && asset.validation.length > 0 && (
        <div className="card" style={{ marginBottom: '1.5rem' }}>
          <div className="card-header"><h2 className="card-title">Validation Commands</h2></div>
          <div style={{ padding: '0 1rem 1rem' }}>
            {asset.validation.map((v, i) => (
              <code key={i} className="mono" style={{ display: 'block', padding: '0.25rem 0.5rem', background: 'var(--bg-secondary)', borderRadius: '0.25rem', marginBottom: '0.25rem', fontSize: '0.8rem' }}>
                $ {v}
              </code>
            ))}
          </div>
        </div>
      )}

      {!isGene && asset.summary && (
        <div className="card" style={{ marginBottom: '1.5rem' }}>
          <div className="card-header"><h2 className="card-title">Summary</h2></div>
          <p style={{ padding: '0 1rem 1rem', whiteSpace: 'pre-wrap' }}>{asset.summary}</p>
        </div>
      )}

      {!isGene && asset.triggerData && (
        <div className="card" style={{ marginBottom: '1.5rem' }}>
          <div className="card-header"><h2 className="card-title">Trigger Data</h2></div>
          <pre className="code-block" style={{ padding: '1rem', fontSize: '0.8rem', overflow: 'auto', maxHeight: '200px', background: 'var(--bg-secondary)', borderRadius: '0.25rem', margin: '0 1rem 1rem' }}>
            {JSON.stringify(asset.triggerData, null, 2)}
          </pre>
        </div>
      )}

      {/* Usage Reports */}
      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <div className="card-header">
          <h2 className="card-title">Usage Reports ({asset.reports?.length ?? 0})</h2>
        </div>
        <DataTable
          columns={reportColumns}
          data={(asset.reports ?? []) as unknown as Record<string, unknown>[]}
          loading={false}
          rowKey="id"
        />
      </div>

      {/* Moderation Actions (admin only) */}
      {isAdmin && (
        <div className="card">
          <div className="card-header"><h2 className="card-title">Moderation</h2></div>
          <div className="action-group" style={{ padding: '1rem', display: 'flex', gap: '0.5rem' }}>
            {statusActions.map(({ label, newStatus }) => (
              <button
                key={label}
                className={`btn ${label === 'Quarantine' ? 'btn-danger' : label === t('assetDetail.promote') ? 'btn-primary' : 'btn-default'}`}
                onClick={() => setActionModal({ action: label, newStatus })}
                disabled={asset.status === newStatus}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      )}

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
              {changeStatus.isPending ? 'Processing...' : 'Confirm'}
            </button>
          </div>
        }
      >
        {actionModal && (
          <p>
            {actionModal.action} asset <strong>{asset.assetId}</strong>? This will set
            its status to <strong>{actionModal.newStatus}</strong>.
          </p>
        )}
      </Modal>
    </div>
  );
}

// ── Gene/Capsule Content Description ──────────────────────────────────────

function GeneContentDescription({ assetId, contentHash }: { assetId: string; contentHash?: string }) {
  // Extract task code from assetId (e.g., "gene-task-FIN-013" → "FIN-013")
  const taskCodeMatch = assetId.match(/gene-task-(\w+-\d+)/);
  const taskCode = taskCodeMatch?.[1];

  // Try to decode contentHash (base64url JSON)
  let decoded: Record<string, unknown> | null = null;
  if (contentHash) {
    try {
      const base64 = contentHash.replace(/-/g, '+').replace(/_/g, '/');
      const padded = base64 + '='.repeat((4 - base64.length % 4) % 4);
      decoded = JSON.parse(atob(padded));
    } catch { /* not decodable */ }
  }

  // Fetch linked task details if taskCode exists
  const { data: taskData } = useQuery({
    queryKey: ['admin', 'tasks', 'by-code', taskCode],
    queryFn: async () => {
      if (!taskCode) return null;
      const res = await apiClient.get<{ data: any[] }>(`/api/v1/admin/tasks`, { task_code: taskCode, page_size: 1 });
      const tasks = (res as any).data ?? [];
      return tasks[0] ?? null;
    },
    enabled: !!taskCode,
    staleTime: 5 * 60 * 1000,
  });

  const task = taskData as any;

  // If neither decoded content nor linked task, show nothing meaningful
  if (!decoded && !task) {
    // Check for capsule-style assetId
    const capsuleMatch = assetId.match(/capsule-(.+)/);
    if (capsuleMatch) {
      return (
        <div className="card" style={{ marginBottom: '1.5rem' }}>
          <div className="card-header"><h2 className="card-title">📄 このCapsuleについて</h2></div>
          <div style={{ padding: '0 1rem 1rem' }}>
            <p style={{ color: 'var(--color-text-secondary)' }}>
              カプセル <strong>{capsuleMatch[1]}</strong> — Geneの知識を特定のコンテキストに適用した実行可能な経験パッケージです。
            </p>
          </div>
        </div>
      );
    }
    return null;
  }

  return (
    <div className="card" style={{ marginBottom: '1.5rem' }}>
      <div className="card-header"><h2 className="card-title">📄 このGeneについて</h2></div>
      <div style={{ padding: '0 1rem 1rem' }}>

        {/* Source badge */}
        {(decoded?.source || taskCode) && (
          <div style={{ marginBottom: 12 }}>
            <span className="badge badge-info" style={{ marginRight: 8 }}>
              {String(decoded?.source ?? 'task-completion')}
            </span>
            {taskCode && <span className="badge badge-outline">{taskCode}</span>}
          </div>
        )}

        {/* Title from task or decoded */}
        <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>
          {String(task?.title ?? decoded?.title ?? assetId)}
        </h3>

        {/* Description / Result Summary */}
        {(task?.description || decoded?.resultSummary) && (
          <div style={{ marginBottom: 12 }}>
            <span className="text-muted text-sm">概要:</span>
            <p style={{ color: 'var(--color-text-secondary)', lineHeight: 1.6, marginTop: 4 }}>
              {String(task?.description ?? decoded?.resultSummary)}
            </p>
          </div>
        )}

        {/* Result / Deliverables from task */}
        {task?.resultSummary && (
          <div style={{ marginBottom: 12 }}>
            <span className="text-muted text-sm">成果:</span>
            <p style={{ lineHeight: 1.6, marginTop: 4 }}>{String(task.resultSummary)}</p>
          </div>
        )}

        {task?.deliverables && (
          <div style={{ marginBottom: 12 }}>
            <span className="text-muted text-sm">成果物:</span>
            <p style={{ whiteSpace: 'pre-wrap', marginTop: 4 }}>{String(task.deliverables)}</p>
          </div>
        )}

        {/* Task metadata */}
        {task && (
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 13, color: 'var(--color-text-muted)', marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--color-border)' }}>
            {task.status && <span>ステータス: <strong>{String(task.status)}</strong></span>}
            {task.assignedRoleId && <span>担当: <strong>{String(task.assignedRoleId)}</strong></span>}
            {task.category && <span>カテゴリ: <strong>{String(task.category)}</strong></span>}
            {task.priority && <span>優先度: <strong>{String(task.priority)}</strong></span>}
          </div>
        )}

        {/* Fallback: show decoded JSON for non-task genes */}
        {decoded && !task && !decoded.source && (
          <pre style={{ padding: 12, fontSize: 12, overflow: 'auto', maxHeight: 300, background: 'var(--bg-secondary)', borderRadius: 4 }}>
            {JSON.stringify(decoded, null, 2)}
          </pre>
        )}
      </div>
    </div>
  );
}
