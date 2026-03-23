import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../api/client';

// ── Types ──────────────────────────────────────────────────────────────────

interface KPI {
  id: string;
  name: string;
  description?: string;
  category: string;
  current_value: number;
  target_value: number;
  unit: string;
  achievement_rate: number; // 0–100
  period?: string;
}

interface KPIDashboardResponse {
  kpis: KPI[];
  total: number;
}

interface CreateKPIBody {
  name: string;
  description?: string;
  category: string;
  target_value: number;
  unit: string;
}

interface RecordValueBody {
  kpi_id: string;
  value: number;
  recorded_at?: string;
  note?: string;
}

// ── Constants ──────────────────────────────────────────────────────────────

const CATEGORIES = ['All', 'Revenue', 'Growth', 'Efficiency', 'Quality'];

// ── Helpers ────────────────────────────────────────────────────────────────

function achievementColor(rate: number): string {
  if (rate >= 80) return '#10b981';
  if (rate >= 50) return '#f59e0b';
  return '#ef4444';
}

// ── Subcomponents ──────────────────────────────────────────────────────────

function KPICard({ kpi, onRecord }: { kpi: KPI; onRecord: (kpi: KPI) => void }) {
  const { t } = useTranslation('marketing');
  const color = achievementColor(kpi.achievement_rate);
  return (
    <div
      className="card"
      style={{
        padding: '16px 20px',
        borderLeft: `4px solid ${color}`,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 2 }}>{kpi.name}</div>
          {kpi.description && (
            <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 6 }}>
              {kpi.description}
            </div>
          )}
          <span
            style={{
              fontSize: 10,
              fontWeight: 600,
              background: 'var(--color-bg)',
              color: 'var(--color-text-secondary)',
              borderRadius: 4,
              padding: '1px 6px',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
            }}
          >
            {kpi.category}
          </span>
        </div>
        <button
          className="btn btn-default btn-sm"
          onClick={() => onRecord(kpi)}
          style={{ fontSize: 11, whiteSpace: 'nowrap' }}
        >
          {t('kpi.recordValue', { defaultValue: 'Record Value' })}
        </button>
      </div>

      {/* Values */}
      <div style={{ display: 'flex', gap: 24, marginBottom: 12, marginTop: 10 }}>
        <div>
          <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 2 }}>{t('kpi.current')}</div>
          <div style={{ fontSize: 20, fontWeight: 800, color }}>
            {kpi.current_value.toLocaleString()}
            <span style={{ fontSize: 12, fontWeight: 500, marginLeft: 2 }}>{kpi.unit}</span>
          </div>
        </div>
        <div>
          <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 2 }}>{t('kpi.target')}</div>
          <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--color-text)' }}>
            {kpi.target_value.toLocaleString()}
            <span style={{ fontSize: 12, fontWeight: 500, marginLeft: 2 }}>{kpi.unit}</span>
          </div>
        </div>
        <div>
          <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 2 }}>{t('kpi.progress')}</div>
          <div style={{ fontSize: 20, fontWeight: 800, color }}>
            {kpi.achievement_rate.toFixed(1)}%
          </div>
        </div>
      </div>

      {/* Progress bar */}
      <div>
        <div style={{ height: 8, background: 'var(--color-border)', borderRadius: 4, overflow: 'hidden' }}>
          <div
            style={{
              height: '100%',
              width: `${Math.min(kpi.achievement_rate, 100)}%`,
              background: color,
              borderRadius: 4,
              transition: 'width 0.4s ease',
            }}
          />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--color-text-muted)', marginTop: 3 }}>
          <span>0</span>
          <span>
            {kpi.achievement_rate >= 80 ? 'On Track' : kpi.achievement_rate >= 50 ? 'At Risk' : 'Off Track'}
          </span>
          <span>{t('kpi.target')}</span>
        </div>
      </div>
    </div>
  );
}

// ── Create KPI Modal ───────────────────────────────────────────────────────

interface CreateKPIModalProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (body: CreateKPIBody) => void;
  loading: boolean;
}

