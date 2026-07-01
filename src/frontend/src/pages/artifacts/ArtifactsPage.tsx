import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '@/api';
import type { Artifact } from '@/types';
import { DataTable, type Column } from '@/components/DataTable';
import { ArtifactTypeBadge, TagList } from '@/components/Badge';
import { SearchBar } from '@/search/SearchBar';
import { useSearchQuery } from '@/search/useSearchQuery';
import { EmptyState, ErrorState } from '@/components/EmptyState';

// Route: "/artifacts" — artifacts registry (search bar). Clicking a row
// navigates to the editable artifact detail page (/artifacts/:id), mirroring
// how tasks open TaskDetailPage.

export default function ArtifactsPage() {
  const navigate = useNavigate();
  const [query, setQuery] = useSearchQuery();
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  // Fetch artifacts list when query changes
  const load = useCallback(() => {
    let cancelled = false;
    setLoading(true);
    setError(false);
    api.views
      .artifacts(query || undefined)
      .then((data) => {
        if (!cancelled) {
          setArtifacts(data);
          setLoading(false);
        }
      })
      .catch((e) => {
        console.error(e);
        if (!cancelled) {
          setError(true);
          setLoading(false);
        }
      });
    return () => { cancelled = true; };
  }, [query]);

  useEffect(() => load(), [load]);

  const openDetail = useCallback(
    (artifact: Artifact) => navigate(`/artifacts/${artifact.id}`),
    [navigate],
  );

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

        {loading ? (
          <div className="text-muted text-sm">Loading artifacts…</div>
        ) : error ? (
          <div className="panel">
            <ErrorState
              title="Couldn't load artifacts"
              hint="The artifacts list failed to load. Try again."
              onRetry={load}
            />
          </div>
        ) : artifacts.length === 0 ? (
          <div className="panel">
            <EmptyState
              icon="◈"
              title={query ? 'No matching artifacts' : 'No artifacts yet'}
              hint={
                query
                  ? 'Nothing matches that search. Try clearing the filter.'
                  : 'Artifacts appear here as they are captured in reports.'
              }
            />
          </div>
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
    </>
  );
}
