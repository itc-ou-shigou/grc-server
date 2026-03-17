import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { DataTable, Column } from '../../components/DataTable';
import { StatusBadge } from '../../components/StatusBadge';
import { Modal } from '../../components/Modal';
import { ErrorMessage } from '../../components/ErrorMessage';
import { useAdminPosts, useModeratePost, useCommunityStats, Post } from '../../api/hooks';

type ModAction = 'hide' | 'lock' | 'unlock' | 'delete' | 'pin' | 'unpin';

export function Moderation() {
  const { t } = useTranslation('community');
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [channelId, setChannelId] = useState('');
  const [actionModal, setActionModal] = useState<{ post: Post; action: ModAction } | null>(null);

  const { data, isLoading, error } = useAdminPosts({ page, page_size: 20, channel_id: channelId || undefined });
  const { data: stats } = useCommunityStats();
  const moderatePost = useModeratePost();

  const columns: Column<Record<string, unknown>>[] = [
    {
      key: 'title',
      label: 'Title',
      render: (v, row) => {
        const post = row as unknown as Post;
        return (
          <a
            href={`/community/topics/${post.id}`}
            onClick={(e) => { e.preventDefault(); navigate(`/community/topics/${post.id}`); }}
            style={{ color: 'var(--color-primary)', textDecoration: 'none', cursor: 'pointer' }}
            title={String(v)}
          >
            {String(v).length > 50 ? String(v).slice(0, 50) + '...' : String(v)}
          </a>
        );
      },
    },
    {
      key: 'channelId',
      label: 'Channel',
      render: (v) => <span className="mono text-sm">{String(v).slice(0, 8)}…</span>,
    },
    {
      key: 'authorId',
      label: 'Author',
      render: (v) => <span className="mono text-sm">{String(v).slice(0, 8)}…</span>,
    },
    {
      key: 'score',
      label: 'Score',
      render: (v) => {
        const score = Number(v);
        return (
          <span className={score >= 0 ? 'text-success' : 'text-danger'}>
            {score >= 0 ? '+' : ''}{score}
          </span>
        );
      },
    },
    {
      key: 'postType',
      label: 'Type',
      render: (v) => <StatusBadge status={String(v)} variant="info" />,
    },
    {
      key: 'visibility',
      label: 'Visibility',
      render: (_v, row) => <StatusBadge status={Number(row.score) <= -999 ? 'Hidden' : 'Visible'} />,
    },
    {
      key: 'isLocked',
      label: 'Lock',
      render: (v) => Number(v) === 1 ? <StatusBadge status="Locked" variant="warning" /> : <span className="text-muted">—</span>,
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
        const post = row as unknown as Post;
        const isHidden = post.score <= -999;
        const isLocked = Number(post.isLocked) === 1;
        return (
          <div className="action-group">
            {!isHidden && (
              <button
                className="btn btn-sm btn-default"
                onClick={() => setActionModal({ post, action: 'hide' })}
              >
                Hide
              </button>
            )}
            <button
              className="btn btn-sm btn-default"
              onClick={() => setActionModal({ post, action: isLocked ? 'unlock' : 'lock' })}
            >
              {isLocked ? 'Unlock' : 'Lock'}
            </button>
            <button
              className="btn btn-sm btn-danger"
              onClick={() => setActionModal({ post, action: 'delete' })}
            >
              Delete
            </button>
          </div>
        );
      },
    },
  ];

  async function handleModerate() {
    if (!actionModal) return;
    await moderatePost.mutateAsync({ postId: actionModal.post.id, action: actionModal.action });
    setActionModal(null);
  }

  const actionLabel: Record<ModAction, string> = {
    hide: 'Hide',
    lock: 'Lock',
    unlock: 'Unlock',
    delete: 'Delete',
    pin: 'Pin',
    unpin: 'Unpin',
  };

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">{t('moderation.title')}</h1>
        <p className="page-subtitle">
          {t('moderation.subtitle')}
          {stats && stats.stats.dailyPosts > 0 && (
            <span className="page-subtitle-extra">
              {' — '}{stats.stats.dailyPosts} posts today
            </span>
          )}
        </p>
      </div>

      {error && <ErrorMessage error={error as Error} />}

      <div className="card">
        <div className="filter-bar">
          <input
            className="input"
            placeholder="Filter by channel ID…"
            value={channelId}
            onChange={(e) => { setChannelId(e.target.value); setPage(1); }}
          />
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
          emptyMessage={t('moderation.noFlags')}
        />
      </div>

      <Modal
        open={!!actionModal}
        onClose={() => setActionModal(null)}
        title={`${actionModal ? actionLabel[actionModal.action] : ''} Post`}
        footer={
          <div className="modal-footer-actions">
            <button className="btn btn-default" onClick={() => setActionModal(null)}>Cancel</button>
            <button
              className={`btn ${actionModal?.action === 'delete' ? 'btn-danger' : 'btn-primary'}`}
              onClick={handleModerate}
              disabled={moderatePost.isPending}
            >
              {moderatePost.isPending ? 'Processing…' : 'Confirm'}
            </button>
          </div>
        }
      >
        {actionModal && (
          <p>
            {actionLabel[actionModal.action]} post{' '}
            <strong>
              {actionModal.post.title.length > 60
                ? actionModal.post.title.slice(0, 60) + '…'
                : actionModal.post.title}
            </strong>
            ?
            {actionModal.action === 'delete' && (
              <span> This action cannot be undone.</span>
            )}
          </p>
        )}
      </Modal>
    </div>
  );
}
