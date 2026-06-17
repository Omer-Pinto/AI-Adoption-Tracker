import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';

// Standalone mention-aware text input.
// Typing `@` opens a task-name dropdown; `#` opens an artifact-name dropdown.
// The caller supplies the full candidate list (fetched once by the parent page).
// When a candidate is picked, the trigger+partial-query in the value is replaced
// with the chosen name, and onValueChange is called with the updated string.
// The user can also dismiss and keep typing a new name — the final value is
// always a plain string.

export interface MentionInputProps {
  value: string;
  onValueChange: (v: string) => void;
  taskNames: string[];
  artifactNames: string[];
  placeholder?: string;
  className?: string;
  multiline?: boolean;
  rows?: number;
}

type TriggerKind = '@' | '#';

interface MentionState {
  kind: TriggerKind;
  // character offset in `value` where the trigger char was typed
  triggerIndex: number;
  query: string;
}

function fuzzy(candidates: string[], query: string): string[] {
  const q = query.toLowerCase();
  if (!q) return candidates.slice(0, 12);
  return candidates
    .filter((c) => c.toLowerCase().includes(q))
    .slice(0, 12);
}

export function MentionInput({
  value,
  onValueChange,
  taskNames,
  artifactNames,
  placeholder,
  className = 'form-input',
  multiline = false,
  rows = 2,
}: MentionInputProps) {
  const [mention, setMention] = useState<MentionState | null>(null);
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement & HTMLTextAreaElement>(null);

  const candidates = mention
    ? fuzzy(
        mention.kind === '@' ? taskNames : artifactNames,
        mention.query,
      )
    : [];

  // When the input value changes externally, close the dropdown.
  useEffect(() => {
    setMention(null);
  }, [value]);

  function handleChange(e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) {
    const next = e.target.value;
    const cursor = e.target.selectionStart ?? next.length;

    // Find the nearest trigger before cursor that hasn't been closed by a space
    let found: MentionState | null = null;
    for (let i = cursor - 1; i >= 0; i--) {
      const ch = next[i];
      if (ch === ' ' || ch === '\n') break;
      if (ch === '@' || ch === '#') {
        found = {
          kind: ch as TriggerKind,
          triggerIndex: i,
          query: next.slice(i + 1, cursor),
        };
        break;
      }
    }
    setMention(found);
    setActiveIdx(0);
    onValueChange(next);
  }

  function pick(name: string) {
    if (!mention) return;
    const before = value.slice(0, mention.triggerIndex);
    const after = value.slice(mention.triggerIndex + 1 + mention.query.length);
    onValueChange(before + name + after);
    setMention(null);
    // Restore focus
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  function handleKeyDown(e: ReactKeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) {
    if (!mention || candidates.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, candidates.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      const chosen = candidates[activeIdx];
      if (chosen) {
        e.preventDefault();
        pick(chosen);
      }
    } else if (e.key === 'Escape') {
      setMention(null);
    }
  }

  const sharedProps = {
    ref: inputRef as React.Ref<HTMLInputElement & HTMLTextAreaElement>,
    value,
    placeholder,
    className,
    onChange: handleChange,
    onKeyDown: handleKeyDown,
    onBlur: () => {
      // Small delay so click on dropdown item registers first
      setTimeout(() => setMention(null), 150);
    },
  };

  return (
    <div style={{ position: 'relative' }}>
      {multiline ? (
        <textarea {...sharedProps} rows={rows} />
      ) : (
        <input {...sharedProps} type="text" />
      )}

      {mention && candidates.length > 0 && (
        <div className="mention-dropdown" role="listbox">
          <div className="mention-dropdown-header">
            {mention.kind === '@' ? 'Tasks' : 'Artifacts'}
          </div>
          {candidates.map((name, idx) => (
            <div
              key={name}
              className={`mention-option${idx === activeIdx ? ' mention-option-active' : ''}`}
              role="option"
              aria-selected={idx === activeIdx}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(name);
              }}
            >
              {name}
            </div>
          ))}
          <div className="mention-dropdown-hint">
            {mention.kind === '@'
              ? 'Type a task name or pick an existing one'
              : 'Type an artifact name or pick an existing one'}
          </div>
        </div>
      )}
    </div>
  );
}
