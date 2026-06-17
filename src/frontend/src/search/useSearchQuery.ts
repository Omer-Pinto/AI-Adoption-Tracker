/**
 * useSearchQuery — syncs the `?q=` URL param with local state.
 *
 * Returns [query, setQuery].
 * - On mount, reads the current `?q=` value.
 * - On setQuery, pushes a new history entry with the updated `?q=`.
 * - The page component passes `query` to <SearchBar query={query} onChange={setQuery} />
 *   and also to the api call, so the URL is the single source of truth.
 */

import { useState, useCallback, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';

export function useSearchQuery(): [string, (q: string) => void] {
  const [searchParams, setSearchParams] = useSearchParams();

  const [query, setQueryState] = useState<string>(() => searchParams.get('q') ?? '');

  // Keep local state in sync when the URL changes externally (e.g. back/forward)
  useEffect(() => {
    const fromUrl = searchParams.get('q') ?? '';
    setQueryState(fromUrl);
  }, [searchParams]);

  const setQuery = useCallback(
    (q: string) => {
      setQueryState(q);
      const next = new URLSearchParams(searchParams);
      if (q) {
        next.set('q', q);
      } else {
        next.delete('q');
      }
      setSearchParams(next, { replace: false });
    },
    [searchParams, setSearchParams],
  );

  return [query, setQuery];
}
