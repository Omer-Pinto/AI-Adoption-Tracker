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

interface ProposalCardProps {
  proposal: DomainProposal;
  index: number;
  allDomains: Domain[];
  teamId: number;
  championId: number;
  onApproved: (saved: Domain) => void;
  onDirtyChange: (index: number, dirty: boolean) => void;
  alreadySaved: boolean;
}

function ProposalCard({
  proposal,
  index,
  allDomains,
  teamId,
  championId,
  onApproved,
  onDirtyChange,
  alreadySaved,
}: ProposalCardProps) {
  const initial: DomainFormFieldValues = {
    name: proposal.name,
    description: proposal.description ?? '',
    priority: proposal.priority ?? '',
    crossDomainIds: [],
  };
  const [fields, setFields] = useState<DomainFormFieldValues>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleFieldsChange(next: DomainFormFieldValues) {
    setFields(next);
    const dirty =
      next.name !== initial.name ||
      next.description !== initial.description ||
      next.priority !== initial.priority ||
      next.crossDomainIds.length !== initial.crossDomainIds.length;
    onDirtyChange(index, dirty);
  }

  async function handleApprove() {
    if (!fields.name.trim()) {
      setError('Name is required.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const saved = await api.domains.create({
        team_id: teamId,
        champion_id: championId,
        name: fields.name,
        description: fields.description || null,
        priority: fields.priority || null,
        cross_domain_ids: fields.crossDomainIds,
      });
      onDirtyChange(index, false);
      onApproved(saved);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed.');
    } finally {
      setSaving(false);
    }
  }

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
        onChange={handleFieldsChange}
        allDomains={allDomains}
        autoFocusName={false}
      />

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
        <button
          className="btn btn-primary btn-sm"
          onClick={() => void handleApprove()}
          disabled={saving}
        >
          {saving ? 'Saving…' : 'Approve & save'}
        </button>
      </div>
    </div>
  );
}

// ---- Main page ---------------------------------------------------------------

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
  const [savedIds, setSavedIds] = useState<Set<number>>(new Set());
  const [dirtyIds, setDirtyIds] = useState<Set<number>>(new Set());
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
    setSavedIds(new Set());
    setDirtyIds(new Set());
    setHasExtracted(false);
    try {
      const result = await api.domains.extract(text);
      setProposals(result.domains);
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
                then click &ldquo;Approve &amp; save&rdquo; to persist it. You can link
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

              {proposals.map((p, i) => (
                <ProposalCard
                  key={i}
                  proposal={p}
                  index={i}
                  allDomains={allDomains}
                  teamId={Number(selectedTeamId)}
                  championId={Number(selectedChampionId)}
                  onApproved={(saved) => handleProposalApproved(i, saved)}
                  onDirtyChange={handleDirtyChange}
                  alreadySaved={savedIds.has(i)}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
