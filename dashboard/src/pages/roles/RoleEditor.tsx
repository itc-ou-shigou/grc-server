import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useRoleTemplate, useUpdateRole } from '../../api/hooks';
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

export function RoleEditor() {
  const { t } = useTranslation('roles');
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data, isLoading, error } = useRoleTemplate(id ?? '');
  const role = data?.data;
  const updateRole = useUpdateRole();

  const [roleName, setRoleName] = useState('');
  const [mode, setMode] = useState<'autonomous' | 'copilot'>('autonomous');
  const [department, setDepartment] = useState('');
  const [industry, setIndustry] = useState('');
  const [mdFields, setMdFields] = useState<Record<MdField, string>>({
    agentsMd: '',
    soulMd: '',
    identityMd: '',
    userMd: '',
    toolsMd: '',
    heartbeatMd: '',
    bootstrapMd: '',
    tasksMd: '',
  });
  const [activeTab, setActiveTab] = useState<MdField>('agentsMd');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (role) {
      setRoleName(role.name);
      setMode(role.mode);
      setDepartment(role.department ?? '');
      setIndustry(role.industry ?? '');
      setMdFields({
        agentsMd: role.agentsMd,
        soulMd: role.soulMd,
        identityMd: role.identityMd,
        userMd: role.userMd,
        toolsMd: role.toolsMd,
        heartbeatMd: role.heartbeatMd,
        bootstrapMd: role.bootstrapMd,
        tasksMd: role.tasksMd,
      });
    }
  }, [role]);

  const handleSave = async () => {
    if (!id) return;
    await updateRole.mutateAsync({
      id,
      data: {
        name: roleName,
        mode,
        department,
        industry,
        ...mdFields,
      },
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  const activeTabInfo = MD_TABS.find(t => t.key === activeTab)!;

  if (isLoading) {
    return (
      <div className="page">
        <p className="text-muted">Loading role…</p>
      </div>
    );
  }

  if (error) return <ErrorMessage error={error as Error} />;
  if (!role) return <ErrorMessage error={new Error(`Role "${id}" not found`)} />;

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">{t('editTitle', { name: role.name })}</h1>
          <p className="page-subtitle">
            <span className="mono">{id}</span>
            {role.isBuiltin && <span className="tag" style={{ marginLeft: '0.5rem' }}>{t('table.builtin')}</span>}
          </p>
        </div>
        <div className="action-group">
          <button className="btn btn-default" onClick={() => navigate('/roles')}>
            Back
          </button>
          <button
            className="btn btn-primary"
            onClick={handleSave}
            disabled={updateRole.isPending}
          >
            {updateRole.isPending ? t('editor.saving') : saved ? '✓ Saved' : t('editor.save')}
          </button>
        </div>
      </div>

      {updateRole.error && <ErrorMessage error={updateRole.error as Error} />}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1.5rem' }}>
        <div className="form-group">
          <label className="form-label">{t('editor.roleId')} (readonly)</label>
          <input className="input" type="text" value={id ?? ''} readOnly style={{ opacity: 0.6, cursor: 'not-allowed' }} />
        </div>
        <div className="form-group">
          <label className="form-label">{t('editor.displayName')}</label>
          <input
            className="input"
            type="text"
            value={roleName}
            onChange={e => setRoleName(e.target.value)}
            placeholder="Human-friendly name"
          />
        </div>
        <div className="form-group">
          <label className="form-label">{t('editor.mode')}</label>
          <select
            className="select"
            value={mode}
            onChange={e => setMode(e.target.value as 'autonomous' | 'copilot')}
          >
            <option value="autonomous">Autonomous</option>
            <option value="copilot">Copilot</option>
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">{t('editor.department')}</label>
          <input
            className="input"
            type="text"
            value={department}
            onChange={e => setDepartment(e.target.value)}
            placeholder="e.g. Engineering, Sales"
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
          Back
        </button>
        <button
          className="btn btn-primary"
          onClick={handleSave}
          disabled={updateRole.isPending}
        >
          {updateRole.isPending ? t('editor.saving') : saved ? '✓ Saved' : t('editor.save')}
        </button>
      </div>
    </div>
  );
}
