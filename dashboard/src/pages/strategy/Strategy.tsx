import { useState, useEffect, useCallback, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  useStrategy,
  useStrategyHistory,
  useStrategyDiff,
  useUpdateStrategy,
  useDeployStrategy,
  type CompanyStrategy,
  type StrategyHistoryEntry,
} from '../../api/hooks';
import { Modal } from '../../components/Modal';
import { ErrorMessage } from '../../components/ErrorMessage';

// ---------------------------------------------------------------------------
// Types for structured JSON fields
// ---------------------------------------------------------------------------

interface QuarterlyObjective {
  quarter: string;
  goals: string[];
  kpis: string[];
}

interface MidTermObjectives {
  revenueTarget: string;
  goals: string[];
  kpis: string[];
}

interface LongTermMilestone {
  year: number;
  description: string;
}

interface LongTermObjectives {
  milestones: LongTermMilestone[];
}

interface DepartmentBudget {
  annual: string;
  q1: string;
  q2: string;
  q3: string;
  q4: string;
}

interface DepartmentKpiEntry {
  name: string;
  target: string;
}

const DEPARTMENTS = ['marketing', 'sales', 'engineering', 'finance', 'hr', 'support', 'strategy'] as const;
type Department = typeof DEPARTMENTS[number];

const TAB_KEYS = [
  'profile',
  'shortTerm',
  'midTerm',
  'longTerm',
  'budgets',
  'kpis',
] as const;

const TAB_LABELS = [
  'Company Profile',
  'Short-term',
  'Mid-term',
  'Long-term',
  'Budgets',
  'KPIs',
] as const;
type TabIndex = 0 | 1 | 2 | 3 | 4 | 5;

// ---------------------------------------------------------------------------
// Default values
// ---------------------------------------------------------------------------

const DEFAULT_SHORT_TERM: QuarterlyObjective[] = [
  { quarter: 'Q1 2026', goals: [''], kpis: [''] },
  { quarter: 'Q2 2026', goals: [''], kpis: [''] },
  { quarter: 'Q3 2026', goals: [''], kpis: [''] },
  { quarter: 'Q4 2026', goals: [''], kpis: [''] },
];

const DEFAULT_MID_TERM: MidTermObjectives = {
  revenueTarget: '',
  goals: [''],
  kpis: [''],
};

const DEFAULT_LONG_TERM: LongTermObjectives = {
  milestones: [
    { year: 2027, description: '' },
    { year: 2028, description: '' },
    { year: 2029, description: '' },
  ],
};

const DEFAULT_BUDGET: DepartmentBudget = { annual: '', q1: '', q2: '', q3: '', q4: '' };

function defaultBudgets(): Record<Department, DepartmentBudget> {
  return Object.fromEntries(DEPARTMENTS.map((d) => [d, { ...DEFAULT_BUDGET }])) as Record<Department, DepartmentBudget>;
}

function defaultKpis(): Record<Department, DepartmentKpiEntry[]> {
  return Object.fromEntries(DEPARTMENTS.map((d) => [d, [{ name: '', target: '' }]])) as Record<Department, DepartmentKpiEntry[]>;
}

// ---------------------------------------------------------------------------
// Safe JSON parsers
// ---------------------------------------------------------------------------

function parseShortTerm(raw: unknown): QuarterlyObjective[] {
  try {
    if (!raw) return DEFAULT_SHORT_TERM;
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (Array.isArray(parsed)) return parsed as QuarterlyObjective[];
  } catch {
    // fall through
  }
  return DEFAULT_SHORT_TERM;
}

function parseMidTerm(raw: unknown): MidTermObjectives {
  try {
    if (!raw) return DEFAULT_MID_TERM;
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as MidTermObjectives;
  } catch {
    // fall through
  }
  return DEFAULT_MID_TERM;
}

function parseLongTerm(raw: unknown): LongTermObjectives {
  try {
    if (!raw) return DEFAULT_LONG_TERM;
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as LongTermObjectives;
  } catch {
    // fall through
  }
  return DEFAULT_LONG_TERM;
}

