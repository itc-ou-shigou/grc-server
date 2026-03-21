import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { apiClient } from '../../api/client';

// ── Types ──────────────────────────────────────────────────────────────────

type SkillTier = 'P0' | 'P1' | 'P2' | 'P3';

interface WinClawSkill {
  id: string;
  name: string;
  pluginName: string;
  description: string;
  tier: SkillTier;
  roleCount: number;
  capabilities: string[];
  slashCommands: string[];
  departments: string[];
}

interface SkillsResponse {
  data: WinClawSkill[];
  total: number;
}

// ── Tier Config ─────────────────────────────────────────────────────────────

const TIER_CONFIG: Record<SkillTier, { label: string; bg: string; color: string }> = {
  P0: { label: 'P0 Critical',    bg: 'rgba(239, 68, 68, 0.12)',  color: '#ef4444' },
  P1: { label: 'P1 High',        bg: 'rgba(255, 190, 11, 0.12)', color: '#ffbe0b' },
  P2: { label: 'P2 Medium',      bg: 'rgba(0, 229, 255, 0.12)',  color: '#00E5FF' },
  P3: { label: 'P3 Specialized', bg: 'rgba(66, 72, 89, 0.20)',   color: 'rgba(224, 229, 251, 0.70)' },
};

type TierFilter = 'all' | SkillTier;

const TIER_FILTERS: { value: TierFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'P0',  label: 'P0 Critical' },
  { value: 'P1',  label: 'P1 High' },
  { value: 'P2',  label: 'P2 Medium' },
  { value: 'P3',  label: 'P3 Specialized' },
];

// ── Skill Card ──────────────────────────────────────────────────────────────

interface SkillCardProps {
  skill: WinClawSkill;
  expanded: boolean;
  onToggle: () => void;
}

