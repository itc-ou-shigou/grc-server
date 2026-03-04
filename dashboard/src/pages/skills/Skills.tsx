import { useState, useRef } from 'react';
import { DataTable, Column } from '../../components/DataTable';
import { StatusBadge } from '../../components/StatusBadge';
import { Modal } from '../../components/Modal';
import { ErrorMessage } from '../../components/ErrorMessage';
import { useAdminSkills, useChangeSkillStatus, usePublishSkill, Skill } from '../../api/hooks';
import { useUser } from '../../context/UserContext';

const CATEGORIES = ['productivity', 'development', 'data', 'communication', 'finance', 'other'];
const SORT_OPTIONS = [
  { value: 'createdAt', label: 'Newest' },
  { value: 'downloads', label: 'Most Downloads' },
  { value: 'rating', label: 'Highest Rating' },
];

interface PublishForm {
  name: string;
  slug: string;
  description: string;
  version: string;
  category: string;
  tags: string;
  changelog: string;
  isOfficial: boolean;
  tarball: File | null;
}

const defaultPublishForm: PublishForm = {
  name: '',
  slug: '',
  description: '',
  version: '1.0.0',
  category: '',
  tags: '',
  changelog: '',
  isOfficial: false,
  tarball: null,
};

function toSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

export function Skills() {
  const [page, setPage] = useState(1);
  const [category, setCategory] = useState('');
  const [sortBy, setSortBy] = useState('createdAt');
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [actionModal, setActionModal] = useState<{ skill: Skill; action: string } | null>(null);
  const [publishOpen, setPublishOpen] = useState(false);
  const [publishForm, setPublishForm] = useState<PublishForm>(defaultPublishForm);
  const [publishError, setPublishError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { isAdmin } = useUser();

  const { data, isLoading, error } = useAdminSkills({
    page,
    page_size: 20,
    category: category || undefined,
    sort_by: sortBy,
    search: search || undefined,
  });
  const changeStatus = useChangeSkillStatus();
  const publishSkill = usePublishSkill();

  const statusMap: Record<string, string> = {
    Approve: 'approved',
    Reject: 'rejected',
    Flag: 'flagged',
    Remove: 'removed',
  };

  const columns: Column<Record<string, unknown>>[] = [
    {
      key: 'name',
      label: 'Name',
      render: (_, row) => {
        const skill = row as unknown as Skill;
        return (
          <div>
            <div className="font-medium">{skill.name}</div>
            <div className="text-sm text-muted mono">{skill.slug}</div>
          </div>
        );
      },
    },
    { key: 'authorDisplayName', label: 'Author' },
    {
      key: 'category',
      label: 'Category',
      render: (v) => v ? <StatusBadge status={String(v)} variant="info" /> : <span className="text-muted">—</span>,
    },
    {
      key: 'downloadCount',
      label: 'Downloads',
      render: (v) => Number(v).toLocaleString(),
    },
    {
      key: 'ratingAvg',
      label: 'Rating',
      render: (v) => {
        const rating = Number(v);
        return (
          <span>
            {'★'.repeat(Math.round(rating))}{'☆'.repeat(5 - Math.round(rating))}
            {' '}{rating.toFixed(1)}
          </span>
        );
      },
    },
    {
      key: 'status',
      label: 'Status',
      render: (v) => <StatusBadge status={String(v)} />,
    },
    {
      key: 'id',
      label: 'Actions',
      render: (_, row) => {
        const skill = row as unknown as Skill;
        return (
          <div className="action-group">
            {['Approve', 'Reject', 'Flag', 'Remove'].map((action) => (
              <button
                key={action}
                className={`btn btn-sm ${action === 'Remove' || action === 'Reject' ? 'btn-danger' : action === 'Approve' ? 'btn-primary' : 'btn-default'}`}
                onClick={() => setActionModal({ skill, action })}
                disabled={skill.status === statusMap[action]}
              >
                {action}
              </button>
            ))}
          </div>
        );
      },
    },
  ];

  async function handleAction() {
    if (!actionModal) return;
    const newStatus = statusMap[actionModal.action];
    await changeStatus.mutateAsync({ skillId: actionModal.skill.id, status: newStatus });
    setActionModal(null);
  }

  function handlePublishFormChange(field: keyof PublishForm, value: string | boolean | File | null) {
    setPublishForm((prev) => {
      const next = { ...prev, [field]: value };
      // Auto-generate slug from name
      if (field === 'name' && typeof value === 'string') {
        next.slug = toSlug(value);
      }
      return next;
    });
  }

  async function handlePublish() {
    setPublishError(null);
    if (!publishForm.name.trim()) { setPublishError('Name is required'); return; }
    if (!publishForm.slug.trim()) { setPublishError('Slug is required'); return; }
    if (!publishForm.description.trim()) { setPublishError('Description is required'); return; }
    if (!publishForm.version.trim()) { setPublishError('Version is required'); return; }
    if (!publishForm.tarball) { setPublishError('Tarball file is required'); return; }

    try {
      const tags = publishForm.tags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);

      await publishSkill.mutateAsync({
        name: publishForm.name,
        slug: publishForm.slug,
        description: publishForm.description,
        version: publishForm.version,
        category: publishForm.category || undefined,
        tags,
        changelog: publishForm.changelog || undefined,
        isOfficial: publishForm.isOfficial,
        tarball: publishForm.tarball,
      });

      // Reset form and close modal
      setPublishForm(defaultPublishForm);
      setPublishOpen(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    } catch (err) {
      setPublishError(err instanceof Error ? err.message : 'Publish failed');
    }
  }

  function handleClosePublish() {
    setPublishOpen(false);
    setPublishError(null);
    setPublishForm(defaultPublishForm);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  return (
    <div className="page">
      <div className="page-header">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <h1 className="page-title">Skills</h1>
            <p className="page-subtitle">Manage published skills in the ClawHub marketplace</p>
          </div>
          {isAdmin && (
            <button className="btn btn-primary" onClick={() => setPublishOpen(true)}>
              + Add Skill
            </button>
          )}
        </div>
      </div>

      {error && <ErrorMessage error={error as Error} />}

      <div className="card">
        <div className="filter-bar">
          <input
            className="input"
            placeholder="Search skills…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { setSearch(searchInput); setPage(1); } }}
          />
          <select className="select" value={category} onChange={(e) => { setCategory(e.target.value); setPage(1); }}>
            <option value="">All Categories</option>
            {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <select className="select" value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
            {SORT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <button className="btn btn-primary" onClick={() => { setSearch(searchInput); setPage(1); }}>
            Search
          </button>
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

      {/* Status change confirmation modal (admin only) */}
      <Modal
        open={!!actionModal}
        onClose={() => setActionModal(null)}
        title={`${actionModal?.action} Skill`}
        footer={
          <div className="modal-footer-actions">
            <button className="btn btn-default" onClick={() => setActionModal(null)}>Cancel</button>
            <button
              className={`btn ${actionModal?.action === 'Remove' || actionModal?.action === 'Reject' ? 'btn-danger' : 'btn-primary'}`}
              onClick={handleAction}
              disabled={changeStatus.isPending}
            >
              {changeStatus.isPending ? 'Processing…' : 'Confirm'}
            </button>
          </div>
        }
      >
        {actionModal && (
          <p>
            {actionModal.action} skill{' '}
            <strong>{actionModal.skill.name}</strong>?
          </p>
        )}
      </Modal>

      {/* Publish skill modal */}
      <Modal
        open={publishOpen}
        onClose={handleClosePublish}
        title="Add New Skill"
        size="lg"
        footer={
          <div className="modal-footer-actions">
            <button className="btn btn-default" onClick={handleClosePublish}>Cancel</button>
            <button
              className="btn btn-primary"
              onClick={handlePublish}
              disabled={publishSkill.isPending}
            >
              {publishSkill.isPending ? 'Publishing…' : 'Publish Skill'}
            </button>
          </div>
        }
      >
        {publishError && (
          <div style={{ color: 'var(--color-danger)', marginBottom: '1rem', padding: '0.5rem 0.75rem', background: 'rgba(255,0,0,0.08)', borderRadius: 'var(--radius-sm)' }}>
            {publishError}
          </div>
        )}

        <div className="form-grid">
          <div className="form-group">
            <label className="label">Name <span style={{ color: 'var(--color-danger)' }}>*</span></label>
            <input
              className="input"
              placeholder="My Custom Skill"
              value={publishForm.name}
              onChange={(e) => handlePublishFormChange('name', e.target.value)}
            />
          </div>

          <div className="form-group">
            <label className="label">Slug <span style={{ color: 'var(--color-danger)' }}>*</span></label>
            <input
              className="input mono"
              placeholder="my-custom-skill"
              value={publishForm.slug}
              onChange={(e) => handlePublishFormChange('slug', e.target.value)}
            />
          </div>

          <div className="form-group">
            <label className="label">Version <span style={{ color: 'var(--color-danger)' }}>*</span></label>
            <input
              className="input mono"
              placeholder="1.0.0"
              value={publishForm.version}
              onChange={(e) => handlePublishFormChange('version', e.target.value)}
            />
          </div>

          <div className="form-group">
            <label className="label">Category</label>
            <select
              className="select"
              value={publishForm.category}
              onChange={(e) => handlePublishFormChange('category', e.target.value)}
            >
              <option value="">— None —</option>
              {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>

          <div className="form-group-full">
            <label className="label">Description <span style={{ color: 'var(--color-danger)' }}>*</span></label>
            <textarea
              className="textarea"
              rows={3}
              placeholder="What does this skill do?"
              value={publishForm.description}
              onChange={(e) => handlePublishFormChange('description', e.target.value)}
            />
          </div>

          <div className="form-group-full">
            <label className="label">Tags <span className="text-muted text-sm">(comma-separated)</span></label>
            <input
              className="input"
              placeholder="automation, workflow, custom"
              value={publishForm.tags}
              onChange={(e) => handlePublishFormChange('tags', e.target.value)}
            />
          </div>

          <div className="form-group-full">
            <label className="label">Changelog</label>
            <textarea
              className="textarea"
              rows={2}
              placeholder="What's new in this version?"
              value={publishForm.changelog}
              onChange={(e) => handlePublishFormChange('changelog', e.target.value)}
            />
          </div>

          <div className="form-group-full">
            <label className="label">Tarball <span style={{ color: 'var(--color-danger)' }}>*</span></label>
            <input
              ref={fileInputRef}
              type="file"
              className="input"
              accept=".tar.gz,.tgz"
              onChange={(e) => handlePublishFormChange('tarball', e.target.files?.[0] ?? null)}
            />
            <div className="text-sm text-muted" style={{ marginTop: '0.25rem' }}>
              Upload a .tar.gz file containing a SKILL.md and skill assets.
            </div>
          </div>

          <div className="form-group-full">
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={publishForm.isOfficial}
                onChange={(e) => handlePublishFormChange('isOfficial', e.target.checked)}
              />
              <span>Mark as Official Skill</span>
            </label>
          </div>
        </div>
      </Modal>
    </div>
  );
}