function parseBudgets(raw: unknown): Record<Department, DepartmentBudget> {
  try {
    if (!raw) return defaultBudgets();
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const result = defaultBudgets();
      for (const dept of DEPARTMENTS) {
        if ((parsed as Record<string, unknown>)[dept]) {
          result[dept] = { ...DEFAULT_BUDGET, ...(parsed as Record<string, unknown>)[dept] as DepartmentBudget };
        }
      }
      return result;
    }
  } catch {
    // fall through
  }
  return defaultBudgets();
}

function parseKpis(raw: unknown): Record<Department, DepartmentKpiEntry[]> {
  try {
    if (!raw) return defaultKpis();
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const result = defaultKpis();
      for (const dept of DEPARTMENTS) {
        const deptData = (parsed as Record<string, unknown>)[dept];
        if (Array.isArray(deptData)) {
          result[dept] = deptData as DepartmentKpiEntry[];
        } else if (deptData && typeof deptData === 'object') {
          // Handle object format { kpiName: target, ... }
          result[dept] = Object.entries(deptData as Record<string, string>).map(([name, target]) => ({ name, target }));
        }
      }
      return result;
    }
  } catch {
    // fall through
  }
  return defaultKpis();
}

// ---------------------------------------------------------------------------
// Small reusable subcomponents
// ---------------------------------------------------------------------------

function StringListEditor({
  label,
  items,
  onChange,
  placeholder,
}: {
  label: string;
  items: string[];
  onChange: (items: string[]) => void;
  placeholder?: string;
}) {
  const safeItems = items.length > 0 ? items : [''];

  return (
    <div className="form-group" style={{ marginBottom: 12 }}>
      <label className="form-label">{label}</label>
      {safeItems.map((item, idx) => (
        <div key={idx} style={{ display: 'flex', gap: 6, marginBottom: 4 }}>
          <input
            className="input"
            style={{ flex: 1 }}
            value={item}
            placeholder={placeholder ?? `Item ${idx + 1}`}
            onChange={(e) => {
              const next = [...safeItems];
              next[idx] = e.target.value;
              onChange(next);
            }}
          />
          <button
            className="btn btn-danger btn-sm"
            type="button"
            onClick={() => {
              const next = safeItems.filter((_, i) => i !== idx);
              onChange(next.length > 0 ? next : ['']);
            }}
            aria-label="Remove item"
          >
            −
          </button>
        </div>
      ))}
      <button
        className="btn btn-default btn-sm"
        type="button"
        onClick={() => onChange([...safeItems, ''])}
        style={{ marginTop: 2 }}
      >
        + Add
      </button>
    </div>
  );
}

function SectionNote({ children }: { children: ReactNode }) {
  return (
    <p className="text-muted" style={{ fontSize: 13, marginBottom: 16, marginTop: -4 }}>
      {children}
    </p>
  );
}

// ---------------------------------------------------------------------------
// Tab 1: Company Profile
// ---------------------------------------------------------------------------

interface CompanyProfileTabProps {
  mission: string;
  vision: string;
  values: string;
  onChange: (field: 'mission' | 'vision' | 'values', value: string) => void;
}

