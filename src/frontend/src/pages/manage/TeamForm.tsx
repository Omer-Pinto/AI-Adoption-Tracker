import { useState } from 'react';
import type { Team } from '@/types';
import { api } from '@/api';
import { Modal } from '@/components/Modal';

interface TeamFormProps {
  open: boolean;
  editing: Team | null;
  onClose: () => void;
  onSaved: () => void;
}

// One champion per team — name + champion fields are created/edited together.
export function TeamForm({ open, editing, onClose, onSaved }: TeamFormProps) {
  const [name, setName] = useState(editing?.name ?? '');
  const [championName, setChampionName] = useState(editing?.champion_name ?? '');
  const [championStartDate, setChampionStartDate] = useState(
    editing?.champion_start_date ?? '',
  );
  const [saving, setSaving] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const title = editing ? `Edit Team: ${editing.name}` : 'Add Team';

  async function handleSubmit() {
    if (!name.trim()) {
      setSubmitError('Team name is required.');
      return;
    }
    if (!championName.trim()) {
      setSubmitError('Champion name is required.');
      return;
    }
    setSaving(true);
    setSubmitError(null);
    const body = {
      name,
      champion_name: championName,
      champion_start_date: championStartDate || null,
    };
    try {
      if (editing) {
        await api.teams.update(editing.id, body);
      } else {
        await api.teams.create(body);
      }
      onSaved();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Save failed. Please try again.');
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
            disabled={saving || !name.trim() || !championName.trim()}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </>
      }
    >
      {submitError && (
        <p style={{ color: '#ef4444', fontSize: '13px', marginBottom: '12px', marginTop: '0' }}>
          {submitError}
        </p>
      )}
      <div className="form-row">
        <label className="form-label form-label-required">Team name</label>
        <input
          className="form-input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Team name"
          autoFocus
        />
      </div>
      <div className="form-row">
        <label className="form-label form-label-required">Champion name</label>
        <input
          className="form-input"
          value={championName}
          onChange={(e) => setChampionName(e.target.value)}
          placeholder="Champion name"
        />
      </div>
      <div className="form-row">
        <label className="form-label">Champion start date</label>
        <input
          className="form-input"
          type="date"
          value={championStartDate}
          onChange={(e) => setChampionStartDate(e.target.value)}
        />
      </div>
    </Modal>
  );
}
