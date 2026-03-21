import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  useEmployees,
  useModelKeys,
  useAssignKeysToNode,
  useUnassignKeysFromNode,
  type Employee,
  type ModelKey,
} from '../../api/hooks';

// ── Main Component ──────────────────────────────

export function ModelKeyDistribute() {
  const { t } = useTranslation('modelkeys');
  const [search, setSearch] = useState('');
  const [selectedNode, setSelectedNode] = useState<Employee | null>(null);

  const { data: empData, isLoading: empLoading } = useEmployees();
  const { data: primaryData } = useModelKeys('primary');
  const { data: auxData } = useModelKeys('auxiliary');

  const employees = empData?.data ?? [];
  const primaryKeys = primaryData?.keys ?? [];
  const auxiliaryKeys = auxData?.keys ?? [];

  // Filter by search
  const filtered = employees.filter((emp) => {
    if (!search) return true;
    const s = search.toLowerCase();
    return (
      emp.nodeId?.toLowerCase().includes(s) ||
      emp.employeeName?.toLowerCase().includes(s) ||
      emp.employeeEmail?.toLowerCase().includes(s) ||
      emp.displayName?.toLowerCase().includes(s)
    );
  });

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">{t('distribute.title')}</h1>
          <p className="page-subtitle">{t('distribute.subtitle')}</p>
        </div>
      </div>

      {/* Search Bar */}
      <div className="search-bar" style={{ marginBottom: 20 }}>
        <input
          className="input"
          placeholder={t('distribute.search')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ maxWidth: 400 }}
        />
      </div>

      {/* Node Cards Grid */}
      {empLoading ? (
        <div className="loading-spinner" />
      ) : filtered.length === 0 ? (
        <p className="empty-state">No nodes found.</p>
      ) : (
        <div className="card-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
          {filtered.map((emp) => (
            <NodeKeyCard
              key={emp.id}
              employee={emp}
              primaryKeys={primaryKeys}
              auxiliaryKeys={auxiliaryKeys}
              onSelect={() => setSelectedNode(emp)}
            />
          ))}
        </div>
      )}

      {/* Assignment Modal */}
      {selectedNode && (
        <AssignModal
          employee={selectedNode}
          primaryKeys={primaryKeys}
          auxiliaryKeys={auxiliaryKeys}
          onClose={() => setSelectedNode(null)}
        />
      )}
    </div>
  );
}

// ── Node Card ───────────────────────────────────

