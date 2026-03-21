import { useParams, useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StatusBadge } from '../../components/StatusBadge';
import { Modal } from '../../components/Modal';
import { ErrorMessage } from '../../components/ErrorMessage';
import {
  useMeetingDetail,
  useChangeMeetingStatus,
  useSendMeetingMessage,
  useDeleteMeeting,
  MeetingParticipant,
  MeetingTranscriptEntry,
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

function statusVariant(status: string): 'success' | 'info' | 'warning' | 'danger' | 'default' {
  switch (status) {
    case 'active':    return 'success';
    case 'scheduled': return 'info';
    case 'paused':    return 'warning';
    case 'concluded': return 'default';
    case 'cancelled': return 'danger';
    default:          return 'default';
  }
}

function participantStatusVariant(status: string): 'success' | 'info' | 'warning' | 'default' {
  switch (status) {
    case 'joined':   return 'success';
    case 'speaking': return 'info';
    case 'invited':  return 'warning';
    case 'left':     return 'default';
    default:         return 'default';
  }
}

function typeColor(type: string): string {
  switch (type) {
    case 'question':  return 'var(--color-info, #3b82f6)';
    case 'answer':    return 'var(--color-success, #22c55e)';
    case 'proposal':  return 'var(--color-warning, #f59e0b)';
    case 'objection': return 'var(--color-danger, #ef4444)';
    case 'agreement': return 'var(--color-success, #22c55e)';
    case 'system':    return '#6b7280';
    default:          return 'inherit';
  }
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ParticipantRow({ p }: { p: MeetingParticipant }) {
  return (
    <tr>
      <td className="mono">{p.nodeId}</td>
      <td>{p.displayName}</td>
      <td>{p.roleId}</td>
      <td><StatusBadge status={p.status} variant={participantStatusVariant(p.status)} /></td>
      <td className="text-muted">{formatDate(p.joinedAt)}</td>
    </tr>
  );
}

function TranscriptBubble({ entry }: { entry: MeetingTranscriptEntry }) {
  const isSystem = entry.type === 'system';
  return (
    <div
      style={{
        padding: '0.75rem 1rem',
        marginBottom: '0.5rem',
        borderRadius: '0.5rem',
        backgroundColor: isSystem ? 'rgba(29, 37, 59, 0.50)' : 'rgba(12, 19, 36, 0.50)',
        border: `1px solid ${isSystem ? 'rgba(66, 72, 89, 0.30)' : 'rgba(66, 72, 89, 0.20)'}`,
        borderLeft: `3px solid ${typeColor(entry.type)}`,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
        <span style={{ fontWeight: 600, fontSize: '0.85rem' }}>
          {isSystem ? '⚙️ System' : `${entry.speakerRole} (${entry.speakerNodeId.slice(0, 12)}…)`}
        </span>
        <span className="text-muted" style={{ fontSize: '0.75rem' }}>
          {entry.type} · {formatDate(entry.createdAt)}
        </span>
      </div>
      <div style={{ fontSize: '0.9rem', whiteSpace: 'pre-wrap' }}>{entry.content}</div>
      {entry.replyToId && (
        <div className="text-muted" style={{ fontSize: '0.75rem', marginTop: '0.25rem' }}>
          ↩ Reply to #{entry.replyToId}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export function MeetingDetail() {
  const { t } = useTranslation('meetings');
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [msgContent, setMsgContent] = useState('');

  const { data, isLoading, error } = useMeetingDetail(id ?? '');
  const changeStatus = useChangeMeetingStatus();
  const sendMessage = useSendMeetingMessage();
  const deleteMeeting = useDeleteMeeting();

  const meetingData = data?.data;
  const meeting = meetingData;
  const participants = meetingData?.participants ?? [];
  const transcript = meetingData?.transcript ?? [];

  function handleDelete() {
    if (!id) return;
    deleteMeeting.mutate(id, {
      onSuccess: () => navigate('/meetings'),
    });
  }

  function handleSendMessage() {
    if (!id || !msgContent.trim()) return;
    sendMessage.mutate(
      { id, content: msgContent.trim() },
      { onSuccess: () => setMsgContent('') },
    );
  }

  if (isLoading) {
    return <div className="page"><p className="text-muted">Loading meeting…</p></div>;
  }

  if (error) {
    return (
      <div className="page">
        <ErrorMessage error={error as Error} />
        <button className="btn btn-default" onClick={() => navigate('/meetings')}>← {t('detail.backToMeetings')}</button>
      </div>
    );
  }

  if (!meeting) {
    return (
      <div className="page">
        <p>Meeting not found.</p>
        <button className="btn btn-default" onClick={() => navigate('/meetings')}>← {t('detail.backToMeetings')}</button>
      </div>
    );
  }

  const canStart = meeting.status === 'scheduled';
  const canPause = meeting.status === 'active';
  const canResume = meeting.status === 'paused';
  const canEnd = meeting.status === 'active' || meeting.status === 'paused';

  return (
    <div className="page">
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">{meeting.title}</h1>
          <p className="page-subtitle mono">{meeting.id}</p>
        </div>
        <div className="action-group">
          <button className="btn btn-default btn-sm" onClick={() => navigate('/meetings')}>← {t('detail.backToMeetings')}</button>
          {meeting.status === 'active' && (
            <button
              className="btn btn-sm"
              style={{ backgroundColor: 'var(--color-success)', color: '#080e1d' }}
              onClick={() => navigate(`/meetings/${id}/live`)}
            >
              Live View
            </button>
          )}
          {canStart && (
            <button
              className="btn btn-primary btn-sm"
              onClick={() => id && changeStatus.mutate({ id, status: 'active' })}
              disabled={changeStatus.isPending}
            >
              Start
            </button>
          )}
          {canPause && (
            <button
              className="btn btn-default btn-sm"
              onClick={() => id && changeStatus.mutate({ id, status: 'paused' })}
              disabled={changeStatus.isPending}
            >
              {t('live.pause')}
            </button>
          )}
          {canResume && (
            <button
              className="btn btn-primary btn-sm"
              onClick={() => id && changeStatus.mutate({ id, status: 'active' })}
              disabled={changeStatus.isPending}
            >
              {t('live.resume')}
            </button>
          )}
          {canEnd && (
            <button
              className="btn btn-danger btn-sm"
              onClick={() => id && changeStatus.mutate({ id, status: 'concluded' })}
              disabled={changeStatus.isPending}
            >
              {t('live.endMeeting')}
            </button>
          )}
          <button className="btn btn-danger btn-sm" onClick={() => setDeleteOpen(true)}>Delete</button>
        </div>
      </div>

      {/* Meeting Info */}
      <div className="card" style={{ padding: '1.5rem', marginBottom: '1.5rem' }}>
        <dl style={{ display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: '0.4rem 1rem' }}>
          <dt className="form-label">Status</dt>
          <dd><StatusBadge status={meeting.status} variant={statusVariant(meeting.status)} /></dd>
          <dt className="form-label">Type</dt>
          <dd>{meeting.type}</dd>
          <dt className="form-label">Initiator</dt>
          <dd>{meeting.initiatorType === 'agent' ? '🤖 Agent' : '👤 Human'}</dd>
          {meeting.initiationReason && (
            <>
              <dt className="form-label">Reason</dt>
              <dd>{meeting.initiationReason}</dd>
            </>
          )}
          <dt className="form-label">Facilitator</dt>
          <dd className="mono">{meeting.facilitatorNodeId}</dd>
          <dt className="form-label">Turn Policy</dt>
          <dd>{meeting.turnPolicy}</dd>
          <dt className="form-label">Max Duration</dt>
          <dd>{meeting.maxDurationMinutes} min</dd>
          <dt className="form-label">Created By</dt>
          <dd>{meeting.createdBy}</dd>
          <dt className="form-label">Created</dt>
          <dd className="text-muted">{formatDate(meeting.createdAt)}</dd>
          {meeting.startedAt && (
            <>
              <dt className="form-label">Started</dt>
              <dd className="text-muted">{formatDate(meeting.startedAt)}</dd>
            </>
          )}
          {meeting.endedAt && (
            <>
              <dt className="form-label">Ended</dt>
              <dd className="text-muted">{formatDate(meeting.endedAt)}</dd>
            </>
          )}
        </dl>
      </div>

      {/* Summary */}
      {meeting.summary && (
        <div className="card" style={{ padding: '1.5rem', marginBottom: '1.5rem' }}>
          <h3 style={{ marginBottom: '0.5rem' }}>Summary</h3>
          <p style={{ whiteSpace: 'pre-wrap' }}>{meeting.summary}</p>
        </div>
      )}

      {/* Agenda */}
      {meeting.agenda && (meeting.agenda as unknown[]).length > 0 && (
        <div className="card" style={{ padding: '1.5rem', marginBottom: '1.5rem' }}>
          <h3 style={{ marginBottom: '0.5rem' }}>{t('detail.agenda')}</h3>
          <textarea
            className="textarea mono"
            readOnly
            rows={6}
            style={{ width: '100%', fontSize: '0.8rem' }}
            value={JSON.stringify(meeting.agenda, null, 2)}
          />
        </div>
      )}

      {/* Participants */}
      <div className="card" style={{ padding: '1.5rem', marginBottom: '1.5rem' }}>
        <h3 style={{ marginBottom: '1rem' }}>{t('detail.participants')} ({participants.length})</h3>
        {participants.length > 0 ? (
          <table className="data-table" style={{ width: '100%' }}>
            <thead>
              <tr>
                <th>Node ID</th>
                <th>Name</th>
                <th>Role</th>
                <th>Status</th>
                <th>Joined</th>
              </tr>
            </thead>
            <tbody>
              {participants.map((p) => (
                <ParticipantRow key={p.id} p={p} />
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-muted">No participants yet.</p>
        )}
      </div>

      {/* Transcript */}
      <div className="card" style={{ padding: '1.5rem', marginBottom: '1.5rem' }}>
        <h3 style={{ marginBottom: '1rem' }}>{t('detail.transcript')} ({transcript.length} entries)</h3>
        {transcript.length > 0 ? (
          <div style={{ maxHeight: '500px', overflowY: 'auto' }}>
            {transcript.map((entry) => (
              <TranscriptBubble key={entry.id} entry={entry} />
            ))}
          </div>
        ) : (
          <p className="text-muted">No transcript entries yet.</p>
        )}

        {/* Admin message input */}
        {(meeting.status === 'active' || meeting.status === 'paused') && (
          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem' }}>
            <input
              className="input"
              type="text"
              placeholder="Send a system message…"
              value={msgContent}
              onChange={(e) => setMsgContent(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSendMessage(); }}
              style={{ flex: 1 }}
            />
            <button
              className="btn btn-primary btn-sm"
              onClick={handleSendMessage}
              disabled={sendMessage.isPending || !msgContent.trim()}
            >
              {sendMessage.isPending ? 'Sending…' : 'Send'}
            </button>
          </div>
        )}
      </div>

      {/* Decisions & Action Items */}
      {meeting.decisions && (meeting.decisions as unknown[]).length > 0 && (
        <div className="card" style={{ padding: '1.5rem', marginBottom: '1.5rem' }}>
          <h3 style={{ marginBottom: '0.5rem' }}>{t('detail.decisions')}</h3>
          <textarea
            className="textarea mono"
            readOnly
            rows={6}
            style={{ width: '100%', fontSize: '0.8rem' }}
            value={JSON.stringify(meeting.decisions, null, 2)}
          />
        </div>
      )}
      {meeting.actionItems && (meeting.actionItems as unknown[]).length > 0 && (
        <div className="card" style={{ padding: '1.5rem', marginBottom: '1.5rem' }}>
          <h3 style={{ marginBottom: '0.5rem' }}>{t('detail.actionItems')}</h3>
          <textarea
            className="textarea mono"
            readOnly
            rows={6}
            style={{ width: '100%', fontSize: '0.8rem' }}
            value={JSON.stringify(meeting.actionItems, null, 2)}
          />
        </div>
      )}

      {/* Delete Modal */}
      <Modal
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title="Delete Meeting"
        footer={
          <div className="modal-footer-actions">
            <button className="btn btn-default" onClick={() => setDeleteOpen(false)} disabled={deleteMeeting.isPending}>Cancel</button>
            <button className="btn btn-danger" onClick={handleDelete} disabled={deleteMeeting.isPending}>
              {deleteMeeting.isPending ? 'Deleting…' : 'Delete'}
            </button>
          </div>
        }
      >
        <p>Delete meeting <strong>{meeting.title}</strong>? This will remove all participants and transcript. This action cannot be undone.</p>
        {deleteMeeting.error && <ErrorMessage error={deleteMeeting.error as Error} />}
      </Modal>
    </div>
  );
}
