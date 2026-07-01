import { useState } from 'react';
import { ApiError } from '@/api';
import { useAuth } from '@/auth/AuthContext';
import { Modal } from '@/components/Modal';

// Self-service password change, opened from the SettingsMenu. Available to every
// role. Old + new + confirm → useAuth().changePassword. A wrong CURRENT password
// comes back as a 403 (ForbiddenError extends ApiError) — we catch it here and
// show an inline "current password is incorrect" message rather than letting it
// bubble into a generic error / redirect.

interface ChangePasswordModalProps {
  open: boolean;
  onClose: () => void;
}

export function ChangePasswordModal({ open, onClose }: ChangePasswordModalProps) {
  const { changePassword } = useAuth();
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  function reset() {
    setOldPassword('');
    setNewPassword('');
    setConfirm('');
    setError(null);
    setDone(false);
    setSaving(false);
  }

  function handleClose() {
    reset();
    onClose();
  }

  async function handleSubmit() {
    if (!oldPassword || !newPassword) {
      setError('Please fill in every field.');
      return;
    }
    if (newPassword !== confirm) {
      setError('The new passwords do not match.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await changePassword(oldPassword, newPassword);
      setDone(true);
    } catch (err) {
      // 403 (ForbiddenError) = the current password was wrong. Keep it inline.
      if (err instanceof ApiError && err.status === 403) {
        setError('Current password is incorrect.');
      } else {
        setError('Could not change your password. Please try again in a moment.');
      }
    } finally {
      setSaving(false);
    }
  }

  const canSubmit =
    !saving && oldPassword !== '' && newPassword !== '' && confirm !== '';

  return (
    <Modal
      open={open}
      title="Change password"
      onClose={handleClose}
      footer={
        done ? (
          <button className="btn btn-primary" onClick={handleClose}>
            Done
          </button>
        ) : (
          <>
            <button className="btn btn-secondary" onClick={handleClose} disabled={saving}>
              Cancel
            </button>
            <button className="btn btn-primary" onClick={handleSubmit} disabled={!canSubmit}>
              {saving ? 'Saving…' : 'Update password'}
            </button>
          </>
        )
      }
    >
      {done ? (
        <p style={{ color: 'var(--text-secondary)', fontSize: 14, margin: 0 }}>
          Your password has been updated. Use the new password next time you sign in.
        </p>
      ) : (
        <>
          {error && (
            <p role="alert" style={{ color: '#ef4444', fontSize: 13, margin: '0 0 12px' }}>
              {error}
            </p>
          )}
          <div className="form-row">
            <label className="form-label form-label-required" htmlFor="cp-old">
              Current password
            </label>
            <input
              id="cp-old"
              className="form-input"
              type="password"
              value={oldPassword}
              onChange={(e) => setOldPassword(e.target.value)}
              autoComplete="current-password"
              autoFocus
            />
          </div>
          <div className="form-row">
            <label className="form-label form-label-required" htmlFor="cp-new">
              New password
            </label>
            <input
              id="cp-new"
              className="form-input"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              autoComplete="new-password"
            />
          </div>
          <div className="form-row">
            <label className="form-label form-label-required" htmlFor="cp-confirm">
              Confirm new password
            </label>
            <input
              id="cp-confirm"
              className="form-input"
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="new-password"
            />
          </div>
        </>
      )}
    </Modal>
  );
}
