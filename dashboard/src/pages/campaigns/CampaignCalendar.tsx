import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../api/client';

// ── Types ──────────────────────────────────────────────────────────────────

interface Campaign {
  id: string;
  title: string;
  channel: 'email' | 'social' | 'content' | 'event';
  start_date: string;
  end_date: string;
  status: string;
  description?: string;
}

interface CampaignListResponse {
  campaigns: Campaign[];
  total: number;
}

interface CreateCampaignBody {
  title: string;
  channel: string;
  start_date: string;
  end_date: string;
  description?: string;
}

// ── Constants ──────────────────────────────────────────────────────────────

const CHANNEL_COLORS: Record<string, string> = {
  email:   '#81ecff',
  social:  '#b287fe',
  content: '#4ade80',
  event:   '#ffbe0b',
};

// ── Helpers ────────────────────────────────────────────────────────────────

function formatYYYYMM(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`;
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

function firstDayOfWeek(year: number, month: number): number {
  return new Date(year, month - 1, 1).getDay();
}

function toDateNum(dateStr: string): number {
  return new Date(dateStr).getTime();
}

// ── Subcomponents ──────────────────────────────────────────────────────────

function CampaignBar({ campaign }: { campaign: Campaign }) {
  const color = CHANNEL_COLORS[campaign.channel] ?? 'rgba(224, 229, 251, 0.55)';
  return (
    <div
      title={`${campaign.title} (${campaign.start_date} ~ ${campaign.end_date})`}
      style={{
        background: color,
        color: '#080e1d',
        fontSize: 10,
        fontWeight: 600,
        borderRadius: 3,
        padding: '1px 4px',
        marginTop: 2,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        cursor: 'default',
      }}
    >
      {campaign.title}
    </div>
  );
}

// ── Modal ──────────────────────────────────────────────────────────────────

interface CreateModalProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (body: CreateCampaignBody) => void;
  loading: boolean;
}

function CreateModal({ open, onClose, onSubmit, loading }: CreateModalProps) {
  const { t } = useTranslation('marketing');
  const [form, setForm] = useState<CreateCampaignBody>({
    title: '',
    channel: 'email',
    start_date: '',
    end_date: '',
    description: '',
  });

  if (!open) return null;

  function handleChange(field: keyof CreateCampaignBody, value: string) {
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
          width: 420,
          maxWidth: '95vw',
          boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>{t('campaign.modal.title')}</h2>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: 'var(--color-text-secondary)' }}
          >
            &times;
          </button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label">{t('campaign.form.title')}</label>
            <input
              className="input"
              type="text"
              value={form.title}
              onChange={(e) => handleChange('title', e.target.value)}
              required
              placeholder={t('campaign.form.titlePlaceholder')}
            />
          </div>
          <div className="form-group">
            <label className="form-label">{t('campaign.form.channel')}</label>
            <select
              className="input"
              value={form.channel}
              onChange={(e) => handleChange('channel', e.target.value)}
              required
            >
              {(['email', 'social', 'content', 'event'] as const).map((val) => (
                <option key={val} value={val}>{t(`campaign.channels.${val}`)}</option>
              ))}
            </select>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div className="form-group">
              <label className="form-label">{t('campaign.form.startDate')}</label>
              <input
                className="input"
                type="date"
                value={form.start_date}
                onChange={(e) => handleChange('start_date', e.target.value)}
                required
              />
            </div>
            <div className="form-group">
              <label className="form-label">{t('campaign.form.endDate')}</label>
              <input
                className="input"
                type="date"
                value={form.end_date}
                onChange={(e) => handleChange('end_date', e.target.value)}
                required
              />
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">{t('campaign.form.description')}</label>
            <textarea
              className="textarea"
              rows={3}
              value={form.description}
              onChange={(e) => handleChange('description', e.target.value)}
              placeholder={t('campaign.form.descriptionPlaceholder')}
            />
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
            <button type="button" className="btn btn-default" onClick={onClose}>
              {t('common.cancel')}
            </button>
            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading ? t('campaign.form.creating') : t('campaign.form.create')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────

export function CampaignCalendar() {
  const { t } = useTranslation('marketing');
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1); // 1-indexed
  const [showModal, setShowModal] = useState(false);

  const queryClient = useQueryClient();

  const startDate = `${formatYYYYMM(year, month)}-01`;
  const endDateDay = daysInMonth(year, month);
  const endDate = `${formatYYYYMM(year, month)}-${endDateDay}`;

  const { data, isLoading, error } = useQuery<CampaignListResponse>({
    queryKey: ['campaigns', year, month],
    queryFn: () =>
      apiClient.get<CampaignListResponse>('/api/v1/admin/campaigns', {
        start_date: startDate,
        end_date: endDate,
      }),
    retry: false,
  });

  const createMutation = useMutation({
    mutationFn: (body: CreateCampaignBody) =>
      apiClient.post('/api/v1/admin/campaigns', body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['campaigns'] });
      setShowModal(false);
    },
  });

  function prevMonth() {
    if (month === 1) {
      setYear((y) => y - 1);
      setMonth(12);
    } else {
      setMonth((m) => m - 1);
    }
  }

  function nextMonth() {
    if (month === 12) {
      setYear((y) => y + 1);
      setMonth(1);
    } else {
      setMonth((m) => m + 1);
    }
  }

  // Build calendar grid
  const totalDays = daysInMonth(year, month);
  const firstDay = firstDayOfWeek(year, month); // 0=Sun

  // Leading empty cells + day cells
  const cells: Array<{ day: number | null }> = [];
  for (let i = 0; i < firstDay; i++) cells.push({ day: null });
  for (let d = 1; d <= totalDays; d++) cells.push({ day: d });
  // Trailing empty cells to complete last row
  const remainder = cells.length % 7;
  if (remainder > 0) {
    for (let i = 0; i < 7 - remainder; i++) cells.push({ day: null });
  }

  // Map campaigns to day cells
  const campaigns = data?.campaigns ?? [];

  function campaignsForDay(day: number): Campaign[] {
    const cellDate = new Date(year, month - 1, day).getTime();
    return campaigns.filter((c) => {
      const s = toDateNum(c.start_date);
      const e = toDateNum(c.end_date);
      return cellDate >= s && cellDate <= e;
    });
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">{t('campaign.title')}</h1>
          <p className="page-subtitle">{t('campaign.subtitle')}</p>
        </div>
        <div className="action-group">
          <button className="btn btn-primary" onClick={() => setShowModal(true)}>
            {t('campaign.newButton')}
          </button>
        </div>
      </div>

      {/* Channel legend */}
      <div style={{ display: 'flex', gap: 16, marginBottom: 16, flexWrap: 'wrap' }}>
        {(['email', 'social', 'content', 'event'] as const).map((ch) => (
          <div key={ch} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
            <div style={{ width: 12, height: 12, borderRadius: 2, background: CHANNEL_COLORS[ch] }} />
            <span style={{ color: 'var(--color-text-secondary)' }}>{t(`campaign.channels.${ch}`)}</span>
          </div>
        ))}
      </div>

      {/* Calendar nav */}
      <div className="card">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <button
            className="btn btn-default btn-sm"
            onClick={prevMonth}
            aria-label={t('calendar.prevMonth')}
          >
            &#8592;
          </button>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>
            {t('calendar.monthYear', { year, month })}
          </h2>
          <button
            className="btn btn-default btn-sm"
            onClick={nextMonth}
            aria-label={t('calendar.nextMonth')}
          >
            &#8594;
          </button>
        </div>

        {isLoading && (
          <div style={{ textAlign: 'center', padding: '32px', color: 'var(--color-text-muted)' }}>
            {t('common.loading')}
          </div>
        )}

        {error && (
          <div style={{ textAlign: 'center', padding: '32px', color: 'var(--color-danger, #ef4444)', fontSize: 13 }}>
            {t('common.loadError')}
          </div>
        )}

        {!isLoading && (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(7, 1fr)',
              gap: 1,
              background: 'var(--color-border)',
              border: '1px solid var(--color-border)',
              borderRadius: 6,
              overflow: 'hidden',
            }}
          >
            {/* Day headers */}
            {((() => { const d = t('calendar.days', { returnObjects: true }); return Array.isArray(d) ? d : ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']; })()).map((name, i) => (
              <div
                key={name}
                style={{
                  background: 'var(--color-bg)',
                  padding: '8px 4px',
                  textAlign: 'center',
                  fontSize: 12,
                  fontWeight: 700,
                  color: i === 0 ? '#ef4444' : i === 6 ? '#3b82f6' : 'var(--color-text-secondary)',
                }}
              >
                {name}
              </div>
            ))}

            {/* Day cells */}
            {cells.map((cell, idx) => {
              const isToday =
                cell.day !== null &&
                cell.day === today.getDate() &&
                month === today.getMonth() + 1 &&
                year === today.getFullYear();

              const dayOfWeek = idx % 7;
              const dayCampaigns = cell.day ? campaignsForDay(cell.day) : [];

              return (
                <div
                  key={idx}
                  style={{
                    background: cell.day === null
                      ? 'rgba(8, 14, 29, 0.60)'
                      : isToday
                      ? 'rgba(129, 236, 255, 0.08)'
                      : 'rgba(12, 19, 36, 0.40)',
                    minHeight: 80,
                    padding: '4px 6px',
                    verticalAlign: 'top',
                  }}
                >
                  {cell.day !== null && (
                    <>
                      <div
                        style={{
                          fontSize: 12,
                          fontWeight: isToday ? 700 : 400,
                          color: isToday
                            ? 'var(--color-primary)'
                            : dayOfWeek === 0
                            ? '#ef4444'
                            : dayOfWeek === 6
                            ? '#81ecff'
                            : 'var(--color-text)',
                          marginBottom: 2,
                        }}
                      >
                        {isToday ? (
                          <span
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              width: 20,
                              height: 20,
                              background: 'var(--color-primary)',
                              color: '#080e1d',
                              borderRadius: '50%',
                              fontSize: 11,
                            }}
                          >
                            {cell.day}
                          </span>
                        ) : (
                          cell.day
                        )}
                      </div>
                      {dayCampaigns.map((c) => (
                        <CampaignBar key={c.id} campaign={c} />
                      ))}
                    </>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Campaign list below calendar */}
      {campaigns.length > 0 && (
        <div className="card" style={{ marginTop: 16 }}>
          <h3 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 700 }}>
            {t('calendar.monthYear', { year, month })} ({t('common.itemCount', { count: campaigns.length })})
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {campaigns.map((c) => (
              <div
                key={c.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '8px 12px',
                  background: 'var(--color-bg)',
                  borderRadius: 6,
                  borderLeft: `3px solid ${CHANNEL_COLORS[c.channel] ?? 'rgba(224, 229, 251, 0.55)'}`,
                }}
              >
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{c.title}</div>
                  <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 2 }}>
                    {c.start_date} ~ {c.end_date}
                  </div>
                </div>
                <span
                  style={{
                    background: CHANNEL_COLORS[c.channel] ?? 'rgba(224, 229, 251, 0.55)',
                    color: '#080e1d',
                    borderRadius: 4,
                    padding: '2px 8px',
                    fontSize: 11,
                    fontWeight: 600,
                  }}
                >
                  {t(`campaign.channels.${c.channel}`) ?? c.channel}
                </span>
                <span
                  style={{
                    fontSize: 11,
                    color: 'var(--color-text-secondary)',
                    background: 'var(--color-border-light)',
                    borderRadius: 4,
                    padding: '2px 8px',
                  }}
                >
                  {c.status}
                </span>
              </div>
            ))}
          </div>
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
