import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useExpenseQueue, useApproveExpense, useRejectExpense } from '../../api/hooks';
import { DataTable } from '../../components/DataTable';
import { StatusBadge } from '../../components/StatusBadge';
import { Modal } from '../../components/Modal';
import { ErrorMessage } from '../../components/ErrorMessage';
import type { Task } from '../../api/hooks';

type ActionKind = 'approve' | 'reject';

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

export function ExpenseQueue() {
  const { t } = useTranslation('tasks');
  const { data: tasksData, isLoading, error } = useExpenseQueue();
  const approveExpense = useApproveExpense();
  const rejectExpense = useRejectExpense();

  const [pending, setPending] = useState<PendingAction | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const taskList: Task[] = tasksData?.data ?? [];

  function openConfirm(task: Task, kind: ActionKind) {
    setActionError(null);
    setPending({ task, kind });
  }

  function closeModal() {
    setPending(null);
    setActionError(null);
  }

  async function handleConfirm() {
    if (!pending) return;
    setActionError(null);
    try {
      if (pending.kind === 'approve') {
        await approveExpense.mutateAsync(pending.task.id);
      } else {
        await rejectExpense.mutateAsync({ taskId: pending.task.id, reason: 'Rejected by admin' });
      }
      setPending(null);
    } catch (err) {
      setActionError((err as Error).message ?? 'Action failed. Please try again.');
    }
  }

  const isMutating = approveExpense.isPending || rejectExpense.isPending;

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
      key: 'expenseApproved',
      label: 'Expense Status',
      render: (_value, row) => {
        if (row.expenseApproved === 1)
          return <span className="text-success">Approved</span>;
        if (row.expenseApproved === 0)
          return <span className="text-danger">Rejected</span>;
        return <span className="text-warning">Pending</span>;
      },
    },
    {
      key: 'actions',
      label: 'Actions',
      render: (_value, row) => {
        const alreadyDecided = row.expenseApproved !== null;
        return (
          <div className="action-group">
            <button
              className="btn btn-primary btn-sm"
              onClick={() => openConfirm(row, 'approve')}
              disabled={alreadyDecided || isMutating}
              type="button"
              title={alreadyDecided ? 'Already decided' : 'Approve expense'}
            >
              {t('expenses.approveModal.button')}
            </button>
            <button
              className="btn btn-danger btn-sm"
              onClick={() => openConfirm(row, 'reject')}
              disabled={alreadyDecided || isMutating}
              type="button"
              title={alreadyDecided ? 'Already decided' : 'Reject expense'}
            >
              {t('expenses.rejectModal.button')}
            </button>
          </div>
        );
      },
    },
  ];

  const isEmpty = !isLoading && taskList.length === 0;

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">{t('expenses.title')}</h1>
          <p className="page-subtitle">{t('expenses.subtitle')}</p>
        </div>
        {taskList.length > 0 && (
          <div>
            <span className="tag" style={{ fontSize: '0.875rem' }}>
              {taskList.filter((t) => t.expenseApproved === null).length} pending
            </span>
          </div>
        )}
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
        title={
          pending?.kind === 'approve'
            ? t('expenses.approveModal.title')
            : t('expenses.rejectModal.title')
        }
        footer={
          <div className="modal-footer-actions">
            <button
              className="btn btn-default"
              onClick={closeModal}
              type="button"
              disabled={isMutating}
            >
              Cancel
            </button>
            <button
              className={`btn ${pending?.kind === 'approve' ? 'btn-primary' : 'btn-danger'}`}
              onClick={handleConfirm}
              type="button"
              disabled={isMutating}
            >
              {isMutating
                ? 'Processing...'
                : pending?.kind === 'approve'
                ? t('expenses.approveModal.button')
                : t('expenses.rejectModal.button')}
            </button>
          </div>
        }
      >
        {pending && (
          <div>
            <p>
              {pending.kind === 'approve' ? 'Approve' : 'Reject'} the expense for task{' '}
              <strong className="mono">{pending.task.taskCode}</strong>?
            </p>
            <div
              style={{
                padding: '0.75rem',
                background: 'var(--surface-alt, #f5f5f5)',
                borderRadius: '6px',
                marginTop: '0.75rem',
              }}
            >
              <p style={{ margin: '0 0 0.25rem', fontWeight: 600 }}>{pending.task.title}</p>
              <p style={{ margin: 0, fontSize: '0.875rem' }}>
                Amount:{' '}
                <span className="mono">
                  {formatAmount(pending.task.expenseAmount, pending.task.expenseCurrency)}
                </span>
              </p>
            </div>
            {pending.kind === 'reject' && (
              <p className="text-warning" style={{ marginTop: '0.75rem', fontSize: '0.875rem' }}>
                This will mark the expense as rejected. The task owner will be notified.
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
