import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Chart } from '../components/Chart';
import { ErrorMessage } from '../components/ErrorMessage';
import {
  useAuthStats,
  useEvolutionStats,
  useUpdateStats,
  useTelemetryDashboard,
  useCommunityStats,
} from '../api/hooks';
import { ApiError } from '../api/client';
import { StatWidget } from './StatWidget';
import { TaskSummaryWidget } from './TaskSummaryWidget';
import { CommunityFeedWidget } from './CommunityFeedWidget';
import { MessageQueueWidget } from './MessageQueueWidget';
import { TodayMeetingsWidget } from './TodayMeetingsWidget';
import { WeeklyMVPWidget } from './WeeklyMVPWidget';
import { ReviewTasksWidget } from './ReviewTasksWidget';
import { SSEStatusWidget } from './SSEStatusWidget';
import { PipelineSummaryWidget } from './PipelineSummaryWidget';
import { KPISummaryWidget } from './KPISummaryWidget';
import { EvolutionLeaderboardWidget } from './EvolutionLeaderboardWidget';
import { useWidgetConfig } from './useWidgetConfig';
import type { WidgetId } from './types';
import { WIDGET_SIZE_COLS } from './types';

// ---------------------------------------------------------------------------
// Customize panel
// ---------------------------------------------------------------------------

const WIDGET_LABELS: Record<WidgetId, string> = {
  'stat-total-users':          'Total Users',
  'stat-active-nodes':         'Active Nodes',
  'stat-total-genes':          'Total Genes',
  'stat-total-assets':         'Total Assets',
  'stat-update-success-rate':  'Update Success Rate',
  'stat-telemetry-nodes':      'Unique Telemetry Nodes',
  'stat-telemetry-reports':    'Total Telemetry Reports',
  'stat-community-posts':      'Community Posts',
  'chart-daily-telemetry':     'Daily Telemetry Chart',
  'chart-platform-distribution': 'Platform Distribution Chart',
  'chart-genes-by-status':     'Genes by Status Chart',
  'task-summary':              'Task Summary',
  'community-feed':            'Community Feed',
  'message-queue':             'Message Queue',
  'today-meetings':            'Today\'s Meetings',
  'weekly-mvp':                'Weekly MVP',
  'review-tasks':              'Review Tasks',
  'sse-status':                'SSE Status',
  'pipeline-summary':          'Pipeline Summary',
  'kpi-summary':               'KPI Summary',
  'evolution-leaderboard':     'Evolution Leaderboard',
};

interface CustomizePanelProps {
  widgets: ReturnType<typeof useWidgetConfig>['widgets'];
  setVisibility: ReturnType<typeof useWidgetConfig>['setVisibility'];
  reset: ReturnType<typeof useWidgetConfig>['reset'];
  onClose: () => void;
}

function CustomizePanel({ widgets, setVisibility, reset, onClose }: CustomizePanelProps) {
  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        right: 0,
        bottom: 0,
        width: 320,
        background: 'var(--color-content-bg)',
        boxShadow: 'var(--shadow-lg)',
        zIndex: 200,
        display: 'flex',
        flexDirection: 'column',
        borderLeft: '1px solid var(--color-border)',
      }}
    >
      <div
        style={{
          padding: '16px 20px',
          borderBottom: '1px solid var(--color-border)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div>
          <div style={{ fontWeight: 700, fontSize: 15 }}>Customize Dashboard</div>
          <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 2 }}>
            Toggle widgets on or off
          </div>
        </div>
        <button
          onClick={onClose}
          style={{
            background: 'none',
            border: 'none',
            fontSize: 20,
            color: 'var(--color-text-secondary)',
            cursor: 'pointer',
            padding: '4px 8px',
            lineHeight: 1,
          }}
          aria-label="Close customize panel"
        >
          &times;
        </button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 20px' }}>
        {widgets.map((w) => (
          <label
            key={w.id}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: '10px 0',
              borderBottom: '1px solid var(--color-border-light)',
              cursor: 'pointer',
            }}
          >
            <input
              type="checkbox"
              checked={w.visible}
              onChange={(e) => setVisibility(w.id, e.target.checked)}
              style={{ width: 16, height: 16, accentColor: 'var(--color-primary)', cursor: 'pointer' }}
            />
            <span style={{ fontSize: 13, color: 'var(--color-text)' }}>
              {WIDGET_LABELS[w.id]}
            </span>
          </label>
        ))}
      </div>

      <div style={{ padding: '12px 20px', borderTop: '1px solid var(--color-border)' }}>
        <button
          onClick={reset}
          style={{
            width: '100%',
            padding: '8px 16px',
            background: 'none',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-md)',
            fontSize: 13,
            color: 'var(--color-text-secondary)',
            cursor: 'pointer',
            transition: 'background var(--transition)',
          }}
          onMouseOver={(e) => (e.currentTarget.style.background = 'var(--color-bg)')}
          onMouseOut={(e) => (e.currentTarget.style.background = 'none')}
        >
          Reset to defaults
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// CSS column span helper — maps widget size to inline grid-column style.
// We use a 3-column base grid.
// ---------------------------------------------------------------------------

