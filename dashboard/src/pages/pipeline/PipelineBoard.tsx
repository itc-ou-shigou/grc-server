import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../api/client';

// ── Types ──────────────────────────────────────────────────────────────────

interface Deal {
  id: string;
  company_name: string;
  deal_title: string;
  deal_value: number;
  probability: number;
  expected_close_date: string;
  stage: PipelineStage;
  contact_name?: string;
  notes?: string;
}

interface PipelineListResponse {
  deals: Deal[];
  total: number;
}

interface CreateDealBody {
  company_name: string;
  deal_title: string;
  deal_value: number;
  probability: number;
  expected_close_date: string;
  stage: PipelineStage;
}

type PipelineStage =
  | 'lead'
  | 'qualified'
  | 'proposal'
  | 'negotiation'
  | 'closed_won'
  | 'closed_lost';

// ── Constants ──────────────────────────────────────────────────────────────

const STAGES: Array<{ id: PipelineStage; label: string; color: string }> = [
  { id: 'lead',        label: 'Lead',        color: 'rgba(224, 229, 251, 0.55)' },
  { id: 'qualified',   label: 'Qualified',   color: '#81ecff' },
  { id: 'proposal',    label: 'Proposal',    color: '#b287fe' },
  { id: 'negotiation', label: 'Negotiation', color: '#ffbe0b' },
  { id: 'closed_won',  label: 'Closed Won',  color: '#4ade80' },
  { id: 'closed_lost', label: 'Closed Lost', color: '#ef4444' },
];

const STAGE_ORDER: PipelineStage[] = [
  'lead', 'qualified', 'proposal', 'negotiation', 'closed_won', 'closed_lost',
];

// ── Helpers ────────────────────────────────────────────────────────────────

function formatYen(value: number): string {
  return `¥${value.toLocaleString('ja-JP')}`;
}

function nextStage(current: PipelineStage): PipelineStage | null {
  const idx = STAGE_ORDER.indexOf(current);
  if (idx < 0 || idx >= STAGE_ORDER.length - 1) return null;
  return STAGE_ORDER[idx + 1];
}

// ── Deal Card ──────────────────────────────────────────────────────────────

interface DealCardProps {
  deal: Deal;
  onStageChange: (id: string, stage: PipelineStage) => void;
  stageChanging: boolean;
}

function DealCard({ deal, onStageChange, stageChanging }: DealCardProps) {
  const { t } = useTranslation('marketing');
  const next = nextStage(deal.stage);
  const stageInfo = STAGES.find((s) => s.id === deal.stage);

  return (
    <div
      style={{
        background: 'var(--color-content-bg)',
        border: '1px solid var(--color-border)',
        borderRadius: 8,
        padding: '12px',
        marginBottom: 8,
        boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
      }}
    >
      <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 4 }}>{deal.company_name}</div>
      <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginBottom: 8 }}>
        {deal.deal_title}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
        <span style={{ fontWeight: 700, fontSize: 15, color: stageInfo?.color ?? '#333' }}>
          {formatYen(deal.deal_value)}
        </span>
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: deal.probability >= 70 ? '#10b981' : deal.probability >= 40 ? '#f59e0b' : '#ef4444',
          }}
        >
          {deal.probability}%
        </span>
      </div>
      <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 10 }}>
        {t('pipeline.deadline', { date: deal.expected_close_date, defaultValue: `Closing: ${deal.expected_close_date}` })}
      </div>
      {next && (
        <button
          style={{
            width: '100%',
            padding: '5px 0',
            fontSize: 11,
            fontWeight: 600,
            background: 'var(--color-bg)',
            border: '1px solid var(--color-border)',
            borderRadius: 4,
            cursor: 'pointer',
            color: 'var(--color-text-secondary)',
          }}
          disabled={stageChanging}
          onClick={() => onStageChange(deal.id, next)}
        >
          {t(`pipeline.stages.${next}`)} &#8594;
        </button>
      )}
    </div>
  );
}