function CreateKPIModal({ open, onClose, onSubmit, loading }: CreateKPIModalProps) {
  const { t } = useTranslation('marketing');
  const [form, setForm] = useState<CreateKPIBody>({
    name: '',
    description: '',
    category: 'Revenue',
    target_value: 0,
    unit: '',
  });

  if (!open) return null;

  function handleChange(field: keyof CreateKPIBody, value: string | number) {
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
          width: 460,
          maxWidth: '95vw',
          boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>{t('kpi.modal.title')}</h2>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: 'var(--color-text-secondary)' }}
          >
            &times;
          </button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label">{t('kpi.modal.nameLabel')}</label>
            <input
              className="input"
              type="text"
              value={form.name}
              onChange={(e) => handleChange('name', e.target.value)}
              required
            />
          </div>
          <div className="form-group">
            <label className="form-label">{t('kpi.modal.descriptionLabel', { defaultValue: 'Description' })}</label>
            <textarea
              className="textarea"
              rows={2}
              value={form.description}
              onChange={(e) => handleChange('description', e.target.value)}
            />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            <div className="form-group">
              <label className="form-label">{t('kpi.modal.categoryLabel')}</label>
              <select
                className="input"
                value={form.category}
                onChange={(e) => handleChange('category', e.target.value)}
              >
                {CATEGORIES.filter((c) => c !== 'All').map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">{t('kpi.modal.targetLabel')}</label>
              <input
                className="input"
                type="number"
                min={0}
                value={form.target_value}
                onChange={(e) => handleChange('target_value', Number(e.target.value))}
                required
              />
            </div>
            <div className="form-group">
              <label className="form-label">{t('kpi.modal.unitLabel')}</label>
              <input
                className="input"
                type="text"
                value={form.unit}
                onChange={(e) => handleChange('unit', e.target.value)}
                required
                placeholder={t('kpi.modal.unitPlaceholder')}
              />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
            <button type="button" className="btn btn-default" onClick={onClose}>
              {t('kpi.modal.cancel')}
            </button>
            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading ? t('kpi.modal.creating') : t('kpi.modal.create')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Record Value Modal ─────────────────────────────────────────────────────

interface RecordValueModalProps {
  kpi: KPI | null;
  onClose: () => void;
  onSubmit: (body: RecordValueBody) => void;
  loading: boolean;
}

function RecordValueModal({ kpi, onClose, onSubmit, loading }: RecordValueModalProps) {
  const { t } = useTranslation('marketing');
  const [value, setValue] = useState('');
  const [note, setNote] = useState('');

  if (!kpi) return null;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!kpi) return;
    onSubmit({ kpi_id: kpi.id, value: Number(value), note: note || undefined });
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
          width: 380,
          maxWidth: '95vw',
          boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>{t('kpi.recordValue', { defaultValue: 'Record Value' })}</h2>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: 'var(--color-text-secondary)' }}
          >
            &times;
          </button>
        </div>
        <p style={{ margin: '0 0 16px', fontSize: 13, color: 'var(--color-text-secondary)' }}>
          <strong>{kpi.name}</strong> — {t('kpi.target')}: {kpi.target_value} {kpi.unit}
        </p>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label">{t('kpi.current')} ({kpi.unit}) *</label>
            <input
              className="input"
              type="number"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              required
              placeholder={`例: ${kpi.target_value}`}
            />
          </div>
          <div className="form-group">
            <label className="form-label">{t('kpi.noteLabel', { defaultValue: 'Note' })}</label>
            <textarea
              className="textarea"
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={t('kpi.notePlaceholder', { defaultValue: 'Additional info...' })}
            />
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
            <button type="button" className="btn btn-default" onClick={onClose}>
              {t('kpi.modal.cancel')}
            </button>
            <button type="submit" className="btn btn-primary" disabled={loading || !value}>
              {loading ? t('kpi.recording', { defaultValue: 'Recording...' }) : t('kpi.record', { defaultValue: 'Record' })}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────