function SkillCard({ skill, expanded, onToggle }: SkillCardProps) {
  const tier = TIER_CONFIG[skill.tier];

  return (
    <div
      className="card"
      style={{
        padding: '1rem',
        cursor: 'pointer',
        transition: 'box-shadow 0.15s',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.5rem',
      }}
      onClick={onToggle}
    >
      {/* Header row: tier badge + role count */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem' }}>
        <span
          style={{
            display: 'inline-block',
            padding: '0.125rem 0.5rem',
            borderRadius: '0.25rem',
            fontSize: '0.6875rem',
            fontWeight: 700,
            letterSpacing: '0.03em',
            background: tier.bg,
            color: tier.color,
            whiteSpace: 'nowrap',
          }}
        >
          {tier.label}
        </span>
        <span
          style={{
            fontSize: '0.6875rem',
            color: 'var(--color-text-muted)',
            background: 'rgba(12, 19, 36, 0.50)',
            border: '1px solid var(--color-border)',
            borderRadius: '999px',
            padding: '0.125rem 0.5rem',
            whiteSpace: 'nowrap',
          }}
        >
          {skill.roleCount}+ roles
        </span>
      </div>

      {/* Skill name */}
      <div style={{ fontWeight: 700, fontSize: '0.9375rem', lineHeight: 1.3 }}>
        {skill.name}
      </div>

      {/* Plugin name */}
      <div
        style={{
          fontFamily: 'var(--font-mono, monospace)',
          fontSize: '0.75rem',
          color: 'var(--color-text-muted)',
        }}
      >
        {skill.pluginName}
      </div>

      {/* Description (clamped to 2 lines when collapsed) */}
      <div
        style={{
          fontSize: '0.8125rem',
          color: 'var(--color-text-secondary)',
          lineHeight: 1.5,
          overflow: 'hidden',
          display: '-webkit-box',
          WebkitLineClamp: expanded ? 'unset' : 2,
          WebkitBoxOrient: 'vertical' as const,
        }}
      >
        {skill.description}
      </div>

      {/* Expanded details */}
      {expanded && (
        <div
          style={{
            borderTop: '1px solid var(--color-border)',
            paddingTop: '0.75rem',
            marginTop: '0.25rem',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.625rem',
          }}
          onClick={e => e.stopPropagation()}
        >
          {skill.capabilities.length > 0 && (
            <div>
              <div style={{ fontSize: '0.75rem', fontWeight: 600, marginBottom: '0.25rem', color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Capabilities
              </div>
              <ul style={{ margin: 0, paddingLeft: '1.25rem', fontSize: '0.8125rem', lineHeight: 1.6 }}>
                {skill.capabilities.map(cap => (
                  <li key={cap}>{cap}</li>
                ))}
              </ul>
            </div>
          )}

          {skill.slashCommands.length > 0 && (
            <div>
              <div style={{ fontSize: '0.75rem', fontWeight: 600, marginBottom: '0.25rem', color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Slash Commands
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem' }}>
                {skill.slashCommands.map(cmd => (
                  <code
                    key={cmd}
                    style={{
                      fontSize: '0.75rem',
                      background: 'rgba(12, 19, 36, 0.50)',
                      border: '1px solid var(--color-border)',
                      borderRadius: '0.25rem',
                      padding: '0.0625rem 0.375rem',
                    }}
                  >
                    {cmd}
                  </code>
                ))}
              </div>
            </div>
          )}

          {skill.departments.length > 0 && (
            <div>
              <div style={{ fontSize: '0.75rem', fontWeight: 600, marginBottom: '0.25rem', color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Departments
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem' }}>
                {skill.departments.map(dept => (
                  <span
                    key={dept}
                    style={{
                      fontSize: '0.75rem',
                      background: 'rgba(12, 19, 36, 0.50)',
                      border: '1px solid var(--color-border)',
                      borderRadius: '999px',
                      padding: '0.125rem 0.5rem',
                    }}
                  >
                    {dept}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Expand/collapse hint */}
      <div style={{ fontSize: '0.75rem', color: 'var(--color-primary)', marginTop: 'auto', paddingTop: '0.25rem' }}>
        {expanded ? '▲ Collapse' : '▼ Show details'}
      </div>
    </div>
  );
}

// ── Page ────────────────────────────────────────────────────────────────────

export function SkillCatalog() {
  const { t } = useTranslation('roles');
  const [tierFilter, setTierFilter] = useState<TierFilter>('all');
  const [search, setSearch] = useState('');
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const { data, isLoading, error } = useQuery<SkillsResponse>({
    queryKey: ['admin', 'roles', 'skills'],
    queryFn: () => apiClient.get<SkillsResponse>('/api/v1/admin/roles/skills'),
  });

  const skills = data?.data ?? [];

  const filtered = skills.filter(skill => {
    const matchTier = tierFilter === 'all' || skill.tier === tierFilter;
    const q = search.toLowerCase();
    const matchSearch =
      !q ||
      skill.name.toLowerCase().includes(q) ||
      skill.pluginName.toLowerCase().includes(q) ||
      skill.description.toLowerCase().includes(q);
    return matchTier && matchSearch;
  });

  function toggleExpanded(id: string) {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  return (
    <div className="page">
      {/* Page header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">{t('skillCatalog.title')}</h1>
          <p className="page-subtitle">{t('skillCatalog.subtitle')}</p>
        </div>
        {!isLoading && (
          <span style={{ fontSize: '0.875rem', color: 'var(--color-text-muted)' }}>
            {filtered.length} / {skills.length} {t('skillCatalog.skillCount')}
          </span>
        )}
      </div>

      {/* Filters */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '0.75rem',
          alignItems: 'center',
          marginBottom: '1.25rem',
        }}
      >
        {/* Search */}
        <input
          className="input"
          type="search"
          placeholder={t('skillCatalog.searchPlaceholder')}
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ maxWidth: '260px', flex: '1 1 200px' }}
        />

        {/* Tier filter buttons */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.375rem' }}>
          {TIER_FILTERS.map(f => (
            <button
              key={f.value}
              onClick={() => setTierFilter(f.value)}
              style={{
                padding: '0.375rem 0.75rem',
                borderRadius: 'var(--radius-md, 6px)',
                border: '1px solid var(--color-border)',
                background: tierFilter === f.value ? 'var(--color-primary)' : 'transparent',
                color: tierFilter === f.value ? '#080e1d' : 'inherit',
                fontWeight: tierFilter === f.value ? 600 : 400,
                cursor: 'pointer',
                fontSize: '0.8125rem',
                transition: 'background 0.15s, color 0.15s',
              }}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Loading */}
      {isLoading && (
        <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--color-text-muted)' }}>
          {t('skillCatalog.loading')}
        </div>
      )}

      {/* Error */}
      {error && (
        <div
          style={{
            padding: '1rem',
            background: 'rgba(239, 68, 68, 0.12)',
            color: '#ef4444',
            borderRadius: 'var(--radius-md, 6px)',
            marginBottom: '1rem',
          }}
        >
          {(error as Error).message}
        </div>
      )}

      {/* Empty state */}
      {!isLoading && !error && filtered.length === 0 && (
        <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--color-text-muted)' }}>
          {t('skillCatalog.empty')}
        </div>
      )}

      {/* Card grid */}
      {!isLoading && filtered.length > 0 && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: '1rem',
          }}
        >
          {filtered.map(skill => (
            <SkillCard
              key={skill.id}
              skill={skill}
              expanded={expandedIds.has(skill.id)}
              onToggle={() => toggleExpanded(skill.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
