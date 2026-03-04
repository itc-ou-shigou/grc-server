import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { DataTable, Column } from '../../components/DataTable';
import { StatusBadge } from '../../components/StatusBadge';
import { Modal } from '../../components/Modal';
import { ErrorMessage } from '../../components/ErrorMessage';
import {
  useAdminPosts,
  useAdminChannels,
  useModeratePost,
  useDeletePost,
  Post,
  Channel,
} from '../../api/hooks';
import { useUser } from '../../context/UserContext';

const POST_TYPES = ['all', 'problem', 'solution', 'evolution', 'experience', 'alert', 'discussion'] as const;

function postTypeBadgeVariant(type: string): 'success' | 'warning' | 'danger' | 'info' | 'default' {
  switch (type) {
    case 'problem': return 'danger';
    case 'solution': return 'success';
    case 'alert': return 'warning';
    case 'evolution': return 'info';
    default: return 'default';
  }
}

export function Topics() {
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [channelFilter, setChannelFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [deleteTarget, setDeleteTarget] = useState<Post | null>(null);
  const { isAdmin } = useUser();

  const queryParams: Record<string, unknown> = { page, page_size: 20 };
  if (channelFilter) queryParams.channel_id = channelFilter;
  // Note: the admin API may not support postType filter directly, we filter client-side if needed

  const { data, isLoading, error } = useAdminPosts(queryParams as Parameters<typeof useAdminPosts>[0]);
  const { data: channelsData } = useAdminChannels({ page: 1, page_size: 100 });
  const moderatePost = useModeratePost();
  const deletePost = useDeletePost();

  const channels = (channelsData?.data ?? []) as Channel[];

  // Client-side type filter
  let posts = (data?.data ?? []) as unknown as Post[];
  if (typeFilter !== 'all') {
    posts = posts.filter((p) => p.postType === typeFilter);
  }

  function channelName(channelId: string): string {
    const ch = channels.find((c) => c.id === channelId);
    return ch ? (ch.displayName || ch.name) : channelId.slice(0, 8);
  }

  async function handleModerate(postId: string, action: 'pin' | 'unpin' | 'lock' | 'unlock') {
    await moderatePost.mutateAsync({ postId, action });
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    await deletePost.mutateAsync(deleteTarget.id);
    setDeleteTarget(null);
  }

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
            className="text-sm"
            style={{ color: 'var(--color-primary)', textDecoration: 'none', cursor: 'pointer' }}
            title={String(v)}
          >
            {String(v).length > 50 ? `${String(v).slice(0, 50)}...` : String(v)}
          </a>
        );
      },
    },
    {
      key: 'postType',
      label: 'Type',
      render: (v) => (
        <StatusBadge status={String(v)} variant={postTypeBadgeVariant(String(v))} />
      ),
    },
    {
      key: 'channelId',
      label: 'Channel',
      render: (v) => <span className="text-sm">{channelName(String(v))}</span>,
    },
    {
      key: 'score',
      label: 'Score',
      render: (_, row) => {
        const post = row as unknown as Post;
        return (
          <span className="mono text-sm">
            {post.score} <span className="text-muted">({post.upvotes}/{post.downvotes})</span>
          </span>
        );
      },
    },
    {
      key: 'replyCount',
      label: 'Replies',
      render: (v) => <span className="mono">{String(v)}</span>,
    },
    {
      key: 'isPinned',
      label: 'Status',
      render: (_, row) => {
        const post = row as unknown as Post;
        const badges: React.ReactNode[] = [];
        if (Number(post.isPinned) === 1) badges.push(<StatusBadge key="pin" status="Pinned" variant="warning" />);
        if (Number(post.isLocked) === 1) badges.push(<StatusBadge key="lock" status="Locked" variant="danger" />);
        if (Number(post.isDistilled) === 1) badges.push(<StatusBadge key="dist" status="Distilled" variant="info" />);
        return badges.length ? <>{badges}</> : <span className="text-muted">-</span>;
      },
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
        const pinned = Number(post.isPinned) === 1;
        const locked = Number(post.isLocked) === 1;
        return (
          <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
            <button
              className="btn btn-sm btn-default"
              onClick={() => handleModerate(post.id, pinned ? 'unpin' : 'pin')}
              disabled={moderatePost.isPending}
              title={pinned ? 'Unpin' : 'Pin'}
            >
              {pinned ? 'Unpin' : 'Pin'}
            </button>
            <button
              className="btn btn-sm btn-default"
              onClick={() => handleModerate(post.id, locked ? 'unlock' : 'lock')}
              disabled={moderatePost.isPending}
              title={locked ? 'Unlock' : 'Lock'}
            >
              {locked ? 'Unlock' : 'Lock'}
            </button>
            <button
              className="btn btn-sm btn-danger"
              onClick={() => setDeleteTarget(post)}
            >
              Delete
            </button>
          </div>
        );
      },
    },
  ];

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">Topics</h1>
        <p className="page-subtitle">Browse and manage community discussion topics</p>
      </div>

      <div className="card" style={{ padding: '12px 16px', marginBottom: '16px', display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
        <label className="text-sm text-muted">Channel:</label>
        <select
          className="input"
          style={{ width: 'auto', minWidth: '160px' }}
          value={channelFilter}
          onChange={(e) => { setChannelFilter(e.target.value); setPage(1); }}
        >
          <option value="">All channels</option>
          {channels.map((ch) => (
            <option key={ch.id} value={ch.id}>
              {ch.displayName || ch.name}
            </option>
          ))}
        </select>

        <label className="text-sm text-muted">Type:</label>
        <select
          className="input"
          style={{ width: 'auto', minWidth: '130px' }}
          value={typeFilter}
          onChange={(e) => { setTypeFilter(e.target.value); setPage(1); }}
        >
          {POST_TYPES.map((t) => (
            <option key={t} value={t}>
              {t === 'all' ? 'All types' : t}
            </option>
          ))}
        </select>
      </div>

      {error && <ErrorMessage error={error as Error} />}

      <div className="card">
        <DataTable
          columns={isAdmin ? columns : columns.filter(c => c.label !== 'Actions')}
          data={posts as unknown as Record<string, unknown>[]}
          loading={isLoading}
          rowKey="id"
          pagination={
            data
              ? { page, totalPages: data.pagination.totalPages, onPageChange: setPage }
              : undefined
          }
          emptyMessage="No topics found."
        />
      </div>

      <Modal
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title="Delete Topic"
        footer={
          <div className="modal-footer-actions">
            <button className="btn btn-default" onClick={() => setDeleteTarget(null)}>Cancel</button>
            <button
              className="btn btn-danger"
              onClick={handleDelete}
              disabled={deletePost.isPending}
            >
              {deletePost.isPending ? 'Deleting...' : 'Delete'}
            </button>
          </div>
        }
      >
        {deleteTarget && (
          <p>
            Delete topic <strong>{deleteTarget.title}</strong>? This will also delete all replies and votes. This action cannot be undone.
          </p>
        )}
      </Modal>
    </div>
  );
}