function NodeKeyCard({
  employee,
  primaryKeys,
  auxiliaryKeys,
  onSelect,
}: {
  employee: Employee;
  primaryKeys: ModelKey[];
  auxiliaryKeys: ModelKey[];
  onSelect: () => void;
}) {
  const { t } = useTranslation('modelkeys');

  // Find assigned keys from employee data (fields from Node interface)
  const assignedPrimary = employee.primaryKeyId
    ? primaryKeys.find((k) => k.id === employee.primaryKeyId)
    : null;
  const assignedAux = employee.auxiliaryKeyId
    ? auxiliaryKeys.find((k) => k.id === employee.auxiliaryKeyId)
    : null;

  const hasAnyKey = assignedPrimary || assignedAux;

  // Online status based on last heartbeat
  const lastHb = employee.lastHeartbeat;
  const isOnline = lastHb
    ? Date.now() - new Date(lastHb).getTime() < 5 * 60 * 1000
    : false;

  return (
    <div
      className="card"
      style={{
        padding: 16,
        borderRadius: 8,
        border: '1px solid var(--color-border)',
        background: 'rgba(12, 19, 36, 0.40)',
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <span
          style={{
            width: 10,
            height: 10,
            borderRadius: '50%',
            background: isOnline ? '#22c55e' : '#ef4444',
            flexShrink: 0,
          }}
        />
        <strong style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {employee.employeeName || employee.displayName || employee.nodeId}
        </strong>
      </div>

      {/* Info */}
      <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 12 }}>
        {employee.employeeEmail && <div>{employee.employeeEmail}</div>}
        <div style={{ fontFamily: 'monospace', fontSize: 11 }}>
          {employee.nodeId?.substring(0, 12)}...
        </div>
      </div>

      {/* Key Status */}
      <div style={{ fontSize: 13, marginBottom: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
          <span>{t('distribute.primaryKey')}:</span>
          {assignedPrimary ? (
            <span className="badge badge-success" style={{ fontSize: 11 }}>
              {assignedPrimary.provider}/{assignedPrimary.modelName}
            </span>
          ) : (
            <span className="badge badge-muted" style={{ fontSize: 11 }}>—</span>
          )}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>{t('distribute.auxiliaryKey')}:</span>
          {assignedAux ? (
            <span className="badge badge-success" style={{ fontSize: 11 }}>
              {assignedAux.provider}/{assignedAux.modelName}
            </span>
          ) : (
            <span className="badge badge-muted" style={{ fontSize: 11 }}>—</span>
          )}
        </div>
      </div>

      {/* Action */}
      <button
        className={`btn btn-sm ${hasAnyKey ? 'btn-outline' : 'btn-primary'}`}
        style={{ width: '100%' }}
        onClick={onSelect}
      >
        {hasAnyKey ? t('distribute.manageBtn') : t('distribute.assignBtn')}
      </button>
    </div>
  );
}

// ── Assignment Modal ────────────────────────────

function AssignModal({
  employee,
  primaryKeys,
  auxiliaryKeys,
  onClose,
}: {
  employee: Employee;
  primaryKeys: ModelKey[];
  auxiliaryKeys: ModelKey[];
  onClose: () => void;
}) {
  const { t } = useTranslation('modelkeys');

  const currentPrimaryKeyId = employee.primaryKeyId ?? '';
  const currentAuxKeyId = employee.auxiliaryKeyId ?? '';
  const hasExisting = !!(currentPrimaryKeyId || currentAuxKeyId);

  const [selectedPrimary, setSelectedPrimary] = useState(currentPrimaryKeyId);
  const [selectedAux, setSelectedAux] = useState(currentAuxKeyId);

  const assignMutation = useAssignKeysToNode();
  const unassignMutation = useUnassignKeysFromNode();

  const displayName = employee.employeeName || employee.displayName || employee.nodeId;

  function handleAssign() {
    assignMutation.mutate(
      {
        nodeId: employee.nodeId!,
        primaryKeyId: selectedPrimary || null,
        auxiliaryKeyId: selectedAux || null,
      },
      { onSuccess: () => onClose() },
    );
  }

  function handleUnbind() {
    if (!confirm(t('distribute.confirmUnbind'))) return;
    unassignMutation.mutate(employee.nodeId!, {
      onSuccess: () => onClose(),
    });
  }

  const isSaving = assignMutation.isPending || unassignMutation.isPending;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-content-header">
          <h3>{t('distribute.assignModal.title', { name: displayName })}</h3>
          <p>{t('distribute.assignModal.nodeId', { id: employee.nodeId?.substring(0, 16) })}</p>
        </div>

        <div className="modal-content-body">
          {/* Primary Key Selection */}
          <div className="form-group">
            <label className="form-label">{t('distribute.primaryKey')}</label>
            <select
              className="select"
              value={selectedPrimary}
              onChange={(e) => setSelectedPrimary(e.target.value)}
            >
              <option value="">{t('distribute.noneOption')}</option>
              {primaryKeys
                .filter((k) => k.isActive)
                .map((k) => (
                  <option key={k.id} value={k.id}>
                    {k.name} ({k.provider}/{k.modelName})
                  </option>
                ))}
            </select>
          </div>

          {/* Auxiliary Key Selection */}
          <div className="form-group">
            <label className="form-label">{t('distribute.auxiliaryKey')}</label>
            <select
              className="select"
              value={selectedAux}
              onChange={(e) => setSelectedAux(e.target.value)}
            >
              <option value="">{t('distribute.noneOption')}</option>
              {auxiliaryKeys
                .filter((k) => k.isActive)
                .map((k) => (
                  <option key={k.id} value={k.id}>
                    {k.name} ({k.provider}/{k.modelName})
                  </option>
                ))}
            </select>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="modal-content-footer">
          <button className="btn btn-default" onClick={onClose} disabled={isSaving}>
            {t('distribute.assignModal.cancel')}
          </button>
          {hasExisting && (
            <button
              className="btn btn-danger"
              onClick={handleUnbind}
              disabled={isSaving}
            >
              {t('distribute.assignModal.unbind')}
            </button>
          )}
          <button
            className="btn btn-primary"
            onClick={handleAssign}
            disabled={isSaving}
          >
            {hasExisting
              ? t('distribute.assignModal.update')
              : t('distribute.assignModal.assign')}
          </button>
        </div>
      </div>
    </div>
  );
}
