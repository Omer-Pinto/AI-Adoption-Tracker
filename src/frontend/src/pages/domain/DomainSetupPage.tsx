import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Team, Champion, Domain } from '@/types';
import type { DomainProposal } from '@/api';
import { api } from '@/api';
import { DomainFormFields } from '@/pages/manage/DomainForm';
import type { DomainFormFieldValues } from '@/pages/manage/DomainForm';

// Route: "/domains/extract"
// Lets the user pick a team (and champion), paste raw domain text,
// extract proposals via POST /api/domains/extract, then review/edit
// and approve each proposal (POST /api/domains).

// ---- Proposal card ----------------------------------------------------------
//
// Controlled: the editable field values live on the page (so both "Approve &
// save" and "Approve all" read the same source of truth). The card just renders
// the fields and reports edits / approve clicks up via props.

interface ProposalCardProps {
  index: number;
  fields: DomainFormFieldValues;
  onFieldsChange: (index: number, next: DomainFormFieldValues) => void;
  allDomains: Domain[];
  onApprove: (index: number) => void;
  saving: boolean;
  error: string | null;
  alreadySaved: boolean;
}

function ProposalCard({
  index,
  fields,
  onFieldsChange,
  allDomains,
  onApprove,
  saving,
  error,
  alreadySaved,
}: ProposalCardProps) {
  if (alreadySaved) {
    return (
      <div
        style={{
          background: '#f0fdf4',
          border: '1px solid #bbf7d0',
          borderRadius: 10,
          padding: '14px 18px',
          marginBottom: 12,
          display: 'flex',
          alignItems: 'center',
          gap: 10,
        }}
      >
        <span style={{ fontSize: 18, color: '#16a34a' }}>&#10003;</span>
        <div>
          <div style={{ fontWeight: 700, fontSize: 13, color: '#166534' }}>
            {fields.name}
          </div>
          <div style={{ fontSize: 11, color: '#15803d' }}>Saved successfully</div>
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        background: '#ffffff',
        border: '1px solid #e5e7eb',
        borderRadius: 10,
        padding: '16px 18px',
        marginBottom: 12,
      }}
    >
      <div
        style={{
          fontSize: 11,
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: '0.5px',
          color: '#9ca3af',
          marginBottom: 12,
        }}
      >
        Proposal {index + 1}
      </div>

      {error && (
        <div className="blocker-banner" style={{ marginBottom: 12 }}>
          {error}
        </div>
      )}

      <DomainFormFields
        values={fields}
        onChange={(next) => onFieldsChange(index, next)}
        allDomains={allDomains}
        autoFocusName={false}
      />

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
        <button
          className="btn btn-primary btn-sm"
          onClick={() => onApprove(index)}
          disabled={saving}
        >
          {saving ? 'Saving…' : 'Approve & save'}
        </button>
      </div>
    </div>
  );
}

// ---- Main page ---------------------------------------------------------------

// Seed a card's editable fields from a raw proposal. `priority` is coerced to a
// string — the extraction returns it as a number, but POST /api/domains expects
// a free-text string (DB column is TEXT), so un-edited proposals must not carry
// a number through to the save body (that 422s on `priority`).
function proposalToFields(p: DomainProposal): DomainFormFieldValues {
  return {
    name: p.name,
    description: p.description ?? '',
    priority: p.priority != null ? String(p.priority) : '',
    crossDomainIds: [],
  };
}

