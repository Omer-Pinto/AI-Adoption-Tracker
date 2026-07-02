import { useState } from 'react';
import type { User } from '@/types';
import { api } from '@/api';
import { Modal } from '@/components/Modal';

// Admin reset of another user's password. Two modes: type a specific new
// password, or leave it blank to reset to the system's default provisioning
// password. The API returns the updated User (never the password itself), so we
// confirm success by echoing back what the admin set (or "the default"). The
// admin then relays it to the user out-of-band.

interface ResetPasswordModalProps {
  open: boolean;
  user: User;
  onClose: () => void;
  /** Called after a successful reset with a human-readable confirmation. */
  onDone: (message: string) => void;
}

export function ResetPasswordModal({ open, user, onClose, onDone }: ResetPasswordModalProps) {
  const [newPassword, setNewPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    setSaving(true);
    setError(null);
    const custom = newPassword.trim();
    try {
      await api.users.resetPassword(user.id, custom !== '' ? custom : undefined);
      onDone(
        custom !== ''
          ? `Password for “${user.username}” was reset to the value you entered.`
          : `Password for “${user.username}” was reset to the default password.`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reset failed. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      title={`Reset password: ${user.username}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={handleSubmit} disabled={saving}>
            {saving ? 'Resetting…' : 'Reset password'}
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
        <label className="form-label" htmlFor="rp-new">
          New password
        </label>
        <input
          id="rp-new"
          className="form-input"
          type="text"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          placeholder="Leave blank to reset to the default"
          autoComplete="new-password"
          autoFocus
        />
        <div className="text-muted text-sm" style={{ marginTop: 4 }}>
          Leave blank to reset to the system default password. Share the new
          password with the user so they can sign in and change it.
        </div>
      </div>
    </Modal>
  );
}
