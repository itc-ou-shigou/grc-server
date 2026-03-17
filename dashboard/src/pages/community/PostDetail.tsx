import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { DataTable, Column } from '../../components/DataTable';
import { StatusBadge } from '../../components/StatusBadge';
import { Modal } from '../../components/Modal';
import { ErrorMessage } from '../../components/ErrorMessage';
import {
  useAdminPostDetail,
  useAdminChannels,
  useModeratePost,
  useDeletePost,
  useDeleteReply,
  useModerateReply,
  useCreateCommunityReply,
  useVoteCommunityPost,
  Post,
  Reply,
  Channel,
} from '../../api/hooks';
import { useUser } from '../../context/UserContext';

function postTypeBadgeVariant(type: string): 'success' | 'warning' | 'danger' | 'info' | 'default' {
  switch (type) {
    case 'problem': return 'danger';
    case 'solution': return 'success';
    case 'alert': return 'warning';
    case 'evolution': return 'info';
    default: return 'default';
  }
}

export function PostDetail() {
  const { t } = useTranslation('community');
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [replyPage, setReplyPage] = useState(1);
  const [deletePostModal, setDeletePostModal] = useState(false);
  const [deleteReplyTarget, setDeleteReplyTarget] = useState<Reply | null>(null);
  const [modAction, setModAction] = useState<{ action: 'hide' | 'lock' | 'unlock' | 'pin' | 'unpin' } | null>(null);
  const [replyContent, setReplyContent] = useState('');

  const { isAdmin } = useUser();
  const createReply = useCreateCommunityReply();
  const votePost = useVoteCommunityPost();
  const { data, isLoading, error } = useAdminPostDetail(id ?? '', { page: replyPage, page_size: 20 });
  const { data: channelsData } = useAdminChannels({ page: 1, page_size: 100 });
  const moderatePost = useModeratePost();
  const deletePost = useDeletePost();
  const deleteReply = useDeleteReply();
  const moderateReply = useModerateReply();

  const post = data?.data as Post | undefined;
  const replies = (data?.replies?.data ?? []) as Reply[];
  const replyPagination = data?.replies?.pagination;
  const channels = (channelsData?.data ?? []) as Channel[];

  function channelName(channelId: string): string {
    const ch = channels.find((c) => c.id === channelId);
    return ch ? (ch.displayName || ch.name) : channelId.slice(0, 8) + '...';
  }

  async function handleModeratePost() {
    if (!post || !modAction) return;
    await moderatePost.mutateAsync({ postId: post.id, action: modAction.action });
    setModAction(null);
  }

  async function handleDeletePost() {
    if (!post) return;
    await deletePost.mutateAsync(post.id);
    navigate('/community/topics');
  }

  async function handleDeleteReply() {
    if (!deleteReplyTarget || !post) return;
    await deleteReply.mutateAsync({ postId: post.id, replyId: deleteReplyTarget.id });
    setDeleteReplyTarget(null);
  }

  async function handleToggleSolution(reply: Reply) {
    if (!post) return;
    const action = Number(reply.isSolution) === 1 ? 'unmarkSolution' : 'markSolution';
    await moderateReply.mutateAsync({ postId: post.id, replyId: reply.id, action });
  }

  if (error) {
    return (
      <div className="page">
        <ErrorMessage error={error as Error} />
        <button className="btn btn-default" style={{ marginTop: '16px' }} onClick={() => navigate('/community/topics')}>
          {t('postDetail.backToTopics')}
        </button>
      </div>
    );
  }

  if (isLoading || !post) {
    return (
      <div className="page">
        <div className="page-header">
          <h1 className="page-title">Loading...</h1>
        </div>
      </div>
    );
  }

  const isPinned = Number(post.isPinned) === 1;
  const isLocked = Number(post.isLocked) === 1;
  const isDistilled = Number(post.isDistilled) === 1;
  const isHidden = post.score <= -999;

  const replyColumns: Column<Record<string, unknown>>[] = [
    {
      key: 'authorId',
      label: 'Author',
      render: (v) => <span className="mono text-sm">{String(v).slice(0, 12)}...</span>,
    },
    {
      key: 'body',
      label: 'Content',
      render: (v) => (
        <span className="text-sm" title={String(v)}>
          {String(v).length > 120 ? `${String(v).slice(0, 120)}...` : String(v)}
        </span>
      ),
    },
    {
      key: 'isSolution',
      label: 'Solution',
      render: (v) =>
        Number(v) === 1 ? (
          <StatusBadge status="Solution" variant="success" />
        ) : (
          <span className="text-muted">-</span>
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
        const reply = row as unknown as Reply;
        const isSol = Number(reply.isSolution) === 1;
        return (
          <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
            <button
              className={`btn btn-sm ${isSol ? 'btn-default' : 'btn-primary'}`}
              onClick={() => handleToggleSolution(reply)}
              disabled={moderateReply.isPending}
            >
              {isSol ? 'Unmark' : 'Mark Solution'}
            </button>
            <button
              className="btn btn-sm btn-danger"
              onClick={() => setDeleteReplyTarget(reply)}
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
      {/* Back navigation */}
      <div style={{ marginBottom: '16px' }}>
        <button
          className="btn btn-sm btn-default"
          onClick={() => navigate('/community/topics')}
        >
          &larr; {t('postDetail.backToTopics')}
        </button>
      </div>

      {/* Post header */}
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <StatusBadge status={post.postType} variant={postTypeBadgeVariant(post.postType)} />
          <h1 className="page-title" style={{ margin: 0 }}>{post.title}</h1>
        </div>
      </div>

      {/* Post metadata */}
      <div className="card" style={{ padding: '16px', marginBottom: '16px' }}>
        <div style={{ display: 'flex', gap: '24px', flexWrap: 'wrap', fontSize: '14px' }}>
          <div>
            <span className="text-muted">Channel: </span>
            <strong>{channelName(post.channelId)}</strong>
          </div>
          <div>
            <span className="text-muted">Author: </span>
            <span className="mono">{post.authorId.slice(0, 12)}...</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span className="text-muted">Score: </span>
            <span className={post.score >= 0 ? 'text-success' : 'text-danger'}>
              {post.score >= 0 ? '+' : ''}{post.score}
            </span>
            <span className="text-muted"> ({post.upvotes}/{post.downvotes})</span>
            <button
              className="btn btn-sm btn-default"
              onClick={() => votePost.mutate({ postId: post.id, direction: 'upvote' })}
              disabled={votePost.isPending}
              title="Upvote"
              style={{ padding: '2px 8px', fontSize: '14px' }}
            >
              👍
            </button>
            <button
              className="btn btn-sm btn-default"
              onClick={() => votePost.mutate({ postId: post.id, direction: 'downvote' })}
              disabled={votePost.isPending}
              title="Downvote"
              style={{ padding: '2px 8px', fontSize: '14px' }}
            >
              👎
            </button>
          </div>
          <div>
            <span className="text-muted">{t('postDetail.replies')}: </span>
            <strong>{post.replyCount}</strong>
          </div>
          <div>
            <span className="text-muted">Created: </span>
            {new Date(post.createdAt).toLocaleString()}
          </div>
        </div>

        <div style={{ display: 'flex', gap: '6px', marginTop: '12px', flexWrap: 'wrap' }}>
          {isPinned && <StatusBadge status="Pinned" variant="warning" />}
          {isLocked && <StatusBadge status="Locked" variant="danger" />}
          {isDistilled && <StatusBadge status="Distilled" variant="info" />}
          {isHidden && <StatusBadge status="Hidden" variant="danger" />}
        </div>
      </div>

      {/* Post body */}
      <div className="card" style={{ padding: '16px', marginBottom: '16px' }}>
        <h3 style={{ marginTop: 0, marginBottom: '12px', fontSize: '14px', color: 'var(--color-text-muted)' }}>
          Content
        </h3>
        <div style={{ whiteSpace: 'pre-wrap', fontSize: '14px', lineHeight: '1.6' }}>
          {(post as unknown as Record<string, unknown>).body as string ?? (post as unknown as Record<string, unknown>).content as string ?? '(No content)'}
        </div>
      </div>

      {/* Replies section */}
      <div className="card" style={{ marginBottom: '16px' }}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--color-border)' }}>
          <h3 style={{ margin: 0, fontSize: '14px' }}>
            {t('postDetail.replies')} ({replyPagination?.total ?? replies.length})
          </h3>
        </div>
        <DataTable
          columns={isAdmin ? replyColumns : replyColumns.filter(c => c.label !== 'Actions')}
          data={replies as unknown as Record<string, unknown>[]}
          loading={isLoading}
          rowKey="id"
          pagination={
            replyPagination
              ? { page: replyPage, totalPages: replyPagination.totalPages, onPageChange: setReplyPage }
              : undefined
          }
          emptyMessage={t('postDetail.noReplies')}
        />
      </div>

      {/* Reply input (unless locked) */}
      {!isLocked && (
        <div className="card" style={{ padding: '16px', marginBottom: '16px' }}>
          <h3 style={{ marginTop: 0, marginBottom: '12px', fontSize: '14px', color: 'var(--color-text-muted)' }}>
            Write a Reply
          </h3>
          <textarea
            className="textarea"
            value={replyContent}
            onChange={e => setReplyContent(e.target.value)}
            placeholder="Write your reply here..."
            rows={4}
            style={{ width: '100%', fontFamily: 'var(--font-mono, monospace)', fontSize: '0.8125rem', resize: 'vertical', marginBottom: '8px' }}
          />
          <button
            className="btn btn-primary"
            onClick={async () => {
              if (!replyContent.trim()) return;
              await createReply.mutateAsync({ postId: post.id, content: replyContent });
              setReplyContent('');
            }}
            disabled={createReply.isPending || !replyContent.trim()}
          >
            {createReply.isPending ? 'Posting...' : 'Post Reply'}
          </button>
          {createReply.error && <ErrorMessage error={createReply.error as Error} />}
        </div>
      )}

      {/* Moderation actions (admin only) */}
      {isAdmin && (
        <div className="card" style={{ padding: '16px' }}>
          <h3 style={{ marginTop: 0, marginBottom: '12px', fontSize: '14px', color: 'var(--color-text-muted)' }}>
            Moderation
          </h3>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <button
              className="btn btn-default"
              onClick={() => setModAction({ action: isPinned ? 'unpin' : 'pin' })}
            >
              {isPinned ? 'Unpin' : 'Pin'}
            </button>
            <button
              className="btn btn-default"
              onClick={() => setModAction({ action: isLocked ? 'unlock' : 'lock' })}
            >
              {isLocked ? 'Unlock' : 'Lock'}
            </button>
            {!isHidden && (
              <button
                className="btn btn-default"
                onClick={() => setModAction({ action: 'hide' })}
              >
                Hide
              </button>
            )}
            <button
              className="btn btn-danger"
              onClick={() => setDeletePostModal(true)}
            >
              Delete Post
            </button>
          </div>
        </div>
      )}

      {/* Moderate post confirm modal */}
      <Modal
        open={!!modAction}
        onClose={() => setModAction(null)}
        title={`${modAction?.action ? modAction.action.charAt(0).toUpperCase() + modAction.action.slice(1) : ''} Post`}
        footer={
          <div className="modal-footer-actions">
            <button className="btn btn-default" onClick={() => setModAction(null)}>Cancel</button>
            <button
              className="btn btn-primary"
              onClick={handleModeratePost}
              disabled={moderatePost.isPending}
            >
              {moderatePost.isPending ? 'Processing...' : 'Confirm'}
            </button>
          </div>
        }
      >
        <p>
          {modAction?.action} this post: <strong>{post.title}</strong>?
        </p>
      </Modal>

      {/* Delete post confirm modal */}
      <Modal
        open={deletePostModal}
        onClose={() => setDeletePostModal(false)}
        title="Delete Post"
        footer={
          <div className="modal-footer-actions">
            <button className="btn btn-default" onClick={() => setDeletePostModal(false)}>Cancel</button>
            <button
              className="btn btn-danger"
              onClick={handleDeletePost}
              disabled={deletePost.isPending}
            >
              {deletePost.isPending ? 'Deleting...' : 'Delete'}
            </button>
          </div>
        }
      >
        <p>
          Delete post <strong>{post.title}</strong>? This will also delete all replies and votes.
          This action cannot be undone.
        </p>
      </Modal>

      {/* Delete reply confirm modal */}
      <Modal
        open={!!deleteReplyTarget}
        onClose={() => setDeleteReplyTarget(null)}
        title="Delete Reply"
        footer={
          <div className="modal-footer-actions">
            <button className="btn btn-default" onClick={() => setDeleteReplyTarget(null)}>Cancel</button>
            <button
              className="btn btn-danger"
              onClick={handleDeleteReply}
              disabled={deleteReply.isPending}
            >
              {deleteReply.isPending ? 'Deleting...' : 'Delete'}
            </button>
          </div>
        }
      >
        {deleteReplyTarget && (
          <p>
            Delete this reply by <strong>{deleteReplyTarget.authorId.slice(0, 12)}...</strong>?
            This action cannot be undone.
          </p>
        )}
      </Modal>
    </div>
  );
}
