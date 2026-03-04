import { ReactNode } from 'react';

interface StatCardProps {
  title: string;
  value: string | number;
  change?: number;
  icon?: string;
  color?: string;
  subtitle?: string;
  loading?: boolean;
}

export function StatCard({ title, value, change, icon, color = '#4361ee', subtitle, loading = false }: StatCardProps) {
  const accentStyle = { borderLeftColor: color };
  const iconStyle = { background: color + '20', color };

  if (loading) {
    return (
      <div className="stat-card" style={accentStyle}>
        <div className="skeleton skeleton-text" style={{ width: '60%', marginBottom: 12 }} />
        <div className="skeleton skeleton-text" style={{ width: '40%', height: 32 }} />
      </div>
    );
  }

  return (
    <div className="stat-card" style={accentStyle}>
      <div className="stat-card-header">
        <div className="stat-card-title">{title}</div>
        {icon && (
          <div className="stat-card-icon" style={iconStyle}>
            {icon}
          </div>
        )}
      </div>
      <div className="stat-card-value">{formatValue(value)}</div>
      {subtitle && <div className="stat-card-subtitle">{subtitle}</div>}
      {change !== undefined && (
        <div className={`stat-card-change ${change >= 0 ? 'positive' : 'negative'}`}>
          {change >= 0 ? '▲' : '▼'} {Math.abs(change).toFixed(1)}%
          <span> vs last period</span>
        </div>
      )}
    </div>
  );
}

function formatValue(value: string | number): ReactNode {
  if (typeof value === 'number') {
    if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
    if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
    return value.toLocaleString();
  }
  return value;
}
