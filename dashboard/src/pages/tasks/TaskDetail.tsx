import { useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  useTaskDetail,
  useChangeTaskStatus,
  useAddTaskComment,
  useDeleteTask,
  useApproveExpense,
  useRejectExpense,
  useMarkExpensePaid,
} from '../../api/hooks';
import { StatusBadge } from '../../components/StatusBadge';
import { Modal } from '../../components/Modal';
import { ErrorMessage } from '../../components/ErrorMessage';
import { TaskStatusFlow } from '../../components/TaskStatusFlow';
import { useUser } from '../../context/UserContext';
import type { Task } from '../../api/hooks';

type Variant = 'success' | 'warning' | 'danger' | 'info' | 'default';

const PRIORITY_VARIANT: Record<string, Variant> = {
  critical: 'danger',
  high: 'warning',
  medium: 'info',
  low: 'default',
};

type StatusTransition = {
  label: string;
  toStatus: Task['status'];
  btnClass: string;
};

const STATUS_TRANSITIONS: Record<string, StatusTransition[]> = {
  pending: [{ label: 'Start', toStatus: 'in_progress', btnClass: 'btn-primary' }],
  in_progress: [
    { label: 'Submit for Review', toStatus: 'review', btnClass: 'btn-primary' },
    { label: 'Mark Blocked', toStatus: 'blocked', btnClass: 'btn-danger' },
  ],
  review: [
    { label: 'Approve', toStatus: 'approved', btnClass: 'btn-primary' },
    { label: 'Complete', toStatus: 'completed', btnClass: 'btn-primary' },
  ],
  blocked: [{ label: 'Resume', toStatus: 'in_progress', btnClass: 'btn-primary' }],
};

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleString();
}

function formatDateOnly(dateStr: string | null | undefined): string {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString();
}

