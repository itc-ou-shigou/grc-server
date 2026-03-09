import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DataTable, Column } from '../../components/DataTable';
import { StatusBadge } from '../../components/StatusBadge';
import { Chart } from '../../components/Chart';
import { Modal } from '../../components/Modal';
import { ErrorMessage } from '../../components/ErrorMessage';
import { useUsers, useAuthStats, useChangeTier, useBanUser, User } from '../../api/hooks';

const TIERS = ['free', 'contributor', 'pro'];
const PROVIDERS = ['local', 'google', 'github', 'microsoft'];

export function Users() {
  const { t } = useTranslation('users');
  const [page, setPage] = useState(1);
  const [provider, setProvider] = useState('');
  const [tier, setTier] = useState('');
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [tierModal, setTierModal] = useState<{ user: User; newTier: string } | null>(null);
  const [banModal, setBanModal] = useState<User | null>(null);

  const { data, isLoading, error } = useUsers({ page, page_size: 20, provider: provider || undefined, tier: tier || undefined, search: search || undefined });
  const { data: stats } = useAuthStats();
  const changeTier = useChangeTier();
  const banUser = useBanUser();

  const tierDistData = stats
    ? Object.entries(stats.stats.tierDistribution).map(([name, value]) => ({ name, value }))
    : [];

  const columns: Column<Record<string, unknown>>[] = [
    { key: 'id', label: 'ID', render: (v) => <span className="mono text-sm">{String(v).slice(0, 8)}…</span> },
    { key: 'displayName', label: t('table.displayName') },
    { key: 'email', label: t('table.email') },
    {
      key: 'provider',
      label: t('table.provider'),
      render: (v) => <StatusBadge status={String(v)} variant="info" />,
    },
    {
      key: 'tier',
      label: t('table.tier'),
      render: (v) => (
        <StatusBadge
          status={String(v)}
          variant={v === 'pro' ? 'success' : v === 'contributor' ? 'info' : 'default'}
        />
      ),
    },
    {
      key: 'role',
      label: t('table.role'),
      render: (v) => <StatusBadge status={v === 'banned' ? 'Banned' : 'Active'} />,
    },
    {
      key: 'createdAt',
      label: t('table.joined'),
      render: (v) => new Date(String(v)).toLocaleDateString(),
    },
    {
      key: 'actions',
      label: 'Actions',
      render: (_, row) => {
        const user = row as unknown as User;
        const isBanned = user.role === 'banned';
        return (
          <div className="action-group">
            <select
              className="select-sm"
              value={user.tier}
              onChange={(e) => setTierModal({ user, newTier: e.target.value })}
            >
              {TIERS.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
            <button
              className={`btn btn-sm ${isBanned ? 'btn-default' : 'btn-danger'}`}
              onClick={() => setBanModal(user)}
            >
              {isBanned ? t('unban') : 'Ban'}
            </button>
          </div>
        );
      },
    },
  ];

  async function handleTierChange() {
    if (!tierModal) return;
    await changeTier.mutateAsync({ userId: tierModal.user.id, tier: tierModal.newTier });
    setTierModal(null);
  }

  async function handleBanToggle() {
    if (!banModal) return;
    const isBanned = banModal.role === 'banned';
    await banUser.mutateAsync({ userId: banModal.id, ban: !isBanned });
    setBanModal(null);
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">{t('title')}</h1>
        <p className="page-subtitle">{t('subtitle')}</p>
      </div>

      {tierDistData.length > 0 && (
        <div className="card" style={{ marginBottom: 20 }}>
          <Chart
            type="pie"
            data={tierDistData}
            nameKey="name"
            valueKey="value"
            title="Users by Tier"
            height={200}
          />
        </div>
      )}

      {error && <ErrorMessage error={error as Error} />}

      <div className="card">
        <div className="filter-bar">
          <input
            className="input"
            placeholder={t('filters.searchPlaceholder')}
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                setSearch(searchInput);
                setPage(1);
              }
            }}
          />
          <select className="select" value={provider} onChange={(e) => { setProvider(e.target.value); setPage(1); }}>
            <option value="">{t('filters.allProviders')}</option>
            {PROVIDERS.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
          <select className="select" value={tier} onChange={(e) => { setTier(e.target.value); setPage(1); }}>
            <option value="">{t('filters.allTiers')}</option>
            {TIERS.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <button className="btn btn-primary" onClick={() => { setSearch(searchInput); setPage(1); }}>
            Search
          </button>
        </div>

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
        />
      </div>

      <Modal
        open={!!tierModal}
        onClose={() => setTierModal(null)}
        title={t('tierModal.title', { name: tierModal?.user.email ?? '' })}
        footer={
          <div className="modal-footer-actions">
            <button className="btn btn-default" onClick={() => setTierModal(null)}>Cancel</button>
            <button
              className="btn btn-primary"
              onClick={handleTierChange}
              disabled={changeTier.isPending}
            >
              {changeTier.isPending ? t('tierModal.updating') : 'Confirm'}
            </button>
          </div>
        }
      >
        {tierModal && (
          <p>
            Change <strong>{tierModal.user.email}</strong> from{' '}
            <strong>{tierModal.user.tier}</strong> to <strong>{tierModal.newTier}</strong>?
          </p>
        )}
      </Modal>

      <Modal
        open={!!banModal}
        onClose={() => setBanModal(null)}
        title={banModal?.role === 'banned' ? t('unban') : t('banModal.title', { name: banModal?.email ?? '' })}
        footer={
          <div className="modal-footer-actions">
            <button className="btn btn-default" onClick={() => setBanModal(null)}>Cancel</button>
            <button
              className={`btn ${banModal?.role === 'banned' ? 'btn-primary' : 'btn-danger'}`}
              onClick={handleBanToggle}
              disabled={banUser.isPending}
            >
              {banUser.isPending ? t('banModal.banning') : banModal?.role === 'banned' ? t('unban') : t('banModal.button')}
            </button>
          </div>
        }
      >
        {banModal && (
          <p>
            {banModal.role === 'banned' ? t('unban') : 'Ban'} user <strong>{banModal.email}</strong>?
            {banModal.role !== 'banned' && (
              <span> This will prevent them from accessing the platform.</span>
            )}
          </p>
        )}
      </Modal>
    </div>
  );
}
