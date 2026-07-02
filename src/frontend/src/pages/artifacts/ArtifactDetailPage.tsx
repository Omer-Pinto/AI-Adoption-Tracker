import { useCallback, useEffect, useState } from 'react';
import { useParams, useNavigate, Link, Navigate } from 'react-router-dom';
import { api, ApiError, ForbiddenError } from '@/api';
import type {
  Artifact,
  ArtifactDetail,
  ArtifactHistoryEntry,
  ArtifactType,
  Domain,
} from '@/types';
import { ArtifactTypeBadge, ChangeKindBadge, TagList, ARTIFACT_TYPE_LABELS } from '@/components/Badge';
import { ErrorState } from '@/components/EmptyState';
import { useAuth } from '@/auth/AuthContext';

// A subtle, calm marker showing whether a history entry came from a report or a
// manual current-state edit. Report entries stay unlabeled (the common case);
// manual edits get a muted "manual" tag so "was this a meeting update or a
// manual fix?" is answerable at a glance — no loud color.
function HistorySourceTag({ source }: { source: ArtifactHistoryEntry['source'] }) {
  if (source !== 'manual') return null;
  return (
    <span className="detail-manual-tag" title="Recorded by a manual edit (not from a report)">
      manual
    </span>
  );
}

// Route: "/artifacts/:id" — full artifact detail page (link target for matched
// artifact chips in the report editor). Mirrors the approved prototype:
//   - a hero with the artifact name + facts (type, tags, domain, summary),
//   - a contextual Edit button toggling editing of name/type/tags/summary/domain
//     (every artifact belongs to a domain), PATCH /api/artifacts/{id},
//   - a history timeline using DATES ONLY (meeting_date + change_kind + change_note).

const ARTIFACT_TYPES: ArtifactType[] = ['agent', 'skill', 'hook', 'context', 'workflow', 'mcp', 'other'];

