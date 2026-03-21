import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../api/client';

// ── Types ──────────────────────────────────────────────────────────────────

type RoadmapPhase = 'now' | 'next' | 'later' | 'done';
type MoSCoW = 'must' | 'should' | 'could' | 'wont';

interface RoadmapItem {
  id: string;
  title: string;
  phase: RoadmapPhase;
  priority: MoSCoW;
  progress: number; // 0–100
  owner_role?: string;
  start_date?: string;
  end_date?: string;
  description?: string;
}

interface RoadmapListResponse {
  items: RoadmapItem[];
  total: number;
}

interface CreateItemBody {
  title: string;
  phase: RoadmapPhase;
  priority: MoSCoW;
  progress: number;
  owner_role?: string;
  start_date?: string;
  end_date?: string;
  description?: string;
}

// ── Constants ──────────────────────────────────────────────────────────────

const PHASES: Array<{ id: RoadmapPhase; label: string; color: string }> = [
  { id: 'now',  label: 'Now',  color: '#ef4444' },
  { id: 'next', label: 'Next', color: '#f59e0b' },
  { id: 'later', label: 'Later', color: '#3b82f6' },
  { id: 'done', label: 'Done', color: '#10b981' },
];

const PRIORITY_CONFIG: Record<MoSCoW, { label: string; bg: string; color: string }> = {
  must:   { label: 'Must',   bg: 'rgba(239, 68, 68, 0.12)',  color: '#ef4444' },
  should: { label: 'Should', bg: 'rgba(255, 190, 11, 0.12)', color: '#ffbe0b' },
  could:  { label: 'Could',  bg: 'rgba(0, 229, 255, 0.12)',  color: '#00E5FF' },
  wont:   { label: "Won't",  bg: 'rgba(66, 72, 89, 0.20)',   color: 'rgba(224, 229, 251, 0.55)' },
};

// ── Subcomponents ──────────────────────────────────────────────────────────

function PriorityBadge({ priority }: { priority: MoSCoW }) {
  const cfg = PRIORITY_CONFIG[priority];
  return (
    <span
      style={{
        background: cfg.bg,
        color: cfg.color,
        borderRadius: 4,
        padding: '1px 7px',
        fontSize: 11,
        fontWeight: 700,
      }}
    >
      {cfg.label}
    </span>
  );
}

