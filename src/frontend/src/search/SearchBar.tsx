/**
 * SearchBar — chip/pill filter bar for the AI Adoption Tracker.
 *
 * Keys: team, domain, type, tag, status, date
 * - Enum keys autocomplete via api.search.values(key).
 * - Date key renders a from/to date picker.
 * - Composes a DSL query string and round-trips it to/from URL `?q=`.
 *
 * Props:
 *   query    — controlled DSL string (read from URL `?q=` by the parent page)
 *   onChange — called with the new DSL string whenever chips change
 */

import { useState, useRef, useEffect, useCallback, type RefObject, type KeyboardEvent, type ReactNode } from 'react';
import { api } from '@/api';
import type { SearchKey, SearchValuesResult } from '@/types';
import {
  KEY_META,
  ENABLED_KEYS,
  chipsToDsl,
  parseDslToChips,
  chipValueLabel,
  type Chip,
  type EnumChip,
  type DateChip,
} from '@/search/filter-builder';

// ── Autocomplete cache ────────────────────────────────────────────────────────

const _valuesCache = new Map<SearchKey, SearchValuesResult>();

async function fetchValues(key: SearchKey): Promise<SearchValuesResult | null> {
  if (_valuesCache.has(key)) return _valuesCache.get(key)!;
  try {
    const data = await api.search.values(key);
    _valuesCache.set(key, data);
    return data;
  } catch {
    return null;
  }
}

// ── Chip counter ──────────────────────────────────────────────────────────────
let _chipIdCounter = 0;
function nextChipId(): string {
  return `chip-${++_chipIdCounter}`;
}

// ── Types for dropdown state ──────────────────────────────────────────────────

type DropdownPhase =
  | { phase: 'closed' }
  | { phase: 'category' }
  | { phase: 'enum-editor'; chipId: string; values: string[]; selected: Set<string>; loading: boolean }
  | { phase: 'date-editor'; chipId: string; initDate: string };

// ── SearchBar ─────────────────────────────────────────────────────────────────

interface SearchBarProps {
  query: string;
  onChange: (dsl: string) => void;
}

