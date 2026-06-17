import { useState } from 'react';
import type { Champion, Team } from '@/types';
import { api } from '@/api';
import { Modal } from '@/components/Modal';

interface ChampionFormProps {
  open: boolean;
  editing: Champion | null;
  teams: Team[];
  onClose: () => void;
  onSaved: () => void;
}

export function ChampionForm({ open, editing, teams, onClose, onSaved }: ChampionFormProps) {
  const [name, setName] = useState(editing?.name ?? '');
  const [teamId, setTeamId] = useState<string>(editing?.team_id != null ? String(editing.team_id) : '');
  const [startDate, setStartDate] = useState(editing?.start_date ?? '');
  const [endDate, setEndDate] = useState(editing?.end_date ?? '');
  const [saving, setSaving] = useState(false);

  const title = editing ? `Edit Champion: ${editing.name}` : 'Add Champion';

  async function handleSubmit() {
    setSaving(true);
    const body = {
      name,
      team_id: Number(teamId),
      start_date: startDate || null,
      end_date: endDate || null,
    };
    if (editing) {
      await api.champions.update(editing.id, body);
    } else {
      await api.champions.create(body);
    }
    setSaving(false);
    onSaved();
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
          <button className="btn btn-primary" onClick={handleSubmit} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </>
      }
    >
      <div className="form-row">
        <label className="form-label form-label-required">Name</label>
        <input
          className="form-input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Champion name"
          autoFocus
        />
      </div>
      <div className="form-row">
        <label className="form-label form-label-required">Team</label>
        <select
          className="form-select"
          value={teamId}
          onChange={(e) => setTeamId(e.target.value)}
        >
          <option value="">Select team…</option>
          {teams.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </div>
      <div className="form-grid-2">
        <div className="form-row">
          <label className="form-label">Start Date</label>
          <input
            className="form-input"
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
          />
        </div>
        <div className="form-row">
          <label className="form-label">End Date</label>
          <input
            className="form-input"
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
          />
        </div>
      </div>
    </Modal>
  );
}
