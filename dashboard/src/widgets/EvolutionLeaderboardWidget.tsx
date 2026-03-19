import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { apiClient } from '../api/client';

type Period = 'weekly' | 'monthly' | 'all_time';

interface LeaderboardEntry {
  rank: number;
  agentId: string;
  agentName: string;
  nodeId?: string;
  role?: string;
  score: number;
  genes: number;
  capsules: number;
  used: number;
  votesUp: number;
  votesDown: number;
  badges: string[];
}

interface LeaderboardResponse {
  period: Period;
  entries: LeaderboardEntry[];
  orgStats?: {
    totalGenes: number;
    totalCapsules: number;
    avgSuccessRate: number;
  };
}

const PERIOD_LABELS: Record<Period, string> = {
  weekly: '週次',
  monthly: '月次',
  all_time: '全期間',
};

function rankMedal(rank: number): string {
  if (rank === 1) return '\uD83E\uDD47';
  if (rank === 2) return '\uD83E\uDD48';
  if (rank === 3) return '\uD83E\uDD49';
  return String(rank);
}

export function EvolutionLeaderboardWidget() {
  const navigate = useNavigate();
  const [period, setPeriod] = useState<Period>('weekly');

  const { data, isLoading, error } = useQuery<LeaderboardResponse>({
    queryKey: ['admin', 'evolution', 'leaderboard', { period, limit: 5 }],
    queryFn: () =>
      apiClient.get<LeaderboardResponse>('/api/v1/admin/evolution/leaderboard', {
        period,
        limit: 5,
      } as Record<string, string | number | boolean | undefined>),
    staleTime: 60_000,
  });

  const title = 'Evolution Leaderboard';

  // ── Loading skeleton ────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="card" style={{ height: '100%' }}>
        <div className="chart-title">{title}</div>
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} style={{ marginBottom: 10 }}>
            <div className="skeleton skeleton-text" style={{ width: '80%', marginBottom: 4 }} />
            <div className="skeleton skeleton-text" style={{ width: '50%' }} />
          </div>
        ))}
      </div>
    );
  }

  const entries = data?.entries ?? [];

  return (
    <div className="card" style={{ height: '100%' }}>
      {/* Header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          marginBottom: 12,
        }}
      >
        <div className="chart-title" style={{ marginBottom: 0 }}>
          {title}
        </div>
        <button
          onClick={() => navigate('/evolution/leaderboard')}
          style={{
            background: 'none',
            border: 'none',
            fontSize: 12,
            color: 'var(--color-primary)',
            cursor: 'pointer',
            padding: 0,
            textDecoration: 'underline',
          }}
        >
          全て見る
        </button>
      </div>

      {/* Period toggle */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 12 }}>
        {(Object.entries(PERIOD_LABELS) as [Period, string][]).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setPeriod(key)}
            style={{
              padding: '3px 10px',
              fontSize: 11,
              fontWeight: period === key ? 700 : 400,
              borderRadius: 'var(--radius-sm)',
              border: period === key
                ? '1px solid var(--color-primary)'
                : '1px solid var(--color-border)',
              background: period === key ? 'var(--color-primary)' : 'transparent',
              color: period === key ? '#fff' : 'var(--color-text-muted)',
              cursor: 'pointer',
              transition: 'all var(--transition)',
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Empty state */}
      {(error || entries.length === 0) && (
        <p style={{ color: 'var(--color-text-muted)', fontSize: 13, margin: 0 }}>
          まだランキングデータがありません
        </p>
      )}

      {/* Entries */}
      {entries.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {entries.map((entry) => (
            <div
              key={entry.agentId}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '6px 8px',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--color-border-light)',
                background: entry.rank <= 3 ? 'rgba(var(--color-primary-rgb, 67, 97, 238), 0.04)' : 'transparent',
              }}
            >
              {/* Rank */}
              <span
                style={{
                  fontSize: entry.rank <= 3 ? 18 : 13,
                  fontWeight: 700,
                  minWidth: 24,
                  textAlign: 'center',
                  color: entry.rank > 3 ? 'var(--color-text-muted)' : undefined,
                }}
              >
                {rankMedal(entry.rank)}
              </span>

              {/* Agent info */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: 'var(--color-text)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {entry.agentName}
                </div>
                {entry.role && (
                  <span
                    style={{
                      display: 'inline-block',
                      fontSize: 10,
                      fontWeight: 600,
                      padding: '1px 5px',
                      borderRadius: 4,
                      background: 'rgba(var(--color-primary-rgb, 67, 97, 238), 0.12)',
                      color: 'var(--color-primary)',
                      marginTop: 2,
                    }}
                  >
                    {entry.role}
                  </span>
                )}
              </div>

              {/* Score */}
              <div style={{ textAlign: 'right', minWidth: 48 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-text)' }}>
                  {entry.score.toLocaleString()}
                </div>
                <div style={{ fontSize: 10, color: 'var(--color-text-muted)' }}>pts</div>
              </div>

              {/* Badges */}
              {entry.badges.length > 0 && (
                <div style={{ display: 'flex', gap: 2 }}>
                  {entry.badges.slice(0, 3).map((badge, i) => (
                    <span key={i} title={badge} style={{ fontSize: 14 }}>
                      {badge}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