export function SearchBar({ query, onChange }: SearchBarProps) {
  const [chips, setChips] = useState<Chip[]>(() => parseDslToChips(query));
  const [dropdown, setDropdown] = useState<DropdownPhase>({ phase: 'closed' });
  const [catSearch, setCatSearch] = useState('');
  const [enumSearch, setEnumSearch] = useState('');

  const containerRef = useRef<HTMLDivElement>(null);
  const addBtnRef = useRef<HTMLButtonElement>(null);
  const catSearchRef = useRef<HTMLInputElement>(null) as RefObject<HTMLInputElement>;
  const enumSearchRef = useRef<HTMLInputElement>(null) as RefObject<HTMLInputElement>;
  const dateInputRef = useRef<HTMLInputElement>(null) as RefObject<HTMLInputElement>;

  // Sync chips → DSL → onChange (debounced)
  const emitRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const emitDsl = useCallback(
    (newChips: Chip[]) => {
      if (emitRef.current) clearTimeout(emitRef.current);
      emitRef.current = setTimeout(() => {
        onChange(chipsToDsl(newChips));
      }, 0);
    },
    [onChange],
  );

  // Re-parse chips when the query prop changes from outside (URL nav)
  // Only resync when the prop actually diverges from our current chips
  const prevQueryRef = useRef(query);
  useEffect(() => {
    if (query === prevQueryRef.current) return;
    prevQueryRef.current = query;
    setChips(parseDslToChips(query));
  }, [query]);

  // Close dropdown on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setDropdown({ phase: 'closed' });
      }
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Close dropdown on Escape
  useEffect(() => {
    function handler(e: globalThis.KeyboardEvent) {
      if (e.key === 'Escape') setDropdown({ phase: 'closed' });
    }
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  // Focus search input when dropdown opens
  useEffect(() => {
    if (dropdown.phase === 'category') {
      setCatSearch('');
      requestAnimationFrame(() => catSearchRef.current?.focus());
    } else if (dropdown.phase === 'enum-editor') {
      setEnumSearch('');
      requestAnimationFrame(() => enumSearchRef.current?.focus());
    } else if (dropdown.phase === 'date-editor') {
      requestAnimationFrame(() => dateInputRef.current?.focus());
    }
  }, [dropdown.phase]);

  // ── Chip manipulation ──────────────────────────────────────────────────────

  function removeChip(id: string) {
    setChips((prev) => {
      const next = prev.filter((c) => c.id !== id);
      emitDsl(next);
      return next;
    });
    setDropdown({ phase: 'closed' });
  }

  function clearAll() {
    setChips([]);
    emitDsl([]);
    setDropdown({ phase: 'closed' });
    addBtnRef.current?.focus();
  }

  // ── Category picker ────────────────────────────────────────────────────────

  function openCategoryPicker() {
    setDropdown({ phase: 'category' });
  }

  async function selectCategory(key: SearchKey) {
    const meta = KEY_META[key];

    if (meta.kind === 'date') {
      const existing = chips.find((c): c is DateChip => c.key === 'date' && c.kind === 'date');
      if (existing) {
        setDropdown({ phase: 'date-editor', chipId: existing.id, initDate: existing.value });
        return;
      }
      const chip: DateChip = { id: nextChipId(), key: 'date', kind: 'date', value: '' };
      setChips((prev) => [...prev, chip]);
      setDropdown({ phase: 'date-editor', chipId: chip.id, initDate: '' });
      return;
    }

    // enum key
    const chipId = nextChipId();
    const newChip: EnumChip = { id: chipId, key, kind: 'enum', value: [] };

    // Check if we already have an enum chip for this key (merge mode)
    const existing = chips.find((c): c is EnumChip => c.key === key && c.kind === 'enum');
    const targetId = existing ? existing.id : chipId;

    if (!existing) {
      setChips((prev) => [...prev, newChip]);
    }

    // Load values then open editor
    setDropdown({ phase: 'enum-editor', chipId: targetId, values: [], selected: new Set(existing?.value ?? []), loading: true });

    const data = await fetchValues(key);
    const values: string[] = data?.kind === 'enum' ? data.values.map((v) => v.value) : [];

    setDropdown({ phase: 'enum-editor', chipId: targetId, values, selected: new Set(existing?.value ?? []), loading: false });
  }

  function openEnumEditor(chip: EnumChip) {
    setDropdown({ phase: 'enum-editor', chipId: chip.id, values: [], selected: new Set(chip.value), loading: true });
    fetchValues(chip.key as SearchKey).then((data) => {
      const values: string[] = data?.kind === 'enum' ? data.values.map((v) => v.value) : [];
      setDropdown((prev) =>
        prev.phase === 'enum-editor' && prev.chipId === chip.id
          ? { ...prev, values, loading: false }
          : prev,
      );
    });
  }

  function openDateEditor(chip: DateChip) {
    setDropdown({ phase: 'date-editor', chipId: chip.id, initDate: chip.value });
  }

  // ── Apply enum selection ───────────────────────────────────────────────────

  function applyEnumSelection(chipId: string, selected: Set<string>) {
    setChips((prev) => {
      const next = prev.map((c) => {
        if (c.id !== chipId) return c;
        return { ...c, kind: 'enum' as const, value: Array.from(selected) } as EnumChip;
      });
      // Remove chip if empty selection
      const filtered = next.filter((c) => {
        if (c.kind === 'enum' && c.value.length === 0) return false;
        return true;
      });
      emitDsl(filtered);
      return filtered;
    });
    setDropdown({ phase: 'closed' });
    addBtnRef.current?.focus();
  }

  // ── Apply date selection ───────────────────────────────────────────────────

  function applyDateSelection(chipId: string, date: string) {
    if (!date) {
      removeChip(chipId);
      return;
    }
    setChips((prev) => {
      const next = prev.map((c) => {
        if (c.id !== chipId) return c;
        return { ...c, kind: 'date' as const, value: date } as DateChip;
      });
      emitDsl(next);
      return next;
    });
    setDropdown({ phase: 'closed' });
    addBtnRef.current?.focus();
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  const hasChips = chips.length > 0;

  return (
    <div className="sb-wrapper" ref={containerRef}>
      <div className={`sb-bar${hasChips ? ' has-chips' : ''}`} role="group" aria-label="Filter chips">
        {!hasChips && (
          <span className="sb-empty-hint">Filter by team, domain, type, tag, status, date…</span>
        )}

        {/* Chips */}
        {chips.map((chip, idx) => (
          <ChipPill
            key={chip.id}
            chip={chip}
            isFirst={idx === 0}
            onRemove={() => removeChip(chip.id)}
            onEditEnum={(c) => openEnumEditor(c)}
            onEditDate={(c) => openDateEditor(c)}
          />
        ))}

        {/* Add filter button */}
        <button
          ref={addBtnRef}
          type="button"
          className="sb-add-btn"
          aria-label="Add filter"
          onClick={openCategoryPicker}
          onKeyDown={(e: KeyboardEvent<HTMLButtonElement>) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              openCategoryPicker();
            }
            if (e.key === 'Backspace' && chips.length > 0) {
              e.preventDefault();
              removeChip(chips[chips.length - 1]!.id);
            }
          }}
        >
          <span className="sb-add-icon">+</span>Add filter
        </button>

        {/* Clear all */}
        {hasChips && (
          <button type="button" className="sb-clear-all" onClick={clearAll} aria-label="Clear all filters">
            Clear all
          </button>
        )}
      </div>

      {/* Dropdown */}
      {dropdown.phase === 'category' && (
        <CategoryDropdown
          searchRef={catSearchRef}
          searchValue={catSearch}
          onSearchChange={setCatSearch}
          chips={chips}
          onSelect={selectCategory}
          onClose={() => setDropdown({ phase: 'closed' })}
          addBtnRef={addBtnRef}
        />
      )}

      {dropdown.phase === 'enum-editor' && (
        <EnumDropdown
          searchRef={enumSearchRef}
          searchValue={enumSearch}
          onSearchChange={setEnumSearch}
          values={dropdown.values}
          selected={dropdown.selected}
          loading={dropdown.loading}
          onApply={(sel) => applyEnumSelection(dropdown.chipId, sel)}
          onClose={() => {
            // If chip was just created with empty value, remove it
            const chip = chips.find((c) => c.id === dropdown.chipId);
            if (chip?.kind === 'enum' && chip.value.length === 0) {
              removeChip(dropdown.chipId);
            }
            setDropdown({ phase: 'closed' });
          }}
        />
      )}

      {dropdown.phase === 'date-editor' && (
        <DateDropdown
          dateRef={dateInputRef}
          initDate={dropdown.initDate}
          onApply={(date) => applyDateSelection(dropdown.chipId, date)}
          onClose={() => {
            const c = chips.find((ch) => ch.id === dropdown.chipId);
            if (c?.kind === 'date' && !c.value) {
              removeChip(dropdown.chipId);
            }
            setDropdown({ phase: 'closed' });
          }}
        />
      )}
    </div>
  );
}

