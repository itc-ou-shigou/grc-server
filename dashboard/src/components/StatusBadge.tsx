type Variant = 'success' | 'warning' | 'danger' | 'info' | 'default';

interface StatusBadgeProps {
  status: string;
  variant?: Variant;
}

function inferVariant(status: string): Variant {
  const s = status.toLowerCase();
  if (['active', 'approved', 'promoted', 'published', 'success', 'completed', 'enabled'].includes(s)) return 'success';
  if (['pending', 'review', 'draft', 'inactive', 'warning', 'processing'].includes(s)) return 'warning';
  if (['banned', 'quarantined', 'rejected', 'failed', 'error', 'revoked', 'archived', 'hidden', 'locked'].includes(s)) return 'danger';
  if (['info', 'system', 'beta', 'critical'].includes(s)) return 'info';
  return 'default';
}

export function StatusBadge({ status, variant }: StatusBadgeProps) {
  const v = variant ?? inferVariant(status);
  return (
    <span className={`status-badge status-badge-${v}`}>
      {status}
    </span>
  );
}