function ProgressBar({ value }: { value: number }) {
  const color = value >= 80 ? '#10b981' : value >= 40 ? '#f59e0b' : '#ef4444';
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 3, color: 'var(--color-text-muted)' }}>
        <span>進捗</span>
        <span style={{ fontWeight: 600 }}>{value}%</span>
      </div>
      <div style={{ height: 5, background: 'var(--color-border)', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${value}%`, background: color, borderRadius: 3, transition: 'width 0.3s' }} />
      </div>
    </div>
  );
}

function ItemCard({ item }: { item: RoadmapItem }) {
  return (
    <div
      style={{
        background: 'var(--color-content-bg)',
        border: '1px solid var(--color-border)',
        borderRadius: 8,
        padding: '12px',
        marginBottom: 8,
        boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
        <span style={{ fontWeight: 600, fontSize: 13, flex: 1, marginRight: 8 }}>{item.title}</span>
        <PriorityBadge priority={item.priority} />
      </div>
      <ProgressBar value={item.progress} />
      {item.owner_role && (
        <div style={{ marginTop: 6, fontSize: 11, color: 'var(--color-text-muted)' }}>
          担当: <span style={{ fontWeight: 500 }}>{item.owner_role}</span>
        </div>
      )}
    </div>
  );
}

// ── Create Modal ───────────────────────────────────────────────────────────

interface CreateModalProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (body: CreateItemBody) => void;
  loading: boolean;
}

function CreateModal({ open, onClose, onSubmit, loading }: CreateModalProps) {
  const [form, setForm] = useState<CreateItemBody>({
    title: '',
    phase: 'now',
    priority: 'should',
    progress: 0,
    owner_role: '',
    start_date: '',
    end_date: '',
    description: '',
  });

  if (!open) return null;

  function handleChange(field: keyof CreateItemBody, value: string | number) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onSubmit(form);
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.4)',
        zIndex: 300,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: 'var(--color-content-bg)',
          borderRadius: 8,
          padding: '24px',
          width: 480,
          maxWidth: '95vw',
          boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>新規アイテム</h2>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: 'var(--color-text-secondary)' }}
          >
            &times;
          </button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label">タイトル *</label>
            <input
              className="input"
              type="text"
              value={form.title}
              onChange={(e) => handleChange('title', e.target.value)}
              required
            />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div className="form-group">
              <label className="form-label">フェーズ *</label>
              <select
                className="input"
                value={form.phase}
                onChange={(e) => handleChange('phase', e.target.value as RoadmapPhase)}
              >
                {PHASES.map((p) => (
                  <option key={p.id} value={p.id}>{p.label}</option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">優先度 *</label>
              <select
                className="input"
                value={form.priority}
                onChange={(e) => handleChange('priority', e.target.value as MoSCoW)}
              >
                {(Object.keys(PRIORITY_CONFIG) as MoSCoW[]).map((k) => (
                  <option key={k} value={k}>{PRIORITY_CONFIG[k].label}</option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">進捗 (%)</label>
              <input
                className="input"
                type="number"
                min={0}
                max={100}
                value={form.progress}
                onChange={(e) => handleChange('progress', Number(e.target.value))}
              />
            </div>
            <div className="form-group">
              <label className="form-label">担当ロール</label>
              <input
                className="input"
                type="text"
                value={form.owner_role}
                onChange={(e) => handleChange('owner_role', e.target.value)}
              />
            </div>
            <div className="form-group">
              <label className="form-label">開始日</label>
              <input
                className="input"
                type="date"
                value={form.start_date}
                onChange={(e) => handleChange('start_date', e.target.value)}
              />
            </div>
            <div className="form-group">
              <label className="form-label">終了日</label>
              <input
                className="input"
                type="date"
                value={form.end_date}
                onChange={(e) => handleChange('end_date', e.target.value)}
              />
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">説明</label>
            <textarea
              className="textarea"
              rows={3}
              value={form.description}
              onChange={(e) => handleChange('description', e.target.value)}
            />
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
            <button type="button" className="btn btn-default" onClick={onClose}>
              キャンセル
            </button>
            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading ? '作成中...' : '作成'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Kanban View ────────────────────────────────────────────────────────────

function KanbanView({ items }: { items: RoadmapItem[] }) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(4, 1fr)',
        gap: 16,
        alignItems: 'start',
        overflowX: 'auto',
      }}
    >
      {PHASES.map((phase) => {
        const phaseItems = items.filter((i) => i.phase === phase.id);
        return (
          <div
            key={phase.id}
            style={{
              minWidth: 220,
              background: 'var(--color-bg)',
              borderRadius: 8,
              padding: '12px 10px',
              border: '1px solid var(--color-border)',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: 12,
              }}
            >
              <span
                style={{
                  fontWeight: 700,
                  fontSize: 13,
                  color: phase.color,
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                }}
              >
                {phase.label}
              </span>
              <span
                style={{
                  background: phase.color,
                  color: '#080e1d',
                  borderRadius: 12,
                  padding: '1px 8px',
                  fontSize: 11,
                  fontWeight: 700,
                }}
              >
                {phaseItems.length}
              </span>
            </div>
            {phaseItems.length === 0 && (
              <div
                style={{
                  textAlign: 'center',
                  padding: '20px 8px',
                  fontSize: 11,
                  color: 'var(--color-text-muted)',
                  border: '1px dashed var(--color-border)',
                  borderRadius: 6,
                }}
              >
                アイテムなし
              </div>
            )}
            {phaseItems.map((item) => (
              <ItemCard key={item.id} item={item} />
            ))}
          </div>
        );
      })}
    </div>
  );
}

// ── List View ──────────────────────────────────────────────────────────────

function ListView({ items }: { items: RoadmapItem[] }) {
  return (
    <div className="card" style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr style={{ borderBottom: '2px solid var(--color-border)' }}>
            {['タイトル', 'フェーズ', '優先度', '進捗', '開始日', '終了日', '担当'].map((h) => (
              <th
                key={h}
                style={{
                  padding: '8px 12px',
                  textAlign: 'left',
                  fontWeight: 600,
                  fontSize: 12,
                  color: 'var(--color-text-secondary)',
                  whiteSpace: 'nowrap',
                }}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {items.length === 0 && (
            <tr>
              <td colSpan={7} style={{ padding: '32px', textAlign: 'center', color: 'var(--color-text-muted)' }}>
                アイテムがありません
              </td>
            </tr>
          )}
          {items.map((item, idx) => {
            const phaseInfo = PHASES.find((p) => p.id === item.phase);
            const barColor = item.progress >= 80 ? '#10b981' : item.progress >= 40 ? '#f59e0b' : '#ef4444';
            return (
              <tr
                key={item.id}
                style={{
                  borderBottom: '1px solid var(--color-border-light)',
                  background: idx % 2 === 0 ? 'transparent' : 'rgba(12, 19, 36, 0.30)',
                }}
              >
                <td style={{ padding: '10px 12px', fontWeight: 500 }}>{item.title}</td>
                <td style={{ padding: '10px 12px' }}>
                  <span
                    style={{
                      color: phaseInfo?.color ?? '#666',
                      fontWeight: 600,
                      fontSize: 12,
                    }}
                  >
                    {phaseInfo?.label ?? item.phase}
                  </span>
                </td>
                <td style={{ padding: '10px 12px' }}>
                  <PriorityBadge priority={item.priority} />
                </td>
                <td style={{ padding: '10px 12px', minWidth: 120 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ flex: 1, height: 6, background: 'var(--color-border)', borderRadius: 3, overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${item.progress}%`, background: barColor, borderRadius: 3 }} />
                    </div>
                    <span style={{ fontSize: 11, fontWeight: 600, color: barColor, minWidth: 30 }}>
                      {item.progress}%
                    </span>
                  </div>
                </td>
                <td style={{ padding: '10px 12px', fontSize: 12, color: 'var(--color-text-secondary)' }}>
                  {item.start_date ?? '—'}
                </td>
                <td style={{ padding: '10px 12px', fontSize: 12, color: 'var(--color-text-secondary)' }}>
                  {item.end_date ?? '—'}
                </td>
                <td style={{ padding: '10px 12px', fontSize: 12, color: 'var(--color-text-secondary)' }}>
                  {item.owner_role ?? '—'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────

export function Roadmap() {
  const [viewMode, setViewMode] = useState<'kanban' | 'list'>('kanban');
  const [showModal, setShowModal] = useState(false);
  const queryClient = useQueryClient();

  const { data, isLoading, error } = useQuery<RoadmapListResponse>({
    queryKey: ['roadmap'],
    queryFn: () => apiClient.get<RoadmapListResponse>('/api/v1/admin/roadmap'),
    retry: false,
  });

  const createMutation = useMutation({
    mutationFn: (body: CreateItemBody) =>
      apiClient.post('/api/v1/admin/roadmap', body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['roadmap'] });
      setShowModal(false);
    },
  });

  const items = data?.items ?? [];

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">ロードマップ</h1>
          <p className="page-subtitle">プロダクトの開発計画と優先度管理</p>
        </div>
        <div className="action-group">
          {/* View toggle */}
          <div
            style={{
              display: 'flex',
              border: '1px solid var(--color-border)',
              borderRadius: 6,
              overflow: 'hidden',
            }}
          >
            <button
              onClick={() => setViewMode('kanban')}
              style={{
                padding: '6px 14px',
                fontSize: 12,
                fontWeight: 600,
                background: viewMode === 'kanban' ? 'var(--color-primary)' : 'rgba(29, 37, 59, 0.60)',
                color: viewMode === 'kanban' ? '#080e1d' : 'var(--color-text-secondary)',
                border: 'none',
                cursor: 'pointer',
              }}
            >
              カンバン
            </button>
            <button
              onClick={() => setViewMode('list')}
              style={{
                padding: '6px 14px',
                fontSize: 12,
                fontWeight: 600,
                background: viewMode === 'list' ? 'var(--color-primary)' : 'rgba(29, 37, 59, 0.60)',
                color: viewMode === 'list' ? '#080e1d' : 'var(--color-text-secondary)',
                border: 'none',
                cursor: 'pointer',
              }}
            >
              リスト
            </button>
          </div>
          <button className="btn btn-primary" onClick={() => setShowModal(true)}>
            + 新規アイテム
          </button>
        </div>
      </div>

      {/* Priority legend */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        {(Object.keys(PRIORITY_CONFIG) as MoSCoW[]).map((k) => {
          const cfg = PRIORITY_CONFIG[k];
          return (
            <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
              <span
                style={{
                  background: cfg.bg,
                  color: cfg.color,
                  borderRadius: 4,
                  padding: '1px 7px',
                  fontSize: 11,
                  fontWeight: 700,
                }}
              >
                {cfg.label}
              </span>
            </div>
          );
        })}
      </div>

      {isLoading && (
        <div style={{ textAlign: 'center', padding: '48px', color: 'var(--color-text-muted)' }}>
          読み込み中...
        </div>
      )}

      {error && (
        <div style={{ textAlign: 'center', padding: '48px', color: 'var(--color-danger, #ef4444)' }}>
          データの読み込みに失敗しました
        </div>
      )}

      {!isLoading && viewMode === 'kanban' && <KanbanView items={items} />}
      {!isLoading && viewMode === 'list' && <ListView items={items} />}

      <CreateModal
        open={showModal}
        onClose={() => setShowModal(false)}
        onSubmit={(body) => createMutation.mutate(body)}
        loading={createMutation.isPending}
      />
    </div>
  );
}
