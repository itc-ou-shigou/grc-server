import { useTranslation } from 'react-i18next';
import { StatCard } from '../../components/StatCard';
import { Chart } from '../../components/Chart';
import { ErrorMessage } from '../../components/ErrorMessage';
import { useSkillDownloadStats } from '../../api/hooks';

export function SkillStats() {
  const { t } = useTranslation('skills');
  const { data, isLoading, error } = useSkillDownloadStats();

  const dailyData = (data?.stats.byDay ?? []).map((d) => ({
    date: d.date.slice(5),
    count: d.count,
  }));

  const topSkillsData = (data?.stats.bySkill ?? []).slice(0, 10).map((s) => ({
    name: s.skillName.length > 14 ? s.skillName.slice(0, 14) + '…' : s.skillName,
    downloads: s.count,
  }));

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">{t('statsTitle')}</h1>
        <p className="page-subtitle">{t('statsSubtitle')}</p>
      </div>

      {error && <ErrorMessage error={error as Error} />}

      <div className="stat-grid stat-grid-3">
        <StatCard
          title={t('stats.totalDownloads')}
          value={data?.stats.totalDownloads ?? 0}
          icon="⬇️"
          color="#4361ee"
          loading={isLoading}
        />
        <StatCard
          title="Unique Skills Downloaded"
          value={data?.stats.bySkill?.length ?? 0}
          icon="📈"
          color="#06d6a0"
          loading={isLoading}
        />
        <StatCard
          title="Top Skill Downloads"
          value={data?.stats.bySkill?.[0]?.count ?? 0}
          icon="🏆"
          color="#ffbe0b"
          subtitle={data?.stats.bySkill?.[0]?.skillName}
          loading={isLoading}
        />
      </div>

      <div className="card" style={{ marginTop: 20 }}>
        <Chart
          type="line"
          data={dailyData}
          xKey="date"
          yKey="count"
          title={t('stats.downloadTrend')}
          height={260}
        />
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <Chart
          type="bar"
          data={topSkillsData}
          xKey="name"
          yKey="downloads"
          title="Top 10 Skills by Downloads"
          height={260}
        />
      </div>
    </div>
  );
}
