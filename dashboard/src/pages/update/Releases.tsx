import { useState } from 'react';
import { DataTable, Column } from '../../components/DataTable';
import { StatusBadge } from '../../components/StatusBadge';
import { Modal } from '../../components/Modal';
import { ErrorMessage } from '../../components/ErrorMessage';
import { useReleases, useCreateRelease, useDeleteRelease } from '../../api/hooks';
import type { Release, CreateReleaseInput } from '../../api/hooks';
import { useUser } from '../../context/UserContext';

const PLATFORMS = ['win32', 'darwin', 'linux'];
const CHANNELS = ['stable', 'beta', 'dev'];

interface ReleaseFormData {
  version: string;
  platform: string;
  channel: string;
  isCritical: boolean;
  changelog: string;
  downloadUrl: string;
  sizeBytes: string;
  checksumSha256: string;
}

const defaultForm: ReleaseFormData = {
  version: '',
  platform: 'win32',
  channel: 'stable',
  isCritical: false,
  changelog: '',
  downloadUrl: '',
  sizeBytes: '',
  checksumSha256: '',
};

export function Releases() {
  const [page, setPage] = useState(1);
  const [platform, setPlatform] = useState('');
  const [channel, setChannel] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Release | null>(null);
  const [form, setForm] = useState<ReleaseFormData>(defaultForm);
  const { isAdmin } = useUser();

  const { data, isLoading, error } = useReleases({ page, page_size: 20, platform: platform || undefined, channel: channel || undefined });
  const createRelease = useCreateRelease();
  const deleteRelease = useDeleteRelease();

  function formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
  }

  const columns: Column<Record<string, unknown>>[] = [
    {
      key: 'version',
      label: 'Version',
      render: (v) => <span className="mono font-medium">{String(v)}</span>,
    },
    {
      key: 'platform',
      label: 'Platform',
      render: (v) => <StatusBadge status={String(v)} variant="info" />,
    },
    {
      key: 'channel',
      label: 'Channel',
      render: (v) => (
        <StatusBadge
          status={String(v)}
          variant={v === 'stable' ? 'success' : v === 'beta' ? 'warning' : 'default'}
        />
      ),
    },
    {
      key: 'sizeBytes',
      label: 'Size',
      render: (v) => formatBytes(Number(v)),
    },
    {
      key: 'isCritical',
      label: 'Critical?',
      render: (v) => Number(v) === 1 ? <StatusBadge status="Critical" variant="danger" /> : <span className="text-muted">—</span>,
    },
    {
      key: 'publishedAt',
      label: 'Published',
      render: (v) => v ? new Date(String(v)).toLocaleDateString() : <span className="text-muted">Draft</span>,
    },
    {
      key: 'createdAt',
      label: 'Created',
      render: (v) => v ? new Date(String(v)).toLocaleDateString() : <span className="text-muted">—</span>,
    },
    {
      key: 'id',
      label: 'Actions',
      render: (_, row) => {
        const release = row as unknown as Release;
        return (
          <button
            className="btn btn-danger btn-sm"
            onClick={() => setDeleteTarget(release)}
          >
            Delete
          </button>
        );
      },
    },
  ];

  async function handleCreate() {
    const input: CreateReleaseInput = {
      version: form.version,
      platform: form.platform,
      channel: form.channel,
      download_url: form.downloadUrl,
      size_bytes: parseInt(form.sizeBytes, 10) || 0,
      checksum_sha256: form.checksumSha256 || undefined,
      changelog: form.changelog || undefined,
      is_critical: form.isCritical,
    };
    await createRelease.mutateAsync(input);
    setCreateOpen(false);
    setForm(defaultForm);
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    await deleteRelease.mutateAsync(deleteTarget.id);
    setDeleteTarget(null);
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">Releases</h1>
        <p className="page-subtitle">Manage platform release versions and channels</p>
        {isAdmin && (
          <div className="page-header-actions">
            <button className="btn btn-primary" onClick={() => setCreateOpen(true)}>
              + New Release
            </button>
          </div>
        )}
      </div>

      {error && <ErrorMessage error={error as Error} />}

      <div className="card">
        <div className="filter-bar">
          <select className="select" value={platform} onChange={(e) => { setPlatform(e.target.value); setPage(1); }}>
            <option value="">All Platforms</option>
            {PLATFORMS.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
          <select className="select" value={channel} onChange={(e) => { setChannel(e.target.value); setPage(1); }}>
            <option value="">All Channels</option>
            {CHANNELS.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>

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
        />
      </div>

      <Modal
        open={createOpen}
        onClose={() => { setCreateOpen(false); setForm(defaultForm); }}
        title="New Release"
        size="lg"
        footer={
          <div className="modal-footer-actions">
            <button className="btn btn-default" onClick={() => { setCreateOpen(false); setForm(defaultForm); }}>
              Cancel
            </button>
            <button
              className="btn btn-primary"
              onClick={handleCreate}
              disabled={createRelease.isPending || !form.version}
            >
              {createRelease.isPending ? 'Creating…' : 'Create Release'}
            </button>
          </div>
        }
      >
        <div className="form-grid">
          <div className="form-group">
            <label className="label">Version *</label>
            <input
              className="input"
              placeholder="e.g. 1.2.3"
              value={form.version}
              onChange={(e) => setForm({ ...form, version: e.target.value })}
            />
          </div>
          <div className="form-group">
            <label className="label">Platform</label>
            <select className="select" value={form.platform} onChange={(e) => setForm({ ...form, platform: e.target.value })}>
              {PLATFORMS.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label className="label">Channel</label>
            <select className="select" value={form.channel} onChange={(e) => setForm({ ...form, channel: e.target.value })}>
              {CHANNELS.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label className="label">Download URL *</label>
            <input
              className="input"
              placeholder="https://sourceforge.net/… or https://registry.npmjs.org/…"
              value={form.downloadUrl}
              onChange={(e) => setForm({ ...form, downloadUrl: e.target.value })}
            />
          </div>
          <div className="form-group">
            <label className="label">Size (bytes) *</label>
            <input
              className="input"
              type="number"
              placeholder="e.g. 52428800"
              value={form.sizeBytes}
              onChange={(e) => setForm({ ...form, sizeBytes: e.target.value })}
            />
          </div>
          <div className="form-group form-group-full">
            <label className="label">SHA-256 Checksum</label>
            <input
              className="input mono"
              placeholder="e.g. a1b2c3d4e5f6…"
              value={form.checksumSha256}
              onChange={(e) => setForm({ ...form, checksumSha256: e.target.value })}
            />
          </div>
          <div className="form-group form-group-full">
            <label className="label">Changelog</label>
            <textarea
              className="textarea"
              rows={4}
              placeholder="What's new in this release…"
              value={form.changelog}
              onChange={(e) => setForm({ ...form, changelog: e.target.value })}
            />
          </div>
          <div className="form-group form-group-full">
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={form.isCritical}
                onChange={(e) => setForm({ ...form, isCritical: e.target.checked })}
              />
              <span>Mark as critical update</span>
            </label>
          </div>
        </div>
      </Modal>

      <Modal
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title="Delete Release"
        footer={
          <div className="modal-footer-actions">
            <button className="btn btn-default" onClick={() => setDeleteTarget(null)}>Cancel</button>
            <button
              className="btn btn-danger"
              onClick={handleDelete}
              disabled={deleteRelease.isPending}
            >
              {deleteRelease.isPending ? 'Deleting…' : 'Delete'}
            </button>
          </div>
        }
      >
        {deleteTarget && (
          <p>
            Delete release <strong>v{deleteTarget.version}</strong> ({deleteTarget.platform} / {deleteTarget.channel})?
            This action cannot be undone.
          </p>
        )}
      </Modal>
    </div>
  );
}
