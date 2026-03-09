import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DataTable, Column } from '../../components/DataTable';
import { StatusBadge } from '../../components/StatusBadge';
import { Modal } from '../../components/Modal';
import { ErrorMessage } from '../../components/ErrorMessage';
import { useAdminChannels, useCreateChannel, useDeleteChannel, Channel } from '../../api/hooks';
import { useUser } from '../../context/UserContext';

interface ChannelFormData {
  name: string;
  display_name: string;
  description: string;
}

const defaultForm: ChannelFormData = { name: '', display_name: '', description: '' };

export function Channels() {
  const { t } = useTranslation('community');
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Channel | null>(null);
  const [form, setForm] = useState<ChannelFormData>(defaultForm);
  const { isAdmin } = useUser();

  const { data, isLoading, error } = useAdminChannels({ page, page_size: 20 });
  const createChannel = useCreateChannel();
  const deleteChannel = useDeleteChannel();

  const columns: Column<Record<string, unknown>>[] = [
    {
      key: 'name',
      label: t('channels.table.name'),
      render: (v) => <span className="mono">{String(v)}</span>,
    },
    { key: 'displayName', label: 'Display Name' },
    {
      key: 'description',
      label: t('channels.table.description'),
      render: (v) => v ? <span className="text-sm">{String(v).slice(0, 60)}</span> : <span className="text-muted">—</span>,
    },
    {
      key: 'isSystem',
      label: 'Type',
      render: (v) => (
        <StatusBadge
          status={Number(v) === 1 ? 'System' : 'Community'}
          variant={Number(v) === 1 ? 'info' : 'default'}
        />
      ),
    },
    {
      key: 'createdAt',
      label: 'Created',
      render: (v) => new Date(String(v)).toLocaleDateString(),
    },
    {
      key: 'id',
      label: 'Actions',
      render: (_, row) => {
        const channel = row as unknown as Channel;
        return (
          <button
            className="btn btn-sm btn-danger"
            onClick={() => setDeleteTarget(channel)}
            disabled={Number(channel.isSystem) === 1}
          >
            Delete
          </button>
        );
      },
    },
  ];

  async function handleCreate() {
    await createChannel.mutateAsync(form as Partial<Channel>);
    setCreateOpen(false);
    setForm(defaultForm);
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    await deleteChannel.mutateAsync(deleteTarget.id);
    setDeleteTarget(null);
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">{t('channels.title')}</h1>
        <p className="page-subtitle">{t('channels.subtitle')}</p>
        {isAdmin && (
          <div className="page-header-actions">
            <button className="btn btn-primary" onClick={() => setCreateOpen(true)}>
              + New Channel
            </button>
          </div>
        )}
      </div>

      {error && <ErrorMessage error={error as Error} />}

      <div className="card">
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
          emptyMessage="No channels found."
        />
      </div>

      <Modal
        open={createOpen}
        onClose={() => { setCreateOpen(false); setForm(defaultForm); }}
        title="New Channel"
        footer={
          <div className="modal-footer-actions">
            <button className="btn btn-default" onClick={() => { setCreateOpen(false); setForm(defaultForm); }}>
              Cancel
            </button>
            <button
              className="btn btn-primary"
              onClick={handleCreate}
              disabled={createChannel.isPending || !form.name}
            >
              {createChannel.isPending ? 'Creating…' : 'Create'}
            </button>
          </div>
        }
      >
        <div className="form-grid">
          <div className="form-group">
            <label className="label">Slug Name *</label>
            <input
              className="input"
              placeholder="e.g. general-discussion"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value.toLowerCase().replace(/\s+/g, '-') })}
            />
            <p className="input-hint">Lowercase, hyphens only</p>
          </div>
          <div className="form-group">
            <label className="label">Display Name</label>
            <input
              className="input"
              placeholder="e.g. General Discussion"
              value={form.display_name}
              onChange={(e) => setForm({ ...form, display_name: e.target.value })}
            />
          </div>
          <div className="form-group form-group-full">
            <label className="label">Description</label>
            <textarea
              className="textarea"
              rows={3}
              placeholder="Channel description…"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </div>
        </div>
      </Modal>

      <Modal
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title="Delete Channel"
        footer={
          <div className="modal-footer-actions">
            <button className="btn btn-default" onClick={() => setDeleteTarget(null)}>Cancel</button>
            <button
              className="btn btn-danger"
              onClick={handleDelete}
              disabled={deleteChannel.isPending}
            >
              {deleteChannel.isPending ? 'Deleting…' : 'Delete'}
            </button>
          </div>
        }
      >
        {deleteTarget && (
          <p>
            Delete channel <strong>{deleteTarget.displayName}</strong>? This action cannot be undone.
          </p>
        )}
      </Modal>
    </div>
  );
}
