import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useCreateTask } from '../../api/hooks';

const CATEGORY_OPTIONS = [
  { value: '', label: 'Select category...' },
  { value: 'strategic', label: 'Strategic' },
  { value: 'operational', label: 'Operational' },
  { value: 'administrative', label: 'Administrative' },
  { value: 'expense', label: 'Expense' },
];

const PRIORITY_OPTIONS_KEYS = [
  { value: '', label: 'Select priority...' },
  { value: 'critical', tKey: 'priority.critical' },
  { value: 'high', tKey: 'priority.high' },
  { value: 'medium', tKey: 'priority.medium' },
  { value: 'low', tKey: 'priority.low' },
];

const CURRENCY_OPTIONS = [
  { value: 'USD', label: 'USD — US Dollar' },
  { value: 'EUR', label: 'EUR — Euro' },
  { value: 'JPY', label: 'JPY — Japanese Yen' },
  { value: 'GBP', label: 'GBP — British Pound' },
];

interface FormState {
  taskCode: string;
  title: string;
  description: string;
  category: string;
  priority: string;
  assignedRoleId: string;
  deadline: string;
  deliverables: string;
  notes: string;
  includeExpense: boolean;
  expenseAmount: string;
  expenseCurrency: string;
}

interface FieldErrors {
  taskCode?: string;
  title?: string;
  priority?: string;
  expenseAmount?: string;
}

function validate(form: FormState): FieldErrors {
  const errors: FieldErrors = {};
  if (!form.taskCode.trim()) errors.taskCode = 'Task code is required.';
  if (!form.title.trim()) errors.title = 'Title is required.';
  if (!form.priority) errors.priority = 'Priority is required.';
  if (form.includeExpense && !form.expenseAmount) {
    errors.expenseAmount = 'Expense amount is required when expense is enabled.';
  }
  if (form.includeExpense && form.expenseAmount && isNaN(parseFloat(form.expenseAmount))) {
    errors.expenseAmount = 'Expense amount must be a number.';
  }
  return errors;
}

