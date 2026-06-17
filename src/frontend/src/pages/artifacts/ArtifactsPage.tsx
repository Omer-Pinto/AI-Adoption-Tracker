import { useState, useEffect, useCallback } from 'react';
import { api } from '@/api';
import type { Artifact, ArtifactDetail } from '@/types';
import { DataTable, type Column } from '@/components/DataTable';
import { ArtifactDetailModal } from '@/components/ArtifactDetailModal';
import { ArtifactTypeBadge, TagList } from '@/components/Badge';
import { SearchBar } from '@/search/SearchBar';
import { useSearchQuery } from '@/search/useSearchQuery';

// Route: "/artifacts" — artifacts registry (search bar + detail modal).

export default function ArtifactsPage() {
  const [query, setQuery] = useSearchQuery();
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Detail modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [detail, setDetail] = useState<ArtifactDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // Fetch artifacts list when query changes
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api.views
      .artifacts(query || undefined)
      .then((data) => {
        if (!cancelled) {
          setArtifacts(data);
          setLoading(false);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load artifacts');
          setLoading(false);
        }
      });
    return () => { cancelled = true; };
  }, [query]);

  const openDetail = useCallback((artifact: Artifact) => {
    setModalOpen(true);
    setDetail(null);
    setDetailLoading(true);
    api.views
      .artifact(artifact.id)
      .then((d) => {
        setDetail(d);
        setDetailLoading(false);
      })
      .catch(() => setDetailLoading(false));
  }, []);

  const columns: Column<Artifact>[] = [
    {
      key: 'name',
      header: 'Name',
      render: (row) => <span style={{ fontWeight: 600, color: '#1a1d23' }}>{row.name}</span>,
    },
    {
      key: 'type',
      header: 'Type',
      width: '100px',
      render: (row) => <ArtifactTypeBadge type={row.type} />,
    },
    {
      key: 'tags',
      header: 'Tags',
      render: (row) =>
        row.tags.length > 0 ? (
          <TagList tags={row.tags} />
        ) : (
          <span className="text-muted text-xs">—</span>
        ),
    },
    {
      key: 'summary',
      header: 'Summary',
      render: (row) =>
        row.summary ? (
          <span className="text-sm" style={{ color: '#374151' }}>{row.summary}</span>
        ) : (
          <span className="text-muted text-xs">—</span>
        ),
    },
  ];

  return (
    <>
      <div className="top-bar">
        <div>
          <span className="top-bar-title">Artifacts</span>
          <span className="top-bar-sub">All artifacts across all domains &bull; click a row for change history</span>
        </div>
      </div>

      <div className="page-body">
        <SearchBar query={query} onChange={setQuery} />

        {error && (
          <div className="warning-banner" style={{ marginBottom: 16 }}>{error}</div>
        )}

        {loading ? (
          <div className="text-muted text-sm">Loading artifacts…</div>
        ) : (
          <div className="panel">
            <DataTable
              columns={columns}
              rows={artifacts}
              rowKey={(r) => r.id}
              onRowClick={openDetail}
              empty="No artifacts found. Try clearing the search filter."
            />
          </div>
        )}
      </div>

      <ArtifactDetailModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        detail={detailLoading ? null : detail}
      />
    </>
  );
}
