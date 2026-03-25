import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  useModelKeys,
  useCreateModelKey,
  useUpdateModelKey,
  useDeleteModelKey,
  type ModelKey,
  type ModelKeyCreateInput,
  type ModelKeyUpdateInput,
} from '../../api/hooks';

// ── Provider & Model Options ────────────────────

const PROVIDERS = ['openai', 'anthropic', 'google', 'deepseek', 'qwen', 'custom'] as const;

const MODEL_OPTIONS: Record<string, string[]> = {
  openai: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'o1', 'o1-mini', 'o3-mini'],
  anthropic: ['claude-sonnet-4-20250514', 'claude-3-5-sonnet-20241022', 'claude-3-5-haiku-20241022', 'claude-3-opus-20240229'],
  google: ['gemini-embedding-001', 'gemini-2.0-flash'],
  deepseek: ['deepseek-chat', 'deepseek-reasoner'],
  qwen: ['qwen-plus', 'qwen-turbo', 'qwen-max'],
  custom: [],
};

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  return `${days}d`;
}

// ── Main Component ──────────────────────────────

export function ModelKeys() {
  const { t } = useTranslation('modelkeys');
  const [tab, setTab] = useState<'primary' | 'auxiliary'>('primary');
  const [showModal, setShowModal] = useState(false);
  const [editKey, setEditKey] = useState<ModelKey | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ModelKey | null>(null);

  const { data, isLoading } = useModelKeys(tab);
  const createMutation = useCreateModelKey();
  const updateMutation = useUpdateModelKey();
  const deleteMutation = useDeleteModelKey();

  const keys = data?.keys ?? [];

  function handleAdd() {
    setEditKey(null);
    setShowModal(true);
  }

  function handleEdit(key: ModelKey) {
    setEditKey(key);
    setShowModal(true);
  }

  function handleSave(input: ModelKeyCreateInput | ModelKeyUpdateInput, isEdit: boolean) {
    if (isEdit && editKey) {
      updateMutation.mutate(
        { id: editKey.id, data: input as ModelKeyUpdateInput },
        { onSuccess: () => setShowModal(false) },
      );
    } else {
      createMutation.mutate(input as ModelKeyCreateInput, {
        onSuccess: () => setShowModal(false),
      });
    }
  }

  function handleDelete() {
    if (!deleteTarget) return;
    deleteMutation.mutate(deleteTarget.id, {
      onSuccess: () => setDeleteTarget(null),
    });
  }

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">{t('title')}</h1>
          <p className="page-subtitle">{t('subtitle')}</p>
        </div>
        <button className="btn btn-primary" onClick={handleAdd}>
          + {t('addKey')}
        </button>
      </div>

      {/* Tab Switcher */}
      <div className="tab-bar" style={{ marginBottom: 16 }}>
        <button
          className={`tab-btn${tab === 'primary' ? ' active' : ''}`}
          onClick={() => setTab('primary')}
        >
          {t('tabs.primary')}
        </button>
        <button
          className={`tab-btn${tab === 'auxiliary' ? ' active' : ''}`}
          onClick={() => setTab('auxiliary')}
        >
          {t('tabs.auxiliary')}
        </button>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="loading-spinner" />
      ) : keys.length === 0 ? (
        <p className="empty-state">{t('noKeys')}</p>
      ) : (
        <div className="data-table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>{t('table.name')}</th>
                <th>{t('table.provider')}</th>
                <th>{t('table.model')}</th>
                <th>{t('table.status')}</th>
                <th>{t('table.updated')}</th>
                <th>{t('table.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {keys.map((key) => (
                <tr key={key.id}>
                  <td>
                    <strong>{key.name}</strong>
                    <br />
                    <small className="text-muted">{key.apiKeyPrefix}</small>
                  </td>
                  <td>
                    <span className="badge badge-outline">{key.provider}</span>
                  </td>
                  <td>{key.modelName}</td>
                  <td>
                    <span className={`badge ${key.isActive ? 'badge-success' : 'badge-muted'}`}>
                      {key.isActive ? t('status.active') : t('status.inactive')}
                    </span>
                  </td>
                  <td>{key.updatedAt ? timeAgo(key.updatedAt) : '—'}</td>
                  <td>
                    <button className="btn btn-sm btn-outline" onClick={() => handleEdit(key)}>
                      ✏️
                    </button>{' '}
                    <button
                      className="btn btn-sm btn-danger"
                      onClick={() => setDeleteTarget(key)}
                    >
                      🗑️
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Create/Edit Modal */}
      {showModal && (
        <KeyFormModal
          editKey={editKey}
          defaultCategory={tab}
          saving={createMutation.isPending || updateMutation.isPending}
          onSave={handleSave}
          onClose={() => setShowModal(false)}
        />
      )}

      {/* Delete Confirmation */}
      {deleteTarget && (
        <div className="modal-overlay" onClick={() => setDeleteTarget(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h3>{t('delete.title')}</h3>
            <p>{t('delete.confirm', { name: deleteTarget.name })}</p>
            <div className="modal-actions">
              <button className="btn btn-outline" onClick={() => setDeleteTarget(null)}>
                {t('cancel')}
              </button>
              <button
                className="btn btn-danger"
                onClick={handleDelete}
                disabled={deleteMutation.isPending}
              >
                {deleteMutation.isPending ? t('delete.deleting') : t('delete.button')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Key Form Modal ──────────────────────────────

function KeyFormModal({
  editKey,
  defaultCategory,
  saving,
  onSave,
  onClose,
}: {
  editKey: ModelKey | null;
  defaultCategory: 'primary' | 'auxiliary';
  saving: boolean;
  onSave: (data: ModelKeyCreateInput | ModelKeyUpdateInput, isEdit: boolean) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation('modelkeys');
  const isEdit = !!editKey;

  const [category, setCategory] = useState<'primary' | 'auxiliary'>(
    editKey?.category ?? defaultCategory,
  );
  const [name, setName] = useState(editKey?.name ?? '');
  const [provider, setProvider] = useState(editKey?.provider ?? '');
  const [modelName, setModelName] = useState(editKey?.modelName ?? '');
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState(editKey?.baseUrl ?? '');
  const [notes, setNotes] = useState(editKey?.notes ?? '');
  const [showKey, setShowKey] = useState(false);

  const models = MODEL_OPTIONS[provider] ?? [];
  const isCustomProvider = provider === 'custom';

  function handleProviderChange(newProvider: string) {
    setProvider(newProvider);
    const newModels = MODEL_OPTIONS[newProvider] ?? [];
    if (newModels.length > 0 && !newModels.includes(modelName)) {
      setModelName(newModels[0]);
    } else if (newProvider === 'custom') {
      setModelName('');
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (isEdit) {
      const update: ModelKeyUpdateInput = {};
      if (name !== editKey.name) update.name = name;
      if (provider !== editKey.provider) update.provider = provider;
      if (modelName !== editKey.modelName) update.model_name = modelName;
      if (apiKey) update.api_key = apiKey;
      if (baseUrl !== (editKey.baseUrl ?? '')) update.base_url = baseUrl || null;
      if (notes !== (editKey.notes ?? '')) update.notes = notes || null;
      onSave(update, true);
    } else {
      onSave(
        {
          category,
          name,
          provider,
          model_name: modelName,
          api_key: apiKey,
          base_url: baseUrl || undefined,
          notes: notes || undefined,
        },
        false,
      );
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content modal-lg" onClick={(e) => e.stopPropagation()}>
        <div className="modal-content-header">
          <h3>{isEdit ? t('editKey') : t('addKey')}</h3>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-content-body">
            {/* Category */}
            {!isEdit && (
              <div className="form-group">
                <label className="form-label">{t('form.category')}</label>
                <div style={{ display: 'flex', gap: 16 }}>
                  <label className="checkbox-label">
                    <input
                      type="radio"
                      name="category"
                      checked={category === 'primary'}
                      onChange={() => setCategory('primary')}
                    />
                    {t('form.primary')}
                  </label>
                  <label className="checkbox-label">
                    <input
                      type="radio"
                      name="category"
                      checked={category === 'auxiliary'}
                      onChange={() => setCategory('auxiliary')}
                    />
                    {t('form.auxiliary')}
                  </label>
                </div>
              </div>
            )}

            <div className="form-grid">
              {/* Name */}
              <div className="form-group">
                <label className="form-label">{t('form.name')} <span className="text-danger">*</span></label>
                <input
                  className="input"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t('form.namePlaceholder')}
                  required
                />
              </div>

              {/* Provider */}
              <div className="form-group">
                <label className="form-label">{t('form.provider')} <span className="text-danger">*</span></label>
                <select
                  className="select"
                  value={provider}
                  onChange={(e) => handleProviderChange(e.target.value)}
                  required
                >
                  <option value="">{t('form.selectProvider')}</option>
                  {PROVIDERS.map((p) => (
                    <option key={p} value={p}>
                      {p.charAt(0).toUpperCase() + p.slice(1)}
                    </option>
                  ))}
                </select>
              </div>

              {/* Model Name */}
              <div className="form-group">
                <label className="form-label">{t('form.model')} <span className="text-danger">*</span></label>
                {isCustomProvider || models.length === 0 ? (
                  <input
                    className="input"
                    value={modelName}
                    onChange={(e) => setModelName(e.target.value)}
                    placeholder={t('form.customModel')}
                    required
                  />
                ) : (
                  <select
                    className="select"
                    value={modelName}
                    onChange={(e) => setModelName(e.target.value)}
                    required
                  >
                    <option value="">{t('form.selectModel')}</option>
                    {models.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              {/* API Key */}
              <div className="form-group">
                <label className="form-label">{t('form.apiKey')}{isEdit && ' (leave empty to keep current)'}</label>
                <div style={{ position: 'relative' }}>
                  <input
                    className="input"
                    type={showKey ? 'text' : 'password'}
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder={t('form.apiKeyPlaceholder')}
                    required={!isEdit}
                    style={{ paddingRight: 40 }}
                  />
                  <button
                    type="button"
                    className="btn btn-sm"
                    style={{ position: 'absolute', right: 4, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', fontSize: 16 }}
                    onClick={() => setShowKey(!showKey)}
                  >
                    {showKey ? '🙈' : '👁️'}
                  </button>
                </div>
              </div>
            </div>

            {/* Base URL - full width */}
            <div className="form-group">
              <label className="form-label">{t('form.baseUrl')}</label>
              <input
                className="input"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder={t('form.baseUrlPlaceholder')}
              />
            </div>

            {/* Notes - full width */}
            <div className="form-group">
              <label className="form-label">{t('form.notes')}</label>
              <textarea
                className="textarea"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder={t('form.notesPlaceholder')}
                rows={3}
              />
            </div>
          </div>

          {/* Footer Actions */}
          <div className="modal-content-footer">
            <button type="button" className="btn btn-default" onClick={onClose}>
              {t('cancel')}
            </button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? t('saving') : t('save')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
