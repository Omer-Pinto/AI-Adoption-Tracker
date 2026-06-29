import { useEffect, useState } from 'react';
import type { Domain, Team } from '@/types';
import { api } from '@/api';
import { Modal } from '@/components/Modal';

// ---- Shared DomainFormFields --------------------------------------------------
// Used both inside the Modal (manage page edit/create) and inline on the
// DomainSetupPage (approve-extracted-domain cards). Renders name, description,
// priority (free text), and a cross-domain multi-select.

export interface DomainFormFieldValues {
  name: string;
  description: string;
  priority: string;
  crossDomainIds: number[];
}

interface DomainFormFieldsProps {
  values: DomainFormFieldValues;
  onChange: (next: DomainFormFieldValues) => void;
  /** All domains across all teams (to populate multi-select). */
  allDomains: Domain[];
  /** If editing an existing domain, its id is excluded from the multi-select. */
  excludeId?: number | undefined;
  autoFocusName?: boolean | undefined;
}

export function DomainFormFields({
  values,
  onChange,
  allDomains,
  excludeId,
  autoFocusName,
}: DomainFormFieldsProps) {
  const { name, description, priority, crossDomainIds } = values;

  // Domains available for cross-domain linking (exclude self)
  const options = allDomains.filter((d) => d.id !== excludeId);

  function toggleCrossDomain(id: number) {
    const next = crossDomainIds.includes(id)
      ? crossDomainIds.filter((x) => x !== id)
      : [...crossDomainIds, id];
    onChange({ ...values, crossDomainIds: next });
  }

  return (
    <>
      <div className="form-row">
        <label className="form-label form-label-required">Name</label>
        <input
          className="form-input"
          value={name}
          onChange={(e) => onChange({ ...values, name: e.target.value })}
          placeholder="Domain name"
          autoFocus={autoFocusName}
        />
      </div>
      <div className="form-row">
        <label className="form-label">Description</label>
        <textarea
          className="form-textarea"
          value={description}
          onChange={(e) => onChange({ ...values, description: e.target.value })}
          placeholder="Brief description of this domain…"
          rows={3}
        />
      </div>
      <div className="form-row">
        <label className="form-label">Priority</label>
        <input
          className="form-input"
          type="number"
          min="1"
          step="1"
          value={priority}
          onChange={(e) => onChange({ ...values, priority: e.target.value })}
          placeholder="e.g. 1, 2, 3…"
        />
        <div className="text-muted text-sm" style={{ marginTop: 4 }}>
          Lower number = higher priority
        </div>
      </div>
      <div className="form-row">
        <label className="form-label">Cross-domain links</label>
        {options.length === 0 ? (
          <div className="text-muted text-sm" style={{ padding: '6px 0' }}>
            No other domains available.
          </div>
        ) : (
          <div
            style={{
              border: '1px solid #d1d5db',
              borderRadius: 6,
              maxHeight: 180,
              overflowY: 'auto',
              background: '#fff',
            }}
          >
            {options.map((d) => {
              const checked = crossDomainIds.includes(d.id);
              return (
                <label
                  key={d.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '7px 10px',
                    cursor: 'pointer',
                    borderBottom: '1px solid #f3f4f6',
                    background: checked ? '#eff2ff' : undefined,
                    fontSize: 13,
                    color: '#374151',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleCrossDomain(d.id)}
                    style={{ accentColor: '#4361ee', width: 15, height: 15, flexShrink: 0 }}
                  />
                  <span>
                    <span style={{ fontWeight: 600, color: '#6b7280', fontSize: 11 }}>
                      {d.team_name}:
                    </span>{' '}
                    {d.name}
                  </span>
                </label>
              );
            })}
          </div>
        )}
        {crossDomainIds.length > 0 && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
            {crossDomainIds.map((id) => {
              const d = allDomains.find((x) => x.id === id);
              if (!d) return null;
              return (
                <span
                  key={id}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                    padding: '2px 8px',
                    borderRadius: 20,
                    background: '#ede9fe',
                    color: '#5b21b6',
                    fontSize: 11,
                    fontWeight: 600,
                  }}
                >
                  {d.team_name}: {d.name}
                  <button
                    type="button"
                    onClick={() => toggleCrossDomain(id)}
                    style={{
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      color: '#7c3aed',
                      fontSize: 13,
                      lineHeight: 1,
                      padding: '0 0 0 2px',
                    }}
                    aria-label={`Remove ${d.name}`}
                  >
                    &times;
                  </button>
                </span>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}

// ---- DomainForm modal ---------------------------------------------------------
// Used in ManagePage for create and edit actions.

interface DomainFormProps {
  open: boolean;
  editing: Domain | null;
  teams: Team[];
  onClose: () => void;
  onSaved: () => void;
}

export function DomainForm({
  open,
  editing,
  teams,
  onClose,
  onSaved,
}: DomainFormProps) {
  const [teamId, setTeamId] = useState<string>(
    editing?.team_id != null ? String(editing.team_id) : '',
  );
  const [fields, setFields] = useState<DomainFormFieldValues>({
    name: editing?.name ?? '',
    description: editing?.description ?? '',
    priority: editing?.priority ?? '',
    crossDomainIds: editing?.cross_domains?.map((cd) => cd.id) ?? [],
  });
  const [saving, setSaving] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [allDomains, setAllDomains] = useState<Domain[]>([]);

  useEffect(() => {
    if (!open) return;
    api.domains.list().then(setAllDomains).catch(() => {
      // Non-fatal: multi-select just won't show options
    });
  }, [open]);

  const title = editing ? `Edit Domain: ${editing.name}` : 'Add Domain';

  async function handleSubmit() {
    if (!fields.name.trim()) {
      setSubmitError('Name is required.');
      return;
    }
    setSaving(true);
    setSubmitError(null);
    const body = {
      team_id: Number(teamId),
      name: fields.name,
      description: fields.description || null,
      priority: fields.priority || null,
      cross_domain_ids: fields.crossDomainIds,
    };
    try {
      if (editing) {
        await api.domains.update(editing.id, body);
      } else {
        await api.domains.create(body);
      }
      onSaved();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Save failed. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      title={title}
      onClose={onClose}
      wide
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            onClick={handleSubmit}
            disabled={saving || !fields.name.trim()}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </>
      }
    >
      {submitError && (
        <p style={{ color: '#ef4444', fontSize: '13px', marginBottom: '12px', marginTop: '0' }}>
          {submitError}
        </p>
      )}
      <div className="form-row">
        <label className="form-label form-label-required">Team</label>
        <select
          className="form-select"
          value={teamId}
          onChange={(e) => setTeamId(e.target.value)}
        >
          <option value="">Select team…</option>
          {teams.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </div>
      <DomainFormFields
        values={fields}
        onChange={setFields}
        allDomains={allDomains}
        excludeId={editing?.id}
        autoFocusName={false}
      />
    </Modal>
  );
}