// ── Create Modal ───────────────────────────────────────────────────────────

interface CreateModalProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (body: CreateDealBody) => void;
  loading: boolean;
}

function CreateModal({ open, onClose, onSubmit, loading }: CreateModalProps) {
  const { t } = useTranslation('marketing');
  const [form, setForm] = useState<CreateDealBody>({
    company_name: '',
    deal_title: '',
    deal_value: 0,
    probability: 50,
    expected_close_date: '',
    stage: 'lead',
  });

  if (!open) return null;

  function handleChange(field: keyof CreateDealBody, value: string | number) {
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
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>{t('pipeline.modal.title')}</h2>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: 'var(--color-text-secondary)' }}
          >
            &times;
          </button>
        </div>
        <form onSubmit={handleSubmit}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div className="form-group">
              <label className="form-label">{t('pipeline.modal.companyLabel')}</label>
              <input
                className="input"
                type="text"
                value={form.company_name}
                onChange={(e) => handleChange('company_name', e.target.value)}
                required
              />
            </div>
            <div className="form-group">
              <label className="form-label">{t('pipeline.modal.nameLabel')}</label>
              <input
                className="input"
                type="text"
                value={form.deal_title}
                onChange={(e) => handleChange('deal_title', e.target.value)}
                required
              />
            </div>
            <div className="form-group">
              <label className="form-label">{t('pipeline.modal.valueLabel')}</label>
              <input
                className="input"
                type="number"
                min={0}
                value={form.deal_value}
                onChange={(e) => handleChange('deal_value', Number(e.target.value))}
                required
              />
            </div>
            <div className="form-group">
              <label className="form-label">{t('pipeline.modal.probabilityLabel')}</label>
              <input
                className="input"
                type="number"
                min={0}
                max={100}
                value={form.probability}
                onChange={(e) => handleChange('probability', Number(e.target.value))}
                required
              />
            </div>
            <div className="form-group">
              <label className="form-label">{t('pipeline.modal.closeDateLabel', { defaultValue: 'Expected Close *' })}</label>
              <input
                className="input"
                type="date"
                value={form.expected_close_date}
                onChange={(e) => handleChange('expected_close_date', e.target.value)}
                required
              />
            </div>
            <div className="form-group">
              <label className="form-label">{t('pipeline.modal.stageLabel')}</label>
              <select
                className="input"
                value={form.stage}
                onChange={(e) => handleChange('stage', e.target.value as PipelineStage)}
              >
                {STAGES.map((s) => (
                  <option key={s.id} value={s.id}>{t(`pipeline.stages.${s.id}`)}</option>
                ))}
              </select>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
            <button type="button" className="btn btn-default" onClick={onClose}>
              {t('pipeline.modal.cancel')}
            </button>
            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading ? t('pipeline.modal.creating') : t('pipeline.modal.create')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────

