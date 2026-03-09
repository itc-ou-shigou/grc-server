import { useTranslation } from 'react-i18next';
import { StatCard } from '../components/StatCard';
import { Chart } from '../components/Chart';
import { ErrorMessage } from '../components/ErrorMessage';
import {
  useAuthStats,
  useEvolutionStats,
  useUpdateStats,
  useTelemetryDashboard,
  useCommunityStats,
} from '../api/hooks';

export function Overview() {
  const { t } = useTranslation('overview');
  const auth = useAuthStats();
  const evolution = useEvolutionStats();
  const update = useUpdateStats();
  const telemetry = useTelemetryDashboard();
  const community = useCommunityStats();

  const loading =
    auth.isLoading ||
    evolution.isLoading ||
    update.isLoading ||
    telemetry.isLoading ||
    community.isLoading;

  const error =
    auth.error ?? evolution.error ?? update.error ?? telemetry.error ?? community.error;

  // Prepare chart data
  const platformData = telemetry.data
    ? Object.entries(telemetry.data.stats.platformDistribution).map(([name, value]) => ({ name, value }))
    : [];

  const dailyReportData = (telemetry.data?.stats.dailyReportCount ?? [])
    .slice()
    .reverse()
    .slice(0, 30)
    .map((d) => ({ date: d.date.slice(5), count: d.count }));

  const totalGenes = evolution.data?.stats.totalGenes ?? 0;
  const totalCapsules = evolution.data?.stats.totalCapsules ?? 0;

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">{t('title')}</h1>
        <p className="page-subtitle">{t('subtitle')}</p>
      </div>

      {error && <ErrorMessage error={error as Error} />}

      <div className="stat-grid stat-grid-4">
        <StatCard
          title={t('stats.totalUsers')}
          value={auth.data?.stats.totalUsers ?? 0}
          icon="👤"
          color="#4361ee"
          loading={loading}
        />
        <StatCard
          title={t('stats.activeNodes')}
          value={evolution.data?.stats.activeNodes ?? 0}
          icon="🖥️"
          color="#06d6a0"
          loading={loading}
        />
        <StatCard
          title={t('stats.totalGenes')}
          value={totalGenes}
          icon="🔧"
          color="#3a86ff"
          loading={loading}
        />
        <StatCard
          title={t('stats.totalAssets')}
          value={totalGenes + totalCapsules}
          icon="🧬"
          color="#8338ec"
          loading={loading}
        />
      </div>

      <div className="stat-grid stat-grid-4" style={{ marginTop: 16 }}>
        <StatCard
          title={t('stats.updateSuccessRate')}
          value={`${(update.data?.stats.successRate ?? 0).toFixed(1)}%`}
          icon="🔄"
          color="#fb5607"
          loading={loading}
        />
        <StatCard
          title={t('stats.uniqueTelemetryNodes')}
          value={telemetry.data?.stats.uniqueNodes ?? 0}
          icon="📊"
          color="#ffbe0b"
          loading={loading}
        />
        <StatCard
          title={t('stats.totalTelemetryReports')}
          value={telemetry.data?.stats.totalReports ?? 0}
          icon="🤖"
          color="#118ab2"
          loading={loading}
        />
        <StatCard
          title={t('stats.communityPosts')}
          value={community.data?.stats.totalPosts ?? 0}
          icon="⚠️"
          color="#ff006e"
          loading={loading}
        />
      </div>

      <div className="chart-grid" style={{ marginTop: 24 }}>
        <div className="card" style={{ gridColumn: 'span 2' }}>
          <Chart
            type="line"
            data={dailyReportData}
            xKey="date"
            yKey="count"
            title={t('charts.dailyTelemetry')}
            height={240}
          />
        </div>
        <div className="card">
          <Chart
            type="pie"
            data={platformData}
            nameKey="name"
            valueKey="value"
            title={t('charts.platformDistribution')}
            height={240}
          />
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <Chart
          type="bar"
          data={Object.entries(evolution.data?.stats.genesByStatus ?? {}).map(([name, value]) => ({ name, value }))}
          xKey="name"
          yKey="value"
          title={t('charts.genesByStatus')}
          height={240}
        />
      </div>
    </div>
  );
}
