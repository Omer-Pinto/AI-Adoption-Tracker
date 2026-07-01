import { Link } from 'react-router-dom';
import { Modal } from '@/components/Modal';
import { ArtifactTypeBadge, ChangeKindBadge, TagList } from '@/components/Badge';
import { useAuth } from '@/auth/AuthContext';
import type { ArtifactDetail } from '@/types';

// Working detail modal (spec §7): summary + full data + change history.
// Used by team / domain / artifacts pages (Wave-2 agents 2B & 2D). Clicking an
// artifact opens this — it is NOT a navigation away (spec §7 domain/team pages).
//
// Binds to the `GET /api/artifacts/{id}` wrapper: { artifact, history }.

export interface ArtifactDetailModalProps {
  open: boolean;
  onClose: () => void;
  detail: ArtifactDetail | null;
}

export function ArtifactDetailModal({ open, onClose, detail }: ArtifactDetailModalProps) {
  const { isAdmin } = useAuth();
  const artifact = detail?.artifact ?? null;
  const domain = detail?.domain ?? '';
  const history = detail?.history ?? [];
  return (
    <Modal open={open && artifact !== null} title={artifact?.name ?? ''} onClose={onClose} wide>
      {artifact && (
        <>
          {/* Summary + full data */}
          <div className="case-header-meta" style={{ marginBottom: 16 }}>
            <div className="case-meta-item">
              <div className="case-meta-label">Type</div>
              <div className="case-meta-value">
                <ArtifactTypeBadge type={artifact.type} />
              </div>
            </div>
            <div className="case-meta-item">
              <div className="case-meta-label">Domain</div>
              <div className="case-meta-value">{domain}</div>
            </div>
          </div>

          <div className="form-row">
            <div className="case-meta-label">Summary</div>
            <div className="narrative-text" style={{ marginTop: 4 }}>
              {artifact.summary || <span className="text-muted">No summary.</span>}
            </div>
          </div>

          {artifact.tags.length > 0 && (
            <div className="form-row">
              <div className="case-meta-label" style={{ marginBottom: 6 }}>
                Current tags
              </div>
              <TagList tags={artifact.tags} />
            </div>
          )}

          {/* Change history (spec §5 artifact_history) */}
          <div className="history-inner" style={{ paddingLeft: 0 }}>
            <div className="history-title">Change history</div>
            {history.length === 0 ? (
              <div className="text-muted text-sm">No recorded changes.</div>
            ) : (
              history.map((h) => (
                <div className="history-entry" key={h.id}>
                  <span className="history-date">{h.meeting_date}</span>
                  <ChangeKindBadge kind={h.change_kind} />
                  <span className="history-note">{h.change_note || '—'}</span>
                  {/* report_id is present on ArtifactHistoryEntry — link to the owning report */}
                  {isAdmin && (
                    <Link
                      to={`/reports/${h.report_id}/edit`}
                      className="btn btn-sm btn-outline"
                      style={{ fontSize: 11, padding: '1px 7px', marginLeft: 6 }}
                      title="Edit the report that recorded this change"
                    >
                      Edit report
                    </Link>
                  )}
                </div>
              ))
            )}
          </div>
        </>
      )}
    </Modal>
  );
}
