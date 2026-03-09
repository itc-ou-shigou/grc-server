import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { ErrorMessage } from '../../components/ErrorMessage';
import { usePlatformValues, useUpdatePlatformValues } from '../../api/hooks';
import { useUser } from '../../context/UserContext';

export function PlatformValues() {
  const { t } = useTranslation('platform');
  const { isAdmin } = useUser();
  const { data, isLoading, error } = usePlatformValues();
  const updateValues = useUpdatePlatformValues();

  const [content, setContent] = useState('');
  const [saved, setSaved] = useState(false);
  const [dirty, setDirty] = useState(false);

  const values = data?.data;

  // Sync fetched content into local state
  useEffect(() => {
    if (values?.content !== undefined) {
      setContent(values.content);
      setDirty(false);
    }
  }, [values?.content]);

  function handleContentChange(newContent: string) {
    setContent(newContent);
    setDirty(true);
    setSaved(false);
  }

  async function handleSave() {
    try {
      await updateValues.mutateAsync(content);
      setSaved(true);
      setDirty(false);
      // Auto-dismiss success message after 3 seconds
      setTimeout(() => setSaved(false), 3000);
    } catch {
      // Error is handled by the mutation state
    }
  }

  if (error) {
    return (
      <div className="page">
        <div className="page-header">
          <h1 className="page-title">{t('title')}</h1>
        </div>
        <ErrorMessage error={error as Error} />
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">{t('title')}</h1>
          <p className="page-subtitle">
            {isAdmin
              ? 'Define platform-wide values and culture. All connected WinClaw clients will inherit these values.'
              : 'Platform-wide values and culture shared across all WinClaw clients.'}
          </p>
        </div>
      </div>

      {isLoading ? (
        <div className="card" style={{ padding: '32px', textAlign: 'center' }}>
          Loading...
        </div>
      ) : (
        <>
          {/* Editor / Viewer */}
          <div className="card" style={{ padding: '16px', marginBottom: '16px' }}>
            <div style={{ marginBottom: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
              <h3 style={{ margin: 0, fontSize: '14px', color: 'var(--color-text-muted)' }}>
                Content (Markdown)
              </h3>
              {values?.updatedAt && (
                <span style={{ fontSize: '12px', color: 'var(--color-text-muted)' }}>
                  Last updated: {new Date(values.updatedAt).toLocaleString()}
                </span>
              )}
            </div>

            {isAdmin ? (
              <div className="form-group" style={{ marginBottom: '12px' }}>
                <textarea
                  className="textarea"
                  rows={24}
                  value={content}
                  onChange={(e) => handleContentChange(e.target.value)}
                  placeholder="Enter platform values in Markdown format..."
                  style={{
                    width: '100%',
                    fontFamily: 'monospace',
                    fontSize: '13px',
                    lineHeight: '1.6',
                    resize: 'vertical',
                    minHeight: '300px',
                  }}
                />
              </div>
            ) : (
              <div
                style={{
                  whiteSpace: 'pre-wrap',
                  fontFamily: 'monospace',
                  fontSize: '13px',
                  lineHeight: '1.6',
                  padding: '12px',
                  background: 'var(--color-bg-tertiary, #f5f5f5)',
                  borderRadius: '6px',
                  minHeight: '200px',
                }}
              >
                {content || t('noValues')}
              </div>
            )}
          </div>

          {/* Save button + status (admin only) */}
          {isAdmin && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
              <button
                className="btn btn-primary"
                onClick={handleSave}
                disabled={updateValues.isPending || !dirty}
              >
                {updateValues.isPending ? 'Saving...' : 'Save'}
              </button>

              {saved && (
                <span style={{ color: 'var(--color-success, #22c55e)', fontSize: '14px' }}>
                  Saved successfully
                </span>
              )}

              {updateValues.isError && (
                <span style={{ color: 'var(--color-danger, #ef4444)', fontSize: '14px' }}>
                  Error: {(updateValues.error as Error)?.message ?? 'Failed to save'}
                </span>
              )}

              {dirty && (
                <span style={{ color: 'var(--color-text-muted)', fontSize: '12px' }}>
                  Unsaved changes
                </span>
              )}
            </div>
          )}

          {/* Content hash info */}
          {values?.contentHash && (
            <div style={{ marginTop: '16px', fontSize: '12px', color: 'var(--color-text-muted)' }}>
              Content Hash: <code>{values.contentHash.slice(0, 16)}...</code>
            </div>
          )}
        </>
      )}
    </div>
  );
}