function colSpanStyle(size: string): React.CSSProperties {
  const cols = WIDGET_SIZE_COLS[size as keyof typeof WIDGET_SIZE_COLS] ?? 1;
  return { gridColumn: `span ${Math.min(cols, 3)}` };
}

// ---------------------------------------------------------------------------
// Main WidgetGrid
// ---------------------------------------------------------------------------

export function WidgetGrid() {
  const { t } = useTranslation('overview');
  const { widgets, setVisibility, reset } = useWidgetConfig();
  const [customizeOpen, setCustomizeOpen] = useState(false);

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

  const isReal = (e: unknown): e is Error =>
    e instanceof Error && !(e instanceof ApiError && e.status === 404);

  const error =
    [auth.error, evolution.error, update.error, telemetry.error, community.error].find(isReal) ??
    null;

  const totalGenes = evolution.data?.stats.totalGenes ?? 0;
  const totalCapsules = evolution.data?.stats.totalCapsules ?? 0;

  const platformData = telemetry.data
    ? Object.entries(telemetry.data.stats.platformDistribution).map(([name, value]) => ({ name, value }))
    : [];

  const dailyReportData = (telemetry.data?.stats.dailyReportCount ?? [])
    .slice()
    .reverse()
    .slice(0, 30)
    .map((d) => ({ date: d.date.slice(5), count: d.count }));

  const genesByStatusData = Object.entries(evolution.data?.stats.genesByStatus ?? {}).map(
    ([name, value]) => ({ name, value })
  );

  const visibleWidgets = widgets.filter((w) => w.visible);

  function renderWidget(id: WidgetId) {
    switch (id) {
      case 'stat-total-users':
        return (
          <StatWidget
            title={t('stats.totalUsers')}
            value={auth.data?.stats.totalUsers ?? 0}
            icon="👤"
            color="#4361ee"
            loading={loading}
          />
        );
      case 'stat-active-nodes':
        return (
          <StatWidget
            title={t('stats.activeNodes')}
            value={evolution.data?.stats.activeNodes ?? 0}
            icon="🖥️"
            color="#06d6a0"
            loading={loading}
          />
        );
      case 'stat-total-genes':
        return (
          <StatWidget
            title={t('stats.totalGenes')}
            value={totalGenes}
            icon="🔧"
            color="#3a86ff"
            loading={loading}
          />
        );
      case 'stat-total-assets':
        return (
          <StatWidget
            title={t('stats.totalAssets')}
            value={totalGenes + totalCapsules}
            icon="🧬"
            color="#8338ec"
            loading={loading}
          />
        );
      case 'stat-update-success-rate':
        return (
          <StatWidget
            title={t('stats.updateSuccessRate')}
            value={`${(update.data?.stats.successRate ?? 0).toFixed(1)}%`}
            icon="🔄"
            color="#fb5607"
            loading={loading}
          />
        );
      case 'stat-telemetry-nodes':
        return (
          <StatWidget
            title={t('stats.uniqueTelemetryNodes')}
            value={telemetry.data?.stats.uniqueNodes ?? 0}
            icon="📊"
            color="#ffbe0b"
            loading={loading}
          />
        );
      case 'stat-telemetry-reports':
        return (
          <StatWidget
            title={t('stats.totalTelemetryReports')}
            value={telemetry.data?.stats.totalReports ?? 0}
            icon="🤖"
            color="#118ab2"
            loading={loading}
          />
        );
      case 'stat-community-posts':
        return (
          <StatWidget
            title={t('stats.communityPosts')}
            value={community.data?.stats.totalPosts ?? 0}
            icon="⚠️"
            color="#ff006e"
            loading={loading}
          />
        );
      case 'chart-daily-telemetry':
        return (
          <div className="card" style={{ height: '100%' }}>
            <Chart
              type="line"
              data={dailyReportData}
              xKey="date"
              yKey="count"
              title={t('charts.dailyTelemetry')}
              height={240}
            />
          </div>
        );
      case 'chart-platform-distribution':
        return (
          <div className="card" style={{ height: '100%' }}>
            <Chart
              type="pie"
              data={platformData}
              nameKey="name"
              valueKey="value"
              title={t('charts.platformDistribution')}
              height={240}
            />
          </div>
        );
      case 'chart-genes-by-status':
        return (
          <div className="card" style={{ height: '100%' }}>
            <Chart
              type="bar"
              data={genesByStatusData}
              xKey="name"
              yKey="value"
              title={t('charts.genesByStatus')}
              height={240}
            />
          </div>
        );
      case 'task-summary':
        return <TaskSummaryWidget />;
      case 'community-feed':
        return <CommunityFeedWidget />;
      case 'message-queue':
        return <MessageQueueWidget />;
      case 'today-meetings':
        return <TodayMeetingsWidget />;
      case 'weekly-mvp':
        return <WeeklyMVPWidget />;
      case 'review-tasks':
        return <ReviewTasksWidget />;
      case 'sse-status':
        return <SSEStatusWidget />;
      case 'pipeline-summary':
        return <PipelineSummaryWidget />;
      case 'kpi-summary':
        return <KPISummaryWidget />;
      case 'evolution-leaderboard':
        return <EvolutionLeaderboardWidget />;
      default:
        return null;
    }
  }

  return (
    <>
      {/* Toolbar */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'flex-end',
          marginBottom: 16,
        }}
      >
        <button
          onClick={() => setCustomizeOpen(true)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '7px 14px',
            background: 'var(--color-content-bg)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-md)',
            fontSize: 13,
            fontWeight: 500,
            color: 'var(--color-text)',
            cursor: 'pointer',
            boxShadow: 'var(--shadow-sm)',
            transition: 'background var(--transition)',
          }}
          onMouseOver={(e) => (e.currentTarget.style.background = 'var(--color-bg)')}
          onMouseOut={(e) => (e.currentTarget.style.background = 'var(--color-content-bg)')}
        >
          <span style={{ fontSize: 15 }}>&#9881;</span>
          Customize
        </button>
      </div>

      {/* Widget grid — 3-column base, widgets span according to their size */}
      {error && <ErrorMessage error={error as Error} />}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 16,
          alignItems: 'start',
        }}
      >
        {visibleWidgets.map((w) => (
          <div key={w.id} style={colSpanStyle(w.size)}>
            {renderWidget(w.id)}
          </div>
        ))}
      </div>

      {/* Overlay backdrop when customize panel is open */}
      {customizeOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.25)',
            zIndex: 199,
          }}
          onClick={() => setCustomizeOpen(false)}
        />
      )}

      {customizeOpen && (
        <CustomizePanel
          widgets={widgets}
          setVisibility={setVisibility}
          reset={reset}
          onClose={() => setCustomizeOpen(false)}
        />
      )}
    </>
  );
}
