import { useState, useCallback } from 'react';
import type { WidgetConfig, WidgetGridConfig, WidgetId } from './types';

const STORAGE_KEY = 'grc_dashboard_widget_config_v1';

/** Default widget layout — stat widgets first, then charts, then composite widgets. */
const DEFAULT_CONFIG: WidgetConfig[] = [
  { id: 'stat-total-users',          visible: true, order: 0,  size: '1x1' },
  { id: 'stat-active-nodes',         visible: true, order: 1,  size: '1x1' },
  { id: 'stat-total-genes',          visible: true, order: 2,  size: '1x1' },
  { id: 'stat-total-assets',         visible: true, order: 3,  size: '1x1' },
  { id: 'stat-update-success-rate',  visible: true, order: 4,  size: '1x1' },
  { id: 'stat-telemetry-nodes',      visible: true, order: 5,  size: '1x1' },
  { id: 'stat-telemetry-reports',    visible: true, order: 6,  size: '1x1' },
  { id: 'stat-community-posts',      visible: true, order: 7,  size: '1x1' },
  { id: 'chart-daily-telemetry',     visible: true, order: 8,  size: '2x1' },
  { id: 'chart-platform-distribution', visible: true, order: 9, size: '1x1' },
  { id: 'chart-genes-by-status',     visible: true, order: 10, size: '3x1' },
  { id: 'task-summary',              visible: true, order: 11, size: '1x1' },
  { id: 'community-feed',            visible: true, order: 12, size: '2x1' },
  { id: 'message-queue',             visible: true, order: 13, size: '1x1' },
  { id: 'today-meetings',            visible: true, order: 14, size: '2x1' },
  { id: 'weekly-mvp',                visible: true, order: 15, size: '1x1' },
  { id: 'review-tasks',              visible: true, order: 16, size: '2x1' },
  { id: 'sse-status',                visible: true, order: 17, size: '1x1' },
  { id: 'pipeline-summary',          visible: true, order: 18, size: '2x1' },
  { id: 'kpi-summary',               visible: true, order: 19, size: '1x1' },
  { id: 'evolution-leaderboard',     visible: true, order: 20, size: '2x1' },
];

function load(): WidgetConfig[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_CONFIG;
    const parsed: WidgetGridConfig = JSON.parse(raw);
    if (!parsed?.widgets?.length) return DEFAULT_CONFIG;

    // Merge saved config with defaults so newly-added widgets appear automatically.
    const savedMap = new Map(parsed.widgets.map((w) => [w.id, w]));
    return DEFAULT_CONFIG.map((def) => savedMap.get(def.id) ?? def);
  } catch {
    return DEFAULT_CONFIG;
  }
}

function save(widgets: WidgetConfig[]) {
  const config: WidgetGridConfig = { widgets, savedAt: new Date().toISOString() };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
}

export function useWidgetConfig() {
  const [widgets, setWidgets] = useState<WidgetConfig[]>(load);

  const setVisibility = useCallback((id: WidgetId, visible: boolean) => {
    setWidgets((prev) => {
      const next = prev.map((w) => (w.id === id ? { ...w, visible } : w));
      save(next);
      return next;
    });
  }, []);

  const reorder = useCallback((from: number, to: number) => {
    setWidgets((prev) => {
      const sorted = [...prev].sort((a, b) => a.order - b.order);
      const [moved] = sorted.splice(from, 1);
      sorted.splice(to, 0, moved);
      const next = sorted.map((w, i) => ({ ...w, order: i }));
      save(next);
      return next;
    });
  }, []);

  const setSize = useCallback((id: WidgetId, size: WidgetConfig['size']) => {
    setWidgets((prev) => {
      const next = prev.map((w) => (w.id === id ? { ...w, size } : w));
      save(next);
      return next;
    });
  }, []);

  const reset = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    setWidgets(DEFAULT_CONFIG);
  }, []);

  const sorted = [...widgets].sort((a, b) => a.order - b.order);

  return { widgets: sorted, setVisibility, reorder, setSize, reset };
}
