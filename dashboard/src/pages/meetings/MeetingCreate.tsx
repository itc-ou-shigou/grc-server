import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ErrorMessage } from '../../components/ErrorMessage';
import { useCreateMeeting } from '../../api/hooks';

// ---------------------------------------------------------------------------
// Form State
// ---------------------------------------------------------------------------

interface MeetingForm {
  title: string;
  type: string;
  initiator_type: string;
  initiation_reason: string;
  facilitator_node_id: string;
  shared_context: string;
  turn_policy: string;
  max_duration_minutes: string;
  created_by: string;
}

const defaultForm: MeetingForm = {
  title: '',
  type: 'discussion',
  initiator_type: 'human',
  initiation_reason: '',
  facilitator_node_id: '',
  shared_context: '',
  turn_policy: 'facilitator-directed',
  max_duration_minutes: '60',
  created_by: 'admin',
};

const TYPE_OPTIONS = [
  { value: 'discussion', label: '💬 Discussion' },
  { value: 'review', label: '📋 Review' },
  { value: 'brainstorm', label: '💡 Brainstorm' },
  { value: 'decision', label: '⚖️ Decision' },
];

const TURN_POLICY_OPTIONS = [
  'facilitator-directed',
  'round-robin',
  'free-form',
  'raise-hand',
];

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export function MeetingCreate() {
  const { t } = useTranslation('meetings');
  const navigate = useNavigate();
  const [form, setForm] = useState<MeetingForm>(defaultForm);
  const createMeeting = useCreateMeeting();

  function updateField(key: keyof MeetingForm, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const payload: Record<string, unknown> = {
      title: form.title.trim(),
      type: form.type,
      initiator_type: form.initiator_type,
      facilitator_node_id: form.facilitator_node_id.trim(),
      turn_policy: form.turn_policy,
      max_duration_minutes: Number.parseInt(form.max_duration_minutes, 10) || 60,
      created_by: form.created_by.trim() || 'admin',
    };

    if (form.initiation_reason.trim()) {
      payload.initiation_reason = form.initiation_reason.trim();
    }
    if (form.shared_context.trim()) {
      payload.shared_context = form.shared_context.trim();
    }

    createMeeting.mutate(payload, {
      onSuccess: () => navigate('/meetings'),
    });
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">{t('create.title')}</h1>
          <p className="page-subtitle">
            {t('create.subtitle')}
          </p>
        </div>
        <button className="btn btn-default btn-sm" onClick={() => navigate('/meetings')}>
          ← Back
        </button>
      </div>

      <div className="card" style={{ padding: '1.5rem', maxWidth: '700px' }}>
        <form onSubmit={handleSubmit}>
          {/* Title */}
          <div className="form-group">
            <label className="form-label" htmlFor="title">{t('create.form.title')} *</label>
            <input
              id="title"
              className="input"
              type="text"
              required
              maxLength={500}
              value={form.title}
              onChange={(e) => updateField('title', e.target.value)}
              placeholder={t('create.form.titlePlaceholder')}
            />
          </div>

          {/* Type */}
          <div className="form-group">
            <label className="form-label" htmlFor="type">{t('create.form.type')}</label>
            <select
              id="type"
              className="select"
              value={form.type}
              onChange={(e) => updateField('type', e.target.value)}
            >
              {TYPE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>

          {/* Facilitator Node ID */}
          <div className="form-group">
            <label className="form-label" htmlFor="facilitator">Facilitator Node ID *</label>
            <input
              id="facilitator"
              className="input"
              type="text"
              required
              value={form.facilitator_node_id}
              onChange={(e) => updateField('facilitator_node_id', e.target.value)}
              placeholder="e.g. ceo-node-01"
            />
            <span className="text-muted" style={{ fontSize: '0.8rem' }}>
              The node that will facilitate the meeting.
            </span>
          </div>

          {/* Turn Policy */}
          <div className="form-group">
            <label className="form-label" htmlFor="turnPolicy">Turn Policy</label>
            <select
              id="turnPolicy"
              className="select"
              value={form.turn_policy}
              onChange={(e) => updateField('turn_policy', e.target.value)}
            >
              {TURN_POLICY_OPTIONS.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </div>

          {/* Max Duration */}
          <div className="form-group">
            <label className="form-label" htmlFor="maxDuration">Max Duration (minutes)</label>
            <input
              id="maxDuration"
              className="input"
              type="number"
              min="1"
              max="1440"
              value={form.max_duration_minutes}
              onChange={(e) => updateField('max_duration_minutes', e.target.value)}
            />
          </div>

          {/* Initiator Type */}
          <div className="form-group">
            <label className="form-label" htmlFor="initiatorType">Initiator Type</label>
            <select
              id="initiatorType"
              className="select"
              value={form.initiator_type}
              onChange={(e) => updateField('initiator_type', e.target.value)}
            >
              <option value="human">👤 Human</option>
              <option value="agent">🤖 Agent</option>
            </select>
          </div>

          {/* Initiation Reason (shown for agent) */}
          {form.initiator_type === 'agent' && (
            <div className="form-group">
              <label className="form-label" htmlFor="reason">Initiation Reason</label>
              <textarea
                id="reason"
                className="textarea"
                rows={3}
                value={form.initiation_reason}
                onChange={(e) => updateField('initiation_reason', e.target.value)}
                placeholder="Why is this meeting being initiated by an agent?"
              />
            </div>
          )}

          {/* Shared Context */}
          <div className="form-group">
            <label className="form-label" htmlFor="context">Shared Context</label>
            <textarea
              id="context"
              className="textarea"
              rows={4}
              value={form.shared_context}
              onChange={(e) => updateField('shared_context', e.target.value)}
              placeholder="Context visible to all participants (optional)"
            />
          </div>

          {/* Created By */}
          <div className="form-group">
            <label className="form-label" htmlFor="createdBy">Created By</label>
            <input
              id="createdBy"
              className="input"
              type="text"
              value={form.created_by}
              onChange={(e) => updateField('created_by', e.target.value)}
            />
          </div>

          {/* Error */}
          {createMeeting.error && <ErrorMessage error={createMeeting.error as Error} />}

          {/* Actions */}
          <div className="action-group" style={{ marginTop: '1.5rem' }}>
            <button
              type="button"
              className="btn btn-default"
              onClick={() => navigate('/meetings')}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={createMeeting.isPending || !form.title.trim() || !form.facilitator_node_id.trim()}
            >
              {createMeeting.isPending ? t('create.form.creating') : t('create.form.submit')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
