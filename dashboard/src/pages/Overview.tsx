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
        <h1 className="page-title">Overview</h1>
        <p className="page-subtitle">Platform-wide statistics and insights</p>
      </div>

      {error && <ErrorMessage error={error as Error} />}

      <div className="stat-grid stat-grid-4">
        <StatCard
          title="Total Users"
          value={auth.data?.stats.totalUsers ?? 0}
          icon="👤"
          color="#4361ee"
          loading={loading}
        />
        <StatCard
          title="Active Nodes"
          value={evolution.data?.stats.activeNodes ?? 0}
          icon="🖥️"
          color="#06d6a0"
          loading={loading}
        />
        <StatCard
          title="Total Genes"
          value={totalGenes}
          icon="🔧"
          color="#3a86ff"
          loading={loading}
        />
        <StatCard
          title="Total Assets"
          value={totalGenes + totalCapsules}
          icon="🧬"
          color="#8338ec"
          loading={loading}
        />
      </div>

      <div className="stat-grid stat-grid-4" style={{ marginTop: 16 }}>
        <StatCard
          title="Update Success Rate"
          value={`${(update.data?.stats.successRate ?? 0).toFixed(1)}%`}
          icon="🔄"
          color="#fb5607"
          loading={loading}
        />
        <StatCard
          title="Unique Telemetry Nodes"
          value={telemetry.data?.stats.uniqueNodes ?? 0}
          icon="📊"
          color="#ffbe0b"
          loading={loading}
        />
        <StatCard
          title="Total Telemetry Reports"
          value={telemetry.data?.stats.totalReports ?? 0}
          icon="🤖"
          color="#118ab2"
          loading={loading}
        />
        <StatCard
          title="Community Posts"
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
            title="Daily Telemetry Reports (last 30 days)"
            height={240}
          />
        </div>
        <div className="card">
          <Chart
            type="pie"
            data={platformData}
            nameKey="name"
            valueKey="value"
            title="Platform Distribution"
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
          title="Genes by Status"
          height={240}
        />
      </div>
    </div>
  );
}