// ── ChipPill ─────────────────────────────────────────────────────────────────

interface ChipPillProps {
  chip: Chip;
  isFirst: boolean;
  onRemove: () => void;
  onEditEnum: (chip: EnumChip) => void;
  onEditDate: (chip: DateChip) => void;
}

function ChipPill({ chip, isFirst, onRemove, onEditEnum, onEditDate }: ChipPillProps) {
  const meta = KEY_META[chip.key];

  function handleEdit() {
    if (chip.kind === 'enum') onEditEnum(chip as EnumChip);
    else onEditDate(chip as DateChip);
  }

  return (
    <>
      {!isFirst && (
        <span className="sb-and-sep" aria-hidden="true">AND</span>
      )}
      <span className="sb-chip" role="group" aria-label={`${meta.label} filter`}>
        <span
          className="sb-chip-key"
          style={{ background: meta.color }}
        >
          {meta.label}
        </span>
        <span
          className="sb-chip-val"
          role="button"
          tabIndex={0}
          aria-label={`Edit ${meta.label} filter`}
          onClick={handleEdit}
          onKeyDown={(e: KeyboardEvent) => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleEdit(); }
            if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); onRemove(); }
          }}
        >
          <ChipValueLabel chip={chip} />
        </span>
        <button
          type="button"
          className="sb-chip-del"
          aria-label={`Remove ${meta.label} filter`}
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
        >
          &times;
        </button>
      </span>
    </>
  );
}

