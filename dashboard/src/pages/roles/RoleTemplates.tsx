import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useRoleTemplates, useCloneRole, useDeleteRole } from '../../api/hooks';
import { DataTable } from '../../components/DataTable';
import { StatusBadge } from '../../components/StatusBadge';
import { Modal } from '../../components/Modal';
import { ErrorMessage } from '../../components/ErrorMessage';
import { useUser } from '../../context/UserContext';

function timeAgo(date: string): string {
  const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

interface CloneModalState {
  open: boolean;
  sourceId: string;
  sourceName: string;
}

interface DeleteModalState {
  open: boolean;
  id: string;
  name: string;
}

const KNOWN_DEPARTMENTS = [
  'Engineering',
  'Marketing',
  'Sales',
  'Product',
  'Design',
  'Testing',
  'Support',
  'Data',
  'Business',
  'Operations',
  'Specialized',
  'Project Management',
  'Paid Media',
  'Game Development',
  'Spatial Computing',
  'Human Resources',
  'Finance',
  'Executive Office',
  'Customer Support',
  'Strategy & Planning',
];

const PAGE_SIZE = 20;

export function RoleTemplates() {
  const { t } = useTranslation('roles');
  const navigate = useNavigate();
  const { isAdmin } = useUser();

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [modeFilter, setModeFilter] = useState('');
  const [deptFilter, setDeptFilter] = useState('');

  const { data: rolesData, isLoading, error } = useRoleTemplates({
    page,
    page_size: PAGE_SIZE,
    department: deptFilter || undefined,
    mode: modeFilter || undefined,
  });

  const roles = rolesData?.data ?? [];
  const cloneRole = useCloneRole();
  const deleteRole = useDeleteRole();

  const [cloneModal, setCloneModal] = useState<CloneModalState>({ open: false, sourceId: '', sourceName: '' });
  const [deleteModal, setDeleteModal] = useState<DeleteModalState>({ open: false, id: '', name: '' });
  const [newId, setNewId] = useState('');
  const [newDisplayName, setNewDisplayName] = useState('');

  const s = search.toLowerCase();
  const filtered = roles.filter(r => {
    const matchSearch = !search || r.name.toLowerCase().includes(s) || r.id.toLowerCase().includes(s) || (r.department || '').toLowerCase().includes(s);
    return matchSearch;
  });

  const total = rolesData?.pagination?.total ?? 0;
  const rangeStart = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const rangeEnd = Math.min(page * PAGE_SIZE, total);

  type RoleRow = typeof roles[0];

  const columns = [
    {
      key: 'id',
      label: t('table.id'),
      render: (_v: unknown, row: Record<string, unknown>) => {
        const r = row as unknown as RoleRow;
        return <span className="mono">{r.id}</span>;
      },
    },
    {
      key: 'name',
      label: t('table.name'),
      render: (_v: unknown, row: Record<string, unknown>) => {
        const r = row as unknown as RoleRow;
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span>{r.name}</span>
            {r.isBuiltin ? <span className="tag">{t('table.builtin')}</span> : null}
          </div>
        );
      },
    },
    {
      key: 'mode',
      label: t('table.mode'),
      render: (_v: unknown, row: Record<string, unknown>) => {
        const r = row as unknown as RoleRow;
        return (
          <StatusBadge status={r.mode} variant={r.mode === 'autonomous' ? 'success' : 'warning'} />
        );
      },
    },
    {
      key: 'department',
      label: t('table.department'),
      render: (_v: unknown, row: Record<string, unknown>) => {
        const r = row as unknown as RoleRow;
        return r.department || <span className="text-muted">—</span>;
      },
    },
    {
      key: 'industry',
      label: t('table.industry'),
      render: (_v: unknown, row: Record<string, unknown>) => {
        const r = row as unknown as RoleRow;
        return r.industry || <span className="text-muted">—</span>;
      },
    },
    {
      key: 'createdAt',
      label: t('table.created'),
      render: (_v: unknown, row: Record<string, unknown>) => {
        const r = row as unknown as RoleRow;
        return (
          <span className="text-muted" title={r.createdAt}>{timeAgo(r.createdAt)}</span>
        );
      },
    },
    {
      key: 'actions',
      label: 'Actions',
      render: (_v: unknown, row: Record<string, unknown>) => {
        const r = row as unknown as RoleRow;
        return (
          <div className="action-group">
            <button
              className="btn btn-primary btn-sm"
              onClick={() => navigate(`/roles/${r.id}/assign`)}
            >
              Assign
            </button>
            <button
              className="btn btn-default btn-sm"
              onClick={() => navigate(`/roles/${r.id}`)}
            >
              Edit
            </button>
            <button
              className="btn btn-default btn-sm"
              onClick={() => {
                setCloneModal({ open: true, sourceId: r.id, sourceName: r.name });
                setNewId(`${r.id}-copy`);
                setNewDisplayName(`${r.name} (Copy)`);
              }}
            >
              Clone
            </button>
            {isAdmin && (
              <button
                className="btn btn-danger btn-sm"
                disabled={r.isBuiltin}
                title={r.isBuiltin ? t('deleteModal.builtinWarning') : undefined}
                onClick={() => setDeleteModal({ open: true, id: r.id, name: r.name })}
              >
                Delete
              </button>
            )}
          </div>
        );
      },
    },
  ];

  const handleClone = async () => {
    if (!newId.trim() || !newDisplayName.trim()) return;
    await cloneRole.mutateAsync({ id: cloneModal.sourceId, newId: newId.trim(), newName: newDisplayName.trim() });
    setCloneModal({ open: false, sourceId: '', sourceName: '' });
  };

  const handleDelete = async () => {
    await deleteRole.mutateAsync(deleteModal.id);
    setDeleteModal({ open: false, id: '', name: '' });
  };

  if (error) return <ErrorMessage error={error as Error} />;

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">{t('title')}</h1>
          <p className="page-subtitle">{t('subtitle')}</p>
        </div>
        <div className="action-group">
          <button className="btn btn-primary" onClick={() => navigate('/roles/create')}>
            {t('newRole')}
          </button>
        </div>
      </div>

      <div className="filter-bar">
        <input
          className="input"
          type="text"
          placeholder={t('filters.searchPlaceholder')}
          value={search}
          onChange={e => { setSearch(e.target.value); setPage(1); }}
          style={{ minWidth: '200px' }}
        />
        <select className="select" value={modeFilter} onChange={e => { setModeFilter(e.target.value); setPage(1); }}>
          <option value="">{t('filters.allModes')}</option>
          <option value="autonomous">{t('filters.autonomous')}</option>
          <option value="copilot">{t('filters.copilot')}</option>
        </select>
        <select className="select" value={deptFilter} onChange={e => { setDeptFilter(e.target.value); setPage(1); }}>
          <option value="">All Departments</option>
          {KNOWN_DEPARTMENTS.map(d => (
            <option key={d} value={d}>{d}</option>
          ))}
        </select>
        <span className="text-muted" style={{ fontSize: '0.875rem' }}>
          {filtered.length} role{filtered.length !== 1 ? 's' : ''}
        </span>
      </div>

      <DataTable
        columns={columns as never}
        data={filtered as never}
        loading={isLoading}
        rowKey="id"
      />

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1rem 0' }}>
        <span className="text-muted text-sm">
          {total === 0
            ? 'No roles found'
            : `Showing ${rangeStart}–${rangeEnd} of ${total} roles`}
        </span>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            className="btn btn-sm btn-default"
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page <= 1}
          >
            ← Prev
          </button>
          <span style={{ padding: '4px 12px', fontSize: 13 }}>Page {page}</span>
          <button
            className="btn btn-sm btn-default"
            onClick={() => setPage(p => p + 1)}
            disabled={!rolesData?.pagination || page * PAGE_SIZE >= rolesData.pagination.total}
          >
            Next →
          </button>
        </div>
      </div>

      {/* Clone Modal */}
      <Modal
        open={cloneModal.open}
        onClose={() => setCloneModal({ open: false, sourceId: '', sourceName: '' })}
        title={t('cloneModal.title', { name: cloneModal.sourceName })}
        footer={
          <div className="modal-footer-actions">
            <button
              className="btn btn-default"
              onClick={() => setCloneModal({ open: false, sourceId: '', sourceName: '' })}
            >
              Cancel
            </button>
            <button
              className="btn btn-primary"
              onClick={handleClone}
              disabled={!newId.trim() || !newDisplayName.trim() || cloneRole.isPending}
            >
              {cloneRole.isPending ? t('cloneModal.cloning') : t('cloneModal.button')}
            </button>
          </div>
        }
      >
        <div className="form-group">
          <label className="form-label">{t('cloneModal.newId')}</label>
          <input
            className="input"
            type="text"
            value={newId}
            onChange={e => setNewId(e.target.value)}
            placeholder={t('cloneModal.newIdPlaceholder')}
          />
        </div>
        <div className="form-group">
          <label className="form-label">{t('cloneModal.newName')}</label>
          <input
            className="input"
            type="text"
            value={newDisplayName}
            onChange={e => setNewDisplayName(e.target.value)}
            placeholder={t('cloneModal.newNamePlaceholder')}
          />
        </div>
        {cloneRole.error && <ErrorMessage error={cloneRole.error as Error} />}
      </Modal>

      {/* Delete Modal */}
      <Modal
        open={deleteModal.open}
        onClose={() => setDeleteModal({ open: false, id: '', name: '' })}
        title={t('deleteModal.title', { name: deleteModal.name })}
        footer={
          <div className="modal-footer-actions">
            <button
              className="btn btn-default"
              onClick={() => setDeleteModal({ open: false, id: '', name: '' })}
            >
              Cancel
            </button>
            <button
              className="btn btn-danger"
              onClick={handleDelete}
              disabled={deleteRole.isPending}
            >
              {deleteRole.isPending ? t('deleteModal.deleting') : t('deleteModal.button')}
            </button>
          </div>
        }
      >
        <p>
          Permanently delete <strong>{deleteModal.name}</strong> (<span className="mono">{deleteModal.id}</span>)?
          Employees currently assigned this role will become unassigned.
        </p>
        {deleteRole.error && <ErrorMessage error={deleteRole.error as Error} />}
      </Modal>
    </div>
  );
}
