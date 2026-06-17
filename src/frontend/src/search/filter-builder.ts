/**
 * filter-builder.ts — chip/token DSL filter builder utilities
 *
 * Adapted from filter-builder.js for the AI Adoption Tracker.
 * Retains chip parsing/composition logic; removes all soccer-specific
 * keys and replaces them with the tracker's search keys:
 *   team, domain, type, tag, status, date
 *
 * The DSL string format consumed by the backend (routes/search.py):
 *   enum  → key:value1,value2   (OR semantics within key, AND between keys)
 *   date  → date:>=YYYY-MM-DD date:<=YYYY-MM-DD
 *
 * Public API exported:
 *   chipsToDsl(chips)         → DSL string
 *   parseDslToChips(dsl)      → Chip[]
 *   chipValueLabel(chip)      → display label string
 *   KEY_META                  → per-key metadata map
 *   ENABLED_KEYS              → ordered list of active keys
 */

import type { SearchKey, SearchValueKind } from '@/types';

// ── Per-key metadata ────────────────────────────────────────────────────────

export interface KeyMeta {
  kind: SearchValueKind;
  label: string;
  color: string;
  hint: string;
}

export const KEY_META: Record<SearchKey, KeyMeta> = {
  team:   { kind: 'enum', label: 'Team',   color: '#4361ee', hint: 'Filter by team name'              },
  domain: { kind: 'enum', label: 'Domain', color: '#7c3aed', hint: 'Filter by domain name'            },
  type:   { kind: 'enum', label: 'Type',   color: '#065f46', hint: 'artifact type: agent/skill/hook/context' },
  tag:    { kind: 'enum', label: 'Tag',    color: '#92400e', hint: 'Filter by artifact tag'           },
  status: { kind: 'enum', label: 'Status', color: '#1e40af', hint: 'Task status'                      },
  date:   { kind: 'date', label: 'Date',   color: '#b45309', hint: 'Filter by date (YYYY-MM-DD)'      },
};

export const ENABLED_KEYS: SearchKey[] = ['team', 'domain', 'type', 'tag', 'status', 'date'];

// ── Chip types ───────────────────────────────────────────────────────────────

export interface EnumChip {
  id: string;
  key: SearchKey;
  kind: 'enum';
  value: string[];
}

export interface DateChip {
  id: string;
  key: 'date';
  kind: 'date';
  value: { from: string; to: string };
}

export type Chip = EnumChip | DateChip;

// ── DSL serialiser ───────────────────────────────────────────────────────────

function chipToDsl(chip: Chip): string {
  if (chip.kind === 'enum') {
    if (!chip.value || chip.value.length === 0) return '';
    const encoded = chip.value.map((v) => {
      if (/\s/.test(v)) return `"${v}"`;
      return v.replace(/\s+/g, '-');
    });
    return `${chip.key}:${encoded.join(',')}`;
  }

  if (chip.kind === 'date') {
    const { from, to } = chip.value;
    const parts: string[] = [];
    if (from) parts.push(`date:>=${from}`);
    if (to)   parts.push(`date:<=${to}`);
    return parts.join(' ');
  }

  return '';
}

export function chipsToDsl(chips: Chip[]): string {
  return chips
    .map(chipToDsl)
    .filter(Boolean)
    .join(' ');
}

// ── DSL parser ───────────────────────────────────────────────────────────────

let _idCounter = 0;
function nextId(): string {
  return `fb-chip-${++_idCounter}`;
}

export function parseDslToChips(dsl: string): Chip[] {
  if (!dsl || !dsl.trim()) return [];

  const chips: Chip[] = [];
  const remaining = dsl.trim();
  const re = /([a-zA-Z]+):((?:"[^"]*"|[^\s]+))/g;
  let m: RegExpExecArray | null;

  const dateParts: { from?: string; to?: string } = {};

  while ((m = re.exec(remaining)) !== null) {
    const rawKey = m[1];
    const rawVal = m[2];
    if (!rawKey || !rawVal) continue;

    const key = rawKey.toLowerCase() as SearchKey;

    if (!(ENABLED_KEYS as string[]).includes(key)) continue;

    const meta = KEY_META[key];
    if (!meta) continue;

    if (key === 'date') {
      if (rawVal.startsWith('>=')) {
        dateParts.from = rawVal.slice(2);
      } else if (rawVal.startsWith('<=')) {
        dateParts.to = rawVal.slice(2);
      } else {
        const d = rawVal.replace(/^"(.*)"$/, '$1');
        dateParts.from = d;
        dateParts.to = d;
      }
      continue;
    }

    if (meta.kind === 'enum') {
      const stripped = rawVal.replace(/^"(.*)"$/, '$1');
      const parts = stripped
        .split(',')
        .map((t) => t.trim().replace(/^"(.*)"$/, '$1').replace(/-/g, ' '))
        .filter(Boolean);
      if (parts.length === 0) continue;

      const existing = chips.find((c): c is EnumChip => c.key === key && c.kind === 'enum');
      if (existing) {
        parts.forEach((p) => {
          if (!existing.value.includes(p)) existing.value.push(p);
        });
      } else {
        chips.push({ id: nextId(), key, kind: 'enum', value: parts });
      }
    }
  }

  if (dateParts.from !== undefined || dateParts.to !== undefined) {
    chips.push({
      id: nextId(),
      key: 'date',
      kind: 'date',
      value: { from: dateParts.from ?? '', to: dateParts.to ?? '' },
    });
  }

  return chips;
}

// ── Display label for a chip ─────────────────────────────────────────────────

export function chipValueLabel(chip: Chip): string {
  if (chip.kind === 'enum') {
    if (!chip.value || chip.value.length === 0) return '…';
    return chip.value.join(' OR ');
  }
  if (chip.kind === 'date') {
    const { from, to } = chip.value;
    if (!from && !to) return '…';
    if (from && to) {
      if (from === to) return from;
      return `${from} → ${to}`;
    }
    if (from) return `>= ${from}`;
    return `<= ${to}`;
  }
  return '…';
}