export function PipelineBoard() {
  const { t } = useTranslation('marketing');
  const [showModal, setShowModal] = useState(false);
  const queryClient = useQueryClient();

  const { data, isLoading, error } = useQuery<PipelineListResponse>({
    queryKey: ['pipeline'],
    queryFn: () => apiClient.get<PipelineListResponse>('/api/v1/admin/pipeline'),
    retry: false,
  });

  const createMutation = useMutation({
    mutationFn: (body: CreateDealBody) =>
      apiClient.post('/api/v1/admin/pipeline', body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pipeline'] });
      setShowModal(false);
    },
  });

  const stageChangeMutation = useMutation({
    mutationFn: ({ id, stage }: { id: string; stage: PipelineStage }) =>
      apiClient.patch(`/api/v1/admin/pipeline/${id}`, { stage }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pipeline'] });
    },
  });

  const deals = data?.deals ?? [];

  // Summary calculations
  const totalPipeline = deals.reduce((sum, d) => sum + d.deal_value, 0);
  const weightedPipeline = deals.reduce(
    (sum, d) => sum + (d.deal_value * d.probability) / 100,
    0,
  );

  function dealsForStage(stage: PipelineStage): Deal[] {
    return deals.filter((d) => d.stage === stage);
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">{t('pipeline.title')}</h1>
          <p className="page-subtitle">{t('pipeline.subtitle')}</p>
        </div>
        <div className="action-group">
          <button className="btn btn-primary" onClick={() => setShowModal(true)}>
            {t('pipeline.newDeal')}
          </button>
        </div>
      </div>

      {/* Summary bar */}
      <div
        style={{
          display: 'flex',
          gap: 16,
          marginBottom: 20,
          flexWrap: 'wrap',
        }}
      >
        <div
          className="card"
          style={{ flex: '1 1 200px', padding: '14px 20px' }}
        >
          <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 4, fontWeight: 500 }}>
            {t('pipeline.totalValue')}
          </div>
          <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--color-text)' }}>
            {formatYen(totalPipeline)}
          </div>
        </div>
        <div
          className="card"
          style={{ flex: '1 1 200px', padding: '14px 20px' }}
        >
          <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 4, fontWeight: 500 }}>
            {t('pipeline.weightedValue')}
          </div>
          <div style={{ fontSize: 22, fontWeight: 800, color: '#3b82f6' }}>
            {formatYen(Math.round(weightedPipeline))}
          </div>
        </div>
        <div
          className="card"
          style={{ flex: '1 1 200px', padding: '14px 20px' }}
        >
          <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 4, fontWeight: 500 }}>
            {t('pipeline.dealCount', { defaultValue: 'Total Deals' })}
          </div>
          <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--color-text)' }}>
            {deals.length}
          </div>
        </div>
      </div>

      {isLoading && (
        <div style={{ textAlign: 'center', padding: '48px', color: 'var(--color-text-muted)' }}>
          {t('pipeline.loading')}
        </div>
      )}

      {error && (
        <div style={{ textAlign: 'center', padding: '48px', color: 'var(--color-danger, #ef4444)' }}>
          {t('pipeline.loadError')}
        </div>
      )}

      {!isLoading && (
        /* Kanban board */
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(6, 1fr)',
            gap: 12,
            alignItems: 'start',
            overflowX: 'auto',
          }}
        >
          {STAGES.map((stage) => {
            const stageDeals = dealsForStage(stage.id);
            const stageTotal = stageDeals.reduce((sum, d) => sum + d.deal_value, 0);
            return (
              <div
                key={stage.id}
                style={{
                  minWidth: 200,
                  background: 'var(--color-bg)',
                  borderRadius: 8,
                  padding: '12px 10px',
                  border: '1px solid var(--color-border)',
                }}
              >
                {/* Column header */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    marginBottom: 12,
                  }}
                >
                  <div>
                    <div
                      style={{
                        fontWeight: 700,
                        fontSize: 12,
                        color: stage.color,
                        textTransform: 'uppercase',
                        letterSpacing: '0.05em',
                      }}
                    >
                      {t(`pipeline.stages.${stage.id}`)}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 2 }}>
                      {formatYen(stageTotal)}
                    </div>
                  </div>
                  <span
                    style={{
                      background: stage.color,
                      color: '#080e1d',
                      borderRadius: 12,
                      padding: '1px 8px',
                      fontSize: 11,
                      fontWeight: 700,
                    }}
                  >
                    {stageDeals.length}
                  </span>
                </div>

                {/* Cards */}
                {stageDeals.length === 0 && (
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
                    {t('pipeline.emptyStage')}
                  </div>
                )}

                {stageDeals.map((deal) => (
                  <DealCard
                    key={deal.id}
                    deal={deal}
                    onStageChange={(id, stage) => stageChangeMutation.mutate({ id, stage })}
                    stageChanging={stageChangeMutation.isPending}
                  />
                ))}
              </div>
            );
          })}
        </div>
      )}

      <CreateModal
        open={showModal}
        onClose={() => setShowModal(false)}
        onSubmit={(body) => createMutation.mutate(body)}
        loading={createMutation.isPending}
      />
    </div>
  );
}
