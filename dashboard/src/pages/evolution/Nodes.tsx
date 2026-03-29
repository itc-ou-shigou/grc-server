import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { DataTable, Column } from '../../components/DataTable';
import { StatusBadge } from '../../components/StatusBadge';
import { ErrorMessage } from '../../components/ErrorMessage';
import { Modal } from '../../components/Modal';
import {
  useAdminNodes,
  useDeleteNode,
  useProvisionNode,
  useRestartNode,
  useAuthorizeNode,
  useRevokeNode,
  Node,
  ProvisionNodeInput,
} from '../../api/hooks';
import { get } from '../../api/client';

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

function isLocalhost(): boolean {
  const h = window.location.hostname;
  return h === 'localhost' || h === '127.0.0.1' || h === 'host.docker.internal';
}

interface DeleteTarget {
  nodeId: string;
  displayName?: string;
  employeeName?: string;
  roleId?: string;
  platform?: string;
  provisioningMode?: 'local_docker' | 'daytona_sandbox' | null;
}

interface RestartTarget {
  nodeId: string;
  displayName?: string;
  provisioningMode: 'local_docker' | 'daytona_sandbox';
}

interface AuthorizeTarget {
  nodeId: string;
  displayName?: string;
  action: 'authorize' | 'revoke';
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 12px',
  border: '1px solid var(--color-border)',
  borderRadius: '6px',
  fontSize: '14px',
  background: 'rgba(12, 19, 36, 0.60)',
  color: 'var(--color-text)',
  boxSizing: 'border-box',
};

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: '13px',
  fontWeight: 600,
  marginBottom: '4px',
  color: 'var(--color-text, #111827)',
};

const fieldStyle: React.CSSProperties = {
  marginBottom: '14px',
};

const errorTextStyle: React.CSSProperties = {
  fontSize: '12px',
  color: 'var(--color-danger, #dc2626)',
  marginTop: '4px',
};