export default function ArtifactDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { isAdmin } = useAuth();
  const artifactId = Number(id);

  const [detail, setDetail] = useState<ArtifactDetail | null>(null);
  const [loading, setLoading] = useState(true);
  // 'invalid' = bad id (not found), 'error' = genuine load failure, null = ok.
  const [error, setError] = useState<'invalid' | 'error' | null>(null);
  // Set when the backend rejects the load with a 403 — this artifact is not in the
  // user's scope. We render the curated Forbidden surface, not a load error.
  const [forbidden, setForbidden] = useState(false);
  const [domains, setDomains] = useState<Domain[]>([]);
  const [editing, setEditing] = useState(false);

  const load = useCallback(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setForbidden(false);
    setEditing(false);
    if (!Number.isFinite(artifactId)) {
      setError('invalid');
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
      .catch((e) => {
        if (cancelled) return;
        console.error(e);
        // Out-of-scope artifact id → the backend 403s: show the Forbidden surface.
        if (e instanceof ForbiddenError) {
          setForbidden(true);
        } else {
          // A removed/unknown id comes back as a 404 → show the friendly
          // "not found" state, not the generic load-failure one.
          setError(e instanceof ApiError && e.status === 404 ? 'invalid' : 'error');
        }
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [artifactId]);

  useEffect(() => load(), [load]);

  // After a successful PATCH, re-read the authoritative detail from the backend
  // (it resolves the domain NAME server-side) instead of guessing from a local
  // domains list that may have failed to load.
  async function handleSaved() {
    setEditing(false);
    try {
      const fresh = await api.views.artifact(artifactId);
      setDetail(fresh);
    } catch {
      // Non-fatal: the save succeeded; a transient refetch failure just leaves
      // the prior detail on screen.
    }
  }

  if (loading) {
    return (
      <>
        <div className="top-bar">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => navigate(-1)}>
              ← Back
            </button>
          </div>
        </div>
        <div className="page-body" style={{ maxWidth: 860 }}>
          <div className="panel detail-hero">
            <div className="panel-body-padded">
              <div className="skeleton skeleton-text w-40" style={{ marginBottom: 12 }} />
              <div className="skeleton detail-skel-title" />
              <div className="detail-skel-facts">
                {[0, 1, 2].map((i) => (
                  <div className="detail-skel-fact" key={i}>
                    <div className="skeleton skeleton-text" style={{ width: 52 }} />
                    <div className="skeleton skeleton-text" style={{ width: 80 }} />
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div className="panel">
            <div className="panel-header">
              <span className="panel-title">History</span>
            </div>
            <div className="panel-body-padded">
              {[0, 1, 2].map((i) => (
                <div className="skeleton skeleton-row" key={i} />
              ))}
            </div>
          </div>
        </div>
      </>
    );
  }

  // Out-of-scope artifact id — the backend said "not your team". Curated 403 surface.
  if (forbidden) return <Navigate to="/403" replace />;

  if (error || !detail) {
    return (
      <>
        <div className="top-bar">
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => navigate(-1)}>
            ← Back
          </button>
        </div>
        <div className="page-body">
          <div className="panel">
            {error === 'invalid' || (!detail && !error) ? (
              <ErrorState
                title="Artifact not found"
                hint="This artifact may have been removed or the link is no longer valid."
              />
            ) : (
              <ErrorState
                title="Couldn't load this artifact"
                hint="The artifact failed to load. Try again."
                onRetry={load}
              />
            )}
          </div>
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
      </div>

      <div className="page-body anim-enter" style={{ maxWidth: 860 }}>
        {/* ── Hero ─────────────────────────────────────────────────────── */}
        <div className="panel detail-hero">
          <div className="panel-body-padded">
            <div className="detail-hero-top">
              <div className="detail-hero-ident">
                <span className="detail-hero-avatar detail-hero-avatar--icon" aria-hidden="true">
                  <span className="detail-hero-avatar-inner">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                      <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
                      <line x1="12" y1="22.08" x2="12" y2="12" />
                    </svg>
                  </span>
                </span>
                <div>
                  <div className="detail-eyebrow">Artifact</div>
                  <h2 className="detail-title">{artifact.name}</h2>
                </div>
              </div>
              {isAdmin && !editing && (
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
                onSaved={() => void handleSaved()}
              />
            ) : (
              <>
                <div className="detail-facts">
                  <div className="detail-fact">
                    <div className="detail-fact-label">Type</div>
                    <div className="detail-fact-value">
                      <ArtifactTypeBadge type={artifact.type} />
                    </div>
                  </div>
                  <div className="detail-fact">
                    <div className="detail-fact-label">Domain</div>
                    <div className="detail-fact-value">
                      {domain || <span className="text-muted">General</span>}
                    </div>
                  </div>
                  <div className="detail-fact">
                    <div className="detail-fact-label">Tags</div>
                    <div className="detail-fact-value">
                      {artifact.tags.length > 0 ? (
                        <TagList tags={artifact.tags} />
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="detail-summary">
                  <div className="detail-summary-label">Summary</div>
                  <div className="detail-summary-text">
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
                {history.map((h, i) => (
                  <div className="detail-tl-row" key={h.id}>
                    <div className="detail-tl-rail">
                      <span className={`detail-tl-dot dot-${h.change_kind}`} />
                      {i < history.length - 1 && <span className="detail-tl-line" />}
                    </div>
                    <div className="detail-tl-content">
                      <div className="detail-tl-head">
                        <span className="detail-tl-date">{h.meeting_date}</span>
                        <ChangeKindBadge kind={h.change_kind} />
                        <HistorySourceTag source={h.source} />
                        {h.report_id != null && (
                          <Link
                            to={`/reports/${h.report_id}/edit`}
                            className="btn btn-sm btn-outline"
                            style={{ fontSize: 11, padding: '1px 7px' }}
                            title={isAdmin ? 'Edit the report that recorded this change' : 'View the report that recorded this change'}
                          >
                            {isAdmin ? 'Edit report' : 'View report'}
                          </Link>
                        )}
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

// ── Edit form — name, type, tags, summary, domain ───────────────────────────

interface ArtifactEditFormProps {
  artifact: Artifact;
  domains: Domain[];
  onCancel: () => void;
  onSaved: () => void;
}

function ArtifactEditForm({ artifact, domains, onCancel, onSaved }: ArtifactEditFormProps) {
  const [name, setName] = useState(artifact.name);
  const [type, setType] = useState<ArtifactType>(artifact.type);
  const [tagsText, setTagsText] = useState(artifact.tags.join(', '));
  const [summary, setSummary] = useState(artifact.summary ?? '');
  // Every artifact belongs to a domain — the picker is a plain domain select.
  const [domainSel, setDomainSel] = useState<string>(String(artifact.domain_id));
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setErr(null);

    const nextTags = tagsText
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
    const nextDomainId = Number(domainSel);

    // Only send changed, allowed fields.
    const body: {
      name?: string;
      type?: ArtifactType;
      tags?: string[];
      summary?: string | null;
      domain_id?: number;
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
      await api.views.patchArtifact(artifact.id, body);
      onSaved();
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
    <div className="detail-edit">
      {err && (
        <div className="warning-banner" style={{ marginBottom: 'var(--sp-4)' }}>
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
              {ARTIFACT_TYPE_LABELS[t]}
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
      <div className="detail-edit-actions">
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
