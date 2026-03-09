import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DataTable, Column } from '../../components/DataTable';
import { StatusBadge } from '../../components/StatusBadge';
import { Modal } from '../../components/Modal';
import { ErrorMessage } from '../../components/ErrorMessage';
import {
  useMeetingTriggers,
  useCreateMeetingTrigger,
  useUpdateMeetingTrigger,
  useDeleteMeetingTrigger,
  MeetingAutoTrigger,
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
    hour12: false,
  });
}

// ---------------------------------------------------------------------------
// Form
// ---------------------------------------------------------------------------

interface TriggerForm {
  name: string;
  description: string;
  event: string;
  enabled: boolean;
  facilitator_role: string;
  meeting_template: string;
}

const defaultForm: TriggerForm = {
  name: '',
  description: '',
  event: '',
  enabled: true,
  facilitator_role: '',
  meeting_template: JSON.stringify(
    {
      title: 'Auto Meeting - {{event}}',
      type: 'discussion',
      turn_policy: 'facilitator-directed',
      max_duration_minutes: 30,
    },
    null,
    2,
  ),
};

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export function AutoTriggers() {
  const { t } = useTranslation('meetings');
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<MeetingAutoTrigger | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<MeetingAutoTrigger | null>(null);
  const [form, setForm] = useState<TriggerForm>(defaultForm);

  const { data, isLoading, error } = useMeetingTriggers({ page, page_size: 20 });
  const createTrigger = useCreateMeetingTrigger();
  const updateTrigger = useUpdateMeetingTrigger();
  const deleteTrigger = useDeleteMeetingTrigger();

  const triggers = data?.data ?? [];
  const pagination = data?.pagination;

  function updateField(key: keyof TriggerForm, value: string | boolean) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function openCreate() {
    setForm(defaultForm);
    setCreateOpen(true);
  }

  function openEdit(trigger: MeetingAutoTrigger) {
    setForm({
      name: trigger.name,
      description: trigger.description ?? '',
      event: trigger.event,
      enabled: trigger.enabled,
      facilitator_role: trigger.facilitatorRole,
      meeting_template: JSON.stringify(trigger.meetingTemplate, null, 2),
    });
    setEditTarget(trigger);
  }

  function buildPayload(): Record<string, unknown> {
    let template: Record<string, unknown> = {};
    try {
      template = JSON.parse(form.meeting_template);
    } catch {
      template = { title: form.name, type: 'discussion' };
    }
    return {
      name: form.name.trim(),
      description: form.description.trim() || undefined,
      event: form.event.trim(),
      enabled: form.enabled,
      facilitator_role: form.facilitator_role.trim(),
      meeting_template: template,
    };
  }

  function handleCreate() {
    createTrigger.mutate(buildPayload(), {
      onSuccess: () => { setCreateOpen(false); setForm(defaultForm); },
    });
  }

  function handleUpdate() {
    if (!editTarget) return;
    updateTrigger.mutate(
      { id: editTarget.id, data: buildPayload() },
      { onSuccess: () => { setEditTarget(null); setForm(defaultForm); } },
    );
  }

  function handleDelete() {
    if (!deleteTarget) return;
    deleteTrigger.mutate(deleteTarget.id, {
      onSuccess: () => setDeleteTarget(null),
    });
  }

  function handleToggleEnabled(trigger: MeetingAutoTrigger) {
    updateTrigger.mutate({
      id: trigger.id,
      data: { enabled: !trigger.enabled },
    });
  }

  // ---------------------------------------------------------------------------
  // Columns
  // ---------------------------------------------------------------------------

  const columns: Column<Record<string, unknown>>[] = [
    {
      key: 'name',
      label: t('triggers.table.name'),
      render: (_v, row) => <strong>{row.name as string}</strong>,
    },
    {
      key: 'event',
      label: t('triggers.table.condition'),
      width: '200px',
      render: (_v, row) => <span className="mono">{row.event as string}</span>,
    },
    {
      key: 'facilitatorRole',
      label: 'Facilitator',
      width: '120px',
      render: (_v, row) => <span>{row.facilitatorRole as string}</span>,
    },
    {
      key: 'enabled',
      label: t('triggers.table.status'),
      width: '90px',
      render: (_v, row) => (
        <StatusBadge
          status={(row as unknown as MeetingAutoTrigger).enabled ? 'active' : 'disabled'}
          variant={(row as unknown as MeetingAutoTrigger).enabled ? 'success' : 'default'}
        />
      ),
    },
    {
      key: 'triggerCount',
      label: 'Triggers',
      width: '80px',
      render: (_v, row) => <span>{row.triggerCount as number}</span>,
    },
    {
      key: 'lastTriggeredAt',
      label: t('triggers.table.lastTriggered'),
      width: '150px',
      render: (_v, row) => (
        <span className="text-muted">{formatDate(row.lastTriggeredAt as string | null)}</span>
      ),
    },
    {
      key: '_actions',
      label: '',
      width: '150px',
      render: (_v, row) => {
        const trigger = row as unknown as MeetingAutoTrigger;
        return (
          <div className="action-group">
            <button
              className="btn btn-default btn-sm"
              onClick={() => handleToggleEnabled(trigger)}
              title={trigger.enabled ? 'Disable' : 'Enable'}
            >
              {trigger.enabled ? 'Disable' : 'Enable'}
            </button>
            <button
              className="btn btn-default btn-sm"
              onClick={() => openEdit(trigger)}
            >
              Edit
            </button>
            <button
              className="btn btn-danger btn-sm"
              onClick={() => setDeleteTarget(trigger)}
            >
              Del
            </button>
          </div>
        );
      },
    },
  ];

  // ---------------------------------------------------------------------------
  // Form Modal
  // ---------------------------------------------------------------------------

  const isEditing = editTarget !== null;
  const formOpen = createOpen || isEditing;
  const formTitle = isEditing ? `Edit Trigger: ${editTarget?.name}` : 'Create Auto Trigger';
  const formMutation = isEditing ? updateTrigger : createTrigger;

  const formContent = (
    <>
      <div className="form-group">
        <label className="form-label" htmlFor="trigger-name">Name *</label>
        <input
          id="trigger-name"
          className="input"
          type="text"
          required
          value={form.name}
          onChange={(e) => updateField('name', e.target.value)}
          placeholder="e.g. Security Incident Review"
        />
      </div>

      <div className="form-group">
        <label className="form-label" htmlFor="trigger-event">Event Pattern *</label>
        <input
          id="trigger-event"
          className="input"
          type="text"
          required
          value={form.event}
          onChange={(e) => updateField('event', e.target.value)}
          placeholder="e.g. security.critical, strategy.deployed, cron:daily"
        />
        <span className="text-muted" style={{ fontSize: '0.8rem' }}>
          Event pattern that triggers this meeting automatically.
        </span>
      </div>

      <div className="form-group">
        <label className="form-label" htmlFor="trigger-description">Description</label>
        <textarea
          id="trigger-description"
          className="textarea"
          rows={2}
          value={form.description}
          onChange={(e) => updateField('description', e.target.value)}
        />
      </div>

      <div className="form-group">
        <label className="form-label" htmlFor="trigger-role">Facilitator Role *</label>
        <input
          id="trigger-role"
          className="input"
          type="text"
          required
          value={form.facilitator_role}
          onChange={(e) => updateField('facilitator_role', e.target.value)}
          placeholder="e.g. ceo, security-lead"
        />
      </div>

      <div className="form-group">
        <label className="form-label">
          <input
            type="checkbox"
            checked={form.enabled}
            onChange={(e) => updateField('enabled', e.target.checked)}
            style={{ marginRight: '0.5rem' }}
          />
          Enabled
        </label>
      </div>

      <div className="form-group">
        <label className="form-label" htmlFor="trigger-template">Meeting Template (JSON)</label>
        <textarea
          id="trigger-template"
          className="textarea mono"
          rows={8}
          style={{ fontSize: '0.8rem' }}
          value={form.meeting_template}
          onChange={(e) => updateField('meeting_template', e.target.value)}
        />
      </div>

      {formMutation.error && <ErrorMessage error={formMutation.error as Error} />}
    </>
  );

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">{t('triggers.title')}</h1>
          <p className="page-subtitle">
            {t('triggers.subtitle')}
          </p>
        </div>
        <button className="btn btn-primary btn-sm" onClick={openCreate}>
          {t('triggers.createTrigger')}
        </button>
      </div>

      {error && <ErrorMessage error={error as Error} />}

      <div className="card">
        <DataTable
          columns={columns}
          data={triggers as unknown as Record<string, unknown>[]}
          loading={isLoading}
          rowKey="id"
          emptyMessage="No auto triggers configured."
          pagination={
            pagination && pagination.totalPages > 1
              ? { page: pagination.page, totalPages: pagination.totalPages, onPageChange: setPage }
              : undefined
          }
        />
      </div>

      {/* Create / Edit Modal */}
      <Modal
        open={formOpen}
        onClose={() => { setCreateOpen(false); setEditTarget(null); }}
        title={formTitle}
        size="lg"
        footer={
          <div className="modal-footer-actions">
            <button
              className="btn btn-default"
              onClick={() => { setCreateOpen(false); setEditTarget(null); }}
              disabled={formMutation.isPending}
            >
              Cancel
            </button>
            <button
              className="btn btn-primary"
              onClick={isEditing ? handleUpdate : handleCreate}
              disabled={formMutation.isPending || !form.name.trim() || !form.event.trim() || !form.facilitator_role.trim()}
            >
              {formMutation.isPending ? 'Saving…' : isEditing ? 'Update' : 'Create'}
            </button>
          </div>
        }
      >
        {formContent}
      </Modal>

      {/* Delete Modal */}
      <Modal
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        title="Delete Trigger"
        footer={
          <div className="modal-footer-actions">
            <button className="btn btn-default" onClick={() => setDeleteTarget(null)} disabled={deleteTrigger.isPending}>Cancel</button>
            <button className="btn btn-danger" onClick={handleDelete} disabled={deleteTrigger.isPending}>
              {deleteTrigger.isPending ? 'Deleting…' : 'Delete'}
            </button>
          </div>
        }
      >
        {deleteTarget && (
          <p>Delete trigger <strong>{deleteTarget.name}</strong>? This action cannot be undone.</p>
        )}
        {deleteTrigger.error && <ErrorMessage error={deleteTrigger.error as Error} />}
      </Modal>
    </div>
  );
}
