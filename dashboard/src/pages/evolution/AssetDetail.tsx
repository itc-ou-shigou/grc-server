import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation } from '@tanstack/react-query';
import { DataTable, Column } from '../../components/DataTable';
import { StatusBadge } from '../../components/StatusBadge';
import { Modal } from '../../components/Modal';
import { ErrorMessage } from '../../components/ErrorMessage';
import { useAdminAssetDetail, useChangeAssetStatus, useAssetUsage } from '../../api/hooks';
import { apiClient } from '../../api/client';
import { useUser } from '../../context/UserContext';

export function AssetDetail() {
  const { t } = useTranslation('evolution');
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { isAdmin } = useUser();
  const { data, isLoading, error } = useAdminAssetDetail(id ?? '');
  const { data: usageData, isLoading: usageLoading } = useAssetUsage(id ?? '');
  const changeStatus = useChangeAssetStatus();
  const [actionModal, setActionModal] = useState<{ action: string; newStatus: string } | null>(null);

  const voteMutation = useMutation({
    mutationFn: (vote: 'upvote' | 'downvote') =>
      apiClient.post('/a2a/evolution/vote', {
        asset_id: data?.data?.assetId,
        voter_node_id: data?.data?.nodeId,
        vote,
      }),
  });

  function handleVote(vote: 'upvote' | 'downvote') {
    voteMutation.mutate(vote);
  }

  if (isLoading) {
    return (
      <div className="page">
        <div className="page-header">
          <h1 className="page-title">{t('assetDetail.loading')}</h1>
        </div>
        <div className="card"><p className="text-muted">{t('assetDetail.loadingDetails')}</p></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="page">
        <div className="page-header">
          <h1 className="page-title">{t('assetDetail.errorTitle')}</h1>
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
          <h1 className="page-title">{t('assetDetail.notFound')}</h1>
        </div>
      </div>
    );
  }

  const isGene = asset.assetType === 'gene';
  const successPct = (asset.successRate * 100).toFixed(1);

  const reportColumns: Column<Record<string, unknown>>[] = [
    {
      key: 'reporterNodeId',
      label: t('assetDetail.reporterNode'),
      render: (v, row) => {
        const name = row?.reporterName as string | null;
        const role = row?.reporterRole as string | null;
        if (name) {
          return (
            <span className="text-sm">
              {name}
              {role && <span className="badge badge-outline" style={{ marginLeft: 6, fontSize: 11 }}>{role}</span>}
            </span>
          );
        }
        return <span className="mono text-sm">{String(v).slice(0, 20)}...</span>;
      },
    },
    {
      key: 'reportType',
      label: t('assetDetail.reportType'),
      render: (v) => (
        <StatusBadge
          status={String(v)}
          variant={v === 'success' ? 'success' : v === 'failure' ? 'danger' : 'warning'}
        />
      ),
    },
    {
      key: 'details',
      label: t('assetDetail.reportDetails'),
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
      label: t('assetDetail.reportedAt'),
      render: (v) => new Date(String(v)).toLocaleString(),
    },
  ];

  const statusActions = [
    { label: t('assetDetail.promote'), newStatus: 'promoted' },
    { label: t('assetDetail.approve'), newStatus: 'approved' },
    { label: t('assetDetail.quarantine'), newStatus: 'quarantined' },
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
          {isGene ? t('assetDetail.geneDetailTitle') : t('assetDetail.capsuleDetailTitle')}
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
            <span className="text-muted text-sm">{t('assetDetail.category')}</span>
            <div>{asset.category ?? <span className="text-muted">-</span>}</div>
          </div>
          <div>
            <span className="text-muted text-sm">{t('assetDetail.nodeId')}</span>
            <div className="mono text-sm">{asset.nodeId}</div>
          </div>
          <div>
            <span className="text-muted text-sm">{t('assetDetail.contentHash')}</span>
            <div className="mono text-sm" style={{ fontSize: 11, wordBreak: 'break-all' }}>{asset.contentHash?.substring(0, 40)}...</div>
          </div>
          <div>
            <span className="text-muted text-sm">{t('assetDetail.useCount')}</span>
            <div className="text-lg">{asset.useCount.toLocaleString()}</div>
          </div>
          <div>
            <span className="text-muted text-sm">{t('assetDetail.successRate')}</span>
            <div className={`text-lg ${Number(successPct) >= 80 ? 'text-success' : Number(successPct) >= 50 ? 'text-warning' : 'text-danger'}`}>
              {successPct}%
            </div>
          </div>
          <div>
            <span className="text-muted text-sm">{t('assetDetail.failCount')}</span>
            <div>{asset.failCount}</div>
          </div>
          <div>
            <span className="text-muted text-sm">{t('assetDetail.safetyScore')}</span>
            <div>{asset.safetyScore !== null ? `${(asset.safetyScore * 100).toFixed(0)}%` : <span className="text-muted">-</span>}</div>
          </div>
          {isGene && asset.signalsMatch && asset.signalsMatch.length > 0 && (
            <div style={{ gridColumn: '1 / -1' }}>
              <span className="text-muted text-sm">{t('assetDetail.signalsMatch')}</span>
              <div style={{ display: 'flex', gap: '0.25rem', flexWrap: 'wrap', marginTop: '0.25rem' }}>
                {asset.signalsMatch.map((s) => (
                  <span key={s} className="badge badge-outline">{s}</span>
                ))}
              </div>
            </div>
          )}
          {!isGene && asset.geneAssetId && (
            <div>
              <span className="text-muted text-sm">{t('assetDetail.parentGene')}</span>
              <div className="mono text-sm">{asset.geneAssetId}</div>
            </div>
          )}
          {!isGene && asset.confidence !== null && (
            <div>
              <span className="text-muted text-sm">{t('assetDetail.confidence')}</span>
              <div>{(asset.confidence! * 100).toFixed(1)}%</div>
            </div>
          )}
          {!isGene && asset.successStreak !== null && (
            <div>
              <span className="text-muted text-sm">{t('assetDetail.successStreak')}</span>
              <div>{asset.successStreak}</div>
            </div>
          )}
          <div>
            <span className="text-muted text-sm">{t('assetDetail.createdAt')}</span>
            <div>{new Date(asset.createdAt).toLocaleString()}</div>
          </div>
          <div>
            <span className="text-muted text-sm">{t('assetDetail.promotedAt')}</span>
            <div>{asset.promotedAt ? new Date(asset.promotedAt).toLocaleString() : <span className="text-muted">-</span>}</div>
          </div>
        </div>
      </div>

      {/* Gene/Capsule Content Description */}
      <GeneContentDescription assetId={asset.assetId} contentHash={asset.contentHash} />

      {/* Usage Tracking Section */}
      <AssetUsageSection assetId={id!} isGene={isGene} loading={usageLoading} data={usageData} />

      {/* Strategy / Trigger Data */}
      {isGene && asset.strategy && (
        <div className="card" style={{ marginBottom: '1.5rem' }}>
          <div className="card-header"><h2 className="card-title">📋 {t('assetDetail.strategy')}</h2></div>
          <div style={{ padding: '0 1rem 1rem' }}>
            {Array.isArray(asset.strategy) ? (
              <ol style={{ margin: 0, paddingLeft: '1.5rem', lineHeight: 1.8 }}>
                {asset.strategy.map((step: string, i: number) => (
                  <li key={i} style={{ marginBottom: 4, fontSize: 14 }}>{step}</li>
                ))}
              </ol>
            ) : (
              <pre style={{ padding: 12, fontSize: 12, overflow: 'auto', maxHeight: 300, background: 'var(--bg-secondary)', borderRadius: 4 }}>
                {JSON.stringify(asset.strategy, null, 2)}
              </pre>
            )}
          </div>
        </div>
      )}

      {isGene && asset.constraintsData && (
        <div className="card" style={{ marginBottom: '1.5rem' }}>
          <div className="card-header"><h2 className="card-title">{t('assetDetail.constraints')}</h2></div>
          <pre className="code-block" style={{ padding: '1rem', fontSize: '0.8rem', overflow: 'auto', maxHeight: '200px', background: 'var(--bg-secondary)', borderRadius: '0.25rem', margin: '0 1rem 1rem' }}>
            {JSON.stringify(asset.constraintsData, null, 2)}
          </pre>
        </div>
      )}

      {isGene && asset.validation && asset.validation.length > 0 && (
        <div className="card" style={{ marginBottom: '1.5rem' }}>
          <div className="card-header"><h2 className="card-title">{t('assetDetail.validationCommands')}</h2></div>
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
          <div className="card-header"><h2 className="card-title">{t('assetDetail.summary')}</h2></div>
          <p style={{ padding: '0 1rem 1rem', whiteSpace: 'pre-wrap' }}>{asset.summary}</p>
        </div>
      )}

      {!isGene && asset.triggerData && (
        <div className="card" style={{ marginBottom: '1.5rem' }}>
          <div className="card-header"><h2 className="card-title">{t('assetDetail.triggerData')}</h2></div>
          <pre className="code-block" style={{ padding: '1rem', fontSize: '0.8rem', overflow: 'auto', maxHeight: '200px', background: 'var(--bg-secondary)', borderRadius: '0.25rem', margin: '0 1rem 1rem' }}>
            {JSON.stringify(asset.triggerData, null, 2)}
          </pre>
        </div>
      )}

      {/* Usage Reports */}
      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <div className="card-header">
          <h2 className="card-title">{t('assetDetail.usageReports', { count: asset.reports?.length ?? 0 })}</h2>
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
        <div className="card" style={{ marginBottom: '1.5rem' }}>
          <div className="card-header"><h2 className="card-title">{t('assetDetail.moderation')}</h2></div>
          <div className="action-group" style={{ padding: '1rem', display: 'flex', gap: '0.5rem' }}>
            {statusActions.map(({ label, newStatus }) => (
              <button
                key={newStatus}
                className={`btn ${newStatus === 'quarantined' ? 'btn-danger' : newStatus === 'promoted' ? 'btn-primary' : 'btn-default'}`}
                onClick={() => setActionModal({ action: label, newStatus })}
                disabled={asset.status === newStatus}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Voting Section */}
      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <div className="card-header">
          <h2 className="card-title">{t('assetDetail.voting.title')}</h2>
        </div>
        <div style={{ padding: '1rem', display: 'flex', gap: 12, alignItems: 'center' }}>
          <button
            className="btn btn-default"
            onClick={() => handleVote('upvote')}
            disabled={voteMutation.isPending}
            style={{ display: 'flex', alignItems: 'center', gap: 6 }}
          >
            👍 {t('assetDetail.voting.upvote')}
          </button>
          <button
            className="btn btn-default"
            onClick={() => handleVote('downvote')}
            disabled={voteMutation.isPending}
            style={{ display: 'flex', alignItems: 'center', gap: 6 }}
          >
            👎 {t('assetDetail.voting.downvote')}
          </button>
          {voteMutation.isSuccess && (
            <span className="text-success text-sm">{t('assetDetail.voting.submitted')}</span>
          )}
          {voteMutation.isError && (
            <span className="text-danger text-sm">{t('assetDetail.voting.error')}</span>
          )}
        </div>
      </div>

      <Modal
        open={!!actionModal}
        onClose={() => setActionModal(null)}
        title={t('assetDetail.modal.title', { action: actionModal?.action })}
        footer={
          <div className="modal-footer-actions">
            <button className="btn btn-default" onClick={() => setActionModal(null)}>{t('assetDetail.modal.cancel')}</button>
            <button
              className={`btn ${actionModal?.newStatus === 'quarantined' ? 'btn-danger' : 'btn-primary'}`}
              onClick={handleAction}
              disabled={changeStatus.isPending}
            >
              {changeStatus.isPending ? t('assetDetail.modal.processing') : t('assetDetail.modal.confirm')}
            </button>
          </div>
        }
      >
        {actionModal && (
          <p>
            {t('assetDetail.modal.body', {
              action: actionModal.action,
              assetId: asset.assetId,
              newStatus: actionModal.newStatus,
            })}
          </p>
        )}
      </Modal>
    </div>
  );
}

// ── Asset Usage Section ──────────────────────────────────────────────────

function AssetUsageSection({
  assetId,
  isGene,
  loading,
  data,
}: {
  assetId: string;
  isGene: boolean;
  loading: boolean;
  data: import('../../api/hooks').AssetUsageResponse | undefined;
}) {
  const { t } = useTranslation('evolution');

  if (loading) {
    return (
      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <div className="card-header"><h2 className="card-title">{t('assetDetail.usage.title')}</h2></div>
        <div style={{ padding: '1rem' }}><p className="text-muted">{t('assetDetail.usage.loading')}</p></div>
      </div>
    );
  }

  if (!data) return null;

  const hasCapsules = isGene && data.capsules.length > 0;
  const hasReporters = data.reporters.length > 0;

  if (!hasCapsules && !hasReporters) {
    return (
      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <div className="card-header"><h2 className="card-title">{t('assetDetail.usage.title')}</h2></div>
        <div style={{ padding: '1rem' }}>
          <p className="text-muted">{t('assetDetail.usage.noReports')}</p>
        </div>
      </div>
    );
  }

  return (
    <>
      {/* Capsules derived from this Gene */}
      {hasCapsules && (
        <div className="card" style={{ marginBottom: '1.5rem' }}>
          <div className="card-header">
            <h2 className="card-title">{t('assetDetail.usage.capsulesTitle', { count: data.capsules.length })}</h2>
          </div>
          <div style={{ padding: '0 1rem 1rem' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                  <th style={{ textAlign: 'left', padding: '0.5rem 0.5rem', color: 'var(--color-text-muted)' }}>{t('assetDetail.usage.colAssetId')}</th>
                  <th style={{ textAlign: 'left', padding: '0.5rem 0.5rem', color: 'var(--color-text-muted)' }}>{t('assetDetail.usage.colNode')}</th>
                  <th style={{ textAlign: 'left', padding: '0.5rem 0.5rem', color: 'var(--color-text-muted)' }}>{t('assetDetail.usage.colStatus')}</th>
                </tr>
              </thead>
              <tbody>
                {data.capsules.map((c) => (
                  <tr key={c.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                    <td style={{ padding: '0.5rem' }}>
                      <span className="mono text-sm">{c.assetId}</span>
                    </td>
                    <td style={{ padding: '0.5rem' }}>
                      {c.nodeName || <span className="text-muted">-</span>}
                      {c.role && <span className="badge badge-outline" style={{ marginLeft: 6, fontSize: 11 }}>{c.role}</span>}
                    </td>
                    <td style={{ padding: '0.5rem' }}>
                      <span className={`badge ${c.status === 'promoted' ? 'badge-success' : c.status === 'quarantined' ? 'badge-danger' : 'badge-default'}`}>
                        {c.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Reporter agents */}
      {hasReporters && (
        <div className="card" style={{ marginBottom: '1.5rem' }}>
          <div className="card-header">
            <h2 className="card-title">{t('assetDetail.usage.reportersTitle', { count: data.reporters.length, total: data.totalUses })}</h2>
          </div>
          <div style={{ padding: '0 1rem 1rem' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                  <th style={{ textAlign: 'left', padding: '0.5rem 0.5rem', color: 'var(--color-text-muted)' }}>{t('assetDetail.usage.colAgent')}</th>
                  <th style={{ textAlign: 'left', padding: '0.5rem 0.5rem', color: 'var(--color-text-muted)' }}>{t('assetDetail.usage.colRole')}</th>
                  <th style={{ textAlign: 'right', padding: '0.5rem 0.5rem', color: 'var(--color-text-muted)' }}>{t('assetDetail.usage.colReports')}</th>
                  <th style={{ textAlign: 'left', padding: '0.5rem 0.5rem', color: 'var(--color-text-muted)' }}>{t('assetDetail.usage.colLastUsed')}</th>
                </tr>
              </thead>
              <tbody>
                {data.reporters.map((r) => (
                  <tr key={r.nodeId} style={{ borderBottom: '1px solid var(--color-border)' }}>
                    <td style={{ padding: '0.5rem' }}>{r.nodeName}</td>
                    <td style={{ padding: '0.5rem' }}>
                      {r.role ? <span className="badge badge-outline">{r.role}</span> : <span className="text-muted">-</span>}
                    </td>
                    <td style={{ padding: '0.5rem', textAlign: 'right', fontWeight: 600 }}>{r.reportCount}</td>
                    <td style={{ padding: '0.5rem' }}>{new Date(r.lastUsed).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}

// ── Gene/Capsule Content Description ──────────────────────────────────────

function GeneContentDescription({ assetId, contentHash }: { assetId: string; contentHash?: string }) {
  const { t } = useTranslation('evolution');

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
          <div className="card-header"><h2 className="card-title">📄 {t('assetDetail.capsuleAbout')}</h2></div>
          <div style={{ padding: '0 1rem 1rem' }}>
            <p style={{ color: 'var(--color-text-secondary)' }}>
              {t('assetDetail.capsuleDescription', { id: capsuleMatch[1] })}
            </p>
          </div>
        </div>
      );
    }
    return null;
  }

  return (
    <div className="card" style={{ marginBottom: '1.5rem' }}>
      <div className="card-header"><h2 className="card-title">📄 {t('assetDetail.geneAbout')}</h2></div>
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
            <span className="text-muted text-sm">{t('assetDetail.overviewLabel')}</span>
            <p style={{ color: 'var(--color-text-secondary)', lineHeight: 1.6, marginTop: 4 }}>
              {String(task?.description ?? decoded?.resultSummary)}
            </p>
          </div>
        )}

        {/* Result / Deliverables from task */}
        {task?.resultSummary && (
          <div style={{ marginBottom: 12 }}>
            <span className="text-muted text-sm">{t('assetDetail.resultLabel')}</span>
            <p style={{ lineHeight: 1.6, marginTop: 4 }}>{String(task.resultSummary)}</p>
          </div>
        )}

        {task?.deliverables && (
          <div style={{ marginBottom: 12 }}>
            <span className="text-muted text-sm">{t('assetDetail.deliverablesLabel')}</span>
            <p style={{ whiteSpace: 'pre-wrap', marginTop: 4 }}>{String(task.deliverables)}</p>
          </div>
        )}

        {/* Task metadata */}
        {task && (
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 13, color: 'var(--color-text-muted)', marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--color-border)' }}>
            {task.status && <span>{t('assetDetail.statusLabel')} <strong>{String(task.status)}</strong></span>}
            {task.assignedRoleId && <span>{t('assetDetail.assignedLabel')} <strong>{String(task.assignedRoleId)}</strong></span>}
            {task.category && <span>{t('assetDetail.categoryLabel')} <strong>{String(task.category)}</strong></span>}
            {task.priority && <span>{t('assetDetail.priorityLabel')} <strong>{String(task.priority)}</strong></span>}
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
