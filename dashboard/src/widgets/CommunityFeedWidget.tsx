import { useNavigate } from 'react-router-dom';
import { useCommunityFeed, useCommunityStats } from '../api/hooks';

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

// ── skeleton loader ───────────────────────────────────────────────────────────

function SkeletonRow() {
  return (
    <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--color-border-light)' }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
        <div className="skeleton" style={{ width: 32, height: 32, borderRadius: 'var(--radius-md)', flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="skeleton" style={{ height: 12, width: '60%', marginBottom: 6, borderRadius: 3 }} />
          <div className="skeleton" style={{ height: 10, width: '40%', borderRadius: 3 }} />
        </div>
      </div>
    </div>
  );
}

// ── component ─────────────────────────────────────────────────────────────────

interface CommunityFeedWidgetProps {
  title?: string;
  limit?: number;
  sort?: 'hot' | 'new' | 'top' | 'relevant';
}

export function CommunityFeedWidget({
  title = 'Community Feed',
  limit = 5,
  sort = 'hot',
}: CommunityFeedWidgetProps) {
  const navigate = useNavigate();
  const feed = useCommunityFeed({ sort, limit });
  const stats = useCommunityStats();

  const posts = feed.data?.data ?? [];

  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden', height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div style={{
        padding: '12px 16px',
        borderBottom: '1px solid var(--color-border)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 15 }}>💬</span>
          <span style={{ fontWeight: 700, fontSize: 13, color: 'var(--color-text)' }}>{title}</span>
          <span style={{
            fontSize: 10,
            color: 'var(--color-text-muted)',
            background: 'var(--color-border-light)',
            padding: '1px 6px',
            borderRadius: 10,
            fontWeight: 600,
            textTransform: 'uppercase' as const,
            letterSpacing: '0.04em',
          }}>
            {sort}
          </span>
          {(stats.data?.stats.dailyPosts ?? 0) > 0 && (
            <span style={{
              fontSize: 11,
              fontWeight: 600,
              padding: '2px 7px',
              borderRadius: 20,
              background: 'var(--color-success-bg)',
              color: '#059669',
              whiteSpace: 'nowrap' as const,
            }}>
              {stats.data!.stats.dailyPosts} today
            </span>
          )}
        </div>
        <button
          onClick={() => navigate('/community/topics')}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            fontSize: 12,
            color: 'var(--color-primary)',
            fontWeight: 600,
            padding: '3px 6px',
            borderRadius: 'var(--radius-sm)',
          }}
        >
          View all
        </button>
      </div>

      {/* Post list */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {feed.isLoading && (
          <>
            <SkeletonRow />
            <SkeletonRow />
            <SkeletonRow />
          </>
        )}

        {!feed.isLoading && posts.length === 0 && (
          <div style={{
            padding: '24px 16px',
            textAlign: 'center',
            color: 'var(--color-text-muted)',
            fontSize: 13,
          }}>
            <div style={{ fontSize: 24, marginBottom: 8 }}>🌱</div>
            No posts yet — start a discussion!
          </div>
        )}

        {!feed.isLoading && posts.map((post, idx) => {
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
                padding: '10px 16px',
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
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                {/* Score column */}
                <div style={{ flexShrink: 0, width: 32, textAlign: 'center', paddingTop: 2 }}>
                  <div style={{
                    fontSize: 13,
                    fontWeight: 700,
                    color: post.score >= 0 ? 'var(--color-success)' : 'var(--color-danger)',
                    lineHeight: 1,
                  }}>
                    {post.score >= 0 ? '+' : ''}{Math.round(post.score)}
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--color-text-muted)', marginTop: 1 }}>pts</div>
                </div>

                {/* Content */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 3 }}>
                    <span style={{
                      display: 'inline-block',
                      padding: '1px 6px',
                      borderRadius: 10,
                      fontSize: 10,
                      fontWeight: 700,
                      textTransform: 'capitalize' as const,
                      background: ts.bg,
                      color: ts.color,
                    }}>
                      {post.postType}
                    </span>
                    {Number(post.isPinned) === 1 && (
                      <span style={{ fontSize: 10 }} title="Pinned">📌</span>
                    )}
                    {Number(post.isDistilled) === 1 && (
                      <span style={{ fontSize: 10 }} title="Distilled">✨</span>
                    )}
                    <span style={{ fontSize: 10, color: 'var(--color-text-muted)', marginLeft: 'auto' }}>
                      {relativeTime(post.createdAt)}
                    </span>
                  </div>

                  <div style={{
                    fontSize: 12,
                    fontWeight: 600,
                    color: 'var(--color-text)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap' as const,
                    marginBottom: 3,
                  }}>
                    {post.title}
                  </div>

                  <div style={{
                    fontSize: 11,
                    color: 'var(--color-text-muted)',
                    display: 'flex',
                    gap: 10,
                  }}>
                    <span>💬 {post.replyCount}</span>
                    <span>▲ {post.upvotes} ▼ {post.downvotes}</span>
                  </div>
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {/* Footer */}
      {!feed.isLoading && posts.length > 0 && (
        <div style={{
          padding: '8px 16px',
          borderTop: '1px solid var(--color-border)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexShrink: 0,
        }}>
          <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
            {stats.data?.stats.totalPosts.toLocaleString() ?? '—'} total posts
          </span>
          <button
            onClick={() => navigate('/community/topics')}
            className="btn btn-default"
            style={{ fontSize: 11, padding: '3px 12px' }}
          >
            Explore all
          </button>
        </div>
      )}
    </div>
  );
}