export function TaskDetail() {
  const { t } = useTranslation('tasks');
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { isAdmin } = useUser();

  const { data, isLoading, error } = useTaskDetail(id ?? '');
  const changeStatus = useChangeTaskStatus();
  const addComment = useAddTaskComment();
  const deleteTask = useDeleteTask();
  const approveExpense = useApproveExpense();
  const rejectExpense = useRejectExpense();
  const markExpensePaid = useMarkExpensePaid();

  const [commentContent, setCommentContent] = useState('');
  const [resultSummary, setResultSummary] = useState('');
  const [pendingTransition, setPendingTransition] = useState<StatusTransition | null>(null);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [expenseActionError, setExpenseActionError] = useState<string | null>(null);
  const commentRef = useRef<HTMLTextAreaElement>(null);

  if (isLoading) {
    return (
      <div className="page">
        <p className="text-muted">Loading task...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="page">
        <ErrorMessage error={error as Error} />
      </div>
    );
  }

  if (!data) return null;

  const { task: rawTask, comments, progress } = data;
  // SQLite returns JSON columns as strings — parse safely
  const parseJsonArr = (v: unknown): unknown[] => {
    if (Array.isArray(v)) return v;
    if (typeof v === 'string') try { const p = JSON.parse(v); if (Array.isArray(p)) return p; } catch { /* */ }
    return [];
  };
  const task = {
    ...rawTask,
    deliverables: parseJsonArr(rawTask.deliverables),
    collaborators: parseJsonArr(rawTask.collaborators),
    dependsOn: parseJsonArr(rawTask.dependsOn),
    resultData: typeof rawTask.resultData === 'string' ? (() => { try { return JSON.parse(rawTask.resultData); } catch { return rawTask.resultData; } })() : rawTask.resultData,
  };
  const transitions = STATUS_TRANSITIONS[task.status] ?? [];
  const needsResultSummary = pendingTransition?.toStatus === 'completed';

  async function handleStatusChange(transition: StatusTransition) {
    if (transition.toStatus === 'completed') {
      setPendingTransition(transition);
      return;
    }
    setPendingTransition(transition);
  }

  async function confirmStatusChange() {
    if (!pendingTransition || !id) return;
    setStatusError(null);
    try {
      await changeStatus.mutateAsync({
        id,
        status: pendingTransition.toStatus,
        resultSummary: pendingTransition.toStatus === 'completed' ? resultSummary : undefined,
      });
      setPendingTransition(null);
      setResultSummary('');
    } catch (err) {
      setStatusError((err as Error).message ?? 'Status change failed');
    }
  }

  async function handleAddComment(e: React.FormEvent) {
    e.preventDefault();
    if (!commentContent.trim() || !id) return;
    await addComment.mutateAsync({ taskId: id, content: commentContent.trim() });
    setCommentContent('');
    commentRef.current?.focus();
  }

  async function handleDelete() {
    if (!id) return;
    try {
      await deleteTask.mutateAsync(id);
      navigate('/tasks');
    } catch (err) {
      alert((err as Error).message ?? 'Failed to delete task');
    }
  }

  // Expense lifecycle state
  // expenseApproved: 0=pending, 1=approved, 2=rejected
  // expensePaid: null=not yet, 1=paid
  const hasExpense = task.expenseAmount !== null;
  const expensePendingApproval = hasExpense && task.expenseApproved === 0;
  const expenseIsApproved = task.expenseApproved === 1;
  const expenseIsRejected = task.expenseApproved === 2;
  const expenseIsPaid = task.expensePaid === 1;
  const expenseAwaitingPayment = expenseIsApproved && !expenseIsPaid;

  const isExpenseMutating = approveExpense.isPending || rejectExpense.isPending || markExpensePaid.isPending;

  async function handleExpenseApprove() {
    if (!id) return;
    setExpenseActionError(null);
    try {
      await approveExpense.mutateAsync(id);
    } catch (err) {
      setExpenseActionError((err as Error).message ?? 'Approval failed');
    }
  }

  async function handleExpenseReject() {
    if (!id) return;
    setExpenseActionError(null);
    try {
      await rejectExpense.mutateAsync({ taskId: id, reason: 'Rejected by admin' });
    } catch (err) {
      setExpenseActionError((err as Error).message ?? 'Rejection failed');
    }
  }

  async function handleExpensePay() {
    if (!id) return;
    setExpenseActionError(null);
    try {
      await markExpensePaid.mutateAsync(id);
    } catch (err) {
      setExpenseActionError((err as Error).message ?? 'Payment failed');
    }
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
            <span className="mono" style={{ fontSize: '0.85rem', color: 'var(--text-muted, #888)' }}>
              {task.taskCode}
            </span>
            <StatusBadge status={task.priority} variant={PRIORITY_VARIANT[task.priority]} />
            <StatusBadge status={task.status} />
          </div>
          <h1 className="page-title" style={{ marginTop: '0.25rem' }}>
            {task.title}
          </h1>
        </div>
        <div className="action-group">
          {isAdmin && (
            <button
              className="btn btn-danger btn-sm"
              onClick={() => setShowDeleteModal(true)}
              type="button"
            >
              Delete Task
            </button>
          )}
        </div>
      </div>

      {/* Status flow visualization */}
      <div className="card" style={{ marginBottom: '1rem', padding: '16px' }}>
        <div style={{ fontWeight: 600, marginBottom: '0.5rem', fontSize: '0.875rem' }}>Status Flow</div>
        <TaskStatusFlow currentStatus={task.status} />
      </div>

      {/* Status transitions */}
      {transitions.length > 0 && (
        <div className="card" style={{ marginBottom: '1rem' }}>
          <div style={{ fontWeight: 600, marginBottom: '0.5rem' }}>Actions</div>
          <div className="action-group">
            {transitions.map((t) => (
              <button
                key={t.toStatus}
                className={`btn ${t.btnClass}`}
                onClick={() => handleStatusChange(t)}
                type="button"
                disabled={changeStatus.isPending}
              >
                {t.label}
              </button>
            ))}
          </div>
          {statusError && (
            <p className="text-danger" style={{ marginTop: '0.5rem', fontSize: '0.875rem' }}>
              {statusError}
            </p>
          )}
        </div>
      )}

      {/* Info card */}
      <div className="card" style={{ marginBottom: '1rem' }}>
        <h2 className="page-subtitle" style={{ marginBottom: '0.75rem' }}>
          Details
        </h2>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
            gap: '0.75rem 1.5rem',
          }}
        >
          <InfoRow label="Category" value={task.category} />
          <InfoRow label="Assigned Role" value={task.assignedRoleId} mono />
          <InfoRow label="Assigned Node" value={task.assignedNodeId} mono />
          <InfoRow label="Assigned By" value={task.assignedBy} mono />
          <InfoRow label="Deadline" value={formatDateOnly(task.deadline)} />
          <InfoRow label="Created" value={formatDate(task.createdAt)} />
          <InfoRow label="Updated" value={formatDate(task.updatedAt)} />
          {task.completedAt && (
            <InfoRow label="Completed" value={formatDate(task.completedAt)} />
          )}
          <InfoRow label="Version" value={String(task.version)} mono />
        </div>

        {task.description && (
          <div style={{ marginTop: '1rem' }}>
            <div className="form-label">{t('detail.description')}</div>
            <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{task.description}</p>
          </div>
        )}

        {task.dependsOn && task.dependsOn.length > 0 && (
          <div style={{ marginTop: '1rem' }}>
            <div className="form-label">Depends On</div>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              {task.dependsOn.map((dep) => (
                <span key={dep} className="tag mono">
                  {dep}
                </span>
              ))}
            </div>
          </div>
        )}

        {task.collaborators && task.collaborators.length > 0 && (
          <div style={{ marginTop: '1rem' }}>
            <div className="form-label">Collaborators</div>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              {task.collaborators.map((c) => (
                <span key={c} className="tag mono">
                  {c}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Deliverables */}
      {task.deliverables && task.deliverables.length > 0 && (
        <div className="card" style={{ marginBottom: '1rem' }}>
          <h2 className="page-subtitle" style={{ marginBottom: '0.75rem' }}>
            Deliverables
          </h2>
          <ul style={{ margin: 0, paddingLeft: '1.25rem' }}>
            {task.deliverables.map((d, i) => (
              <li key={i} style={{ marginBottom: '0.25rem' }}>
                {d}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Expense section */}
      {hasExpense && (
        <div className="card" style={{ marginBottom: '1rem' }}>
          <h2 className="page-subtitle" style={{ marginBottom: '0.75rem' }}>
            经费
          </h2>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
              gap: '0.75rem 1.5rem',
            }}
          >
            <InfoRow
              label="金额"
              value={`${task.expenseCurrency ?? ''} ${task.expenseAmount ?? ''}`}
            />
            <div>
              <div className="form-label">审批状态</div>
              <span
                className={
                  expensePendingApproval
                    ? 'text-warning'
                    : expenseIsApproved
                    ? 'text-success'
                    : expenseIsRejected
                    ? 'text-danger'
                    : 'text-muted'
                }
                style={{ fontWeight: 600 }}
              >
                {expensePendingApproval
                  ? '待审批'
                  : expenseIsApproved
                  ? '已批准'
                  : expenseIsRejected
                  ? '已拒绝'
                  : '—'}
              </span>
            </div>
            <div>
              <div className="form-label">付款状态</div>
              <span
                className={expenseIsPaid ? 'text-success' : expenseAwaitingPayment ? 'text-warning' : 'text-muted'}
                style={{ fontWeight: 600 }}
              >
                {expenseIsPaid ? '已付款' : expenseAwaitingPayment ? '待付款' : '—'}
              </span>
            </div>
            {task.expenseApprovedBy && (
              <InfoRow label="审批人" value={task.expenseApprovedBy} mono />
            )}
            {task.expenseApprovedAt && (
              <InfoRow label="审批时间" value={formatDate(task.expenseApprovedAt)} />
            )}
            {task.expensePaidBy && (
              <InfoRow label="付款人" value={task.expensePaidBy} mono />
            )}
            {task.expensePaidAt && (
              <InfoRow label="付款时间" value={formatDate(task.expensePaidAt)} />
            )}
          </div>

          {/* Expense lifecycle actions */}
          {isAdmin && (expensePendingApproval || expenseAwaitingPayment) && (
            <div style={{ marginTop: '1rem', paddingTop: '0.75rem', borderTop: '1px solid var(--color-border)' }}>
              <div style={{ fontWeight: 600, marginBottom: '0.5rem', fontSize: '0.875rem' }}>经费操作</div>
              <div className="action-group">
                {expensePendingApproval && (
                  <>
                    <button
                      className="btn btn-primary btn-sm"
                      onClick={handleExpenseApprove}
                      disabled={isExpenseMutating}
                      type="button"
                    >
                      {approveExpense.isPending ? '处理中...' : '审批通过'}
                    </button>
                    <button
                      className="btn btn-danger btn-sm"
                      onClick={handleExpenseReject}
                      disabled={isExpenseMutating}
                      type="button"
                    >
                      {rejectExpense.isPending ? '处理中...' : '拒绝'}
                    </button>
                  </>
                )}
                {expenseAwaitingPayment && (
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={handleExpensePay}
                    disabled={isExpenseMutating}
                    type="button"
                  >
                    {markExpensePaid.isPending ? '处理中...' : '💰 确认付款'}
                  </button>
                )}
              </div>
              {expenseActionError && (
                <p className="text-danger" style={{ marginTop: '0.5rem', fontSize: '0.85rem' }}>
                  {expenseActionError}
                </p>
              )}
            </div>
          )}

          {/* Expense lifecycle progress */}
          <div style={{ marginTop: '1rem', paddingTop: '0.75rem', borderTop: '1px solid var(--color-border)' }}>
            <div style={{ fontWeight: 600, marginBottom: '0.5rem', fontSize: '0.875rem' }}>经费流程</div>
            <div style={{ display: 'flex', gap: '0.25rem', alignItems: 'center', flexWrap: 'wrap' }}>
              <span
                className="tag"
                style={{
                  background: 'var(--color-info-bg)',
                  fontWeight: 600,
                }}
              >
                ① 创建
              </span>
              <span style={{ color: 'var(--text-muted, #888)' }}>→</span>
              <span
                className="tag"
                style={{
                  background: expensePendingApproval
                    ? 'var(--color-warning-bg)'
                    : expenseIsApproved || expenseIsRejected
                    ? 'var(--color-info-bg)'
                    : 'rgba(66, 72, 89, 0.20)',
                  fontWeight: expensePendingApproval ? 700 : 400,
                  outline: expensePendingApproval ? '2px solid var(--color-warning)' : 'none',
                }}
              >
                ② 审批
              </span>
              <span style={{ color: 'var(--text-muted, #888)' }}>→</span>
              <span
                className="tag"
                style={{
                  background: expenseAwaitingPayment
                    ? 'var(--color-warning-bg)'
                    : expenseIsPaid
                    ? 'var(--color-info-bg)'
                    : 'rgba(66, 72, 89, 0.20)',
                  fontWeight: expenseAwaitingPayment ? 700 : 400,
                  outline: expenseAwaitingPayment ? '2px solid var(--color-warning)' : 'none',
                }}
              >
                ③ 付款
              </span>
              <span style={{ color: 'var(--text-muted, #888)' }}>→</span>
              <span
                className="tag"
                style={{
                  background: expenseIsPaid
                    ? 'var(--color-success-bg)'
                    : 'rgba(66, 72, 89, 0.20)',
                  fontWeight: expenseIsPaid ? 700 : 400,
                }}
              >
                ④ 完成
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Notes */}
      {task.notes && (
        <div className="card" style={{ marginBottom: '1rem' }}>
          <h2 className="page-subtitle" style={{ marginBottom: '0.75rem' }}>
            Notes
          </h2>
          <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{task.notes}</p>
        </div>
      )}

      {/* Result */}
      {task.status === 'completed' && task.resultSummary && (
        <div className="card" style={{ marginBottom: '1rem' }}>
          <h2 className="page-subtitle" style={{ marginBottom: '0.75rem' }}>
            Result
          </h2>
          <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{task.resultSummary}</p>
        </div>
      )}

      {/* Comments */}
      <div className="card" style={{ marginBottom: '1rem' }}>
        <h2 className="page-subtitle" style={{ marginBottom: '0.75rem' }}>
          {t('detail.comments')} ({comments.length})
        </h2>

        {comments.length === 0 && (
          <p className="text-muted" style={{ marginBottom: '1rem' }}>
            {t('detail.noComments')}
          </p>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '1rem' }}>
          {comments.map((c) => (
            <div
              key={c.id}
              style={{
                padding: '0.75rem',
                background: 'rgba(29, 37, 59, 0.40)',
                borderRadius: '6px',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  marginBottom: '0.35rem',
                  fontSize: '0.8rem',
                }}
              >
                <span className="mono" style={{ fontWeight: 600 }}>
                  {c.author}
                </span>
                <span className="text-muted">{formatDate(c.createdAt)}</span>
              </div>
              <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{c.content}</p>
            </div>
          ))}
        </div>

        <form onSubmit={handleAddComment}>
          <div className="form-group">
            <label className="form-label" htmlFor="comment-input">
              {t('detail.addComment')}
            </label>
            <textarea
              id="comment-input"
              ref={commentRef}
              className="textarea"
              rows={3}
              value={commentContent}
              onChange={(e) => setCommentContent(e.target.value)}
              placeholder={t('detail.addComment')}
              disabled={addComment.isPending}
            />
          </div>
          <button
            type="submit"
            className="btn btn-primary btn-sm"
            disabled={!commentContent.trim() || addComment.isPending}
          >
            {addComment.isPending ? 'Posting...' : t('detail.submitComment')}
          </button>
        </form>
      </div>

      {/* Progress log */}
      {progress.length > 0 && (
        <div className="card" style={{ marginBottom: '1rem' }}>
          <h2 className="page-subtitle" style={{ marginBottom: '0.75rem' }}>
            {t('detail.activity')}
          </h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {progress.map((entry) => (
              <div
                key={entry.id}
                style={{
                  display: 'flex',
                  gap: '0.75rem',
                  alignItems: 'flex-start',
                  fontSize: '0.875rem',
                }}
              >
                <span
                  className="text-muted mono"
                  style={{ whiteSpace: 'nowrap', minWidth: '140px' }}
                >
                  {formatDate(entry.createdAt)}
                </span>
                <span>
                  <span className="mono" style={{ fontWeight: 600 }}>
                    {entry.actor}
                  </span>{' '}
                  {entry.action}
                  {entry.fromStatus && entry.toStatus && (
                    <span className="text-muted">
                      {' '}
                      — {entry.fromStatus} → {entry.toStatus}
                    </span>
                  )}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Status transition modal */}
      <Modal
        open={pendingTransition !== null}
        onClose={() => setPendingTransition(null)}
        title={`Confirm: ${pendingTransition?.label}`}
        footer={
          <div className="modal-footer-actions">
            <button
              className="btn btn-default"
              onClick={() => setPendingTransition(null)}
              type="button"
            >
              Cancel
            </button>
            <button
              className={`btn ${pendingTransition?.btnClass ?? 'btn-primary'}`}
              onClick={confirmStatusChange}
              type="button"
              disabled={changeStatus.isPending}
            >
              {changeStatus.isPending ? 'Saving...' : 'Confirm'}
            </button>
          </div>
        }
      >
        <p>
          Move task status to <strong>{pendingTransition?.toStatus}</strong>?
        </p>
        {needsResultSummary && (
          <div className="form-group">
            <label className="form-label" htmlFor="result-summary">
              Result Summary
            </label>
            <textarea
              id="result-summary"
              className="textarea"
              rows={4}
              value={resultSummary}
              onChange={(e) => setResultSummary(e.target.value)}
              placeholder="Describe the outcome..."
            />
          </div>
        )}
        {statusError && <p className="text-danger">{statusError}</p>}
      </Modal>

      {/* Delete confirmation modal */}
      <Modal
        open={showDeleteModal}
        onClose={() => setShowDeleteModal(false)}
        title="Delete Task"
        footer={
          <div className="modal-footer-actions">
            <button
              className="btn btn-default"
              onClick={() => setShowDeleteModal(false)}
              type="button"
            >
              Cancel
            </button>
            <button
              className="btn btn-danger"
              onClick={handleDelete}
              type="button"
              disabled={deleteTask.isPending}
            >
              {deleteTask.isPending ? 'Deleting...' : 'Delete'}
            </button>
          </div>
        }
      >
        <p>
          Are you sure you want to delete task{' '}
          <strong className="mono">{task.taskCode}</strong>? This action cannot be
          undone.
        </p>
      </Modal>
    </div>
  );
}

function InfoRow({
  label,
  value,
  mono,
}: {
  label: string;
  value: string | null | undefined;
  mono?: boolean;
}) {
  return (
    <div>
      <div className="form-label">{label}</div>
      <span className={`${mono ? 'mono' : ''} ${!value ? 'text-muted' : ''}`}>
        {value ?? '—'}
      </span>
    </div>
  );
}
