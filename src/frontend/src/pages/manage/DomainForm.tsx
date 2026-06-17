import { useState } from 'react';
import type { Domain, Team, Champion } from '@/types';
import { api } from '@/api';
import { Modal } from '@/components/Modal';

interface DomainFormProps {
  open: boolean;
  editing: Domain | null;
  teams: Team[];
  champions: Champion[];
  onClose: () => void;
  onSaved: () => void;
}

export function DomainForm({
  open,
  editing,
  teams,
  champions,
  onClose,
  onSaved,
}: DomainFormProps) {
  const [teamId, setTeamId] = useState<string>(editing?.team_id != null ? String(editing.team_id) : '');
  const [championId, setChampionId] = useState<string>(
    editing?.champion_id != null ? String(editing.champion_id) : '',
  );
  const [name, setName] = useState(editing?.name ?? '');
  const [description, setDescription] = useState(editing?.description ?? '');
  const [scope, setScope] = useState(editing?.scope ?? '');
  const [priority, setPriority] = useState<string>(
    editing?.priority != null ? String(editing.priority) : '',
  );
  const [crossDomain, setCrossDomain] = useState(editing?.cross_domain ?? '');
  const [saving, setSaving] = useState(false);

  // Champions filtered to the selected team (or all if no team selected)
  const filteredChampions =
    teamId ? champions.filter((c) => c.team_id === Number(teamId)) : champions;

  const title = editing ? `Edit Domain: ${editing.name}` : 'Add Domain';

  async function handleSubmit() {
    setSaving(true);
    const body = {
      team_id: Number(teamId),
      champion_id: Number(championId),
      name,
      description: description || null,
      scope: scope || null,
      priority: priority !== '' ? Number(priority) : null,
      cross_domain: crossDomain || null,
    };
    if (editing) {
      await api.domains.update(editing.id, body);
    } else {
      await api.domains.create(body);
    }
    setSaving(false);
    onSaved();
  }

  return (
    <Modal
      open={open}
      title={title}
      onClose={onClose}
      wide
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={handleSubmit} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </>
      }
    >
      <div className="form-grid-2">
        <div className="form-row">
          <label className="form-label form-label-required">Team</label>
          <select
            className="form-select"
            value={teamId}
            onChange={(e) => {
              setTeamId(e.target.value);
              setChampionId('');
            }}
          >
            <option value="">Select team…</option>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>
        <div className="form-row">
          <label className="form-label form-label-required">Champion</label>
          <select
            className="form-select"
            value={championId}
            onChange={(e) => setChampionId(e.target.value)}
          >
            <option value="">Select champion…</option>
            {filteredChampions.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="form-row">
        <label className="form-label form-label-required">Name</label>
        <input
          className="form-input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Domain name"
          autoFocus
        />
      </div>
      <div className="form-row">
        <label className="form-label">Description</label>
        <textarea
          className="form-textarea"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Brief description…"
          rows={3}
        />
      </div>
      <div className="form-grid-2">
        <div className="form-row">
          <label className="form-label">Scope</label>
          <input
            className="form-input"
            value={scope}
            onChange={(e) => setScope(e.target.value)}
            placeholder="e.g. Full stack"
          />
        </div>
        <div className="form-row">
          <label className="form-label">Priority</label>
          <input
            className="form-input"
            type="number"
            min={1}
            value={priority}
            onChange={(e) => setPriority(e.target.value)}
            placeholder="e.g. 1"
          />
        </div>
      </div>
      <div className="form-row">
        <label className="form-label">Cross-domain</label>
        <input
          className="form-input"
          value={crossDomain}
          onChange={(e) => setCrossDomain(e.target.value)}
          placeholder="e.g. Security, Observability"
        />
      </div>
    </Modal>
  );
}