export function TaskCreate() {
  const { t } = useTranslation('tasks');
  const navigate = useNavigate();
  const createTask = useCreateTask();

  const [form, setForm] = useState<FormState>({
    taskCode: '',
    title: '',
    description: '',
    category: '',
    priority: '',
    assignedRoleId: '',
    deadline: '',
    deliverables: '',
    notes: '',
    includeExpense: false,
    expenseAmount: '',
    expenseCurrency: 'USD',
  });

  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);

  function handleChange(
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) {
    const { name, value, type } = e.target;
    const checked = type === 'checkbox' ? (e.target as HTMLInputElement).checked : undefined;
    setForm((prev) => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value,
    }));
    if (fieldErrors[name as keyof FieldErrors]) {
      setFieldErrors((prev) => ({ ...prev, [name]: undefined }));
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitError(null);

    const errors = validate(form);
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }

    const deliverablesList = form.deliverables
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);

    const payload: Record<string, unknown> = {
      title: form.title.trim(),
      description: form.description.trim() || null,
      category: form.category || null,
      priority: form.priority,
      assigned_role_id: form.assignedRoleId.trim() || null,
      deadline: form.deadline || null,
      deliverables: deliverablesList.length > 0 ? deliverablesList : null,
      notes: form.notes.trim() || null,
    };

    if (form.includeExpense) {
      payload.expense_amount = form.expenseAmount;
      payload.expense_currency = form.expenseCurrency;
    }

    try {
      await createTask.mutateAsync(payload);
      navigate('/tasks');
    } catch (err) {
      setSubmitError((err as Error).message ?? 'Failed to create task.');
    }
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">{t('create.title')}</h1>
          <p className="page-subtitle">{t('create.subtitle')}</p>
        </div>
        <div className="action-group">
          <Link to="/tasks" className="btn btn-default">
            Cancel
          </Link>
        </div>
      </div>

      <div className="card">
        <form onSubmit={handleSubmit} noValidate>
          {/* Basic info */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
              gap: '1rem',
              marginBottom: '1rem',
            }}
          >
            <div className="form-group">
              <label className="form-label" htmlFor="taskCode">
                Task Code <span className="text-danger">*</span>
              </label>
              <input
                id="taskCode"
                name="taskCode"
                className="input"
                type="text"
                value={form.taskCode}
                onChange={handleChange}
                placeholder="e.g. TASK-001"
              />
              {fieldErrors.taskCode && (
                <p className="text-danger" style={{ fontSize: '0.8rem', marginTop: '0.25rem' }}>
                  {fieldErrors.taskCode}
                </p>
              )}
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="title">
                {t('create.form.title')} <span className="text-danger">*</span>
              </label>
              <input
                id="title"
                name="title"
                className="input"
                type="text"
                value={form.title}
                onChange={handleChange}
                placeholder={t('create.form.titlePlaceholder')}
              />
              {fieldErrors.title && (
                <p className="text-danger" style={{ fontSize: '0.8rem', marginTop: '0.25rem' }}>
                  {fieldErrors.title}
                </p>
              )}
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="category">
                {t('create.form.category')}
              </label>
              <select
                id="category"
                name="category"
                className="select"
                value={form.category}
                onChange={handleChange}
              >
                {CATEGORY_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="priority">
                {t('create.form.priority')} <span className="text-danger">*</span>
              </label>
              <select
                id="priority"
                name="priority"
                className="select"
                value={form.priority}
                onChange={handleChange}
              >
                {PRIORITY_OPTIONS_KEYS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.tKey ? t(opt.tKey) : opt.label}
                  </option>
                ))}
              </select>
              {fieldErrors.priority && (
                <p className="text-danger" style={{ fontSize: '0.8rem', marginTop: '0.25rem' }}>
                  {fieldErrors.priority}
                </p>
              )}
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="assignedRoleId">
                Assigned Role ID
              </label>
              <input
                id="assignedRoleId"
                name="assignedRoleId"
                className="input"
                type="text"
                value={form.assignedRoleId}
                onChange={handleChange}
                placeholder="Role identifier"
              />
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="deadline">
                {t('create.form.deadline')}
              </label>
              <input
                id="deadline"
                name="deadline"
                className="input"
                type="date"
                value={form.deadline}
                onChange={handleChange}
              />
            </div>
          </div>

          {/* Description */}
          <div className="form-group" style={{ marginBottom: '1rem' }}>
            <label className="form-label" htmlFor="description">
              {t('create.form.description')}
            </label>
            <textarea
              id="description"
              name="description"
              className="textarea"
              rows={4}
              value={form.description}
              onChange={handleChange}
              placeholder={t('create.form.descriptionPlaceholder')}
            />
          </div>

          {/* Deliverables */}
          <div className="form-group" style={{ marginBottom: '1rem' }}>
            <label className="form-label" htmlFor="deliverables">
              Deliverables
              <span className="text-muted" style={{ fontSize: '0.8rem', marginLeft: '0.5rem' }}>
                (one per line)
              </span>
            </label>
            <textarea
              id="deliverables"
              name="deliverables"
              className="textarea"
              rows={3}
              value={form.deliverables}
              onChange={handleChange}
              placeholder="List deliverables, one per line..."
            />
          </div>

          {/* Notes */}
          <div className="form-group" style={{ marginBottom: '1rem' }}>
            <label className="form-label" htmlFor="notes">
              Notes
            </label>
            <textarea
              id="notes"
              name="notes"
              className="textarea"
              rows={3}
              value={form.notes}
              onChange={handleChange}
              placeholder="Internal notes..."
            />
          </div>

          {/* Expense toggle */}
          <div style={{ marginBottom: '1rem' }}>
            <label
              style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}
            >
              <input
                type="checkbox"
                name="includeExpense"
                checked={form.includeExpense}
                onChange={handleChange}
              />
              <span className="form-label" style={{ margin: 0 }}>
                This task includes an expense
              </span>
            </label>
          </div>

          {/* Expense section */}
          {form.includeExpense && (
            <div
              style={{
                padding: '1rem',
                background: 'rgba(29, 37, 59, 0.40)',
                borderRadius: '6px',
                marginBottom: '1rem',
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
                gap: '1rem',
              }}
            >
              <div className="form-group">
                <label className="form-label" htmlFor="expenseAmount">
                  Expense Amount <span className="text-danger">*</span>
                </label>
                <input
                  id="expenseAmount"
                  name="expenseAmount"
                  className="input"
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.expenseAmount}
                  onChange={handleChange}
                  placeholder="0.00"
                />
                {fieldErrors.expenseAmount && (
                  <p className="text-danger" style={{ fontSize: '0.8rem', marginTop: '0.25rem' }}>
                    {fieldErrors.expenseAmount}
                  </p>
                )}
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="expenseCurrency">
                  Currency
                </label>
                <select
                  id="expenseCurrency"
                  name="expenseCurrency"
                  className="select"
                  value={form.expenseCurrency}
                  onChange={handleChange}
                >
                  {CURRENCY_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}

          {submitError && (
            <p className="text-danger" style={{ marginBottom: '1rem' }}>
              {submitError}
            </p>
          )}

          <div className="action-group">
            <Link to="/tasks" className="btn btn-default">
              Cancel
            </Link>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={createTask.isPending}
            >
              {createTask.isPending ? t('create.form.creating') : t('create.form.submit')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
