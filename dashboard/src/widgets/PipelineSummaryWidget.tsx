import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../api/client';

// ── Types ──────────────────────────────────────────────────────────────────

interface StageCount {
  stage: string;
  count: number;
  total_value: number;
}

interface PipelineSummaryResponse {
  stages: StageCount[];
  totalDeals: number;
  totalPipelineValue: number;
  totalWeightedValue: number;
}

// ── Helpers ────────────────────────────────────────────────────────────────

const STAGE_COLORS: Record<string, string> = {
  lead:        'rgba(224, 229, 251, 0.55)',
  qualified:   '#81ecff',
  proposal:    '#b287fe',
  negotiation: '#ffbe0b',
  closed_won:  '#4ade80',
  closed_lost: '#ef4444',
};

const STAGE_LABELS: Record<string, string> = {
  lead:        'Lead',
  qualified:   'Qualified',
  proposal:    'Proposal',
  negotiation: 'Negotiation',
  closed_won:  'Closed Won',
  closed_lost: 'Closed Lost',
};

function formatYen(value: number): string {
  if (value >= 1_000_000) return `¥${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `¥${(value / 1_000).toFixed(0)}K`;
  return `¥${value.toLocaleString('ja-JP')}`;
}

// ── Component ──────────────────────────────────────────────────────────────

export function PipelineSummaryWidget() {
  const { data, isLoading, error } = useQuery<PipelineSummaryResponse>({
    queryKey: ['pipeline-summary'],
    queryFn: async () => {
      const res = await apiClient.get<{ data: PipelineSummaryResponse }>('/api/v1/admin/pipeline/summary');
      return (res as any).data ?? res;
    },
    retry: false,
  });

  if (isLoading) {
    return (
      <div className="card" style={{ height: '100%' }}>
        <div className="chart-title">パイプライン概要</div>
        {[1, 2, 3].map((i) => (
          <div key={i} style={{ marginBottom: 12 }}>
            <div className="skeleton skeleton-text" style={{ width: '60%', marginBottom: 6 }} />
            <div className="skeleton" style={{ height: 6, borderRadius: 3 }} />
          </div>
        ))}
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="card" style={{ height: '100%' }}>
        <div className="chart-title">パイプライン概要</div>
        <p style={{ color: 'var(--color-text-muted)', fontSize: 13 }}>データなし</p>
      </div>
    );
  }

  const maxCount = Math.max(...(data.stages.map((s) => s.count)), 1);

  return (
    <div className="card" style={{ height: '100%' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
        <div className="chart-title" style={{ marginBottom: 0 }}>パイプライン概要</div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 20, fontWeight: 700, color: '#3b82f6', lineHeight: 1 }}>
            {formatYen(data.totalWeightedValue)}
          </div>
          <div style={{ fontSize: 10, color: 'var(--color-text-muted)', marginTop: 1 }}>加重パイプライン</div>
        </div>
      </div>

      {/* Stage bars */}
      <div style={{ marginBottom: 14 }}>
        {data.stages.map((stage) => {
          const color = STAGE_COLORS[stage.stage] ?? 'rgba(224, 229, 251, 0.55)';
          const label = STAGE_LABELS[stage.stage] ?? stage.stage;
          const pct = maxCount > 0 ? Math.round((stage.count / maxCount) * 100) : 0;
          return (
            <div key={stage.stage} style={{ marginBottom: 9 }}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  fontSize: 11,
                  marginBottom: 4,
                  color: 'var(--color-text-secondary)',
                }}
              >
                <span style={{ fontWeight: 500 }}>{label}</span>
                <span style={{ fontWeight: 600 }}>
                  {stage.count}件 &nbsp;{formatYen(stage.total_value)}
                </span>
              </div>
              <div style={{ height: 6, background: 'var(--color-border)', borderRadius: 3, overflow: 'hidden' }}>
                <div
                  style={{
                    height: '100%',
                    width: `${pct}%`,
                    background: color,
                    borderRadius: 3,
                    transition: 'width 0.4s ease',
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>

      {/* Footer totals */}
      <div
        style={{
          display: 'flex',
          gap: 16,
          paddingTop: 10,
          borderTop: '1px solid var(--color-border)',
          flexWrap: 'wrap',
        }}
      >
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--color-text)' }}>
            {data.totalDeals}
          </div>
          <div style={{ fontSize: 10, color: 'var(--color-text-muted)' }}>総商談数</div>
        </div>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--color-text)' }}>
            {formatYen(data.totalPipelineValue)}
          </div>
          <div style={{ fontSize: 10, color: 'var(--color-text-muted)' }}>総パイプライン</div>
        </div>
      </div>
    </div>
  );
}