function ChipValueLabel({ chip }: { chip: Chip }): ReactNode {
  if (chip.kind === 'enum') {
    if (chip.value.length === 0) return <span className="sb-val-text">…</span>;
    return (
      <>
        {chip.value.map((v, i) => (
          <span key={v}>
            {i > 0 && <span className="sb-val-or">OR</span>}
            <span className="sb-val-text">{v}</span>
          </span>
        ))}
      </>
    );
  }
  return <span className="sb-val-text">{chipValueLabel(chip)}</span>;
}

// ── CategoryDropdown ──────────────────────────────────────────────────────────

interface CategoryDropdownProps {
  searchRef: RefObject<HTMLInputElement>;
  searchValue: string;
  onSearchChange: (v: string) => void;
  chips: Chip[];
  onSelect: (key: SearchKey) => void;
  onClose: () => void;
  addBtnRef: RefObject<HTMLButtonElement>;
}

function CategoryDropdown({
  searchRef,
  searchValue,
  onSearchChange,
  chips,
  onSelect,
  onClose,
  addBtnRef,
}: CategoryDropdownProps) {
  const usedKeys = new Set(chips.map((c) => c.key));
  const [focusIdx, setFocusIdx] = useState(-1);

  const lf = searchValue.toLowerCase();
  const items = ENABLED_KEYS.filter((key) => {
    const meta = KEY_META[key];
    return !lf || meta.label.toLowerCase().includes(lf) || key.includes(lf);
  });

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setFocusIdx((i) => Math.min(i + 1, items.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setFocusIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const key = items[focusIdx];
      if (key) onSelect(key);
    } else if (e.key === 'Escape' || e.key === 'Tab') {
      e.preventDefault();
      onClose();
      addBtnRef.current?.focus();
    }
  }

  return (
    <div className="sb-dropdown" role="listbox" aria-label="Choose filter category">
      <div className="sb-dd-header">Choose category</div>
      <input
        ref={searchRef}
        type="text"
        className="sb-dd-search"
        placeholder="Search…"
        value={searchValue}
        onChange={(e) => { setFocusIdx(-1); onSearchChange(e.target.value); }}
        onKeyDown={handleKeyDown}
        aria-label="Search filter categories"
      />
      <ul className="sb-dd-list">
        {items.length === 0 ? (
          <li className="sb-dd-msg">No matching categories</li>
        ) : (
          items.map((key, idx) => {
            const meta = KEY_META[key];
            return (
              <li
                key={key}
                className={`sb-dd-item${idx === focusIdx ? ' is-focused' : ''}`}
                role="option"
                aria-selected={usedKeys.has(key)}
                onClick={() => onSelect(key)}
              >
                <span className="sb-key-dot" style={{ background: meta.color }} />
                <span className="sb-dd-item-body">
                  <span>{meta.label}</span>
                  <span className="sb-dd-item-hint">{meta.hint}</span>
                </span>
                {usedKeys.has(key) && (
                  <span className="sb-dd-add-more">(add more)</span>
                )}
              </li>
            );
          })
        )}
      </ul>
    </div>
  );
}

