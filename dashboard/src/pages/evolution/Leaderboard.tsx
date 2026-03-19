import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { apiClient } from '../../api/client';

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

function rankMedal(rank: number): string {
  if (rank === 1) return '\uD83E\uDD47';
  if (rank === 2) return '\uD83E\uDD48';
  if (rank === 3) return '\uD83E\uDD49';
  return String(rank);
}

export function Leaderboard() {
  const { t } = useTranslation('evolution');
  const [period, setPeriod] = useState<Period>('weekly');

  const { data, isLoading, error } = useQuery<LeaderboardResponse>({
    queryKey: ['admin', 'evolution', 'leaderboard', { period, limit: 20 }],
    queryFn: () =>
      apiClient.get<LeaderboardResponse>('/api/v1/admin/evolution/leaderboard', {
        period,
        limit: 20,
      } as Record<string, string | number | boolean | undefined>),
    staleTime: 60_000,
  });

  const entries = data?.entries ?? [];
  const orgStats = data?.orgStats;

  const periodOptions: { value: Period; label: string }[] = [
    { value: 'weekly', label: t('leaderboard.period.weekly') },
    { value: 'monthly', label: t('leaderboard.period.monthly') },
    { value: 'all_time', label: t('leaderboard.period.allTime') },
  ];

  return (
    <div style={{ padding: '24px 32px', maxWidth: 1100, margin: '0 auto' }}>
      {/* Page header */}
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700, color: 'var(--color-text)' }}>
          {t('leaderboard.title')}
        </h1>
        <p style={{ margin: '4px 0 0', fontSize: 14, color: 'var(--color-text-muted)' }}>
          {t('leaderboard.subtitle')}
        </p>
      </div>

      {/* Period selector */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20 }}>
        <span style={{ fontSize: 13, color: 'var(--color-text-muted)', fontWeight: 500 }}>
          期間:
        </span>
        <select
          value={period}
          onChange={(e) => setPeriod(e.target.value as Period)}
          style={{
            padding: '6px 12px',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--color-border)',
            background: 'var(--color-content-bg)',
            color: 'var(--color-text)',
            fontSize: 13,
            fontWeight: 500,
            cursor: 'pointer',
          }}
        >
          {periodOptions.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      {/* Table */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        {isLoading ? (
          <div style={{ padding: 24 }}>
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} style={{ marginBottom: 16 }}>
                <div className="skeleton skeleton-text" style={{ width: '90%', marginBottom: 6 }} />
                <div className="skeleton skeleton-text" style={{ width: '60%' }} />
              </div>
            ))}
          </div>
        ) : error ? (
          <div style={{ padding: 24, color: 'var(--color-text-muted)', fontSize: 14 }}>
            {t('leaderboard.empty')}
          </div>
        ) : entries.length === 0 ? (
          <div style={{ padding: 24, color: 'var(--color-text-muted)', fontSize: 14, textAlign: 'center' }}>
            {t('leaderboard.empty')}
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table
              style={{
                width: '100%',
                borderCollapse: 'collapse',
                fontSize: 13,
              }}
            >
              <thead>
                <tr
                  style={{
                    borderBottom: '2px solid var(--color-border)',
                    background: 'var(--color-bg)',
                  }}
                >
                  {[
                    { key: 'rank', label: t('leaderboard.rank'), width: 60, align: 'center' as const },
                    { key: 'agent', label: t('leaderboard.agent'), width: undefined, align: 'left' as const },
                    { key: 'role', label: t('leaderboard.role'), width: 120, align: 'left' as const },
                    { key: 'score', label: t('leaderboard.score'), width: 90, align: 'right' as const },
                    { key: 'genes', label: t('leaderboard.genes'), width: 80, align: 'right' as const },
                    { key: 'capsules', label: t('leaderboard.capsules'), width: 90, align: 'right' as const },
                    { key: 'used', label: t('leaderboard.used'), width: 80, align: 'right' as const },
                    { key: 'votes', label: t('leaderboard.votes'), width: 90, align: 'right' as const },
                    { key: 'badges', label: t('leaderboard.badges'), width: 100, align: 'left' as const },
                  ].map((col) => (
                    <th
                      key={col.key}
                      style={{
                        padding: '10px 16px',
                        textAlign: col.align,
                        fontWeight: 600,
                        fontSize: 11,
                        textTransform: 'uppercase',
                        letterSpacing: '0.05em',
                        color: 'var(--color-text-muted)',
                        whiteSpace: 'nowrap',
                        width: col.width,
                      }}
                    >
                      {col.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {entries.map((entry, idx) => (
                  <tr
                    key={entry.agentId}
                    style={{
                      borderBottom: idx < entries.length - 1 ? '1px solid var(--color-border-light)' : 'none',
                      background: entry.rank <= 3
                        ? 'rgba(var(--color-primary-rgb, 67, 97, 238), 0.03)'
                        : 'transparent',
                      transition: 'background var(--transition)',
                    }}
                    onMouseOver={(e) =>
                      (e.currentTarget.style.background = 'var(--color-bg)')
                    }
                    onMouseOut={(e) =>
                      (e.currentTarget.style.background =
                        entry.rank <= 3
                          ? 'rgba(var(--color-primary-rgb, 67, 97, 238), 0.03)'
                          : 'transparent')
                    }
                  >
                    {/* Rank */}
                    <td
                      style={{
                        padding: '12px 16px',
                        textAlign: 'center',
                        fontSize: entry.rank <= 3 ? 20 : 13,
                        fontWeight: 700,
                        color: entry.rank > 3 ? 'var(--color-text-muted)' : undefined,
                      }}
                    >
                      {rankMedal(entry.rank)}
                    </td>

                    {/* Agent */}
                    <td style={{ padding: '12px 16px' }}>
                      <div style={{ fontWeight: 600, color: 'var(--color-text)' }}>
                        {entry.agentName}
                      </div>
                      {entry.nodeId && (
                        <div
                          style={{
                            fontSize: 11,
                            color: 'var(--color-text-muted)',
                            fontFamily: 'var(--font-mono)',
                            marginTop: 2,
                          }}
                        >
                          {entry.nodeId}
                        </div>
                      )}
                    </td>

                    {/* Role */}
                    <td style={{ padding: '12px 16px' }}>
                      {entry.role ? (
                        <span
                          style={{
                            display: 'inline-block',
                            fontSize: 11,
                            fontWeight: 600,
                            padding: '2px 8px',
                            borderRadius: 4,
                            background: 'rgba(var(--color-primary-rgb, 67, 97, 238), 0.1)',
                            color: 'var(--color-primary)',
                          }}
                        >
                          {entry.role}
                        </span>
                      ) : (
                        <span style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>—</span>
                      )}
                    </td>

                    {/* Score */}
                    <td
                      style={{
                        padding: '12px 16px',
                        textAlign: 'right',
                        fontWeight: 700,
                        color: 'var(--color-text)',
                      }}
                    >
                      {entry.score.toLocaleString()}
                    </td>

                    {/* Genes */}
                    <td
                      style={{
                        padding: '12px 16px',
                        textAlign: 'right',
                        color: 'var(--color-text)',
                      }}
                    >
                      {entry.genes.toLocaleString()}
                    </td>

                    {/* Capsules */}
                    <td
                      style={{
                        padding: '12px 16px',
                        textAlign: 'right',
                        color: 'var(--color-text)',
                      }}
                    >
                      {entry.capsules.toLocaleString()}
                    </td>

                    {/* Used */}
                    <td
                      style={{
                        padding: '12px 16px',
                        textAlign: 'right',
                        color: 'var(--color-text)',
                      }}
                    >
                      {entry.used.toLocaleString()}
                    </td>

                    {/* Votes */}
                    <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                      <span style={{ color: 'var(--color-success, #06d6a0)', fontWeight: 600 }}>
                        +{entry.votesUp}
                      </span>
                      {' / '}
                      <span style={{ color: 'var(--color-warning, #fb5607)', fontWeight: 600 }}>
                        -{entry.votesDown}
                      </span>
                    </td>

                    {/* Badges */}
                    <td style={{ padding: '12px 16px' }}>
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                        {entry.badges.length === 0 ? (
                          <span style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>—</span>
                        ) : (
                          entry.badges.map((badge, i) => (
                            <span key={i} title={badge} style={{ fontSize: 16 }}>
                              {badge}
                            </span>
                          ))
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Org Stats summary bar */}
      {orgStats && (
        <div
          style={{
            marginTop: 20,
            padding: '14px 20px',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--color-border)',
            background: 'var(--color-content-bg)',
            display: 'flex',
            gap: 32,
            alignItems: 'center',
            flexWrap: 'wrap',
          }}
        >
          <span
            style={{
              fontSize: 12,
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              color: 'var(--color-text-muted)',
              marginRight: 8,
            }}
          >
            {t('leaderboard.orgStats')}
          </span>

          <div style={{ display: 'flex', gap: 32, flexWrap: 'wrap' }}>
            <OrgStatItem
              label={t('leaderboard.genes')}
              value={orgStats.totalGenes.toLocaleString()}
            />
            <OrgStatItem
              label={t('leaderboard.capsules')}
              value={orgStats.totalCapsules.toLocaleString()}
            />
            <OrgStatItem
              label="Avg 成功率"
              value={`${(orgStats.avgSuccessRate * 100).toFixed(1)}%`}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function OrgStatItem({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <span style={{ fontSize: 11, color: 'var(--color-text-muted)', fontWeight: 500 }}>
        {label}
      </span>
      <span style={{ fontSize: 18, fontWeight: 700, color: 'var(--color-text)' }}>
        {value}
      </span>
    </div>
  );
}
