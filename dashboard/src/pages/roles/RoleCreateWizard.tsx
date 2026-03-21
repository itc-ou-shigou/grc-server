import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useCreateRole, useGenerateRolePreview, type RoleTemplate } from '../../api/hooks';
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

interface GeneratedPreview {
  id?: string;
  name?: string;
  emoji?: string;
  department?: string;
  industry?: string;
  mode?: string;
  agentsMd?: string;
  soulMd?: string;
  identityMd?: string;
  userMd?: string;
  toolsMd?: string;
  heartbeatMd?: string;
  bootstrapMd?: string;
  tasksMd?: string;
}

export function RoleCreateWizard() {
  const { t } = useTranslation('roles');
  const navigate = useNavigate();
  const createRole = useCreateRole();
  const generatePreview = useGenerateRolePreview();

  // Wizard input state
  const [companyInfo, setCompanyInfo] = useState('');
  const [roleDescription, setRoleDescription] = useState('');
  const [genMode, setGenMode] = useState<'autonomous' | 'copilot'>('autonomous');

  // Preview state
  const [preview, setPreview] = useState<GeneratedPreview | null>(null);

  // Editable preview fields
  const [id, setId] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [emoji, setEmoji] = useState('');
  const [department, setDepartment] = useState('');
  const [industry, setIndustry] = useState('');
  const [mdFields, setMdFields] = useState<Record<MdField, string>>(EMPTY_MD);
  const [activeTab, setActiveTab] = useState<MdField>('agentsMd');

  const isInputValid = roleDescription.trim() !== '';
  const isPreviewValid = id.trim() !== '' && displayName.trim() !== '';

  const activeTabInfo = MD_TABS.find(t => t.key === activeTab)!;

  async function handleGenerate() {
    if (!isInputValid) return;
    try {
      const result = await generatePreview.mutateAsync({
        company_info: companyInfo.trim() || undefined,
        role_description: roleDescription.trim(),
        mode: genMode,
      });
      const data = result as GeneratedPreview;
      setPreview(data);
      // Populate editable fields from preview
      setId(data.id ?? '');
      setDisplayName(data.name ?? '');
      setEmoji(data.emoji ?? '');
      setDepartment(data.department ?? '');
      setIndustry(data.industry ?? '');
      setMdFields({
        agentsMd: data.agentsMd ?? '',
        soulMd: data.soulMd ?? '',
        identityMd: data.identityMd ?? '',
        userMd: data.userMd ?? '',
        toolsMd: data.toolsMd ?? '',
        heartbeatMd: data.heartbeatMd ?? '',
        bootstrapMd: data.bootstrapMd ?? '',
        tasksMd: data.tasksMd ?? '',
      });
    } catch {
      // error displayed via generatePreview.error
    }
  }

  async function handleSave() {
    if (!isPreviewValid) return;
    // Backend expects snake_case keys for MD fields
    const payload = {
      id: id.trim(),
      name: displayName.trim(),
      mode: (preview?.mode as 'autonomous' | 'copilot') ?? genMode,
      department: department.trim(),
      industry: industry.trim(),
      agents_md: mdFields.agentsMd,
      soul_md: mdFields.soulMd,
      identity_md: mdFields.identityMd,
      user_md: mdFields.userMd,
      tools_md: mdFields.toolsMd,
      heartbeat_md: mdFields.heartbeatMd,
      bootstrap_md: mdFields.bootstrapMd,
      tasks_md: mdFields.tasksMd,
    };
    await createRole.mutateAsync(payload as unknown as Partial<RoleTemplate> & { id: string });
    navigate('/roles');
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">{t('wizardTitle', 'AI Role Wizard')}</h1>
          <p className="page-subtitle">{t('wizardSubtitle', 'Describe the role and let AI generate the configuration')}</p>
        </div>
        <div className="action-group">
          <button className="btn btn-default" onClick={() => navigate('/roles')}>
            {t('cancel', 'Cancel')}
          </button>
          {preview && (
            <button
              className="btn btn-primary"
              onClick={handleSave}
              disabled={!isPreviewValid || createRole.isPending}
            >
              {createRole.isPending ? t('saving', 'Saving…') : t('saveRole', 'Save Role')}
            </button>
          )}
        </div>
      </div>

      {generatePreview.error && <ErrorMessage error={generatePreview.error as Error} />}
      {createRole.error && <ErrorMessage error={createRole.error as Error} />}

      {/* Input section */}
      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
          <div className="form-group" style={{ gridColumn: '1 / -1' }}>
            <label className="form-label">
              {t('wizardRoleDescription', 'Role Description')}{' '}
              <span style={{ color: 'var(--color-danger, #ef4444)' }}>*</span>
            </label>
            <textarea
              className="textarea"
              rows={4}
              value={roleDescription}
              onChange={e => setRoleDescription(e.target.value)}
              placeholder={t('wizardRoleDescriptionPlaceholder', 'Describe what this role does, its responsibilities, and goals...')}
            />
          </div>
          <div className="form-group" style={{ gridColumn: '1 / -1' }}>
            <label className="form-label">
              {t('wizardCompanyInfo', 'Company Info')}{' '}
              <span className="text-muted" style={{ fontSize: '0.75rem' }}>({t('optional', 'optional')})</span>
            </label>
            <textarea
              className="textarea"
              rows={3}
              value={companyInfo}
              onChange={e => setCompanyInfo(e.target.value)}
              placeholder={t('wizardCompanyInfoPlaceholder', 'Provide context about your company, industry, size, or culture...')}
            />
          </div>
          <div className="form-group">
            <label className="form-label">{t('editor.mode', 'Mode')}</label>
            <div style={{ display: 'flex', gap: '1.5rem', marginTop: '0.5rem' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                <input
                  type="radio"
                  name="genMode"
                  value="autonomous"
                  checked={genMode === 'autonomous'}
                  onChange={() => setGenMode('autonomous')}
                />
                <span>{t('modeAutonomous', 'Autonomous')}</span>
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                <input
                  type="radio"
                  name="genMode"
                  value="copilot"
                  checked={genMode === 'copilot'}
                  onChange={() => setGenMode('copilot')}
                />
                <span>{t('modeCopilot', 'Copilot')}</span>
              </label>
            </div>
          </div>
          <div className="form-group" style={{ display: 'flex', alignItems: 'flex-end' }}>
            <button
              className="btn btn-primary"
              type="button"
              onClick={handleGenerate}
              disabled={!isInputValid || generatePreview.isPending}
              style={{ width: '100%' }}
            >
              {generatePreview.isPending
                ? t('wizardGenerating', 'Generating…')
                : t('wizardGenerate', 'AI Generate')}
            </button>
          </div>
        </div>
      </div>

      {/* Preview section */}
      {preview && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1.5rem' }}>
            <div className="form-group">
              <label className="form-label">
                {t('editor.roleId', 'Role ID')}{' '}
                <span style={{ color: 'var(--color-danger, #ef4444)' }}>*</span>
              </label>
              <input
                className="input"
                type="text"
                value={id}
                onChange={e => setId(e.target.value.toLowerCase().replace(/[^a-z0-9-_]/g, '-'))}
                placeholder={t('cloneModal.newIdPlaceholder', 'e.g. my-role-id')}
              />
              <p className="text-muted" style={{ fontSize: '0.75rem', marginTop: '0.25rem' }}>
                {t('roleIdHint', 'Lowercase letters, numbers, hyphens, underscores.')}
              </p>
            </div>
            <div className="form-group">
              <label className="form-label">
                {t('editor.displayName', 'Display Name')}{' '}
                <span style={{ color: 'var(--color-danger, #ef4444)' }}>*</span>
              </label>
              <input
                className="input"
                type="text"
                value={displayName}
                onChange={e => setDisplayName(e.target.value)}
                placeholder={t('cloneModal.newNamePlaceholder', 'e.g. My Role')}
              />
            </div>
            <div className="form-group">
              <label className="form-label">{t('editor.emoji', 'Emoji')}</label>
              <input
                className="input"
                type="text"
                value={emoji}
                onChange={e => setEmoji(e.target.value)}
                placeholder="e.g. 🤖"
                style={{ maxWidth: '8rem' }}
              />
            </div>
            <div className="form-group">
              <label className="form-label">{t('editor.department', 'Department')}</label>
              <input
                className="input"
                type="text"
                value={department}
                onChange={e => setDepartment(e.target.value)}
                placeholder="e.g. Engineering, Sales, Operations"
              />
            </div>
            <div className="form-group">
              <label className="form-label">{t('editor.industry', 'Industry')}</label>
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
              {t('cancel', 'Cancel')}
            </button>
            <button
              className="btn btn-primary"
              onClick={handleSave}
              disabled={!isPreviewValid || createRole.isPending}
            >
              {createRole.isPending ? t('saving', 'Saving…') : t('saveRole', 'Save Role')}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