// ── EnumDropdown ──────────────────────────────────────────────────────────────

interface EnumDropdownProps {
  searchRef: RefObject<HTMLInputElement>;
  searchValue: string;
  onSearchChange: (v: string) => void;
  values: string[];
  selected: Set<string>;
  loading: boolean;
  onApply: (selected: Set<string>) => void;
  onClose: () => void;
}

function EnumDropdown({
  searchRef,
  searchValue,
  onSearchChange,
  values,
  selected: initialSelected,
  loading,
  onApply,
  onClose,
}: EnumDropdownProps) {
  const [selected, setSelected] = useState(new Set(initialSelected));
  const [focusIdx, setFocusIdx] = useState(-1);

  const lf = searchValue.toLowerCase();
  const filtered = lf ? values.filter((v) => v.toLowerCase().includes(lf)) : values;

  function toggle(v: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(v)) next.delete(v);
      else next.add(v);
      return next;
    });
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setFocusIdx((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setFocusIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (focusIdx >= 0 && filtered[focusIdx]) {
        toggle(filtered[focusIdx]!);
      } else {
        onApply(selected);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    } else if (e.key === 'Tab') {
      e.preventDefault();
      onApply(selected);
    }
  }

  return (
    <div className="sb-dropdown" role="dialog" aria-label="Select values">
      <div className="sb-dd-header">Select (multi-select)</div>
      <input
        ref={searchRef}
        type="text"
        className="sb-dd-search"
        placeholder="Search…"
        value={searchValue}
        onChange={(e) => { setFocusIdx(-1); onSearchChange(e.target.value); }}
        onKeyDown={handleKeyDown}
        aria-label="Search values"
      />
      {loading ? (
        <div className="sb-dd-msg">Loading values…</div>
      ) : (
        <ul className="sb-dd-list" role="listbox" aria-multiselectable="true">
          {filtered.length === 0 ? (
            <li className="sb-dd-msg">{searchValue ? 'No matches' : 'No values available'}</li>
          ) : (
            filtered.map((v, idx) => (
              <li
                key={v}
                className={`sb-dd-item${selected.has(v) ? ' is-selected' : ''}${idx === focusIdx ? ' is-focused' : ''}`}
                role="option"
                aria-selected={selected.has(v)}
                onClick={() => toggle(v)}
              >
                <span className="sb-dd-check">{selected.has(v) ? '✓' : ''}</span>
                {v}
              </li>
            ))
          )}
        </ul>
      )}
      <button type="button" className="sb-dd-apply" onClick={() => onApply(selected)}>
        Apply
      </button>
    </div>
  );
}

// ── DateDropdown ──────────────────────────────────────────────────────────────

interface DateDropdownProps {
  dateRef: RefObject<HTMLInputElement>;
  initDate: string;
  onApply: (date: string) => void;
  onClose: () => void;
}

function DateDropdown({ dateRef, initDate, onApply, onClose }: DateDropdownProps) {
  const [date, setDate] = useState(initDate);

  function apply() {
    onApply(date);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') { e.preventDefault(); apply(); }
    else if (e.key === 'Escape') { e.preventDefault(); onClose(); }
  }

  return (
    <div className="sb-dropdown" role="dialog" aria-label="Select date">
      <div className="sb-dd-header">Active on date</div>
      <div className="sb-date-editor">
        <div className="sb-date-row">
          <label className="sb-date-label" htmlFor="sb-date-input">Date</label>
          <input
            ref={dateRef}
            id="sb-date-input"
            type="date"
            className="sb-date-input"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            onKeyDown={handleKeyDown}
          />
        </div>
      </div>
      <button type="button" className="sb-dd-apply" onClick={apply}>Apply</button>
    </div>
  );
}