export function KPIDashboard() {
  const { t } = useTranslation('marketing');
  const [activeCategory, setActiveCategory] = useState('All');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [recordingKPI, setRecordingKPI] = useState<KPI | null>(null);
  const queryClient = useQueryClient();

  const { data, isLoading, error } = useQuery<KPIDashboardResponse>({
    queryKey: ['kpis-dashboard'],
    queryFn: () => apiClient.get<KPIDashboardResponse>('/api/v1/admin/kpis/dashboard'),
    retry: false,
  });

  const createMutation = useMutation({
    mutationFn: (body: CreateKPIBody) =>
      apiClient.post('/api/v1/admin/kpis', body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['kpis-dashboard'] });
      setShowCreateModal(false);
    },
  });

  const recordMutation = useMutation({
    mutationFn: (body: RecordValueBody) =>
      apiClient.post(`/api/v1/admin/kpis/${body.kpi_id}/values`, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['kpis-dashboard'] });
      setRecordingKPI(null);
    },
  });

  const allKPIs = data?.kpis ?? [];
  const filteredKPIs = activeCategory === 'All'
    ? allKPIs
    : allKPIs.filter((k) => k.category === activeCategory);

  // Summary stats
  const onTrack = allKPIs.filter((k) => k.achievement_rate >= 80).length;
  const atRisk = allKPIs.filter((k) => k.achievement_rate >= 50 && k.achievement_rate < 80).length;
  const offTrack = allKPIs.filter((k) => k.achievement_rate < 50).length;

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">{t('kpi.title')}</h1>
          <p className="page-subtitle">{t('kpi.subtitle')}</p>
        </div>
        <div className="action-group">
          <button className="btn btn-primary" onClick={() => setShowCreateModal(true)}>
            {t('kpi.newKPI')}
          </button>
        </div>
      </div>

      {/* Summary cards */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        {[
          { label: 'On Track', count: onTrack, color: '#10b981' },
          { label: 'At Risk', count: atRisk, color: '#f59e0b' },
          { label: 'Off Track', count: offTrack, color: '#ef4444' },
          { label: t('kpi.summary.total'), count: allKPIs.length, color: '#3b82f6' },
        ].map((s) => (
          <div
            key={s.label}
            className="card"
            style={{ flex: '1 1 140px', padding: '12px 16px', borderTop: `3px solid ${s.color}` }}
          >
            <div style={{ fontSize: 22, fontWeight: 800, color: s.color }}>{s.count}</div>
            <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 2 }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Category tabs */}
      <div
        style={{
          display: 'flex',
          gap: 4,
          marginBottom: 20,
          borderBottom: '2px solid var(--color-border)',
          flexWrap: 'wrap',
        }}
      >
        {CATEGORIES.map((cat) => (
          <button
            key={cat}
            onClick={() => setActiveCategory(cat)}
            style={{
              padding: '8px 16px',
              fontSize: 13,
              fontWeight: activeCategory === cat ? 700 : 500,
              background: 'none',
              border: 'none',
              borderBottom: activeCategory === cat ? '2px solid var(--color-primary)' : '2px solid transparent',
              color: activeCategory === cat ? 'var(--color-primary)' : 'var(--color-text-secondary)',
              cursor: 'pointer',
              marginBottom: -2,
              transition: 'color 0.15s',
            }}
          >
            {cat}
            {cat !== 'All' && (
              <span
                style={{
                  marginLeft: 6,
                  fontSize: 10,
                  background: 'var(--color-bg)',
                  borderRadius: 10,
                  padding: '1px 6px',
                }}
              >
                {allKPIs.filter((k) => k.category === cat).length}
              </span>
            )}
          </button>
        ))}
      </div>

      {isLoading && (
        <div style={{ textAlign: 'center', padding: '48px', color: 'var(--color-text-muted)' }}>
          {t('kpi.loading')}
        </div>
      )}

      {error && (
        <div style={{ textAlign: 'center', padding: '48px', color: 'var(--color-danger, #ef4444)' }}>
          {t('kpi.loadError')}
        </div>
      )}

      {!isLoading && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))',
            gap: 16,
          }}
        >
          {filteredKPIs.length === 0 && (
            <div style={{ gridColumn: '1 / -1', textAlign: 'center', padding: '48px', color: 'var(--color-text-muted)' }}>
              {t('kpi.noKPI')}
            </div>
          )}
          {filteredKPIs.map((kpi) => (
            <KPICard key={kpi.id} kpi={kpi} onRecord={setRecordingKPI} />
          ))}
        </div>
      )}

      <CreateKPIModal
        open={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onSubmit={(body) => createMutation.mutate(body)}
        loading={createMutation.isPending}
      />

      <RecordValueModal
        kpi={recordingKPI}
        onClose={() => setRecordingKPI(null)}
        onSubmit={(body) => recordMutation.mutate(body)}
        loading={recordMutation.isPending}
      />
    </div>
  );
}
