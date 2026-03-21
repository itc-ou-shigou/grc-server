import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../api/client';

interface SSENode {
  node_id: string;
  employee_name: string | null;
  role_id: string | null;
  connected: boolean;
  last_heartbeat: string | null;
}

interface SSEStatusResponse {
  ok: boolean;
  connected_nodes: number;
  total_connections: number;
  total_nodes: number;
  nodes: SSENode[];
}

export function SSEStatusWidget() {
  const { data, isLoading } = useQuery<SSEStatusResponse>({
    queryKey: ['admin', 'sse-status'],
    queryFn: () => apiClient.get('/api/v1/admin/evolution/sse/status'),
    staleTime: 30_000,
    refetchInterval: 30_000,
  });

  if (isLoading) return <div className="widget-skeleton" />;

  const connected = data?.connected_nodes ?? 0;
  const total = data?.total_nodes ?? 0;
  const nodes = data?.nodes ?? [];

  return (
    <div style={{ padding: 16 }}>
      <h4 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 600 }}>
        <span
          style={{
            display: 'inline-block',
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: connected > 0 ? '#4ade80' : 'rgba(224, 229, 251, 0.35)',
            marginRight: 6,
            verticalAlign: 'middle',
          }}
        />
        {connected}/{total} ノード接続中
      </h4>

      {nodes.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {nodes.map((n) => (
            <div
              key={n.node_id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '6px 10px',
                borderRadius: 6,
                background: 'var(--color-bg)',
                fontSize: 13,
              }}
            >
              <span
                style={{
                  display: 'inline-block',
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  background: '#4ade80',
                  flexShrink: 0,
                }}
              />
              <span style={{ fontWeight: 500 }}>{n.employee_name ?? n.node_id}</span>
              {n.role_id && (
                <span
                  style={{
                    marginLeft: 'auto',
                    fontSize: 11,
                    color: 'var(--color-text-muted)',
                    background: 'var(--color-content-bg)',
                    padding: '2px 6px',
                    borderRadius: 4,
                  }}
                >
                  {n.role_id}
                </span>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
          接続中のノードはありません
        </div>
      )}

      {data && (
        <div style={{ marginTop: 10, fontSize: 11, color: 'var(--color-text-muted)' }}>
          総接続数: {data.total_connections}
        </div>
      )}
    </div>
  );
}
