import { useParams, useNavigate } from 'react-router-dom';
import { useState, useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { StatusBadge } from '../../components/StatusBadge';
import { ErrorMessage } from '../../components/ErrorMessage';
import {
  useMeetingDetail,
  useChangeMeetingStatus,
  useSendMeetingMessage,
  MeetingTranscriptEntry,
} from '../../api/hooks';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
}

function typeColor(type: string): string {
  switch (type) {
    case 'question':  return '#3b82f6';
    case 'answer':    return '#22c55e';
    case 'proposal':  return '#f59e0b';
    case 'objection': return '#ef4444';
    case 'agreement': return '#22c55e';
    case 'system':    return '#6b7280';
    default:          return '#374151';
  }
}

function statusVariant(status: string): 'success' | 'info' | 'warning' | 'danger' | 'default' {
  switch (status) {
    case 'active':    return 'success';
    case 'paused':    return 'warning';
    case 'concluded': return 'default';
    default:          return 'default';
  }
}

function getSseBaseUrl(): string {
  // SSE (EventSource) connections are long-lived and go directly to the backend.
  // In development, the backend runs on port 3100.
  // In production, the dashboard is served by the GRC server so '' works.
  if (import.meta.env.VITE_API_BASE_URL) {
    return import.meta.env.VITE_API_BASE_URL as string;
  }
  // Dev mode: connect directly to backend (cannot use Vite proxy for /a2a/* as it
  // conflicts with dashboard routes like /a2a/agents)
  return import.meta.env.DEV ? 'http://localhost:3100' : '';
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export function MeetingLive() {
  const { t } = useTranslation('meetings');
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [sseEntries, setSseEntries] = useState<MeetingTranscriptEntry[]>([]);
  const [sseConnected, setSseConnected] = useState(false);
  const [msgContent, setMsgContent] = useState('');
  const transcriptEndRef = useRef<HTMLDivElement>(null);

  const { data, isLoading, error } = useMeetingDetail(id ?? '');
  const changeStatus = useChangeMeetingStatus();
  const sendMessage = useSendMeetingMessage();

  const meetingData = data?.data;
  const meeting = meetingData;
  const participants = meetingData?.participants ?? [];
  const initialTranscript = meetingData?.transcript ?? [];

  // Combine initial transcript with SSE-received entries
  const allEntries = [...initialTranscript];
  for (const e of sseEntries) {
    if (!allEntries.find((t) => t.id === e.id)) {
      allEntries.push(e);
    }
  }
  allEntries.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

  // SSE connection
  useEffect(() => {
    if (!id || !meeting || meeting.status !== 'active') return;

    const token = localStorage.getItem('grc_admin_token') || '';
    const url = `${getSseBaseUrl()}/a2a/meetings/${id}/stream`;

    const eventSource = new EventSource(`${url}?token=${encodeURIComponent(token)}`);

    eventSource.addEventListener('connected', () => {
      setSseConnected(true);
    });

    // Transcript messages from agents
    eventSource.addEventListener('message', (event) => {
      try {
        const entry = JSON.parse(event.data) as MeetingTranscriptEntry;
        setSseEntries((prev) => [...prev, entry]);
      } catch { /* ignore parse errors */ }
    });

    // Admin intervention messages
    eventSource.addEventListener('admin_message', (event) => {
      try {
        const entry = JSON.parse(event.data) as MeetingTranscriptEntry;
        setSseEntries((prev) => [...prev, entry]);
      } catch { /* ignore parse errors */ }
    });

    // Participant changes — refetch detail
    eventSource.addEventListener('participant_joined', () => {
      qc.invalidateQueries({ queryKey: ['admin', 'meeting', id] });
    });
    eventSource.addEventListener('participant_left', () => {
      qc.invalidateQueries({ queryKey: ['admin', 'meeting', id] });
    });

    // Status changes — refetch detail
    eventSource.addEventListener('status_changed', () => {
      qc.invalidateQueries({ queryKey: ['admin', 'meeting', id] });
    });
    eventSource.addEventListener('meeting_started', () => {
      qc.invalidateQueries({ queryKey: ['admin', 'meeting', id] });
    });
    eventSource.addEventListener('meeting_ended', () => {
      qc.invalidateQueries({ queryKey: ['admin', 'meeting', id] });
    });

    eventSource.onerror = () => {
      setSseConnected(false);
    };

    return () => {
      eventSource.close();
      setSseConnected(false);
    };
  }, [id, meeting?.status, qc]);

  // Auto-scroll transcript
  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [allEntries.length]);

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
        <button className="btn btn-default" onClick={() => navigate('/meetings')}>← Back</button>
      </div>
    );
  }
  if (!meeting) {
    return (
      <div className="page">
        <p>Meeting not found.</p>
        <button className="btn btn-default" onClick={() => navigate('/meetings')}>← Back</button>
      </div>
    );
  }

  const canPause = meeting.status === 'active';
  const canEnd = meeting.status === 'active' || meeting.status === 'paused';

  return (
    <div className="page">
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">
            🔴 {t('live.title')}: {meeting.title}
          </h1>
          <p className="page-subtitle">
            <StatusBadge status={meeting.status} variant={statusVariant(meeting.status)} />
            {' · '}
            {sseConnected ? (
              <span style={{ color: 'var(--color-success)' }}>● SSE Connected</span>
            ) : (
              <span style={{ color: 'var(--color-danger)' }}>● Disconnected</span>
            )}
            {' · '}
            {participants.filter((p) => p.status === 'joined' || p.status === 'speaking').length} active participants
          </p>
        </div>
        <div className="action-group">
          <button className="btn btn-default btn-sm" onClick={() => navigate(`/meetings/${id}`)}>Detail View</button>
          {canPause && (
            <button
              className="btn btn-default btn-sm"
              onClick={() => id && changeStatus.mutate({ id, status: 'paused' })}
              disabled={changeStatus.isPending}
            >
              {t('live.pause')}
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
        </div>
      </div>

      {/* Main layout: transcript + participants sidebar */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 250px', gap: '1rem', height: 'calc(100vh - 200px)' }}>
        {/* Transcript */}
        <div className="card" style={{ padding: '1rem', display: 'flex', flexDirection: 'column' }}>
          <h3 style={{ marginBottom: '0.75rem', flexShrink: 0 }}>
            Transcript ({allEntries.length})
          </h3>

          <div style={{ flex: 1, overflowY: 'auto', marginBottom: '0.75rem' }}>
            {allEntries.length === 0 ? (
              <p className="text-muted">Waiting for messages…</p>
            ) : (
              allEntries.map((entry) => {
                const isSystem = entry.type === 'system';
                return (
                  <div
                    key={entry.id}
                    style={{
                      padding: '0.5rem 0.75rem',
                      marginBottom: '0.25rem',
                      borderRadius: '0.375rem',
                      backgroundColor: isSystem ? 'rgba(29, 37, 59, 0.50)' : 'rgba(12, 19, 36, 0.50)',
                      borderLeft: `3px solid ${typeColor(entry.type)}`,
                      fontSize: '0.875rem',
                    }}
                  >
                    <span style={{ fontWeight: 600, marginRight: '0.5rem' }}>
                      {isSystem ? '⚙️' : entry.speakerRole}
                    </span>
                    <span className="text-muted" style={{ fontSize: '0.75rem', marginRight: '0.5rem' }}>
                      {formatTime(entry.createdAt)}
                    </span>
                    <span className="tag" style={{ fontSize: '0.65rem', marginRight: '0.5rem' }}>
                      {entry.type}
                    </span>
                    <br />
                    <span style={{ whiteSpace: 'pre-wrap' }}>{entry.content}</span>
                  </div>
                );
              })
            )}
            <div ref={transcriptEndRef} />
          </div>

          {/* Admin message input */}
          <div style={{ display: 'flex', gap: '0.5rem', flexShrink: 0 }}>
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
              Send
            </button>
          </div>
        </div>

        {/* Participants Sidebar */}
        <div className="card" style={{ padding: '1rem', overflowY: 'auto' }}>
          <h3 style={{ marginBottom: '0.75rem' }}>
            Participants ({participants.length})
          </h3>
          {participants.map((p) => (
            <div
              key={p.id}
              style={{
                padding: '0.5rem',
                marginBottom: '0.25rem',
                borderRadius: '0.375rem',
                backgroundColor: p.status === 'speaking' ? 'rgba(74, 222, 128, 0.10)' : p.status === 'left' ? 'rgba(66, 72, 89, 0.20)' : 'rgba(12, 19, 36, 0.40)',
                border: '1px solid rgba(66, 72, 89, 0.20)',
              }}
            >
              <div style={{ fontWeight: 600, fontSize: '0.85rem' }}>{p.displayName}</div>
              <div className="text-muted" style={{ fontSize: '0.75rem' }}>{p.roleId}</div>
              <StatusBadge
                status={p.status}
                variant={
                  p.status === 'speaking' ? 'info'
                  : p.status === 'joined' ? 'success'
                  : p.status === 'left' ? 'default'
                  : 'warning'
                }
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
