import { StatCard } from '../../components/StatCard';
import { Chart } from '../../components/Chart';
import { ErrorMessage } from '../../components/ErrorMessage';
import { useTelemetryDashboard } from '../../api/hooks';

export function Insights() {
  const { data, isLoading, error } = useTelemetryDashboard();

  const platformData = data
    ? Object.entries(data.stats.platformDistribution).map(([name, value]) => ({ name, value }))
    : [];

  const versionData = data
    ? Object.entries(data.stats.versionDistribution)
        .map(([name, value]) => ({ name, value }))
        .sort((a, b) => b.value - a.value)
        .slice(0, 10)
    : [];

  const dailyData = (data?.stats.dailyReportCount ?? [])
    .slice()
    .reverse()
    .slice(0, 30)
    .map((d) => ({
      date: d.date.slice(5),
      count: d.count,
    }));

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">Telemetry Insights</h1>
        <p className="page-subtitle">Aggregated anonymized usage data from opted-in nodes</p>
      </div>

      {error && <ErrorMessage error={error as Error} />}

      <div className="stat-grid stat-grid-3">
        <StatCard
          title="Unique Nodes"
          value={data?.stats.uniqueNodes ?? 0}
          icon="🖥️"
          color="#4361ee"
          loading={isLoading}
        />
        <StatCard
          title="Total Reports"
          value={data?.stats.totalReports ?? 0}
          icon="📋"
          color="#3a86ff"
          loading={isLoading}
        />
        <StatCard
          title="Platforms Tracked"
          value={Object.keys(data?.stats.platformDistribution ?? {}).length}
          icon="✅"
          color="#06d6a0"
          loading={isLoading}
        />
      </div>

      <div className="card" style={{ marginTop: 20 }}>
        <Chart
          type="line"
          data={dailyData}
          xKey="date"
          yKey="count"
          title="Daily Report Count (last 30 days)"
          height={260}
        />
      </div>

      <div className="chart-grid" style={{ marginTop: 16 }}>
        <div className="card">
          <Chart
            type="pie"
            data={platformData}
            nameKey="name"
            valueKey="value"
            title="Platform Distribution"
            height={260}
          />
        </div>
        <div className="card" style={{ gridColumn: 'span 2' }}>
          <Chart
            type="bar"
            data={versionData}
            xKey="name"
            yKey="value"
            title="Version Distribution"
            height={260}
          />
        </div>
      </div>
    </div>
  );
}
