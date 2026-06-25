import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { api, ApiError } from '@/api';
import type { Artifact, ArtifactDetail, ArtifactType, Domain } from '@/types';
import { ArtifactTypeBadge, ChangeKindBadge, TagList } from '@/components/Badge';

// Route: "/artifacts/:id" — full artifact detail page (link target for matched
// artifact chips in the report editor). Mirrors the approved prototype:
//   - a hero with the artifact name + facts (type, tags, domain, summary),
//   - a contextual Edit button toggling editing of name/type/tags/summary/domain
//     (domain dropdown includes a "Team-wide" = null option), PATCH /api/artifacts/{id},
//   - a history timeline using DATES ONLY (meeting_date + change_kind + change_note).

const ARTIFACT_TYPES: ArtifactType[] = ['agent', 'skill', 'hook', 'context'];

export default function ArtifactDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const artifactId = Number(id);

  const [detail, setDetail] = useState<ArtifactDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [domains, setDomains] = useState<Domain[]>([]);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setEditing(false);
    if (!Number.isFinite(artifactId)) {
      setError('Invalid artifact id.');
      setLoading(false);
      return;
    }
    api.views
      .artifact(artifactId)
      .then(async (d) => {
        if (cancelled) return;
        setDetail(d);
        setLoading(false);
        // Artifact carries team_id directly — load that team's domains for the picker.
        try {
          const teamDomains = await api.domains.listByTeam(d.artifact.team_id);
          if (!cancelled) setDomains(teamDomains);
        } catch {
          // Non-fatal: page still renders; picker just lacks domain options.
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to load artifact');
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [artifactId]);

  function handleSaved(updated: Artifact) {
    setDetail((prev) => {
      if (!prev) return prev;
      const newDomain =
        updated.domain_id === null ? null : domains.find((d) => d.id === updated.domain_id)?.name ?? prev.domain;
      return { ...prev, artifact: updated, domain: newDomain };
    });
    setEditing(false);
  }

  if (loading) {
    return (
      <div className="page-body">
        <div className="text-muted text-sm">Loading artifact…</div>
      </div>
    );
  }

  if (error || !detail) {
    return (
      <>
        <div className="top-bar">
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => navigate(-1)}>
            ← Back
          </button>
        </div>
        <div className="page-body">
          <div className="warning-banner">{error ?? 'Artifact not found.'}</div>
        </div>
      </>
    );
  }

  const { artifact, domain, history } = detail;

  return (
    <>
      <div className="top-bar">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => navigate(-1)}>
            ← Back
          </button>
          <span className="top-bar-sub">Artifact #{artifact.id}</span>
        </div>
        <div className="top-bar-actions">
          <Link to="/artifacts" className="btn btn-outline btn-sm">
            All artifacts
          </Link>
        </div>
      </div>

      <div className="page-body" style={{ maxWidth: 860 }}>
        {/* ── Hero ─────────────────────────────────────────────────────── */}
        <div className="panel" style={{ marginBottom: 18 }}>
          <div className="panel-body-padded">
            <div
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                justifyContent: 'space-between',
                gap: 16,
                marginBottom: 16,
              }}
            >
              <div>
                <div className="detail-eyebrow">Artifact</div>
                <h2 className="detail-title">{artifact.name}</h2>
              </div>
              {!editing && (
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={() => setEditing(true)}
                >
                  Edit details
                </button>
              )}
            </div>

            {editing ? (
              <ArtifactEditForm
                artifact={artifact}
                domains={domains}
                onCancel={() => setEditing(false)}
                onSaved={handleSaved}
              />
            ) : (
              <>
                <div
                  className="case-header-meta"
                  style={{ borderTop: '1px solid #f1f2f4', paddingTop: 16 }}
                >
                  <div className="case-meta-item">
                    <div className="case-meta-label">Type</div>
                    <div className="case-meta-value">
                      <ArtifactTypeBadge type={artifact.type} />
                    </div>
                  </div>
                  <div className="case-meta-item">
                    <div className="case-meta-label">Domain</div>
                    <div className="case-meta-value">
                      {domain || <span className="text-muted">Team-wide</span>}
                    </div>
                  </div>
                  <div className="case-meta-item">
                    <div className="case-meta-label">Tags</div>
                    <div className="case-meta-value">
                      {artifact.tags.length > 0 ? (
                        <TagList tags={artifact.tags} />
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="form-row" style={{ marginTop: 14 }}>
                  <div className="case-meta-label">Summary</div>
                  <div className="narrative-text" style={{ marginTop: 4 }}>
                    {artifact.summary || <span className="text-muted">No summary.</span>}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>

        {/* ── History timeline (dates only) ────────────────────────────── */}
        <div className="panel">
          <div className="panel-header">
            <span className="panel-title">History</span>
          </div>
          <div className="panel-body-padded">
            {history.length === 0 ? (
              <div className="text-muted text-sm">No recorded changes.</div>
            ) : (
              <div className="detail-timeline">
                {history.map((h) => (
                  <div className="detail-tl-row" key={h.id}>
                    <span className="detail-tl-dot" />
                    <div className="detail-tl-content">
                      <div className="detail-tl-head">
                        <span className="detail-tl-date">{h.meeting_date}</span>
                        <ChangeKindBadge kind={h.change_kind} />
                        <Link
                          to={`/reports/${h.report_id}/edit`}
                          className="btn btn-sm btn-outline"
                          style={{ fontSize: 11, padding: '1px 7px' }}
                          title="Edit the report that recorded this change"
                        >
                          Edit report
                        </Link>
                      </div>
                      {h.change_note && <div className="detail-tl-text">{h.change_note}</div>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

// ── Edit form — name, type, tags, summary, domain (incl. Team-wide = null) ───

interface ArtifactEditFormProps {
  artifact: Artifact;
  domains: Domain[];
  onCancel: () => void;
  onSaved: (updated: Artifact) => void;
}

const TEAM_WIDE = '__team_wide__';

function ArtifactEditForm({ artifact, domains, onCancel, onSaved }: ArtifactEditFormProps) {
  const [name, setName] = useState(artifact.name);
  const [type, setType] = useState<ArtifactType>(artifact.type);
  const [tagsText, setTagsText] = useState(artifact.tags.join(', '));
  const [summary, setSummary] = useState(artifact.summary ?? '');
  const [domainSel, setDomainSel] = useState<string>(
    artifact.domain_id === null ? TEAM_WIDE : String(artifact.domain_id),
  );
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setErr(null);

    const nextTags = tagsText
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
    const nextDomainId = domainSel === TEAM_WIDE ? null : Number(domainSel);

    // Only send changed, allowed fields.
    const body: {
      name?: string;
      type?: ArtifactType;
      tags?: string[];
      summary?: string | null;
      domain_id?: number | null;
    } = {};
    const nm = name.trim();
    if (nm !== artifact.name) body.name = nm;
    if (type !== artifact.type) body.type = type;
    if (JSON.stringify(nextTags) !== JSON.stringify(artifact.tags)) body.tags = nextTags;
    const sm = summary.trim();
    if (sm !== (artifact.summary ?? '')) body.summary = sm === '' ? null : sm;
    if (nextDomainId !== artifact.domain_id) body.domain_id = nextDomainId;

    if (Object.keys(body).length === 0) {
      onCancel();
      return;
    }

    try {
      const updated = await api.views.patchArtifact(artifact.id, body);
      onSaved(updated);
    } catch (e) {
      if (e instanceof ApiError) {
        setErr(e.status === 404 ? 'Artifact not found (404).' : e.message);
      } else {
        setErr(e instanceof Error ? e.message : 'Failed to save.');
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ borderTop: '1px solid #f1f2f4', paddingTop: 16 }}>
      {err && (
        <div className="warning-banner" style={{ marginBottom: 12 }}>
          {err}
        </div>
      )}
      <div className="form-row">
        <label className="form-label">Name</label>
        <input
          className="form-input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Artifact name"
        />
      </div>
      <div className="form-row">
        <label className="form-label">Type</label>
        <select
          className="form-select"
          value={type}
          onChange={(e) => setType(e.target.value as ArtifactType)}
        >
          {ARTIFACT_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </div>
      <div className="form-row">
        <label className="form-label">Domain</label>
        <select
          className="form-select"
          value={domainSel}
          onChange={(e) => setDomainSel(e.target.value)}
        >
          <option value={TEAM_WIDE}>Team-wide (no domain)</option>
          {domains.map((d) => (
            <option key={d.id} value={String(d.id)}>
              {d.name}
            </option>
          ))}
        </select>
      </div>
      <div className="form-row">
        <label className="form-label">Tags</label>
        <input
          className="form-input"
          value={tagsText}
          onChange={(e) => setTagsText(e.target.value)}
          placeholder="Comma-separated tags"
        />
      </div>
      <div className="form-row">
        <label className="form-label">Summary</label>
        <textarea
          className="form-textarea"
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          placeholder="Optional summary"
          rows={3}
        />
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" className="btn btn-primary btn-sm" disabled={saving} onClick={save}>
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button type="button" className="btn btn-secondary btn-sm" disabled={saving} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
