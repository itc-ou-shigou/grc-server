import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  useExpenseQueue,
  useApproveExpense,
  useRejectExpense,
  useMarkExpensePaid,
} from '../../api/hooks';
import { DataTable } from '../../components/DataTable';
import { StatusBadge } from '../../components/StatusBadge';
import { Modal } from '../../components/Modal';
import { ErrorMessage } from '../../components/ErrorMessage';
import type { Task } from '../../api/hooks';

type ActionKind = 'approve' | 'reject' | 'pay';

interface PendingAction {
  task: Task;
  kind: ActionKind;
}

type Column = {
  key: string;
  label: string;
  render?: (value: unknown, row: Task) => React.ReactNode;
};

function formatAmount(amount: string | number | null, currency: string | null): string {
  if (amount === null || amount === undefined) return '—';
  const numeric = typeof amount === 'string' ? parseFloat(amount) : amount;
  if (isNaN(numeric)) return '—';
  const cur = currency ?? '';
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: cur || 'USD',
      minimumFractionDigits: 2,
    }).format(numeric);
  } catch {
    return `${cur} ${numeric.toLocaleString()}`;
  }
}

/**
 * Expense status values:
 *   expenseApproved: 0 = pending, 1 = approved, 2 = rejected
 *   expensePaid: null = not yet, 1 = paid
 */
function getExpenseStatusLabel(task: Task): { label: string; className: string } {
  if (task.expenseApproved === 2) return { label: '已拒绝', className: 'text-danger' };
  if (task.expenseApproved === 0) return { label: '待审批', className: 'text-warning' };
  if (task.expenseApproved === 1 && task.expensePaid === 1) return { label: '已付款', className: 'text-success' };
  if (task.expenseApproved === 1) return { label: '已批准·待付款', className: 'text-info' };
  return { label: '—', className: 'text-muted' };
}

