import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useCreateRole } from '../../api/hooks';
import { ErrorMessage } from '../../components/ErrorMessage';

type MdField = 'agentsMd' | 'soulMd' | 'identityMd' | 'userMd' | 'toolsMd' | 'heartbeatMd' | 'bootstrapMd' | 'tasksMd';

const MD_TABS: { key: MdField; label: string; description: string }[] = [
  { key: 'agentsMd', label: 'Agents', description: 'Agent collaboration and orchestration rules' },
  { key: 'soulMd', label: 'Soul', description: 'Core personality, values, and behavioral principles' },
  { key: 'identityMd', label: 'Identity', description: 'Role identity, persona, and self-description' },
  { key: 'userMd', label: 'User', description: 'User interaction style and communication guidelines' },
  { key: 'toolsMd', label: 'Tools', description: 'Available tools and usage instructions' },
  { key: 'heartbeatMd', label: 'Heartbeat', description: 'Periodic health check and maintenance tasks' },
  { key: 'bootstrapMd', label: 'Bootstrap', description: 'Initialization sequence and startup tasks' },
  { key: 'tasksMd', label: 'Tasks', description: 'Ongoing tasks and workflow definitions' },
];

const EMPTY_MD: Record<MdField, string> = {
  agentsMd: '',
  soulMd: '',
  identityMd: '',
  userMd: '',
  toolsMd: '',
  heartbeatMd: '',
  bootstrapMd: '',
  tasksMd: '',
};

export function RoleCreate() {
  const { t } = useTranslation('roles');
  const navigate = useNavigate();
  const createRole = useCreateRole();

  const [id, setId] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [mode, setMode] = useState<'autonomous' | 'copilot'>('autonomous');
  const [department, setDepartment] = useState('');
  const [industry, setIndustry] = useState('');
  const [mdFields, setMdFields] = useState<Record<MdField, string>>(EMPTY_MD);
  const [activeTab, setActiveTab] = useState<MdField>('agentsMd');

  const isValid = id.trim() !== '' && displayName.trim() !== '';

  const handleCreate = async () => {
    if (!isValid) return;
    await createRole.mutateAsync({
      id: id.trim(),
      name: displayName.trim(),
      mode,
      department: department.trim(),
      industry: industry.trim(),
      ...mdFields,
    });
    navigate('/roles');
  };

  const activeTabInfo = MD_TABS.find(t => t.key === activeTab)!;

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">{t('createTitle')}</h1>
          <p className="page-subtitle">{t('createSubtitle')}</p>
        </div>
        <div className="action-group">
          <button className="btn btn-default" onClick={() => navigate('/roles')}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            onClick={handleCreate}
            disabled={!isValid || createRole.isPending}
          >
            {createRole.isPending ? 'Creating…' : t('createTitle')}
          </button>
        </div>
      </div>

      {createRole.error && <ErrorMessage error={createRole.error as Error} />}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1.5rem' }}>
        <div className="form-group">
          <label className="form-label">
            {t('editor.roleId')} <span style={{ color: 'var(--color-danger, #ef4444)' }}>*</span>
          </label>
          <input
            className="input"
            type="text"
            value={id}
            onChange={e => setId(e.target.value.toLowerCase().replace(/[^a-z0-9-_]/g, '-'))}
            placeholder={t('cloneModal.newIdPlaceholder')}
          />
          <p className="text-muted" style={{ fontSize: '0.75rem', marginTop: '0.25rem' }}>
            Lowercase letters, numbers, hyphens, underscores. Cannot be changed after creation.
          </p>
        </div>
        <div className="form-group">
          <label className="form-label">
            {t('editor.displayName')} <span style={{ color: 'var(--color-danger, #ef4444)' }}>*</span>
          </label>
          <input
            className="input"
            type="text"
            value={displayName}
            onChange={e => setDisplayName(e.target.value)}
            placeholder={t('cloneModal.newNamePlaceholder')}
          />
        </div>
        <div className="form-group">
          <label className="form-label">{t('editor.mode')}</label>
          <select
            className="select"
            value={mode}
            onChange={e => setMode(e.target.value as 'autonomous' | 'copilot')}
          >
            <option value="autonomous">Autonomous — agent acts independently</option>
            <option value="copilot">Copilot — agent assists human operators</option>
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">{t('editor.department')}</label>
          <input
            className="input"
            type="text"
            value={department}
            onChange={e => setDepartment(e.target.value)}
            placeholder="e.g. Engineering, Sales, Operations"
          />
        </div>
        <div className="form-group">
          <label className="form-label">{t('editor.industry')}</label>
          <input
            className="input"
            type="text"
            value={industry}
            onChange={e => setIndustry(e.target.value)}
            placeholder="e.g. SaaS, Finance, Healthcare"
          />
        </div>
      </div>

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div
          style={{
            display: 'flex',
            borderBottom: '1px solid var(--color-border)',
            overflowX: 'auto',
          }}
        >
          {MD_TABS.map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              style={{
                padding: '0.625rem 1rem',
                border: 'none',
                borderBottom: activeTab === tab.key ? '2px solid var(--color-primary)' : '2px solid transparent',
                background: 'none',
                cursor: 'pointer',
                fontWeight: activeTab === tab.key ? 600 : 400,
                color: activeTab === tab.key ? 'var(--color-primary)' : 'inherit',
                whiteSpace: 'nowrap',
                fontSize: '0.875rem',
              }}
            >
              {tab.label}
              {mdFields[tab.key].trim() !== '' && (
                <span
                  style={{
                    display: 'inline-block',
                    width: '6px',
                    height: '6px',
                    borderRadius: '50%',
                    background: 'var(--color-primary)',
                    marginLeft: '0.375rem',
                    verticalAlign: 'middle',
                  }}
                />
              )}
            </button>
          ))}
        </div>

        <div style={{ padding: '1rem' }}>
          <p className="text-muted" style={{ fontSize: '0.8125rem', marginBottom: '0.75rem' }}>
            {activeTabInfo.description}
          </p>
          <textarea
            className="textarea"
            value={mdFields[activeTab]}
            onChange={e => setMdFields(prev => ({ ...prev, [activeTab]: e.target.value }))}
            rows={24}
            placeholder={`# ${activeTabInfo.label}\n\nEnter markdown content…`}
            style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: '0.8125rem', width: '100%', resize: 'vertical' }}
          />
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '1rem' }}>
        <button className="btn btn-default" onClick={() => navigate('/roles')}>
          Cancel
        </button>
        <button
          className="btn btn-primary"
          onClick={handleCreate}
          disabled={!isValid || createRole.isPending}
        >
          {createRole.isPending ? 'Creating…' : t('createTitle')}
        </button>
      </div>
    </div>
  );
}