export function Nodes() {
  const { t } = useTranslation('evolution');
  const [page, setPage] = useState(1);

  // ── modal state ──
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [restartTarget, setRestartTarget] = useState<RestartTarget | null>(null);
  const [authorizeTarget, setAuthorizeTarget] = useState<AuthorizeTarget | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  // ── create form state ──
  const isLocal = isLocalhost();
  const [gatewayPort, setGatewayPort] = useState('');
  const [workspacePath, setWorkspacePath] = useState('');
  const [employeeName, setEmployeeName] = useState('');
  const [employeeCode, setEmployeeCode] = useState('');
  const [employeeEmail, setEmployeeEmail] = useState('');
  const [createFormErrors, setCreateFormErrors] = useState<Record<string, string>>({});
  const [createSuccess, setCreateSuccess] = useState<string | null>(null);
  const [workspacesBase, setWorkspacesBase] = useState('');

  // Fetch workspace base path when create modal opens
  useEffect(() => {
    if (createOpen && isLocal && !workspacesBase) {
      get<{ workspacesBasePath: string; platform: string }>('/api/v1/admin/evolution/nodes/provision-defaults')
        .then(data => {
          if (data?.workspacesBasePath) {
            setWorkspacesBase(data.workspacesBasePath);
          }
        })
        .catch(() => { /* ignore */ });
    }
  }, [createOpen, isLocal, workspacesBase]);

  // ── hooks ──
  const { data, isLoading, error } = useAdminNodes({ page, page_size: 20 });
  const deleteNode = useDeleteNode();
  const provisionNode = useProvisionNode();
  const restartNode = useRestartNode();
  const authorizeNode = useAuthorizeNode();
  const revokeNode = useRevokeNode();

  // ── delete handlers ──
  const openDeleteModal = (row: Record<string, unknown>) => {
    setDeleteTarget({
      nodeId: row.nodeId as string,
      displayName: row.displayName as string | undefined,
      employeeName: row.employeeName as string | undefined,
      roleId: row.roleId as string | undefined,
      platform: row.platform as string | undefined,
      provisioningMode: row.provisioningMode as 'local_docker' | 'daytona_sandbox' | null | undefined,
    });
  };

  const confirmDelete = () => {
    if (!deleteTarget) return;
    deleteNode.mutate(deleteTarget.nodeId, {
      onSuccess: () => setDeleteTarget(null),
    });
  };

  // ── restart handlers ──
  const openRestartModal = (row: Record<string, unknown>) => {
    setRestartTarget({
      nodeId: row.nodeId as string,
      displayName: row.displayName as string | undefined,
      provisioningMode: row.provisioningMode as 'local_docker' | 'daytona_sandbox',
    });
  };

  const confirmRestart = () => {
    if (!restartTarget) return;
    restartNode.mutate(restartTarget.nodeId, {
      onSuccess: () => setRestartTarget(null),
    });
  };

  // ── authorize/revoke handlers ──
  const openAuthorizeModal = (row: Record<string, unknown>) => {
    const apiKeyAuthorized = row.apiKeyAuthorized as boolean;
    setAuthorizeTarget({
      nodeId: row.nodeId as string,
      displayName: row.displayName as string | undefined,
      action: apiKeyAuthorized ? 'revoke' : 'authorize',
    });
  };

  const confirmAuthorize = () => {
    if (!authorizeTarget) return;
    if (authorizeTarget.action === 'authorize') {
      authorizeNode.mutate(authorizeTarget.nodeId, {
        onSuccess: () => setAuthorizeTarget(null),
      });
    } else {
      revokeNode.mutate(authorizeTarget.nodeId, {
        onSuccess: () => setAuthorizeTarget(null),
      });
    }
  };

  // ── create handlers ──
  const resetCreateForm = () => {
    setGatewayPort('');
    setWorkspacePath('');
    setEmployeeName('');
    setEmployeeCode('');
    setEmployeeEmail('');
    setCreateFormErrors({});
    setCreateSuccess(null);
  };

  const closeCreateModal = () => {
    if (provisionNode.isPending) return;
    resetCreateForm();
    provisionNode.reset();
    setCreateOpen(false);
  };

  const submitCreate = () => {
    const errors: Record<string, string> = {};
    if (isLocal) {
      if (!gatewayPort.trim()) errors.gatewayPort = t('nodes.create.gatewayPortRequired');
      if (!workspacePath.trim()) errors.workspacePath = t('nodes.create.workspacePathRequired');
    }
    setCreateFormErrors(errors);
    if (Object.keys(errors).length > 0) return;

    const input: ProvisionNodeInput = {
      mode: isLocal ? 'local_docker' : 'daytona_sandbox',
      ...(isLocal && { gatewayPort: parseInt(gatewayPort, 10), workspacePath: workspacePath.trim() }),
      ...(employeeName.trim() && { employeeName: employeeName.trim() }),
      ...(employeeCode.trim() && { employeeCode: employeeCode.trim() }),
      ...(employeeEmail.trim() && { employeeEmail: employeeEmail.trim() }),
    };

    provisionNode.mutate(input, {
      onSuccess: () => {
        setCreateSuccess(t('nodes.create.success'));
        setTimeout(() => {
          resetCreateForm();
          provisionNode.reset();
          setCreateOpen(false);
        }, 1500);
      },
    });
  };

  // ── delete warning description by provisioningMode ──
  const deleteWarningDescription = (mode?: 'local_docker' | 'daytona_sandbox' | null) => {
    if (mode === 'local_docker') return t('nodes.delete.warningDescriptionDocker');
    if (mode === 'daytona_sandbox') return t('nodes.delete.warningDescriptionSandbox');
    return t('nodes.delete.warningDescription');
  };

  // ── table columns ──
  const columns: Column<Record<string, unknown>>[] = [
    {
      key: 'nodeId',
      label: t('nodes.table.nodeId'),
      render: (v) => <span className="mono text-sm">{String(v).slice(0, 12)}...</span>,
    },
    { key: 'displayName', label: t('nodes.displayName') },
    {
      key: 'employeeId',
      label: t('nodes.employeeId'),
      render: (v) => v ? <span className="mono text-sm">{String(v)}</span> : <span className="text-muted">-</span>,
    },
    {
      key: 'employeeName',
      label: t('nodes.employee'),
      render: (v) => v ? <span>{String(v)}</span> : <span className="text-muted">-</span>,
    },
    {
      key: 'employeeEmail',
      label: t('nodes.email'),
      render: (v) => v ? <span className="text-sm">{String(v)}</span> : <span className="text-muted">-</span>,
    },
    {
      key: 'platform',
      label: t('nodes.table.platform'),
      render: (v) => {
        if (!v) return <span className="text-muted">-</span>;
        const p = String(v);
        const icon = p.includes('win') ? '\uD83E\uDE9F' : p.includes('mac') ? '\uD83C\uDF4E' : '\uD83D\uDC27';
        return <span>{icon} {p}</span>;
      },
    },
    {
      key: 'workspacePath',
      label: t('nodes.table.workspacePath'),
      render: (v) => {
        const path = v as string | null;
        if (!path) return <span className="text-muted">—</span>;
        const explorerCmd = `explorer ${path}`;
        return (
          <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <span style={{ fontSize: '14px' }}>&#128194;</span>
            <code style={{ fontSize: '11px', background: 'rgba(12, 19, 36, 0.60)', padding: '2px 5px', borderRadius: '4px', maxWidth: '160px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'inline-block', verticalAlign: 'middle' }} title={path}>
              {path}
            </code>
            <button
              title={t('nodes.table.copyWorkspacePath')}
              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px', fontSize: '14px', lineHeight: 1, color: 'var(--color-text-secondary)', flexShrink: 0 }}
              onClick={(e) => {
                e.stopPropagation();
                navigator.clipboard.writeText(explorerCmd).catch(() => { /* ignore */ });
              }}
            >
              &#128203;
            </button>
          </span>
        );
      },
    },
    {
      key: 'winclawVersion',
      label: t('nodes.table.version'),
      render: (v) => v ? <span className="mono">{String(v)}</span> : <span className="text-muted">-</span>,
    },
    {
      key: 'geneCount',
      label: t('nodes.genes'),
      render: (v) => <span className="badge-count">{String(v)}</span>,
    },
    {
      key: 'capsuleCount',
      label: t('nodes.capsules'),
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
      key: 'apiKeyStatus',
      label: t('nodes.apiKey.label'),
      render: (_, row) => {
        const mode = row.provisioningMode as 'local_docker' | 'daytona_sandbox' | null;
        const hasProvisioning = mode !== null && mode !== undefined;
        const apiKeyAuthorized = row.apiKeyAuthorized as boolean;
        if (hasProvisioning) {
          return (
            <span style={{
              display: 'inline-block',
              padding: '2px 8px',
              borderRadius: '12px',
              fontSize: '12px',
              fontWeight: 600,
              background: 'rgba(34, 197, 94, 0.15)',
              color: '#16a34a',
              border: '1px solid rgba(34, 197, 94, 0.30)',
            }}>
              {t('nodes.apiKey.auto')}
            </span>
          );
        }
        if (apiKeyAuthorized) {
          return (
            <span style={{
              display: 'inline-block',
              padding: '2px 8px',
              borderRadius: '12px',
              fontSize: '12px',
              fontWeight: 600,
              background: 'rgba(34, 197, 94, 0.15)',
              color: '#16a34a',
              border: '1px solid rgba(34, 197, 94, 0.30)',
            }}>
              {t('nodes.apiKey.authorized')}
            </span>
          );
        }
        return (
          <span style={{
            display: 'inline-block',
            padding: '2px 8px',
            borderRadius: '12px',
            fontSize: '12px',
            fontWeight: 600,
            background: 'rgba(239, 68, 68, 0.12)',
            color: '#dc2626',
            border: '1px solid rgba(239, 68, 68, 0.25)',
          }}>
            {t('nodes.apiKey.unauthorized')}
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
      label: t('nodes.registered'),
      render: (v) => new Date(String(v)).toLocaleDateString(),
    },
    {
      key: 'actions',
      label: '',
      render: (_, row) => {
        const mode = row.provisioningMode as 'local_docker' | 'daytona_sandbox' | null;
        const hasProvisioning = mode !== null && mode !== undefined;
        const apiKeyAuthorized = row.apiKeyAuthorized as boolean;
        return (
          <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
            {!hasProvisioning && !apiKeyAuthorized && (
              <button
                className="btn btn-sm"
                style={{
                  background: 'linear-gradient(135deg, #16a34a, #7c3aed)',
                  color: '#fff',
                  border: 'none',
                }}
                title={t('nodes.authorize')}
                onClick={(e) => {
                  e.stopPropagation();
                  openAuthorizeModal(row as Record<string, unknown>);
                }}
              >
                {t('nodes.authorize')}
              </button>
            )}
            {!hasProvisioning && apiKeyAuthorized && (
              <button
                className="btn btn-sm btn-danger"
                title={t('nodes.revoke')}
                onClick={(e) => {
                  e.stopPropagation();
                  openAuthorizeModal(row as Record<string, unknown>);
                }}
              >
                {t('nodes.revoke')}
              </button>
            )}
            {hasProvisioning && (
              <button
                className="btn btn-sm btn-primary"
                title={t('nodes.gateway.button')}
                onClick={async (e) => {
                  e.stopPropagation();
                  const storedUrl = row.gatewayUrl as string | null;
                  if (storedUrl?.startsWith('daytona://')) {
                    // Fetch preview URL from backend for Daytona sandbox nodes
                    try {
                      const authToken = localStorage.getItem('grc_admin_token');
                      const resp = await fetch(`/api/v1/admin/evolution/nodes/${row.nodeId}/gateway`, {
                        headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
                      });
                      const data = await resp.json();
                      if (data?.data?.url) {
                        window.open(data.data.url, '_blank');
                      } else {
                        alert(t('nodes.gateway.noUrl') + ' (Sandbox may still be starting)');
                      }
                    } catch {
                      alert(t('nodes.gateway.noUrl'));
                    }
                  } else if (storedUrl) {
                    window.open(storedUrl, '_blank');
                  } else {
                    alert(t('nodes.gateway.noUrl'));
                  }
                }}
              >
                {t('nodes.gateway.button')}
              </button>
            )}
            {hasProvisioning && (
              <button
                className="btn btn-sm btn-warning"
                title={t('nodes.restart.button')}
                onClick={(e) => {
                  e.stopPropagation();
                  openRestartModal(row as Record<string, unknown>);
                }}
              >
                {t('nodes.restart.button')}
              </button>
            )}
            <button
              className="btn btn-sm btn-danger"
              onClick={(e) => { e.stopPropagation(); openDeleteModal(row as Record<string, unknown>); }}
              title={t('nodes.delete.button')}
            >
              {t('nodes.delete.button')}
            </button>
          </div>
        );
      },
    },
  ];

  const activeCount = (data?.data ?? []).filter((n) => {
    const node = n as unknown as Node;
    return isActive(node.lastHeartbeat);
  }).length;

  const createModalTitle = isLocal
    ? t('nodes.create.titleLocal')
    : t('nodes.create.titleRemote');

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">{t('nodes.title')}</h1>
          <p className="page-subtitle">
            {t('nodes.subtitle')}
            {data && (
              <span className="page-subtitle-extra">
                {' \u2014 '}{t('nodes.activeOf', { active: activeCount, total: data.pagination.total })}
              </span>
            )}
          </p>
        </div>
        <button
          className="btn btn-primary"
          onClick={() => { resetCreateForm(); provisionNode.reset(); setCreateOpen(true); }}
        >
          + {t('nodes.create.button')}
        </button>
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
          emptyMessage={t('nodes.noNodes')}
        />
      </div>

      {/* ── Create Node Modal ── */}
      <Modal
        open={createOpen}
        onClose={closeCreateModal}
        title={createModalTitle}
        size="md"
        disableBackdropClose={true}
        footer={
          <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
            <button
              className="btn btn-secondary"
              onClick={closeCreateModal}
              disabled={provisionNode.isPending}
            >
              {t('nodes.delete.cancel')}
            </button>
            <button
              className="btn btn-primary"
              onClick={submitCreate}
              disabled={provisionNode.isPending}
            >
              {provisionNode.isPending ? t('nodes.create.creating') : t('nodes.create.submit')}
            </button>
          </div>
        }
      >
        <div>
          {isLocal && (
            <>
              <div style={fieldStyle}>
                <label style={labelStyle}>{t('nodes.create.gatewayPort')} *</label>
                <input
                  type="number"
                  style={inputStyle}
                  placeholder={t('nodes.create.gatewayPortPlaceholder')}
                  value={gatewayPort}
                  onChange={(e) => setGatewayPort(e.target.value)}
                  disabled={provisionNode.isPending}
                />
                {createFormErrors.gatewayPort && (
                  <p style={errorTextStyle}>{createFormErrors.gatewayPort}</p>
                )}
              </div>
              <div style={fieldStyle}>
                <label style={labelStyle}>{t('nodes.create.workspacePath')} *</label>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <input
                    type="text"
                    style={{ ...inputStyle, flex: 1 }}
                    placeholder={t('nodes.create.workspacePathPlaceholder')}
                    value={workspacePath}
                    onChange={(e) => setWorkspacePath(e.target.value)}
                    disabled={provisionNode.isPending}
                  />
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    style={{ whiteSpace: 'nowrap', padding: '8px 12px' }}
                    disabled={provisionNode.isPending}
                    onClick={async () => {
                      try {
                        // Electron desktop: use IPC to get full path via native dialog
                        const grc = (window as any).grcDesktop;
                        if (grc?.selectDirectory) {
                          const fullPath = await grc.selectDirectory();
                          if (fullPath) setWorkspacePath(fullPath);
                          return;
                        }
                        // Browser fallback: showDirectoryPicker (name only)
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        const dirHandle = await (window as any).showDirectoryPicker({ mode: 'read' });
                        if (dirHandle?.name) {
                          const sep = workspacesBase.includes('/') ? '/' : '\\';
                          const base = workspacesBase || '';
                          if (base) {
                            const cleanBase = base.endsWith(sep) ? base.slice(0, -1) : base;
                            setWorkspacePath(cleanBase + sep + dirHandle.name);
                          } else {
                            setWorkspacePath(dirHandle.name);
                          }
                        }
                      } catch {
                        // User cancelled the picker — do nothing
                      }
                    }}
                  >
                    {t('nodes.create.browse')}
                  </button>
                </div>
                <p style={{ fontSize: '11px', color: 'var(--color-text-secondary, #9ca3af)', marginTop: '4px' }}>
                  {t('nodes.create.workspacePathHint')}
                </p>
                {createFormErrors.workspacePath && (
                  <p style={errorTextStyle}>{createFormErrors.workspacePath}</p>
                )}
              </div>
            </>
          )}

          <div style={fieldStyle}>
            <label style={labelStyle}>{t('nodes.create.employeeName')}</label>
            <input
              type="text"
              style={inputStyle}
              placeholder={t('nodes.create.employeeNamePlaceholder')}
              value={employeeName}
              onChange={(e) => setEmployeeName(e.target.value)}
              disabled={provisionNode.isPending}
            />
          </div>
          <div style={fieldStyle}>
            <label style={labelStyle}>{t('nodes.create.employeeCode')}</label>
            <input
              type="text"
              style={inputStyle}
              placeholder={t('nodes.create.employeeCodePlaceholder')}
              value={employeeCode}
              onChange={(e) => setEmployeeCode(e.target.value)}
              disabled={provisionNode.isPending}
            />
          </div>
          <div style={{ ...fieldStyle, marginBottom: 0 }}>
            <label style={labelStyle}>{t('nodes.create.employeeEmail')}</label>
            <input
              type="email"
              style={inputStyle}
              placeholder={t('nodes.create.employeeEmailPlaceholder')}
              value={employeeEmail}
              onChange={(e) => setEmployeeEmail(e.target.value)}
              disabled={provisionNode.isPending}
            />
          </div>

          {createSuccess && (
            <div style={{
              marginTop: '14px',
              padding: '12px',
              background: 'var(--color-success-bg, #f0fdf4)',
              border: '1px solid var(--color-success-border, #bbf7d0)',
              borderRadius: '6px',
              color: 'var(--color-success, #16a34a)',
              fontSize: '13px',
            }}>
              {createSuccess}
            </div>
          )}

          {provisionNode.isError && (
            <div style={{
              marginTop: '14px',
              padding: '12px',
              background: 'rgba(239, 68, 68, 0.10)',
              border: '1px solid rgba(239, 68, 68, 0.25)',
              borderRadius: '6px',
              color: '#ef4444',
              fontSize: '13px',
            }}>
              {t('nodes.create.failed', { error: (provisionNode.error as Error)?.message ?? 'Unknown error' })}
            </div>
          )}
        </div>
      </Modal>

      {/* ── Restart Confirmation Modal ── */}
      <Modal
        open={!!restartTarget}
        onClose={() => !restartNode.isPending && setRestartTarget(null)}
        title={t('nodes.restart.title')}
        size="sm"
        footer={
          <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
            <button
              className="btn btn-secondary"
              onClick={() => setRestartTarget(null)}
              disabled={restartNode.isPending}
            >
              {t('nodes.delete.cancel')}
            </button>
            <button
              className="btn btn-warning"
              onClick={confirmRestart}
              disabled={restartNode.isPending}
            >
              {restartNode.isPending ? t('nodes.restart.restarting') : t('nodes.restart.submit')}
            </button>
          </div>
        }
      >
        {restartTarget && (
          <div>
            <div style={{
              background: 'var(--color-warning-bg)',
              border: '1px solid rgba(255, 190, 11, 0.30)',
              borderRadius: '8px',
              padding: '16px',
              marginBottom: '16px',
              display: 'flex',
              alignItems: 'flex-start',
              gap: '12px',
            }}>
              <span style={{ fontSize: '24px', lineHeight: 1 }}>&#9888;</span>
              <div>
                <strong style={{ color: 'var(--color-warning-text, #92400e)' }}>
                  {t('nodes.restart.confirm')}
                </strong>
                <p style={{ margin: '4px 0 0', fontSize: '14px', color: 'var(--color-text-secondary)' }}>
                  {restartTarget.provisioningMode === 'local_docker'
                    ? t('nodes.restart.warningLocal')
                    : t('nodes.restart.warningRemote')}
                </p>
              </div>
            </div>

            {restartTarget.displayName && (
              <table style={{ width: '100%', fontSize: '14px', borderCollapse: 'collapse' }}>
                <tbody>
                  <tr>
                    <td style={{ padding: '6px 12px 6px 0', color: 'var(--color-text-secondary)', whiteSpace: 'nowrap' }}>{t('nodes.delete.displayName')}</td>
                    <td style={{ padding: '6px 0' }}>{restartTarget.displayName}</td>
                  </tr>
                </tbody>
              </table>
            )}

            {restartNode.isError && (
              <div style={{
                marginTop: '12px',
                padding: '12px',
                background: 'rgba(239, 68, 68, 0.10)',
                border: '1px solid rgba(239, 68, 68, 0.25)',
                borderRadius: '6px',
                color: '#ef4444',
                fontSize: '13px',
              }}>
                {t('nodes.restart.failed', { error: (restartNode.error as Error)?.message ?? 'Unknown error' })}
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* ── Authorize / Revoke Confirmation Modal ── */}
      <Modal
        open={!!authorizeTarget}
        onClose={() => {
          const isPending = authorizeNode.isPending || revokeNode.isPending;
          if (!isPending) setAuthorizeTarget(null);
        }}
        title={authorizeTarget?.action === 'revoke' ? t('nodes.revoke') : t('nodes.authorize')}
        size="sm"
        footer={
          <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
            <button
              className="btn btn-secondary"
              onClick={() => setAuthorizeTarget(null)}
              disabled={authorizeNode.isPending || revokeNode.isPending}
            >
              {t('nodes.delete.cancel')}
            </button>
            <button
              className={authorizeTarget?.action === 'revoke' ? 'btn btn-danger' : 'btn btn-primary'}
              style={authorizeTarget?.action === 'authorize' ? {
                background: 'linear-gradient(135deg, #16a34a, #7c3aed)',
                border: 'none',
              } : undefined}
              onClick={confirmAuthorize}
              disabled={authorizeNode.isPending || revokeNode.isPending}
            >
              {(authorizeNode.isPending || revokeNode.isPending)
                ? '...'
                : authorizeTarget?.action === 'revoke'
                  ? t('nodes.revoke')
                  : t('nodes.authorize')}
            </button>
          </div>
        }
      >
        {authorizeTarget && (
          <div>
            <p style={{ fontSize: '14px', marginBottom: '12px', color: 'var(--color-text)' }}>
              {authorizeTarget.action === 'revoke'
                ? t('nodes.revokeConfirm')
                : t('nodes.authorizeConfirm')}
            </p>
            {authorizeTarget.displayName && (
              <table style={{ width: '100%', fontSize: '14px', borderCollapse: 'collapse' }}>
                <tbody>
                  <tr>
                    <td style={{ padding: '6px 12px 6px 0', color: 'var(--color-text-secondary)', whiteSpace: 'nowrap' }}>{t('nodes.delete.displayName')}</td>
                    <td style={{ padding: '6px 0' }}>{authorizeTarget.displayName}</td>
                  </tr>
                </tbody>
              </table>
            )}
            {(authorizeNode.isError || revokeNode.isError) && (
              <div style={{
                marginTop: '12px',
                padding: '12px',
                background: 'rgba(239, 68, 68, 0.10)',
                border: '1px solid rgba(239, 68, 68, 0.25)',
                borderRadius: '6px',
                color: '#ef4444',
                fontSize: '13px',
              }}>
                {((authorizeNode.error ?? revokeNode.error) as Error)?.message ?? 'Unknown error'}
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* ── Delete Confirmation Modal ── */}
      <Modal
        open={!!deleteTarget}
        onClose={() => !deleteNode.isPending && setDeleteTarget(null)}
        title={t('nodes.delete.title')}
        size="sm"
        footer={
          <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
            <button
              className="btn btn-secondary"
              onClick={() => setDeleteTarget(null)}
              disabled={deleteNode.isPending}
            >
              {t('nodes.delete.cancel')}
            </button>
            <button
              className="btn btn-danger"
              onClick={confirmDelete}
              disabled={deleteNode.isPending}
            >
              {deleteNode.isPending ? t('nodes.delete.buttonDeleting') : t('nodes.delete.button')}
            </button>
          </div>
        }
      >
        {deleteTarget && (
          <div>
            <div style={{
              background: 'var(--color-danger-bg, #fef2f2)',
              border: '1px solid var(--color-danger-border, #fecaca)',
              borderRadius: '8px',
              padding: '16px',
              marginBottom: '16px',
              display: 'flex',
              alignItems: 'flex-start',
              gap: '12px',
            }}>
              <span style={{ fontSize: '24px', lineHeight: 1 }}>&#9888;</span>
              <div>
                <strong style={{ color: 'var(--color-danger, #dc2626)' }}>
                  {t('nodes.delete.warningTitle')}
                </strong>
                <p style={{ margin: '4px 0 0', fontSize: '14px', color: 'var(--color-text-secondary)' }}>
                  {deleteWarningDescription(deleteTarget.provisioningMode)}
                </p>
              </div>
            </div>

            <table style={{ width: '100%', fontSize: '14px', borderCollapse: 'collapse' }}>
              <tbody>
                <tr>
                  <td style={{ padding: '6px 12px 6px 0', color: 'var(--color-text-secondary)', whiteSpace: 'nowrap' }}>{t('nodes.delete.nodeId')}</td>
                  <td style={{ padding: '6px 0' }}>
                    <code style={{ fontSize: '12px', background: 'rgba(12, 19, 36, 0.60)', padding: '2px 6px', borderRadius: '4px' }}>
                      {deleteTarget.nodeId}
                    </code>
                  </td>
                </tr>
                {deleteTarget.displayName && (
                  <tr>
                    <td style={{ padding: '6px 12px 6px 0', color: 'var(--color-text-secondary)' }}>{t('nodes.delete.displayName')}</td>
                    <td style={{ padding: '6px 0' }}>{deleteTarget.displayName}</td>
                  </tr>
                )}
                {deleteTarget.employeeName && (
                  <tr>
                    <td style={{ padding: '6px 12px 6px 0', color: 'var(--color-text-secondary)' }}>{t('nodes.delete.employee')}</td>
                    <td style={{ padding: '6px 0' }}>{deleteTarget.employeeName}</td>
                  </tr>
                )}
                {deleteTarget.roleId && (
                  <tr>
                    <td style={{ padding: '6px 12px 6px 0', color: 'var(--color-text-secondary)' }}>{t('nodes.delete.role')}</td>
                    <td style={{ padding: '6px 0' }}>
                      <StatusBadge status={deleteTarget.roleId} />
                    </td>
                  </tr>
                )}
                {deleteTarget.platform && (
                  <tr>
                    <td style={{ padding: '6px 12px 6px 0', color: 'var(--color-text-secondary)' }}>{t('nodes.delete.platform')}</td>
                    <td style={{ padding: '6px 0' }}>{deleteTarget.platform}</td>
                  </tr>
                )}
              </tbody>
            </table>

            {deleteNode.isError && (
              <div style={{
                marginTop: '12px',
                padding: '12px',
                background: 'rgba(239, 68, 68, 0.10)',
                border: '1px solid rgba(239, 68, 68, 0.25)',
                borderRadius: '6px',
                color: '#ef4444',
                fontSize: '13px',
              }}>
                {t('nodes.delete.failedToDelete', { error: (deleteNode.error as Error)?.message ?? 'Unknown error' })}
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
