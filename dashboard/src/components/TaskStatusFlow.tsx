/**
 * TaskStatusFlow - Visual status flow diagram for tasks
 * Shows the task lifecycle as a horizontal flow with the current status highlighted.
 *
 * Flow: pending → in_progress → review → completed
 *                     ↓
 *                  blocked
 *                     ↓
 *                 cancelled
 */

interface TaskStatusFlowProps {
  currentStatus: string;
  compact?: boolean;
}

const MAIN_FLOW = ['pending', 'in_progress', 'review', 'approved', 'completed'] as const;
const BRANCH_STATUSES = ['blocked', 'cancelled'] as const;

const STATUS_LABELS: Record<string, string> = {
  pending: 'Pending',
  in_progress: 'In Progress',
  review: 'Review',
  approved: 'Approved',
  completed: 'Completed',
  blocked: 'Blocked',
  cancelled: 'Cancelled',
};

const STATUS_COLORS: Record<string, { bg: string; border: string; text: string }> = {
  pending:     { bg: 'rgba(66, 72, 89, 0.20)',  border: 'rgba(66, 72, 89, 0.40)',  text: 'rgba(224, 229, 251, 0.55)' },
  in_progress: { bg: 'rgba(0, 229, 255, 0.10)',  border: '#81ecff',                text: '#81ecff' },
  review:      { bg: 'rgba(255, 190, 11, 0.10)', border: '#ffbe0b',                text: '#ffbe0b' },
  approved:    { bg: 'rgba(74, 222, 128, 0.10)', border: '#4ade80',                text: '#4ade80' },
  completed:   { bg: 'rgba(74, 222, 128, 0.10)', border: '#4ade80',                text: '#4ade80' },
  blocked:     { bg: 'rgba(239, 68, 68, 0.10)',  border: '#ef4444',                text: '#ef4444' },
  cancelled:   { bg: 'rgba(66, 72, 89, 0.15)',   border: 'rgba(66, 72, 89, 0.30)', text: 'rgba(224, 229, 251, 0.40)' },
};

function StatusNode({
  status,
  isCurrent,
  isPast,
}: {
  status: string;
  isCurrent: boolean;
  isPast: boolean;
}) {
  const colors = STATUS_COLORS[status] ?? STATUS_COLORS.pending;
  const label = STATUS_LABELS[status] ?? status;

  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '6px 14px',
        borderRadius: '20px',
        fontSize: '0.8rem',
        fontWeight: isCurrent ? 700 : 500,
        background: isCurrent ? colors.bg : isPast ? colors.bg : 'rgba(29, 37, 59, 0.40)',
        border: `2px solid ${isCurrent ? colors.border : isPast ? colors.border : 'rgba(66, 72, 89, 0.30)'}`,
        color: isCurrent ? colors.text : isPast ? colors.text : 'rgba(224, 229, 251, 0.40)',
        opacity: isPast || isCurrent ? 1 : 0.6,
        boxShadow: isCurrent ? `0 0 0 3px ${colors.border}33` : 'none',
        transition: 'all 0.2s ease',
        whiteSpace: 'nowrap',
      }}
    >
      {isCurrent && (
        <span style={{ marginRight: '4px', fontSize: '0.7rem' }}>●</span>
      )}
      {label}
    </div>
  );
}

function Arrow({ muted }: { muted?: boolean }) {
  return (
    <span
      style={{
        color: muted ? '#ccc' : 'var(--text-muted, #888)',
        fontSize: '1rem',
        margin: '0 4px',
        userSelect: 'none',
      }}
    >
      →
    </span>
  );
}

function DownArrow({ muted }: { muted?: boolean }) {
  return (
    <span
      style={{
        color: muted ? '#ccc' : 'var(--text-muted, #888)',
        fontSize: '0.85rem',
        userSelect: 'none',
      }}
    >
      ↓
    </span>
  );
}

export function TaskStatusFlow({ currentStatus, compact = false }: TaskStatusFlowProps) {
  const currentMainIndex = MAIN_FLOW.indexOf(currentStatus as typeof MAIN_FLOW[number]);
  const isBranched = BRANCH_STATUSES.includes(currentStatus as typeof BRANCH_STATUSES[number]);

  const effectiveIndex = currentMainIndex;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      {/* Main flow */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          flexWrap: compact ? 'nowrap' : 'wrap',
          gap: '2px',
        }}
      >
        {MAIN_FLOW.map((status, idx) => {
          const isCurrent = status === currentStatus;
          const isPast = effectiveIndex >= 0 ? idx < effectiveIndex : false;

          return (
            <span key={status} style={{ display: 'inline-flex', alignItems: 'center' }}>
              <StatusNode status={status} isCurrent={isCurrent} isPast={isPast} />
              {idx < MAIN_FLOW.length - 1 && (
                <Arrow muted={effectiveIndex >= 0 ? idx >= effectiveIndex : true} />
              )}
            </span>
          );
        })}
      </div>

      {/* Branch flow (blocked/cancelled) */}
      {(isBranched || !compact) && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            paddingLeft: '120px',
          }}
        >
          <DownArrow muted={!isBranched} />
          {BRANCH_STATUSES.map((status, idx) => (
            <span key={status} style={{ display: 'inline-flex', alignItems: 'center' }}>
              <StatusNode
                status={status}
                isCurrent={currentStatus === status}
                isPast={false}
              />
              {idx < BRANCH_STATUSES.length - 1 && <Arrow muted />}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
