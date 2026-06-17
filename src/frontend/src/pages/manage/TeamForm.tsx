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

export function TeamForm({ open, editing, onClose, onSaved }: TeamFormProps) {
  const [name, setName] = useState(editing?.name ?? '');
  const [ccBaseline, setCcBaseline] = useState(editing?.cc_baseline ?? '');
  const [saving, setSaving] = useState(false);

  // Reset fields when the modal opens with new data
  const title = editing ? `Edit Team: ${editing.name}` : 'Add Team';

  async function handleSubmit() {
    setSaving(true);
    const body = {
      name,
      cc_baseline: ccBaseline || null,
      baseline_date: editing?.baseline_date ?? null,
    };
    if (editing) {
      await api.teams.update(editing.id, body);
    } else {
      await api.teams.create(body);
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
          placeholder="Team name"
          autoFocus
        />
      </div>
      <div className="form-row">
        <label className="form-label">CC Baseline</label>
        <input
          className="form-input"
          value={ccBaseline}
          onChange={(e) => setCcBaseline(e.target.value)}
          placeholder="e.g. 2024-Q1"
        />
      </div>
    </Modal>
  );
}