export default function DomainSetupPage() {
  const [teams, setTeams] = useState<Team[]>([]);
  const [champions, setChampions] = useState<Champion[]>([]);
  const [allDomains, setAllDomains] = useState<Domain[]>([]);
  const [loadingTeams, setLoadingTeams] = useState(true);

  const [selectedTeamId, setSelectedTeamId] = useState<string>('');
  const [selectedChampionId, setSelectedChampionId] = useState<string>('');

  const [text, setText] = useState('');
  const [extracting, setExtracting] = useState(false);
  const [extractError, setExtractError] = useState<string | null>(null);

  const [proposals, setProposals] = useState<DomainProposal[]>([]);
  // Editable field values per proposal — lifted here (out of each card) so both
  // single "Approve & save" and "Approve all" read the user's current edits.
  const [fieldValues, setFieldValues] = useState<DomainFormFieldValues[]>([]);
  const [savedIds, setSavedIds] = useState<Set<number>>(new Set());
  const [dirtyIds, setDirtyIds] = useState<Set<number>>(new Set());
  const [savingIds, setSavingIds] = useState<Set<number>>(new Set());
  const [errors, setErrors] = useState<Record<number, string | null>>({});
  const [batchSaving, setBatchSaving] = useState(false);
  const [hasExtracted, setHasExtracted] = useState(false);

  // Load teams + all domains on mount
  useEffect(() => {
    Promise.all([api.teams.list(), api.domains.list()])
      .then(([t, d]) => {
        setTeams(t);
        setAllDomains(d);
      })
      .catch(() => {
        // Non-fatal
      })
      .finally(() => setLoadingTeams(false));
  }, []);

  // When team changes, fetch its champions and auto-select if exactly one
  useEffect(() => {
    if (!selectedTeamId) {
      setChampions([]);
      setSelectedChampionId('');
      return;
    }
    api.champions.list().then((all) => {
      const forTeam = all.filter((c) => c.team_id === Number(selectedTeamId));
      setChampions(forTeam);
      if (forTeam.length === 1 && forTeam[0]) {
        // Auto-select the sole champion
        setSelectedChampionId(String(forTeam[0].id));
      } else {
        setSelectedChampionId(forTeam.length > 0 && forTeam[0] ? String(forTeam[0].id) : '');
      }
    }).catch(() => {
      setChampions([]);
      setSelectedChampionId('');
    });
  }, [selectedTeamId]);

  async function handleExtract() {
    if (!text.trim()) return;
    // 5B — warn before discarding unsaved edited (dirty, not-yet-saved) proposals.
    const hasUnsavedEdits = [...dirtyIds].some((i) => !savedIds.has(i));
    if (hasUnsavedEdits) {
      const ok = window.confirm(
        'Re-extracting will discard your unsaved edited proposals. Continue?',
      );
      if (!ok) return;
    }
    setExtracting(true);
    setExtractError(null);
    setProposals([]);
    setFieldValues([]);
    setSavedIds(new Set());
    setDirtyIds(new Set());
    setSavingIds(new Set());
    setErrors({});
    setHasExtracted(false);
    try {
      const result = await api.domains.extract(text);
      setProposals(result.domains);
      setFieldValues(result.domains.map(proposalToFields));
      setHasExtracted(true);
    } catch (err) {
      setExtractError(err instanceof Error ? err.message : 'Extraction failed.');
    } finally {
      setExtracting(false);
    }
  }

  function handleProposalApproved(index: number, saved: Domain) {
    // Refresh all domains so new domain appears in cross-domain multi-selects
    setAllDomains((prev) => [...prev, saved]);
    setSavedIds((prev) => new Set([...prev, index]));
  }

  function handleDirtyChange(index: number, dirty: boolean) {
    setDirtyIds((prev) => {
      const has = prev.has(index);
      if (dirty === has) return prev;
      const next = new Set(prev);
      if (dirty) next.add(index);
      else next.delete(index);
      return next;
    });
  }

  function handleFieldsChange(index: number, next: DomainFormFieldValues) {
    setFieldValues((prev) => prev.map((f, i) => (i === index ? next : f)));
    const orig = proposals[index] ? proposalToFields(proposals[index]) : next;
    const dirty =
      next.name !== orig.name ||
      next.description !== orig.description ||
      next.priority !== orig.priority ||
      next.crossDomainIds.length !== orig.crossDomainIds.length;
    handleDirtyChange(index, dirty);
  }

  // Save one proposal by index, using its CURRENT (possibly edited) field values.
  // Returns true on success. Shared by single-approve and the approve-all batch.
  async function saveProposal(index: number): Promise<boolean> {
    const f = fieldValues[index];
    if (!f || !f.name.trim()) {
      setErrors((prev) => ({ ...prev, [index]: 'Name is required.' }));
      return false;
    }
    setSavingIds((prev) => new Set(prev).add(index));
    setErrors((prev) => ({ ...prev, [index]: null }));
    try {
      const saved = await api.domains.create({
        team_id: Number(selectedTeamId),
        champion_id: Number(selectedChampionId),
        name: f.name,
        description: f.description || null,
        priority: f.priority || null,
        cross_domain_ids: f.crossDomainIds,
      });
      handleDirtyChange(index, false);
      handleProposalApproved(index, saved);
      return true;
    } catch (err) {
      setErrors((prev) => ({
        ...prev,
        [index]: err instanceof Error ? err.message : 'Save failed.',
      }));
      return false;
    } finally {
      setSavingIds((prev) => {
        const nextSet = new Set(prev);
        nextSet.delete(index);
        return nextSet;
      });
    }
  }

  // Approve every not-yet-saved proposal, sequentially (a proposal may cross-link
  // to one saved earlier in the batch, and sequencing surfaces errors cleanly).
  // Stops at the first failure; already-saved ones stay saved.
  async function handleApproveAll() {
    setBatchSaving(true);
    try {
      for (let i = 0; i < proposals.length; i++) {
        if (savedIds.has(i)) continue;
        const ok = await saveProposal(i);
        if (!ok) break;
      }
    } finally {
      setBatchSaving(false);
    }
  }

  const allApproved = proposals.length > 0 && savedIds.size === proposals.length;
  const canExtract = Boolean(selectedTeamId && selectedChampionId && text.trim());

  return (
    <>
      <div className="top-bar">
        <div>
          <span className="top-bar-title">Smart domain extract</span>
          <span className="top-bar-sub">Extract and approve domain proposals from text</span>
        </div>
        <div className="top-bar-actions">
          <Link to="/manage" className="btn btn-secondary btn-sm">
            &#8592; Manage
          </Link>
        </div>
      </div>

      <div className="page-body">
        <div className="breadcrumb" style={{ marginBottom: 16 }}>
          <Link to="/">Teams</Link>
          <span className="breadcrumb-sep">/</span>
          <Link to="/manage">Manage</Link>
          <span className="breadcrumb-sep">/</span>
          <span>Smart domain extract</span>
        </div>

        <div style={{ maxWidth: 760 }}>
          {/* Step 1 — Team + Champion */}
          <div className="form-section" style={{ marginBottom: 16 }}>
            <div className="form-section-title">Step 1 — Select team and champion</div>

            {loadingTeams ? (
              <div className="text-muted text-sm">Loading teams…</div>
            ) : (
              <>
                <div className="form-row">
                  <label className="form-label form-label-required">Team</label>
                  <select
                    className="form-select"
                    value={selectedTeamId}
                    onChange={(e) => setSelectedTeamId(e.target.value)}
                  >
                    <option value="">Select team…</option>
                    {teams.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </div>

                {selectedTeamId && (
                  <div className="form-row">
                    <label className="form-label form-label-required">Champion</label>
                    <select
                      className="form-select"
                      value={selectedChampionId}
                      onChange={(e) => setSelectedChampionId(e.target.value)}
                    >
                      <option value="">Select champion…</option>
                      {champions.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Step 2 — Paste text and extract */}
          <div className="form-section" style={{ marginBottom: 16 }}>
            <div className="form-section-title">Step 2 — Paste domain text and extract</div>
            <div className="form-section-subtitle">
              Paste a description, meeting notes, or any text that describes the domains for this
              team. The AI will propose domain names, descriptions, and priorities.
            </div>

            <div className="form-row">
              <label className="form-label">Domain text</label>
              <textarea
                className="notes-area"
                style={{ minHeight: 180 }}
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Paste text describing the domains — e.g. 'Frontend platform owns the design system and component library (high priority), cloud infrastructure covers CI/CD and deployments (medium priority)…'"
              />
            </div>

            {extractError && (
              <div className="blocker-banner" style={{ marginBottom: 12 }}>
                <div className="blocker-banner-label">Extraction failed</div>
                {extractError}
              </div>
            )}

            <div className="form-actions">
              <button
                className="draft-btn"
                onClick={() => void handleExtract()}
                disabled={extracting || !canExtract}
              >
                {extracting ? 'Extracting…' : 'Extract domains'}
              </button>
              {!selectedTeamId && (
                <span className="text-muted text-sm">Select a team first</span>
              )}
              {selectedTeamId && !selectedChampionId && (
                <span className="text-muted text-sm">Select a champion first</span>
              )}
            </div>
          </div>

          {/* No-results empty state */}
          {hasExtracted && proposals.length === 0 && (
            <div className="form-section">
              <div className="form-section-title">Step 3 — Review and approve proposals</div>
              <div className="text-muted text-sm" style={{ padding: '6px 0' }}>
                No domains found in that text. Edit it and extract again, or add one manually.
              </div>
            </div>
          )}

          {/* Step 3 — Review and approve proposals */}
          {proposals.length > 0 && (
            <div className="form-section">
              <div className="form-section-title">
                Step 3 — Review and approve proposals
              </div>
              <div className="form-section-subtitle">
                Edit each proposal as needed (name, description, priority, cross-domain links),
                then click &ldquo;Approve &amp; save&rdquo; to persist it — or use
                &ldquo;Approve all&rdquo; to save every remaining proposal at once. You can link
                cross-domains to domains already saved in this batch.
              </div>

              {allApproved && (
                <div
                  className="info-banner"
                  style={{ marginBottom: 16 }}
                >
                  All proposals approved and saved.{' '}
                  <Link to="/manage">Back to Manage</Link>
                </div>
              )}

              {!allApproved && (
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={() => void handleApproveAll()}
                    disabled={batchSaving}
                  >
                    {batchSaving ? 'Approving…' : 'Approve all'}
                  </button>
                </div>
              )}

              {proposals.map((p, i) => {
                const fields = fieldValues[i] ?? proposalToFields(p);
                return (
                  <ProposalCard
                    key={i}
                    index={i}
                    fields={fields}
                    onFieldsChange={handleFieldsChange}
                    allDomains={allDomains}
                    onApprove={(idx) => void saveProposal(idx)}
                    saving={savingIds.has(i) || batchSaving}
                    error={errors[i] ?? null}
                    alreadySaved={savedIds.has(i)}
                  />
                );
              })}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
