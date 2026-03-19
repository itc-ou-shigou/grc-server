// Widget system types

export type WidgetId =
  | 'stat-total-users'
  | 'stat-active-nodes'
  | 'stat-total-genes'
  | 'stat-total-assets'
  | 'stat-update-success-rate'
  | 'stat-telemetry-nodes'
  | 'stat-telemetry-reports'
  | 'stat-community-posts'
  | 'chart-daily-telemetry'
  | 'chart-platform-distribution'
  | 'chart-genes-by-status'
  | 'community-feed'
  | 'task-summary'
  | 'message-queue'
  | 'today-meetings'
  | 'weekly-mvp'
  | 'review-tasks'
  | 'sse-status'
  | 'pipeline-summary'
  | 'kpi-summary'
  | 'evolution-leaderboard';

export type WidgetSize = '1x1' | '2x1' | '1x2' | '2x2' | '3x1' | '3x2';

export interface WidgetConfig {
  id: WidgetId;
  visible: boolean;
  order: number;
  size: WidgetSize;
  /** User-facing label override (optional) */
  label?: string;
}

export interface WidgetGridConfig {
  widgets: WidgetConfig[];
  /** ISO timestamp of last save */
  savedAt: string;
}

export const WIDGET_SIZE_COLS: Record<WidgetSize, number> = {
  '1x1': 1,
  '2x1': 2,
  '1x2': 1,
  '2x2': 2,
  '3x1': 3,
  '3x2': 3,
};

export const WIDGET_SIZE_ROWS: Record<WidgetSize, number> = {
  '1x1': 1,
  '2x1': 1,
  '1x2': 2,
  '2x2': 2,
  '3x1': 1,
  '3x2': 2,
};
