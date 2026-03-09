import { useParams, useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StatusBadge } from '../../components/StatusBadge';
import { Modal } from '../../components/Modal';
import { ErrorMessage } from '../../components/ErrorMessage';
import {
  useAgentCardDetail,
  useChangeAgentStatus,
  useDeleteAgent,
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

function statusVariant(status: string): 'success' | 'warning' | 'danger' | 'default' {
  switch (status) {
    case 'online':   return 'success';
    case 'busy':     return 'warning';
    case 'offline':  return 'danger';
    default:         return 'default';
  }
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

const STATUS_OPTIONS = ['online', 'offline', 'busy'];

export function AgentDetail() {
  const { t } = useTranslation('agents');
  const { nodeId } = useParams<{ nodeId: string }>();
  const navigate = useNavigate();
  const [deleteOpen, setDeleteOpen] = useState(false);

  const { data, isLoading, error } = useAgentCardDetail(nodeId ?? '');
  const changeStatus = useChangeAgentStatus();
  const deleteAgent = useDeleteAgent();

  const agent = data?.data;

  function handleDelete() {
    if (!nodeId) return;
    deleteAgent.mutate(nodeId, {
      onSuccess: () => navigate('/a2a/agents'),
    });
  }

  if (isLoading) {
    return (
      <div className="page">
        <p className="text-muted">Loading agent card…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="page">
        <ErrorMessage error={error as Error} />
        <button className="btn btn-default" onClick={() => navigate('/a2a/agents')}>
          ← {t('detail.backToAgents')}
        </button>
      </div>
    );
  }

  if (!agent) {
    return (
      <div className="page">
        <p>Agent not found.</p>
        <button className="btn btn-default" onClick={() => navigate('/a2a/agents')}>
          ← {t('detail.backToAgents')}
        </button>
      </div>
    );
  }

  const card = agent.agentCard ?? {};
  const skills = (agent.skills ?? []) as Record<string, unknown>[];
  const capabilities = agent.capabilities ?? {};

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">
            Agent: {(card.name as string) ?? agent.nodeId}
          </h1>
          <p className="page-subtitle mono">{agent.nodeId}</p>
        </div>
        <div className="action-group">
          <button className="btn btn-default btn-sm" onClick={() => navigate('/a2a/agents')}>
            ← {t('detail.backToAgents')}
          </button>
          <select
            className="select"
            value={agent.status}
            onChange={(e) => {
              if (nodeId) changeStatus.mutate({ nodeId, status: e.target.value });
            }}
          >
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <button className="btn btn-danger btn-sm" onClick={() => setDeleteOpen(true)}>
            Delete
          </button>
        </div>
      </div>

      {/* Status & Timestamps */}
      <div className="stat-grid" style={{ marginBottom: '1.5rem' }}>
        <div className="stat-card">
          <div className="stat-value">
            <StatusBadge status={agent.status} variant={statusVariant(agent.status)} />
          </div>
          <div className="stat-label">Status</div>
        </div>
        <div className="stat-card">
          <div className="stat-value" style={{ fontSize: '0.9rem' }}>{formatDate(agent.lastSeenAt)}</div>
          <div className="stat-label">Last Seen</div>
        </div>
        <div className="stat-card">
          <div className="stat-value" style={{ fontSize: '0.9rem' }}>{formatDate(agent.createdAt)}</div>
          <div className="stat-label">Registered</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{skills.length}</div>
          <div className="stat-label">Skills</div>
        </div>
      </div>

      {/* Agent Card Details */}
      <div className="card" style={{ padding: '1.5rem', marginBottom: '1.5rem' }}>
        <h3 style={{ marginBottom: '1rem' }}>Agent Card</h3>
        <dl style={{ display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: '0.4rem 1rem' }}>
          {!!card.name && (
            <>
              <dt className="form-label">Name</dt>
              <dd>{String(card.name)}</dd>
            </>
          )}
          {!!card.description && (
            <>
              <dt className="form-label">Description</dt>
              <dd>{String(card.description)}</dd>
            </>
          )}
          {!!card.url && (
            <>
              <dt className="form-label">URL</dt>
              <dd className="mono">{String(card.url)}</dd>
            </>
          )}
          {!!card.version && (
            <>
              <dt className="form-label">Version</dt>
              <dd>{String(card.version)}</dd>
            </>
          )}
          {!!card.provider && (
            <>
              <dt className="form-label">Provider</dt>
              <dd>{JSON.stringify(card.provider)}</dd>
            </>
          )}
        </dl>
      </div>

      {/* Skills */}
      {skills.length > 0 && (
        <div className="card" style={{ padding: '1.5rem', marginBottom: '1.5rem' }}>
          <h3 style={{ marginBottom: '1rem' }}>Skills ({skills.length})</h3>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
            {skills.map((skill, idx) => (
              <span key={idx} className="tag">
                {(skill.id as string) ?? (skill.name as string) ?? `skill-${idx}`}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Capabilities */}
      {Object.keys(capabilities).length > 0 && (
        <div className="card" style={{ padding: '1.5rem', marginBottom: '1.5rem' }}>
          <h3 style={{ marginBottom: '1rem' }}>{t('detail.capabilities')}</h3>
          <textarea
            className="textarea mono"
            readOnly
            rows={10}
            style={{ width: '100%', resize: 'vertical', fontSize: '0.8rem' }}
            value={JSON.stringify(capabilities, null, 2)}
          />
        </div>
      )}

      {/* Raw Agent Card JSON */}
      <div className="card" style={{ padding: '1.5rem' }}>
        <h3 style={{ marginBottom: '1rem' }}>Raw Agent Card JSON</h3>
        <textarea
          className="textarea mono"
          readOnly
          rows={14}
          style={{ width: '100%', resize: 'vertical', fontSize: '0.8rem' }}
          value={JSON.stringify(card, null, 2)}
        />
      </div>

      {/* Delete Modal */}
      <Modal
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title="Delete Agent Card"
        footer={
          <div className="modal-footer-actions">
            <button className="btn btn-default" onClick={() => setDeleteOpen(false)} disabled={deleteAgent.isPending}>
              Cancel
            </button>
            <button className="btn btn-danger" onClick={handleDelete} disabled={deleteAgent.isPending}>
              {deleteAgent.isPending ? 'Deleting…' : 'Delete'}
            </button>
          </div>
        }
      >
        <p>
          Remove agent card <span className="mono">{agent.nodeId}</span>?
          This action cannot be undone.
        </p>
        {deleteAgent.error && <ErrorMessage error={deleteAgent.error as Error} />}
      </Modal>
    </div>
  );
}