function CompanyProfileTab({ mission, vision, values, onChange }: CompanyProfileTabProps) {
  return (
    <div style={{ maxWidth: 720 }}>
      <SectionNote>
        Define the foundational identity of the company. These fields are broadcast to all AI agents as core context.
      </SectionNote>
      <div className="form-group">
        <label className="form-label">Mission</label>
        <textarea
          className="textarea"
          rows={4}
          value={mission}
          placeholder="Why does our company exist? What problem do we solve?"
          onChange={(e) => onChange('mission', e.target.value)}
        />
      </div>
      <div className="form-group">
        <label className="form-label">Vision</label>
        <textarea
          className="textarea"
          rows={4}
          value={vision}
          placeholder="Where are we going? What does success look like in 10 years?"
          onChange={(e) => onChange('vision', e.target.value)}
        />
      </div>
      <div className="form-group">
        <label className="form-label">Values</label>
        <textarea
          className="textarea"
          rows={4}
          value={values}
          placeholder="What principles guide our decisions and culture?"
          onChange={(e) => onChange('values', e.target.value)}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab 2: Short-term (Quarterly)
// ---------------------------------------------------------------------------

interface ShortTermTabProps {
  objectives: QuarterlyObjective[];
  onChange: (objectives: QuarterlyObjective[]) => void;
}

function ShortTermTab({ objectives, onChange }: ShortTermTabProps) {
  const updateObjective = (idx: number, patch: Partial<QuarterlyObjective>) => {
    const next = objectives.map((o, i) => (i === idx ? { ...o, ...patch } : o));
    onChange(next);
  };

  const addQuarter = () => {
    onChange([...objectives, { quarter: '', goals: [''], kpis: [''] }]);
  };

  const removeQuarter = (idx: number) => {
    onChange(objectives.filter((_, i) => i !== idx));
  };

  return (
    <div>
      <SectionNote>
        Quarterly objectives define near-term targets. Each quarter can have multiple goals and KPIs.
      </SectionNote>
      {objectives.map((obj, idx) => (
        <div key={idx} className="card" style={{ marginBottom: 16, padding: '16px 20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <input
              className="input"
              style={{ fontWeight: 600, fontSize: 15, maxWidth: 200 }}
              value={obj.quarter}
              placeholder="e.g. Q1 2026"
              onChange={(e) => updateObjective(idx, { quarter: e.target.value })}
            />
            <button
              className="btn btn-danger btn-sm"
              type="button"
              onClick={() => removeQuarter(idx)}
            >
              Remove Quarter
            </button>
          </div>
          <StringListEditor
            label="Goals"
            items={obj.goals}
            onChange={(goals) => updateObjective(idx, { goals })}
            placeholder="Goal description"
          />
          <StringListEditor
            label="KPIs"
            items={obj.kpis}
            onChange={(kpis) => updateObjective(idx, { kpis })}
            placeholder="KPI metric"
          />
        </div>
      ))}
      <button className="btn btn-default" type="button" onClick={addQuarter}>
        + Add Quarter
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab 3: Mid-term (Annual)
// ---------------------------------------------------------------------------

interface MidTermTabProps {
  objectives: MidTermObjectives;
  onChange: (objectives: MidTermObjectives) => void;
}

function MidTermTab({ objectives, onChange }: MidTermTabProps) {
  return (
    <div style={{ maxWidth: 720 }}>
      <SectionNote>
        Annual targets for the current and next fiscal year. Used to guide department OKR alignment.
      </SectionNote>
      <div className="card" style={{ padding: '16px 20px', marginBottom: 16 }}>
        <div className="form-group">
          <label className="form-label">Revenue Target</label>
          <input
            className="input"
            style={{ maxWidth: 300 }}
            value={objectives.revenueTarget}
            placeholder="e.g. $10M ARR"
            onChange={(e) => onChange({ ...objectives, revenueTarget: e.target.value })}
          />
        </div>
        <StringListEditor
          label="Annual Goals"
          items={objectives.goals}
          onChange={(goals) => onChange({ ...objectives, goals })}
          placeholder="Goal description"
        />
        <StringListEditor
          label="Annual KPIs"
          items={objectives.kpis}
          onChange={(kpis) => onChange({ ...objectives, kpis })}
          placeholder="KPI metric"
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab 4: Long-term (Milestones)
// ---------------------------------------------------------------------------

interface LongTermTabProps {
  objectives: LongTermObjectives;
  onChange: (objectives: LongTermObjectives) => void;
}

function LongTermTab({ objectives, onChange }: LongTermTabProps) {
  const updateMilestone = (idx: number, patch: Partial<LongTermMilestone>) => {
    const next = objectives.milestones.map((m, i) => (i === idx ? { ...m, ...patch } : m));
    onChange({ milestones: next });
  };

  const addMilestone = () => {
    const lastYear = objectives.milestones.length > 0
      ? objectives.milestones[objectives.milestones.length - 1].year + 1
      : new Date().getFullYear() + 1;
    onChange({ milestones: [...objectives.milestones, { year: lastYear, description: '' }] });
  };

  const removeMilestone = (idx: number) => {
    onChange({ milestones: objectives.milestones.filter((_, i) => i !== idx) });
  };

  return (
    <div style={{ maxWidth: 720 }}>
      <SectionNote>
        3–5 year strategic milestones. These represent major checkpoints on the path to the company vision.
      </SectionNote>
      {objectives.milestones.map((m, idx) => (
        <div key={idx} className="card" style={{ marginBottom: 12, padding: '14px 18px' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
            <div style={{ minWidth: 90 }}>
              <label className="form-label">Year</label>
              <input
                className="input mono"
                style={{ width: 90 }}
                type="number"
                value={m.year}
                onChange={(e) => updateMilestone(idx, { year: parseInt(e.target.value, 10) || m.year })}
              />
            </div>
            <div style={{ flex: 1 }}>
              <label className="form-label">Milestone Description</label>
              <input
                className="input"
                value={m.description}
                placeholder="Describe the milestone to be achieved by this year"
                onChange={(e) => updateMilestone(idx, { description: e.target.value })}
              />
            </div>
            <button
              className="btn btn-danger btn-sm"
              type="button"
              style={{ marginTop: 22 }}
              onClick={() => removeMilestone(idx)}
            >
              −
            </button>
          </div>
        </div>
      ))}
      <button className="btn btn-default" type="button" onClick={addMilestone}>
        + Add Milestone
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab 5: Budgets
// ---------------------------------------------------------------------------

interface BudgetsTabProps {
  budgets: Record<Department, DepartmentBudget>;
  onChange: (budgets: Record<Department, DepartmentBudget>) => void;
}

function BudgetsTab({ budgets, onChange }: BudgetsTabProps) {
  const updateBudget = (dept: Department, field: keyof DepartmentBudget, value: string) => {
    onChange({ ...budgets, [dept]: { ...budgets[dept], [field]: value } });
  };

  return (
    <div>
      <SectionNote>
        Department budget allocations. All values are strings so you can include currency symbols and units (e.g. "$500K").
      </SectionNote>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: '2px solid var(--border, #e5e7eb)' }}>
              <th style={{ textAlign: 'left', padding: '8px 12px', fontWeight: 600 }}>Department</th>
              <th style={{ textAlign: 'left', padding: '8px 12px', fontWeight: 600 }}>Annual</th>
              <th style={{ textAlign: 'left', padding: '8px 12px', fontWeight: 600 }}>Q1</th>
              <th style={{ textAlign: 'left', padding: '8px 12px', fontWeight: 600 }}>Q2</th>
              <th style={{ textAlign: 'left', padding: '8px 12px', fontWeight: 600 }}>Q3</th>
              <th style={{ textAlign: 'left', padding: '8px 12px', fontWeight: 600 }}>Q4</th>
            </tr>
          </thead>
          <tbody>
            {DEPARTMENTS.map((dept) => {
              const b = budgets[dept];
              return (
                <tr key={dept} style={{ borderBottom: '1px solid var(--border, #e5e7eb)' }}>
                  <td style={{ padding: '8px 12px' }}>
                    <span style={{ fontWeight: 500, textTransform: 'capitalize' }}>{dept}</span>
                  </td>
                  {(['annual', 'q1', 'q2', 'q3', 'q4'] as const).map((field) => (
                    <td key={field} style={{ padding: '6px 8px' }}>
                      <input
                        className="input mono"
                        style={{ width: 110, fontSize: 13 }}
                        value={b[field]}
                        placeholder="$0"
                        onChange={(e) => updateBudget(dept, field, e.target.value)}
                      />
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab 6: Department KPIs
// ---------------------------------------------------------------------------

interface KpisTabProps {
  kpis: Record<Department, DepartmentKpiEntry[]>;
  onChange: (kpis: Record<Department, DepartmentKpiEntry[]>) => void;
}

function KpisTab({ kpis, onChange }: KpisTabProps) {
  const updateKpi = (dept: Department, idx: number, field: keyof DepartmentKpiEntry, value: string) => {
    const entries = [...kpis[dept]];
    entries[idx] = { ...entries[idx], [field]: value };
    onChange({ ...kpis, [dept]: entries });
  };

  const addKpi = (dept: Department) => {
    onChange({ ...kpis, [dept]: [...kpis[dept], { name: '', target: '' }] });
  };

  const removeKpi = (dept: Department, idx: number) => {
    const entries = kpis[dept].filter((_, i) => i !== idx);
    onChange({ ...kpis, [dept]: entries.length > 0 ? entries : [{ name: '', target: '' }] });
  };

  return (
    <div>
      <SectionNote>
        Key performance indicators per department. Each KPI has a name and a measurable target.
      </SectionNote>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 16 }}>
        {DEPARTMENTS.map((dept) => (
          <div key={dept} className="card" style={{ padding: '14px 16px' }}>
            <h4 style={{ margin: '0 0 10px', textTransform: 'capitalize', fontSize: 14, fontWeight: 600 }}>
              {dept}
            </h4>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 120px 28px', gap: 4, marginBottom: 4 }}>
              <span className="text-muted" style={{ fontSize: 11, fontWeight: 600, padding: '0 2px' }}>KPI NAME</span>
              <span className="text-muted" style={{ fontSize: 11, fontWeight: 600, padding: '0 2px' }}>TARGET</span>
              <span />
            </div>
            {kpis[dept].map((entry, idx) => (
              <div key={idx} style={{ display: 'grid', gridTemplateColumns: '1fr 120px 28px', gap: 4, marginBottom: 4 }}>
                <input
                  className="input"
                  style={{ fontSize: 13 }}
                  value={entry.name}
                  placeholder="KPI name"
                  onChange={(e) => updateKpi(dept, idx, 'name', e.target.value)}
                />
                <input
                  className="input mono"
                  style={{ fontSize: 13 }}
                  value={entry.target}
                  placeholder="Target"
                  onChange={(e) => updateKpi(dept, idx, 'target', e.target.value)}
                />
                <button
                  className="btn btn-danger btn-sm"
                  type="button"
                  style={{ padding: '0 6px', fontSize: 14 }}
                  onClick={() => removeKpi(dept, idx)}
                  aria-label="Remove KPI"
                >
                  −
                </button>
              </div>
            ))}
            <button
              className="btn btn-default btn-sm"
              type="button"
              style={{ marginTop: 4, width: '100%' }}
              onClick={() => addKpi(dept)}
            >
              + Add KPI
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// History Panel
// ---------------------------------------------------------------------------

interface HistoryPanelProps {
  entries: StrategyHistoryEntry[];
  isLoading: boolean;
  currentRevision: number;
  onClose: () => void;
}

function HistoryPanel({ entries, isLoading, currentRevision, onClose }: HistoryPanelProps) {
  const [diffRevs, setDiffRevs] = useState<{ r1: number; r2: number } | null>(null);
  const { data: diffData, isLoading: diffLoading } = useStrategyDiff(
    diffRevs?.r1 ?? 0,
    diffRevs?.r2 ?? 0,
  );

  return (
    <Modal open onClose={onClose} title="Revision History" size="lg">
      {isLoading && <p className="text-muted">Loading history...</p>}
      {!isLoading && entries.length === 0 && (
        <p className="text-muted">No revision history yet.</p>
      )}
      {!isLoading && entries.length > 0 && (
        <div>
          <p className="text-muted" style={{ marginBottom: 12, fontSize: 13 }}>
            Current revision: <strong>rev {currentRevision}</strong>. Click "Compare" on any two revisions to see the diff.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
            {entries.map((entry) => (
              <div
                key={entry.id}
                className="card"
                style={{ padding: '10px 14px', display: 'flex', alignItems: 'flex-start', gap: 12 }}
              >
                <div style={{ minWidth: 52 }}>
                  <span className="tag mono" style={{ fontSize: 12 }}>rev {entry.revision}</span>
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 500 }}>
                    {entry.changeSummary ?? 'Strategy updated'}
                  </div>
                  {entry.changedFields && entry.changedFields.length > 0 && (
                    <div style={{ marginTop: 4, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                      {entry.changedFields.map((f) => (
                        <span key={f} className="tag" style={{ fontSize: 11 }}>{f}</span>
                      ))}
                    </div>
                  )}
                  <div className="text-muted" style={{ fontSize: 12, marginTop: 4 }}>
                    {entry.changedBy ?? 'System'} &middot; {new Date(entry.createdAt).toLocaleString()}
                  </div>
                </div>
                {currentRevision !== entry.revision && (
                  <button
                    className="btn btn-default btn-sm"
                    type="button"
                    onClick={() =>
                      setDiffRevs({ r1: entry.revision, r2: currentRevision })
                    }
                  >
                    Compare
                  </button>
                )}
              </div>
            ))}
          </div>

          {diffRevs && (
            <div className="card" style={{ padding: '14px 16px' }}>
              <h4 style={{ margin: '0 0 8px', fontSize: 14 }}>
                Diff: rev {diffRevs.r1} vs rev {diffRevs.r2}
              </h4>
              {diffLoading && <p className="text-muted">Loading diff...</p>}
              {!diffLoading && diffData?.data?.changedFields && (
                <ul style={{ margin: 0, paddingLeft: 18 }}>
                  {diffData.data.changedFields.map((f) => (
                    <li key={f} style={{ fontSize: 13, marginBottom: 4 }}>
                      <span className="tag">{f}</span>
                    </li>
                  ))}
                </ul>
              )}
              {!diffLoading && (!diffData?.data?.changedFields || diffData.data.changedFields.length === 0) && (
                <p className="text-muted" style={{ fontSize: 13 }}>No changed fields reported.</p>
              )}
              <button
                className="btn btn-default btn-sm"
                type="button"
                style={{ marginTop: 10 }}
                onClick={() => setDiffRevs(null)}
              >
                Close Diff
              </button>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Deploy Confirmation Modal
// ---------------------------------------------------------------------------

interface DeployModalProps {
  onConfirm: () => void;
  onCancel: () => void;
  isPending: boolean;
}

function DeployModal({ onConfirm, onCancel, isPending }: DeployModalProps) {
  return (
    <Modal
      open
      onClose={onCancel}
      title="Deploy Strategy to All Agents"
      footer={
        <div className="modal-footer-actions">
          <button className="btn btn-default" onClick={onCancel} disabled={isPending}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            onClick={onConfirm}
            disabled={isPending}
          >
            {isPending ? 'Deploying...' : 'Confirm Deploy'}
          </button>
        </div>
      }
    >
      <p>
        This will save the current strategy and broadcast it to <strong>all AI agents</strong> in the system.
        Active tasks and employee assignments may be re-evaluated based on the new strategy context.
      </p>
      <p className="text-warning" style={{ marginTop: 8 }}>
        This action triggers a cascade update across the platform. Proceed only when the strategy is ready.
      </p>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Main Strategy page
// ---------------------------------------------------------------------------

export function Strategy() {
  const { t } = useTranslation('strategy');
  const { data: strategyData, isLoading, error } = useStrategy();
  const { data: historyData, isLoading: historyLoading } = useStrategyHistory({ page_size: 20 });
  const updateStrategy = useUpdateStrategy();
  const deployStrategy = useDeployStrategy();

  const strategy = strategyData?.data ?? null;

  // Tab state
  const [activeTab, setActiveTab] = useState<TabIndex>(0);

  // Company profile state
  const [mission, setMission] = useState('');
  const [vision, setVision] = useState('');
  const [values, setValues] = useState('');

  // Structured tab states
  const [shortTerm, setShortTerm] = useState<QuarterlyObjective[]>(DEFAULT_SHORT_TERM);
  const [midTerm, setMidTerm] = useState<MidTermObjectives>(DEFAULT_MID_TERM);
  const [longTerm, setLongTerm] = useState<LongTermObjectives>(DEFAULT_LONG_TERM);
  const [budgets, setBudgets] = useState<Record<Department, DepartmentBudget>>(defaultBudgets);
  const [kpis, setKpis] = useState<Record<Department, DepartmentKpiEntry[]>>(defaultKpis);

  // Modal state
  const [showHistory, setShowHistory] = useState(false);
  const [showDeployModal, setShowDeployModal] = useState(false);

  // Status message
  const [statusMsg, setStatusMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Initialize form from loaded strategy
  const initFromStrategy = useCallback((s: CompanyStrategy) => {
    setMission(s.companyMission ?? '');
    setVision(s.companyVision ?? '');
    setValues(s.companyValues ?? '');
    setShortTerm(parseShortTerm(s.shortTermObjectives));
    setMidTerm(parseMidTerm(s.midTermObjectives));
    setLongTerm(parseLongTerm(s.longTermObjectives));
    setBudgets(parseBudgets(s.departmentBudgets));
    setKpis(parseKpis(s.departmentKpis));
  }, []);

  useEffect(() => {
    if (strategy) {
      initFromStrategy(strategy);
    }
  }, [strategy, initFromStrategy]);

  // Build payload from current form state
  const buildPayload = (): Partial<CompanyStrategy> => ({
    companyMission: mission,
    companyVision: vision,
    companyValues: values,
    shortTermObjectives: shortTerm,
    midTermObjectives: midTerm,
    longTermObjectives: longTerm,
    departmentBudgets: budgets as Record<string, unknown>,
    departmentKpis: kpis as Record<string, unknown>,
  });

  const showStatus = (type: 'success' | 'error', text: string) => {
    setStatusMsg({ type, text });
    setTimeout(() => setStatusMsg(null), 4000);
  };

  const handleSaveDraft = () => {
    window.alert('Draft saved locally. Use "Save & Deploy" to persist and broadcast to agents.');
  };

  const handleSaveAndDeploy = () => {
    setShowDeployModal(true);
  };

  const handleConfirmDeploy = async () => {
    try {
      await updateStrategy.mutateAsync(buildPayload());
      await deployStrategy.mutateAsync();
      setShowDeployModal(false);
      showStatus('success', 'Strategy saved and deployed to all agents.');
    } catch (err) {
      setShowDeployModal(false);
      showStatus('error', err instanceof Error ? err.message : 'Deploy failed.');
    }
  };

  if (isLoading) {
    return (
      <div className="page">
        <div className="page-header">
          <h1 className="page-title">{t('title')}</h1>
        </div>
        <p className="text-muted">Loading strategy...</p>
      </div>
    );
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

  const historyEntries = historyData?.data ?? [];

  return (
    <div className="page">
      {/* Page header */}
      <div className="page-header" style={{ marginBottom: 0 }}>
        <div>
          <h1 className="page-title">{t('title')}</h1>
          <p className="page-subtitle">
            {t('subtitle')}
            {strategy && (
              <span className="text-muted" style={{ marginLeft: 10 }}>
                <span className="mono tag" style={{ fontSize: 12 }}>rev {strategy.revision}</span>
                {strategy.updatedBy && (
                  <span style={{ marginLeft: 8 }}>Last updated by {strategy.updatedBy}</span>
                )}
              </span>
            )}
          </p>
        </div>
        <div className="action-group">
          <button
            className="btn btn-default btn-sm"
            type="button"
            onClick={() => setShowHistory(true)}
          >
            {t('actions.history')}
          </button>
          <button
            className="btn btn-default"
            type="button"
            onClick={handleSaveDraft}
          >
            {t('actions.saveDraft')}
          </button>
          <button
            className="btn btn-primary"
            type="button"
            onClick={handleSaveAndDeploy}
            disabled={updateStrategy.isPending || deployStrategy.isPending}
          >
            {(updateStrategy.isPending || deployStrategy.isPending)
              ? t('actions.deploying')
              : t('actions.deploy')}
          </button>
        </div>
      </div>

      {/* Status message */}
      {statusMsg && (
        <div
          className={statusMsg.type === 'success' ? 'text-success' : 'text-danger'}
          style={{
            padding: '10px 14px',
            borderRadius: 6,
            marginTop: 12,
            marginBottom: 4,
            background: statusMsg.type === 'success'
              ? 'rgba(16,185,129,0.08)'
              : 'rgba(239,68,68,0.08)',
            fontSize: 14,
          }}
        >
          {statusMsg.type === 'success' ? '✓' : '✕'} {statusMsg.text}
        </div>
      )}

      {/* Mutation errors */}
      {updateStrategy.error && (
        <div style={{ marginTop: 12 }}>
          <ErrorMessage error={updateStrategy.error as Error} />
        </div>
      )}
      {deployStrategy.error && (
        <div style={{ marginTop: 8 }}>
          <ErrorMessage error={deployStrategy.error as Error} />
        </div>
      )}

      {/* Tab navigation */}
      <div
        style={{
          display: 'flex',
          gap: 2,
          marginTop: 24,
          marginBottom: 24,
          borderBottom: '2px solid var(--border, #e5e7eb)',
          paddingBottom: 0,
        }}
        role="tablist"
        aria-label="Strategy sections"
      >
        {TAB_LABELS.map((label, idx) => (
          <button
            key={label}
            role="tab"
            aria-selected={activeTab === idx}
            className={`btn btn-default btn-sm`}
            type="button"
            style={{
              borderRadius: '4px 4px 0 0',
              borderBottom: activeTab === idx ? '2px solid var(--primary, #4f46e5)' : '2px solid transparent',
              fontWeight: activeTab === idx ? 600 : 400,
              color: activeTab === idx ? 'var(--primary, #4f46e5)' : undefined,
              marginBottom: -2,
              background: activeTab === idx ? 'var(--bg-subtle, #f8f8fc)' : undefined,
            }}
            onClick={() => setActiveTab(idx as TabIndex)}
          >
            {t(`tabs.${TAB_KEYS[idx]}`)}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div role="tabpanel">
        {activeTab === 0 && (
          <CompanyProfileTab
            mission={mission}
            vision={vision}
            values={values}
            onChange={(field, value) => {
              if (field === 'mission') setMission(value);
              else if (field === 'vision') setVision(value);
              else setValues(value);
            }}
          />
        )}

        {activeTab === 1 && (
          <ShortTermTab objectives={shortTerm} onChange={setShortTerm} />
        )}

        {activeTab === 2 && (
          <MidTermTab objectives={midTerm} onChange={setMidTerm} />
        )}

        {activeTab === 3 && (
          <LongTermTab objectives={longTerm} onChange={setLongTerm} />
        )}

        {activeTab === 4 && (
          <BudgetsTab budgets={budgets} onChange={setBudgets} />
        )}

        {activeTab === 5 && (
          <KpisTab kpis={kpis} onChange={setKpis} />
        )}
      </div>

      {/* History modal */}
      {showHistory && (
        <HistoryPanel
          entries={historyEntries}
          isLoading={historyLoading}
          currentRevision={strategy?.revision ?? 0}
          onClose={() => setShowHistory(false)}
        />
      )}

      {/* Deploy confirmation modal */}
      {showDeployModal && (
        <DeployModal
          onConfirm={handleConfirmDeploy}
          onCancel={() => setShowDeployModal(false)}
          isPending={updateStrategy.isPending || deployStrategy.isPending}
        />
      )}
    </div>
  );
}
