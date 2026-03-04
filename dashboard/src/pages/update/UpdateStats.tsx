import { StatCard } from '../../components/StatCard';
import { Chart } from '../../components/Chart';
import { ErrorMessage } from '../../components/ErrorMessage';
import { useUpdateStats } from '../../api/hooks';

export function UpdateStats() {
  const { data, isLoading, error } = useUpdateStats();

  const platformData = data
    ? Object.entries(data.stats.platformDistribution).map(([name, value]) => ({ name, value }))
    : [];

  const versionData = (data?.stats.versionAdoption ?? []).slice(0, 8).map((v) => ({
    version: v.version.length > 10 ? v.version.slice(0, 10) + '…' : v.version,
    count: v.count,
  }));

  const avgDurationSec = data
    ? data.stats.avgDurationMs !== null
      ? (data.stats.avgDurationMs / 1000).toFixed(1)
      : '—'
    : '0';

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">Update Statistics</h1>
        <p className="page-subtitle">Platform update performance and adoption metrics</p>
      </div>

      {error && <ErrorMessage error={error as Error} />}

      <div className="stat-grid stat-grid-4">
        <StatCard
          title="Total Reports"
          value={data?.stats.totalReports ?? 0}
          icon="🔄"
          color="#4361ee"
          loading={isLoading}
        />
        <StatCard
          title="Success Rate"
          value={`${(data?.stats.successRate ?? 0).toFixed(1)}%`}
          icon="✅"
          color="#06d6a0"
          loading={isLoading}
        />
        <StatCard
          title="Platforms"
          value={Object.keys(data?.stats.platformDistribution ?? {}).length}
          icon="💻"
          color="#ff006e"
          loading={isLoading}
        />
        <StatCard
          title="Avg Duration"
          value={`${avgDurationSec}s`}
          icon="⏱️"
          color="#ffbe0b"
          loading={isLoading}
        />
      </div>

      <div className="chart-grid" style={{ marginTop: 20 }}>
        <div className="card">
          <Chart
            type="pie"
            data={platformData}
            nameKey="name"
            valueKey="value"
            title="Updates by Platform"
            height={240}
          />
        </div>
        <div className="card" style={{ gridColumn: 'span 2' }}>
          <Chart
            type="bar"
            data={versionData}
            xKey="version"
            yKey="count"
            title="Version Adoption"
            height={240}
          />
        </div>
      </div>
    </div>
  );
}