export function ExpenseQueue() {
  const { t } = useTranslation('tasks');
  const { data: tasksData, isLoading, error } = useExpenseQueue();
  const approveExpense = useApproveExpense();
  const rejectExpense = useRejectExpense();
  const markPaid = useMarkExpensePaid();

  const [pending, setPending] = useState<PendingAction | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);

  const taskList: Task[] = tasksData?.data ?? [];

  function openConfirm(task: Task, kind: ActionKind) {
    setActionError(null);
    setRejectReason('');
    setPending({ task, kind });
  }

  function closeModal() {
    setPending(null);
    setActionError(null);
    setRejectReason('');
  }

  async function handleConfirm() {
    if (!pending) return;
    setActionError(null);
    try {
      if (pending.kind === 'approve') {
        await approveExpense.mutateAsync(pending.task.id);
      } else if (pending.kind === 'reject') {
        await rejectExpense.mutateAsync({
          taskId: pending.task.id,
          reason: rejectReason.trim() || 'Rejected by admin',
        });
      } else if (pending.kind === 'pay') {
        await markPaid.mutateAsync(pending.task.id);
      }
      setPending(null);
      setRejectReason('');
    } catch (err) {
      setActionError((err as Error).message ?? 'Action failed. Please try again.');
    }
  }

  const isMutating = approveExpense.isPending || rejectExpense.isPending || markPaid.isPending;

  const COLUMNS: Column[] = [
    {
      key: 'taskCode',
      label: 'Code',
      render: (_value, row) => (
        <Link to={`/tasks/${row.id}`} className="link mono">
          {row.taskCode}
        </Link>
      ),
    },
    {
      key: 'title',
      label: t('expenses.table.task'),
      render: (_value, row) => <span>{row.title}</span>,
    },
    {
      key: 'expenseAmount',
      label: t('expenses.table.amount'),
      render: (_value, row) => (
        <span className="mono" style={{ fontWeight: 600 }}>
          {formatAmount(row.expenseAmount, row.expenseCurrency)}
        </span>
      ),
    },
    {
      key: 'assignedRoleId',
      label: t('expenses.table.requestedBy'),
      render: (_value, row) => (
        <span className={row.assignedRoleId ? 'mono' : 'text-muted'}>
          {row.assignedRoleId ?? '—'}
        </span>
      ),
    },
    {
      key: 'status',
      label: t('expenses.table.status'),
      render: (_value, row) => <StatusBadge status={row.status} />,
    },
    {
      key: 'expenseStatus',
      label: '经费状态',
      render: (_value, row) => {
        const { label, className } = getExpenseStatusLabel(row);
        return <span className={className} style={{ fontWeight: 600 }}>{label}</span>;
      },
    },
    {
      key: 'actions',
      label: '操作',
      render: (_value, row) => {
        const isPending = row.expenseApproved === 0;
        const isApproved = row.expenseApproved === 1;
        const isPaid = row.expensePaid === 1;
        const isRejected = row.expenseApproved === 2;

        return (
          <div className="action-group">
            {isPending && (
              <>
                <button
                  className="btn btn-primary btn-sm"
                  onClick={() => openConfirm(row, 'approve')}
                  disabled={isMutating}
                  type="button"
                  title="审批通过"
                >
                  审批
                </button>
                <button
                  className="btn btn-danger btn-sm"
                  onClick={() => openConfirm(row, 'reject')}
                  disabled={isMutating}
                  type="button"
                  title="拒绝经费"
                >
                  拒绝
                </button>
              </>
            )}
            {isApproved && !isPaid && (
              <button
                className="btn btn-primary btn-sm"
                onClick={() => openConfirm(row, 'pay')}
                disabled={isMutating}
                type="button"
                title="确认付款"
              >
                💰 付款
              </button>
            )}
            {isApproved && isPaid && (
              <span className="text-success" style={{ fontSize: '0.85rem' }}>✓ 完成</span>
            )}
            {isRejected && (
              <span className="text-danger" style={{ fontSize: '0.85rem' }}>✗ 已拒绝</span>
            )}
          </div>
        );
      },
    },
  ];

  const pendingCount = taskList.filter((t) => t.expenseApproved === 0).length;
  const awaitingPayment = taskList.filter((t) => t.expenseApproved === 1 && t.expensePaid !== 1).length;
  const isEmpty = !isLoading && taskList.length === 0;

  const modalTitle = pending?.kind === 'approve'
    ? '审批经费'
    : pending?.kind === 'reject'
    ? '拒绝经费'
    : '确认付款';

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">{t('expenses.title')}</h1>
          <p className="page-subtitle">{t('expenses.subtitle')}</p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          {pendingCount > 0 && (
            <span className="tag" style={{ fontSize: '0.875rem', background: 'var(--color-warning-bg)' }}>
              {pendingCount} 待审批
            </span>
          )}
          {awaitingPayment > 0 && (
            <span className="tag" style={{ fontSize: '0.875rem', background: 'var(--info-bg, #d1ecf1)' }}>
              {awaitingPayment} 待付款
            </span>
          )}
        </div>
      </div>

      <div className="card">
        {error ? (
          <ErrorMessage error={error as Error} />
        ) : isEmpty ? (
          <div style={{ padding: '2rem 0', textAlign: 'center' }}>
            <p className="text-muted">No expenses in the queue.</p>
          </div>
        ) : (
          <DataTable
            columns={COLUMNS as never}
            data={taskList as never}
            loading={isLoading}
            rowKey="id"
          />
        )}
      </div>

      {/* Confirmation modal */}
      <Modal
        open={pending !== null}
        onClose={closeModal}
        title={modalTitle}
        footer={
          <div className="modal-footer-actions">
            <button
              className="btn btn-default"
              onClick={closeModal}
              type="button"
              disabled={isMutating}
            >
              取消
            </button>
            <button
              className={`btn ${pending?.kind === 'reject' ? 'btn-danger' : 'btn-primary'}`}
              onClick={handleConfirm}
              type="button"
              disabled={isMutating}
            >
              {isMutating
                ? '处理中...'
                : pending?.kind === 'approve'
                ? '确认审批'
                : pending?.kind === 'reject'
                ? '确认拒绝'
                : '确认付款'}
            </button>
          </div>
        }
      >
        {pending && (
          <div>
            <p>
              {pending.kind === 'approve'
                ? '确认审批通过此经费？'
                : pending.kind === 'reject'
                ? '确认拒绝此经费申请？'
                : '确认此经费已付款？'}
            </p>
            <div
              style={{
                padding: '0.75rem',
                background: 'rgba(29, 37, 59, 0.40)',
                borderRadius: '6px',
                marginTop: '0.75rem',
              }}
            >
              <p style={{ margin: '0 0 0.25rem', fontWeight: 600 }}>{pending.task.title}</p>
              <p style={{ margin: 0, fontSize: '0.875rem' }}>
                金额：{' '}
                <span className="mono" style={{ fontWeight: 600 }}>
                  {formatAmount(pending.task.expenseAmount, pending.task.expenseCurrency)}
                </span>
              </p>
              {pending.task.assignedBy && (
                <p style={{ margin: '0.25rem 0 0', fontSize: '0.8rem' }} className="text-muted">
                  申请人：{pending.task.assignedBy}
                </p>
              )}
            </div>
            {pending.kind === 'reject' && (
              <div className="form-group" style={{ marginTop: '0.75rem' }}>
                <label className="form-label" htmlFor="reject-reason">
                  拒绝原因
                </label>
                <textarea
                  id="reject-reason"
                  className="textarea"
                  rows={2}
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  placeholder="请输入拒绝原因..."
                />
              </div>
            )}
            {pending.kind === 'pay' && (
              <p className="text-info" style={{ marginTop: '0.75rem', fontSize: '0.875rem' }}>
                此操作将标记经费为已付款状态。请确保款项已实际支出。
              </p>
            )}
            {actionError && (
              <p className="text-danger" style={{ marginTop: '0.75rem' }}>
                {actionError}
              </p>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
