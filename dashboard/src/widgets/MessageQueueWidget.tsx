import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../api/client';

interface MessageStatsResponse {
  ok?: boolean;
  stats?: {
    by_status?: { pending?: number; delivered?: number; read?: number };
    by_priority?: { normal?: number; high?: number; critical?: number };
    critical_pending?: number;
    total?: number;
  };
}

export function MessageQueueWidget() {
  const { data, isLoading } = useQuery<MessageStatsResponse>({
    queryKey: ['messaging', 'stats'],
    queryFn: () => apiClient.get('/a2a/messages/stats'),
    refetchInterval: 30_000,
  });

  if (isLoading) return <div className="widget-skeleton" />;

  const byStatus = data?.stats?.by_status ?? {};
  const pending = byStatus.pending ?? 0;
  const delivered = byStatus.delivered ?? 0;
  const read = byStatus.read ?? 0;

  return (
    <div style={{ padding: 16 }}>
      <h4 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 600 }}>メッセージキュー</h4>
      <div style={{ display: 'flex', gap: 12 }}>
        <StatPill label="待機中" value={pending} color="#f59e0b" />
        <StatPill label="配信済" value={delivered} color="#3b82f6" />
        <StatPill label="既読" value={read} color="#22c55e" />
      </div>
      {pending > 0 && (
        <div style={{
          marginTop: 12, padding: '8px 12px', borderRadius: 6,
          background: 'rgba(255, 190, 11, 0.12)', color: '#ffbe0b', fontSize: 13,
        }}>
          {pending}件の未処理メッセージ
        </div>
      )}
    </div>
  );
}

function StatPill({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{
      flex: 1, textAlign: 'center', padding: '8px 4px',
      borderRadius: 8, background: `${color}15`, border: `1px solid ${color}30`,
    }}>
      <div style={{ fontSize: 20, fontWeight: 700, color }}>{value}</div>
      <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>{label}</div>
    </div>
  );
}
