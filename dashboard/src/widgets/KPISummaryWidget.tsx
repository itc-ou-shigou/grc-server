import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../api/client';

// ── Types ──────────────────────────────────────────────────────────────────

interface KPI {
  id: string;
  name: string;
  category: string;
  current_value: number;
  target_value: number;
  unit: string;
  achievement_rate: number;
}

interface KPIDashboardResponse {
  kpis: KPI[];
  total: number;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function achievementColor(rate: number): string {
  if (rate >= 80) return '#10b981';
  if (rate >= 50) return '#f59e0b';
  return '#ef4444';
}

// ── Component ──────────────────────────────────────────────────────────────

export function KPISummaryWidget() {
  const { data, isLoading, error } = useQuery<KPIDashboardResponse>({
    queryKey: ['kpis-dashboard'],
    queryFn: async () => {
      const res = await apiClient.get<any>('/api/v1/admin/kpis/dashboard');
      // API returns { data: [...] } — normalize to { kpis: [...] }
      const kpis = res.data ?? res.kpis ?? [];
      return { kpis, total: kpis.length };
    },
    retry: false,
  });

  if (isLoading) {
    return (
      <div className="card" style={{ height: '100%' }}>
        <div className="chart-title">KPI概要</div>
        {[1, 2, 3].map((i) => (
          <div key={i} style={{ marginBottom: 12 }}>
            <div className="skeleton skeleton-text" style={{ width: '70%', marginBottom: 6 }} />
            <div className="skeleton" style={{ height: 6, borderRadius: 3 }} />
          </div>
        ))}
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="card" style={{ height: '100%' }}>
        <div className="chart-title">KPI概要</div>
        <p style={{ color: 'var(--color-text-muted)', fontSize: 13 }}>データなし</p>
      </div>
    );
  }

  // Top 5 by achievement rate (ascending — worst first to highlight issues)
  const top5 = [...data.kpis]
    .sort((a, b) => b.achievement_rate - a.achievement_rate)
    .slice(0, 5);

  const onTrack = data.kpis.filter((k) => k.achievement_rate >= 80).length;
  const atRisk = data.kpis.filter((k) => k.achievement_rate >= 50 && k.achievement_rate < 80).length;
  const offTrack = data.kpis.filter((k) => k.achievement_rate < 50).length;

  return (
    <div className="card" style={{ height: '100%' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
        <div className="chart-title" style={{ marginBottom: 0 }}>KPI概要</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: '#10b981' }}>
            {onTrack} 達成
          </span>
          <span style={{ fontSize: 10, fontWeight: 700, color: '#f59e0b' }}>
            {atRisk} リスク
          </span>
          <span style={{ fontSize: 10, fontWeight: 700, color: '#ef4444' }}>
            {offTrack} 未達
          </span>
        </div>
      </div>

      {/* Top 5 KPIs */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {top5.length === 0 && (
          <p style={{ color: 'var(--color-text-muted)', fontSize: 13 }}>KPIがありません</p>
        )}
        {top5.map((kpi) => {
          const color = achievementColor(kpi.achievement_rate);
          return (
            <div key={kpi.id}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'baseline',
                  marginBottom: 4,
                  fontSize: 12,
                }}
              >
                <span
                  style={{
                    fontWeight: 500,
                    color: 'var(--color-text)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    maxWidth: '60%',
                  }}
                  title={kpi.name}
                >
                  {kpi.name}
                </span>
                <span style={{ fontWeight: 700, color, marginLeft: 8, flexShrink: 0 }}>
                  {kpi.achievement_rate.toFixed(0)}%
                </span>
              </div>
              <div style={{ height: 5, background: 'var(--color-border)', borderRadius: 3, overflow: 'hidden' }}>
                <div
                  style={{
                    height: '100%',
                    width: `${Math.min(kpi.achievement_rate, 100)}%`,
                    background: color,
                    borderRadius: 3,
                    transition: 'width 0.4s ease',
                  }}
                />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--color-text-muted)', marginTop: 2 }}>
                <span>{kpi.current_value.toLocaleString()} {kpi.unit}</span>
                <span>目標: {kpi.target_value.toLocaleString()} {kpi.unit}</span>
              </div>
            </div>
          );
        })}
      </div>

      {data.kpis.length > 5 && (
        <div style={{ marginTop: 12, fontSize: 11, color: 'var(--color-text-muted)', textAlign: 'center' }}>
          他 {data.kpis.length - 5} 件
        </div>
      )}
    </div>
  );
}
