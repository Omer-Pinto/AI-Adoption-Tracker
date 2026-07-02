import { useState } from 'react';
import type { Team, User } from '@/types';
import { api } from '@/api';
import { Modal } from '@/components/Modal';

// Admin create/edit form for a user. The read-scope matrix is the core control:
// an "All teams" toggle (`read_all`) that, when off, reveals per-team checkboxes
// built from the live team list (so the list grows as teams are added). On
// create we also collect the initial password (edit uses reset-password instead;
// UserUpdate forbids a password field).

interface UserFormProps {
  open: boolean;
  editing: User | null;
  teams: Team[];
  onClose: () => void;
  onSaved: () => void;
}

export function UserForm({ open, editing, teams, onClose, onSaved }: UserFormProps) {
  const [username, setUsername] = useState(editing?.username ?? '');
  const [password, setPassword] = useState('');
  const [readAll, setReadAll] = useState(editing?.read_all ?? false);
  const [selectedTeams, setSelectedTeams] = useState<number[]>(editing?.teams ?? []);
  const [isActive, setIsActive] = useState(editing?.is_active ?? true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const title = editing ? `Edit user: ${editing.username}` : 'Add user';

  function toggleTeam(id: number) {
    setSelectedTeams((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  async function handleSubmit() {
    if (!username.trim()) {
      setError('Username is required.');
      return;
    }
    if (!editing && !password) {
      setError('An initial password is required.');
      return;
    }
    setSaving(true);
    setError(null);
    const teamsToSend = readAll ? [] : selectedTeams;
    try {
      if (editing) {
        await api.users.update(editing.id, {
          username: username.trim(),
          read_all: readAll,
          teams: teamsToSend,
          is_active: isActive,
        });
      } else {
        await api.users.create({
          username: username.trim(),
          password,
          read_all: readAll,
          teams: teamsToSend,
          is_active: isActive,
        });
      }
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      title={title}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            onClick={handleSubmit}
            disabled={saving || !username.trim() || (!editing && !password)}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </>
      }
    >
      {error && (
        <p className="form-error" style={{ marginTop: 0, marginBottom: 'var(--sp-3)' }}>
          {error}
        </p>
      )}

      <div className="form-row">
        <label className="form-label form-label-required">Username</label>
        <input
          className="form-input"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="Username"
          autoComplete="off"
          autoFocus
        />
      </div>

      {!editing && (
        <div className="form-row">
          <label className="form-label form-label-required">Initial password</label>
          <input
            className="form-input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Set an initial password"
            autoComplete="new-password"
          />
          <div className="text-muted text-sm" style={{ marginTop: 4 }}>
            The user can change it themselves after signing in.
          </div>
        </div>
      )}

      <div className="form-row">
        <label className="form-label">Read scope</label>
        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            fontSize: 13,
            color: 'var(--text-secondary)',
            cursor: 'pointer',
            padding: '4px 0',
          }}
        >
          <input
            type="checkbox"
            checked={readAll}
            onChange={(e) => setReadAll(e.target.checked)}
            style={{ accentColor: 'var(--accent)', width: 15, height: 15 }}
          />
          All teams
        </label>
        {!readAll && (
          <>
            <div className="text-muted text-sm" style={{ margin: '2px 0 6px' }}>
              Choose the teams this user can view.
            </div>
            {teams.length === 0 ? (
              <div className="text-muted text-sm" style={{ padding: '6px 0' }}>
                No teams exist yet.
              </div>
            ) : (
              <div
                style={{
                  border: '1px solid var(--border-strong)',
                  borderRadius: 6,
                  maxHeight: 180,
                  overflowY: 'auto',
                  background: 'var(--surface)',
                }}
              >
                {teams.map((t) => {
                  const checked = selectedTeams.includes(t.id);
                  return (
                    <label
                      key={t.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        padding: '7px 10px',
                        cursor: 'pointer',
                        borderBottom: '1px solid var(--border-subtle)',
                        background: checked ? 'var(--accent-weak)' : undefined,
                        fontSize: 13,
                        color: 'var(--text-secondary)',
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleTeam(t.id)}
                        style={{ accentColor: 'var(--accent)', width: 15, height: 15, flexShrink: 0 }}
                      />
                      {t.name}
                    </label>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>

      <div className="form-row">
        <label className="form-label">Status</label>
        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            fontSize: 13,
            color: 'var(--text-secondary)',
            cursor: 'pointer',
            padding: '4px 0',
          }}
        >
          <input
            type="checkbox"
            checked={isActive}
            onChange={(e) => setIsActive(e.target.checked)}
            style={{ accentColor: 'var(--accent)', width: 15, height: 15 }}
          />
          Active (can sign in)
        </label>
      </div>
    </Modal>
  );
}
