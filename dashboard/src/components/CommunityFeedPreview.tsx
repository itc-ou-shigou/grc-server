import { useNavigate } from 'react-router-dom';
import { useCommunityFeed } from '../api/hooks';

// ── helpers ───────────────────────────────────────────────────────────────────

type BadgeVariant = 'problem' | 'solution' | 'alert' | 'evolution' | 'experience' | 'discussion';

const TYPE_STYLES: Record<BadgeVariant, { bg: string; color: string }> = {
  problem:    { bg: 'var(--color-danger-bg)',   color: '#ef4444' },
  solution:   { bg: 'var(--color-success-bg)',  color: '#4ade80' },
  alert:      { bg: 'var(--color-warning-bg)',  color: '#ffbe0b' },
  evolution:  { bg: 'var(--color-info-bg)',     color: '#00E5FF' },
  experience: { bg: 'rgba(178, 135, 254, 0.12)', color: '#b287fe' },
  discussion: { bg: 'rgba(66, 72, 89, 0.20)',   color: 'rgba(224, 229, 251, 0.70)' },
};

function typeStyle(type: string) {
  return TYPE_STYLES[type as BadgeVariant] ?? TYPE_STYLES.discussion;
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1)  return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

// ── component ─────────────────────────────────────────────────────────────────

interface CommunityFeedPreviewProps {
  /** Number of posts to display. Defaults to 5. */
  limit?: number;
  /** Feed sort mode. Defaults to 'hot' to show trending content. */
  sort?: 'hot' | 'new' | 'top' | 'relevant';
}

export function CommunityFeedPreview({ limit = 5, sort = 'hot' }: CommunityFeedPreviewProps) {
  const navigate = useNavigate();
  const { data, isLoading } = useCommunityFeed({ sort, limit });
  const posts = data?.data ?? [];

  return (
    <div className="card" style={{ marginTop: 16, padding: 0, overflow: 'hidden' }}>
      {/* Card header */}
      <div style={{
        padding: '14px 20px',
        borderBottom: '1px solid var(--color-border)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '16px' }}>💬</span>
          <span style={{ fontWeight: 700, fontSize: '14px', color: 'var(--color-text)' }}>
            Community Feed
          </span>
          <span style={{
            fontSize: '11px',
            color: 'var(--color-text-muted)',
            background: 'var(--color-border-light)',
            padding: '1px 6px',
            borderRadius: '10px',
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
          }}>
            {sort}
          </span>
        </div>
        <button
          onClick={() => navigate('/community/topics')}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            fontSize: '12px',
            color: 'var(--color-primary)',
            fontWeight: 600,
            padding: '4px 8px',
            borderRadius: 'var(--radius-sm)',
          }}
        >
          View all
        </button>
      </div>

      {/* Loading state */}
      {isLoading && (
        <div style={{
          padding: '32px',
          textAlign: 'center',
          color: 'var(--color-text-muted)',
          fontSize: '13px',
        }}>
          Loading community posts...
        </div>
      )}

      {/* Empty state */}
      {!isLoading && posts.length === 0 && (
        <div style={{
          padding: '32px',
          textAlign: 'center',
          color: 'var(--color-text-muted)',
          fontSize: '13px',
        }}>
          <div style={{ fontSize: '24px', marginBottom: '8px' }}>🌱</div>
          No community posts yet. Be the first to start a discussion!
        </div>
      )}

      {/* Post rows */}
      {!isLoading && posts.map((post, idx) => {
        const ts = typeStyle(post.postType);
        const isLast = idx === posts.length - 1;

        return (
          <button
            key={post.id}
            onClick={() => navigate(`/community/topics/${post.id}`)}
            style={{
              display: 'block',
              width: '100%',
              textAlign: 'left',
              background: 'none',
              border: 'none',
              borderBottom: isLast ? 'none' : '1px solid var(--color-border-light)',
              padding: '12px 20px',
              cursor: 'pointer',
              transition: 'background var(--transition)',
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background = 'var(--color-primary-light)';
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background = 'none';
            }}
          >
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
              {/* Score pill */}
              <div style={{
                flexShrink: 0,
                width: '38px',
                textAlign: 'center',
                paddingTop: '2px',
              }}>
                <div style={{
                  fontSize: '14px',
                  fontWeight: 700,
                  color: post.score >= 0 ? 'var(--color-success)' : 'var(--color-danger)',
                  lineHeight: 1,
                }}>
                  {post.score >= 0 ? '+' : ''}{Math.round(post.score)}
                </div>
                <div style={{ fontSize: '10px', color: 'var(--color-text-muted)', marginTop: '1px' }}>
                  score
                </div>
              </div>

              {/* Main content */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px', flexWrap: 'wrap' }}>
                  {/* Type badge */}
                  <span style={{
                    display: 'inline-block',
                    padding: '1px 7px',
                    borderRadius: '10px',
                    fontSize: '10px',
                    fontWeight: 700,
                    textTransform: 'capitalize',
                    letterSpacing: '0.03em',
                    background: ts.bg,
                    color: ts.color,
                  }}>
                    {post.postType}
                  </span>

                  {/* Pinned indicator */}
                  {Number(post.isPinned) === 1 && (
                    <span style={{ fontSize: '11px', color: 'var(--color-warning)' }} title="Pinned">
                      📌
                    </span>
                  )}

                  {/* Distilled indicator */}
                  {Number(post.isDistilled) === 1 && (
                    <span style={{ fontSize: '11px', color: 'var(--color-info)' }} title="Knowledge Distilled">
                      ✨
                    </span>
                  )}
                </div>

                {/* Title */}
                <div style={{
                  fontSize: '13px',
                  fontWeight: 600,
                  color: 'var(--color-text)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  marginBottom: '4px',
                }}>
                  {post.title}
                </div>

                {/* Meta row */}
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  fontSize: '11px',
                  color: 'var(--color-text-muted)',
                }}>
                  <span>
                    💬 {post.replyCount} {post.replyCount === 1 ? 'reply' : 'replies'}
                  </span>
                  <span>
                    ▲ {post.upvotes} / ▼ {post.downvotes}
                  </span>
                  <span style={{ marginLeft: 'auto' }}>
                    {relativeTime(post.createdAt)}
                  </span>
                </div>
              </div>
            </div>
          </button>
        );
      })}

      {/* Footer CTA */}
      {!isLoading && posts.length > 0 && (
        <div style={{
          padding: '10px 20px',
          borderTop: '1px solid var(--color-border)',
          display: 'flex',
          justifyContent: 'center',
        }}>
          <button
            onClick={() => navigate('/community/topics')}
            className="btn btn-default"
            style={{ fontSize: '12px', padding: '5px 16px' }}
          >
            Explore all posts
          </button>
        </div>
      )}
    </div>
  );
}
