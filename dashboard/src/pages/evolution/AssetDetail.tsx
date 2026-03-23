import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useMutation } from '@tanstack/react-query';
import { DataTable, Column } from '../../components/DataTable';
import { StatusBadge } from '../../components/StatusBadge';
import { Modal } from '../../components/Modal';
import { ErrorMessage } from '../../components/ErrorMessage';
import { useAdminAssetDetail, useChangeAssetStatus, useAssetUsage } from '../../api/hooks';
import { apiClient } from '../../api/client';
import { useUser } from '../../context/UserContext';
import { useState } from 'react';

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

  const raw = data?.data;
  // SQLite returns JSON columns as strings — parse them safely
  const parseJson = (v: unknown): unknown[] => {
    if (Array.isArray(v)) return v;
    if (typeof v === 'string') try { const p = JSON.parse(v); if (Array.isArray(p)) return p; } catch { /* ignore */ }
    return [];
  };
  const asset = raw ? {
    ...raw,
    signalsMatch: parseJson(raw.signalsMatch),
    capabilities: parseJson((raw as Record<string, unknown>).capabilities),
    strategy: typeof (raw as Record<string, unknown>).strategy === 'string'
      ? (() => { try { return JSON.parse((raw as Record<string, unknown>).strategy as string); } catch { return (raw as Record<string, unknown>).strategy; } })()
      : (raw as Record<string, unknown>).strategy,
  } : null;
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
  const confidencePct = asset.confidence !== null ? (asset.confidence! * 100).toFixed(1) : null;

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

  // Gene: Promote/Approve/Quarantine. Capsule: only Approve/Quarantine (no Promote)
  const statusActions = isGene
    ? [
        { label: t('assetDetail.promote'), newStatus: 'promoted' },
        { label: t('assetDetail.approve'), newStatus: 'approved' },
        { label: t('assetDetail.quarantine'), newStatus: 'quarantined' },
      ]
    : [
        { label: t('assetDetail.approve'), newStatus: 'approved' },
        { label: t('assetDetail.quarantine'), newStatus: 'quarantined' },
      ];

  async function handleAction() {
    if (!actionModal || !id) return;
    await changeStatus.mutateAsync({ assetId: id, status: actionModal.newStatus });
    setActionModal(null);
  }

  // ── Voting Section ──────────────────────────────────────────────────────
  const VotingSection = (
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
  );

  // ── Moderation Section (admin only) ─────────────────────────────────────
  const ModerationSection = isAdmin ? (
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
  ) : null;

  // ── Usage Reports Table ──────────────────────────────────────────────────
  const UsageReportsSection = (
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
  );

  // ══════════════════════════════════════════════════════════════════════════
  // GENE LAYOUT
  // ══════════════════════════════════════════════════════════════════════════
  if (isGene) {
    return (
      <div className="page">
        <div className="page-header">
          <h1 className="page-title">🧬 {t('assetDetail.geneDetailTitle')}</h1>
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

        {/* Header Card */}
        <div className="card" style={{ marginBottom: '1.5rem' }}>
          <div className="card-header">
            <h2 className="card-title" style={{ fontSize: '1.1rem', fontFamily: 'monospace' }}>
              {asset.assetId}
            </h2>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', padding: '1rem' }}>
            <div>
              <span className="text-muted text-sm">{t('assetDetail.status')}</span>
              <div style={{ marginTop: 4 }}><StatusBadge status={asset.status} /></div>
            </div>
            <div>
              <span className="text-muted text-sm">{t('assetDetail.category')}</span>
              <div style={{ marginTop: 4 }}>
                {asset.category
                  ? <span className="badge badge-outline">{asset.category}</span>
                  : <span className="text-muted">-</span>}
              </div>
            </div>
            <div>
              <span className="text-muted text-sm">{t('assetDetail.creator')}</span>
              <div className="mono text-sm" style={{ marginTop: 4 }}>{asset.nodeId}</div>
            </div>
            <div>
              <span className="text-muted text-sm">{t('assetDetail.createdAt')}</span>
              <div style={{ marginTop: 4, fontSize: 13 }}>{new Date(asset.createdAt).toLocaleString()}</div>
            </div>
          </div>
        </div>

        {/* Signal Match Card - PROMINENT */}
        <div className="card" style={{ marginBottom: '1.5rem', borderLeft: '3px solid var(--color-primary, #4f46e5)' }}>
          <div className="card-header">
            <h2 className="card-title">🎯 {t('assetDetail.signalMatchTitle')}</h2>
            <p className="card-subtitle" style={{ margin: 0, fontSize: 12, color: 'var(--color-text-muted)' }}>
              {t('assetDetail.signalMatchSubtitle')}
            </p>
          </div>
          <div style={{ padding: '0.75rem 1rem 1rem' }}>
            {Array.isArray(asset.signalsMatch) && asset.signalsMatch.length > 0 ? (
              <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                {asset.signalsMatch.map((s) => (
                  <span key={s} className="badge badge-info" style={{ fontSize: 13, padding: '4px 10px' }}>{s}</span>
                ))}
              </div>
            ) : (
              <span className="text-muted">{t('assetDetail.noSignals')}</span>
            )}
          </div>
        </div>

        {/* Strategy Card - PROMINENT */}
        <div className="card" style={{ marginBottom: '1.5rem', borderLeft: '3px solid var(--color-primary, #4f46e5)' }}>
          <div className="card-header">
            <h2 className="card-title">📋 {t('assetDetail.strategy')}</h2>
            <p className="card-subtitle" style={{ margin: 0, fontSize: 12, color: 'var(--color-text-muted)' }}>
              {t('assetDetail.strategySubtitle')}
            </p>
          </div>
          <div style={{ padding: '0 1rem 1rem' }}>
            {asset.strategy && Array.isArray(asset.strategy) && asset.strategy.length > 0 ? (
              <ol style={{ margin: 0, paddingLeft: '1.5rem', lineHeight: 1.9 }}>
                {(asset.strategy as string[]).map((step: string, i: number) => (
                  <li key={i} style={{ marginBottom: 6, fontSize: 14 }}>{step}</li>
                ))}
              </ol>
            ) : asset.strategy && !Array.isArray(asset.strategy) ? (
              <pre style={{ padding: 12, fontSize: 12, overflow: 'auto', maxHeight: 300, background: 'var(--bg-secondary)', borderRadius: 4, margin: 0 }}>
                {JSON.stringify(asset.strategy, null, 2)}
              </pre>
            ) : (
              <span className="text-muted">{t('assetDetail.noStrategy')}</span>
            )}
          </div>
        </div>

        {/* Preconditions / Constraints Card */}
        {asset.constraintsData && (
          <div className="card" style={{ marginBottom: '1.5rem' }}>
            <div className="card-header"><h2 className="card-title">⚙️ {t('assetDetail.preconditions')}</h2></div>
            <div style={{ padding: '0 1rem 1rem' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <tbody>
                  {Object.entries(asset.constraintsData).map(([key, value]) => (
                    <tr key={key} style={{ borderBottom: '1px solid var(--color-border)' }}>
                      <td style={{ padding: '0.4rem 0.5rem', color: 'var(--color-text-muted)', width: '35%', fontWeight: 500 }}>{key}</td>
                      <td style={{ padding: '0.4rem 0.5rem' }}>
                        {typeof value === 'object'
                          ? <code style={{ fontSize: 12 }}>{JSON.stringify(value)}</code>
                          : String(value)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Validation Card */}
        {Array.isArray(asset.validation) && asset.validation.length > 0 && (
          <div className="card" style={{ marginBottom: '1.5rem' }}>
            <div className="card-header"><h2 className="card-title">✅ {t('assetDetail.validationCommands')}</h2></div>
            <div style={{ padding: '0 1rem 1rem' }}>
              {asset.validation.map((v, i) => (
                <code key={i} className="mono" style={{ display: 'block', padding: '0.3rem 0.6rem', background: 'var(--bg-secondary)', borderRadius: '0.25rem', marginBottom: '0.35rem', fontSize: '0.8rem' }}>
                  $ {v}
                </code>
              ))}
            </div>
          </div>
        )}

        {/* Capsules for this Gene */}
        <GeneCapsulesList loading={usageLoading} data={usageData} />

        {/* Usage Statistics Card */}
        <div className="card" style={{ marginBottom: '1.5rem' }}>
          <div className="card-header"><h2 className="card-title">📊 {t('assetDetail.usageStats')}</h2></div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem', padding: '1rem' }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 28, fontWeight: 700 }}>{asset.useCount.toLocaleString()}</div>
              <div className="text-muted text-sm">{t('assetDetail.useCount')}</div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 28, fontWeight: 700 }} className={Number(successPct) >= 80 ? 'text-success' : Number(successPct) >= 50 ? 'text-warning' : 'text-danger'}>
                {successPct}%
              </div>
              <div className="text-muted text-sm">{t('assetDetail.successRate')}</div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 28, fontWeight: 700 }}>{asset.failCount}</div>
              <div className="text-muted text-sm">{t('assetDetail.failCount')}</div>
            </div>
          </div>
        </div>

        {/* Usage Reports Table */}
        {UsageReportsSection}

        {/* Moderation */}
        {ModerationSection}

        {/* Vote */}
        {VotingSection}

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

  // ══════════════════════════════════════════════════════════════════════════
  // CAPSULE LAYOUT
  // ══════════════════════════════════════════════════════════════════════════
  const triggerData = asset.triggerData as Record<string, unknown> | null;
  const triggerSignals = triggerData?.trigger as string[] | undefined;
  const solutionDetail = triggerData?.solution_detail as string | undefined;
  const blastRadius = triggerData?.blast_radius as Record<string, unknown> | undefined;
  const outcome = triggerData?.outcome as string | undefined;

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">💊 {t('assetDetail.capsuleDetailTitle')}</h1>
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

      {/* Header Card */}
      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <div className="card-header">
          <h2 className="card-title" style={{ fontSize: '1.1rem', fontFamily: 'monospace' }}>
            {asset.assetId}
          </h2>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', padding: '1rem' }}>
          <div>
            <span className="text-muted text-sm">{t('assetDetail.status')}</span>
            <div style={{ marginTop: 4 }}><StatusBadge status={asset.status} /></div>
          </div>
          <div>
            <span className="text-muted text-sm">{t('assetDetail.creator')}</span>
            <div className="mono text-sm" style={{ marginTop: 4 }}>{asset.nodeId}</div>
          </div>
          <div>
            <span className="text-muted text-sm">{t('assetDetail.createdAt')}</span>
            <div style={{ marginTop: 4, fontSize: 13 }}>{new Date(asset.createdAt).toLocaleString()}</div>
          </div>
          {asset.promotedAt && (
            <div>
              <span className="text-muted text-sm">{t('assetDetail.promotedAt')}</span>
              <div style={{ marginTop: 4, fontSize: 13 }}>{new Date(asset.promotedAt).toLocaleString()}</div>
            </div>
          )}
        </div>
      </div>

      {/* Parent Gene Card - PROMINENT */}
      <div className="card" style={{ marginBottom: '1.5rem', borderLeft: '3px solid #16a34a' }}>
        <div className="card-header">
          <h2 className="card-title">🧬 {t('assetDetail.parentGene')}</h2>
          <p className="card-subtitle" style={{ margin: 0, fontSize: 12, color: 'var(--color-text-muted)' }}>
            {t('assetDetail.parentGeneSubtitle')}
          </p>
        </div>
        <div style={{ padding: '0.75rem 1rem 1rem' }}>
          {asset.geneAssetId ? (
            <a
              href={`/evolution/assets`}
              onClick={(e) => {
                e.preventDefault();
                navigate(`/evolution/assets`);
              }}
              className="link"
              style={{ fontFamily: 'monospace', fontSize: 15, display: 'inline-flex', alignItems: 'center', gap: 6 }}
            >
              🧬 {asset.geneAssetId}
            </a>
          ) : (
            <span className="text-muted">{t('assetDetail.noParentGene')}</span>
          )}
        </div>
      </div>

      {/* Trigger Signals Card */}
      {triggerSignals && triggerSignals.length > 0 && (
        <div className="card" style={{ marginBottom: '1.5rem' }}>
          <div className="card-header">
            <h2 className="card-title">🎯 {t('assetDetail.triggerSignals')}</h2>
          </div>
          <div style={{ padding: '0.75rem 1rem 1rem', display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
            {triggerSignals.map((s) => (
              <span key={s} className="badge badge-info" style={{ fontSize: 13, padding: '4px 10px' }}>{s}</span>
            ))}
          </div>
        </div>
      )}

      {/* Solution Detail Card */}
      {(asset.summary || solutionDetail) && (
        <div className="card" style={{ marginBottom: '1.5rem' }}>
          <div className="card-header">
            <h2 className="card-title">📋 {t('assetDetail.solutionDetail')}</h2>
          </div>
          <div style={{ padding: '0 1rem 1rem' }}>
            {asset.summary && (
              <p style={{ whiteSpace: 'pre-wrap', lineHeight: 1.7, fontSize: 14, marginBottom: solutionDetail ? 12 : 0 }}>
                {asset.summary}
              </p>
            )}
            {solutionDetail && (
              <>
                {asset.summary && <hr style={{ border: 'none', borderTop: '1px solid var(--color-border)', margin: '0.75rem 0' }} />}
                <pre style={{ padding: 12, fontSize: 12, overflow: 'auto', maxHeight: 300, background: 'var(--bg-secondary)', borderRadius: 4, margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                  {solutionDetail}
                </pre>
              </>
            )}
          </div>
        </div>
      )}

      {/* Effectiveness Card */}
      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <div className="card-header">
          <h2 className="card-title">📊 {t('assetDetail.effectiveness')}</h2>
        </div>
        <div style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {/* Confidence bar */}
          {confidencePct !== null && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, fontSize: 13 }}>
                <span className="text-muted">{t('assetDetail.confidence')}</span>
                <strong>{confidencePct}%</strong>
              </div>
              <div style={{ height: 8, borderRadius: 4, background: 'var(--color-border)', overflow: 'hidden' }}>
                <div style={{
                  height: '100%',
                  width: `${confidencePct}%`,
                  borderRadius: 4,
                  background: Number(confidencePct) >= 80 ? '#16a34a' : Number(confidencePct) >= 50 ? '#ca8a04' : '#dc2626',
                  transition: 'width 0.4s ease',
                }} />
              </div>
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '0.75rem' }}>
            {asset.successStreak !== null && (
              <div style={{ textAlign: 'center', padding: '0.5rem', background: 'var(--bg-secondary)', borderRadius: 6 }}>
                <div style={{ fontSize: 24, fontWeight: 700 }}>{asset.successStreak}</div>
                <div className="text-muted text-sm">{t('assetDetail.successStreak')}</div>
              </div>
            )}
            {blastRadius && (
              <>
                {blastRadius.files !== undefined && (
                  <div style={{ textAlign: 'center', padding: '0.5rem', background: 'var(--bg-secondary)', borderRadius: 6 }}>
                    <div style={{ fontSize: 24, fontWeight: 700 }}>{String(blastRadius.files)}</div>
                    <div className="text-muted text-sm">{t('assetDetail.blastFiles')}</div>
                  </div>
                )}
                {blastRadius.lines !== undefined && (
                  <div style={{ textAlign: 'center', padding: '0.5rem', background: 'var(--bg-secondary)', borderRadius: 6 }}>
                    <div style={{ fontSize: 24, fontWeight: 700 }}>{String(blastRadius.lines)}</div>
                    <div className="text-muted text-sm">{t('assetDetail.blastLines')}</div>
                  </div>
                )}
              </>
            )}
          </div>

          {outcome && (
            <div>
              <span className="text-muted text-sm">{t('assetDetail.outcome')}</span>
              <div style={{ marginTop: 4 }}>
                <StatusBadge
                  status={outcome}
                  variant={outcome === 'success' ? 'success' : outcome === 'failure' ? 'danger' : 'default'}
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Usage Reports Table */}
      {UsageReportsSection}

      {/* Moderation */}
      {ModerationSection}

      {/* Vote */}
      {VotingSection}

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

// ── Gene: Capsules List ───────────────────────────────────────────────────

function GeneCapsulesList({
  loading,
  data,
}: {
  loading: boolean;
  data: import('../../api/hooks').AssetUsageResponse | undefined;
}) {
  const { t } = useTranslation('evolution');
  const navigate = useNavigate();

  return (
    <div className="card" style={{ marginBottom: '1.5rem' }}>
      <div className="card-header">
        <h2 className="card-title">💊 {t('assetDetail.capsulesForGene', { count: data?.capsules?.length ?? 0 })}</h2>
      </div>
      {loading ? (
        <div style={{ padding: '1rem' }}><p className="text-muted">{t('assetDetail.usage.loading')}</p></div>
      ) : !data || data.capsules.length === 0 ? (
        <div style={{ padding: '1rem' }}>
          <p className="text-muted">{t('assetDetail.noCapsulesForGene')}</p>
        </div>
      ) : (
        <div style={{ padding: '0 1rem 1rem' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                <th style={{ textAlign: 'left', padding: '0.5rem', color: 'var(--color-text-muted)' }}>{t('assetDetail.usage.colAssetId')}</th>
                <th style={{ textAlign: 'left', padding: '0.5rem', color: 'var(--color-text-muted)' }}>{t('assetDetail.usage.colNode')}</th>
                <th style={{ textAlign: 'left', padding: '0.5rem', color: 'var(--color-text-muted)' }}>{t('assetDetail.usage.colStatus')}</th>
              </tr>
            </thead>
            <tbody>
              {data.capsules.map((c) => (
                <tr key={c.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                  <td style={{ padding: '0.5rem' }}>
                    <a
                      href={`/evolution/assets/${c.id}`}
                      onClick={(e) => { e.preventDefault(); navigate(`/evolution/assets/${c.id}`); }}
                      className="mono text-sm link"
                    >
                      💊 {c.assetId}
                    </a>
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
      )}
    </div>
  );
}
