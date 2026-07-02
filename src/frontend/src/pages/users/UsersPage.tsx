import { useCallback, useEffect, useState } from 'react';
import type { Team, User } from '@/types';
import { api } from '@/api';
import { useAuth } from '@/auth/AuthContext';
import { DataTable } from '@/components/DataTable';
import type { Column } from '@/components/DataTable';
import { ErrorState } from '@/components/EmptyState';
import ForbiddenPage from '@/pages/error/ForbiddenPage';
import { UserForm } from './UserForm';
import { ResetPasswordModal } from './ResetPasswordModal';
import './users-page.css';

// Route: "/users" — admin-only portal to manage viewer accounts (the API list
// already excludes the admin themselves). Create / Edit / Delete / Reset
// password / Activate-Deactivate. Non-admins never reach the route via nav, but
// we defensively render the curated Forbidden surface if one lands here.

type ModalState =
  | { kind: 'none' }
  | { kind: 'edit'; editing: User | null }
  | { kind: 'reset'; user: User };

export default function UsersPage() {
  const { isAdmin } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [modal, setModal] = useState<ModalState>({ kind: 'none' });
  const [loadError, setLoadError] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    setLoadError(false);
    try {
      const [u, t] = await Promise.all([api.users.list(), api.teams.list()]);
      setUsers(u);
      setTeams(t);
    } catch (e) {
      console.error(e);
      setLoadError(true);
    }
  }, []);

  useEffect(() => {
    if (isAdmin) void loadAll();
  }, [isAdmin, loadAll]);

  // Non-admins get the curated Forbidden surface (this route is admin-only).
  if (!isAdmin) return <ForbiddenPage />;

  function showToast(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(null), 4000);
  }

  function closeModal() {
    setModal({ kind: 'none' });
  }

  function handleSaved() {
    closeModal();
    void loadAll();
  }

  const teamName = (id: number) => teams.find((t) => t.id === id)?.name ?? `#${id}`;

  async function handleDelete(user: User) {
    if (!confirm(`Delete user “${user.username}”? This cannot be undone.`)) return;
    try {
      await api.users.delete(user.id);
      showToast(`User “${user.username}” was deleted.`);
      await loadAll();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Delete failed.');
    }
  }

  async function handleToggleActive(user: User) {
    try {
      const updated = await api.users.update(user.id, { is_active: !user.is_active });
      setUsers((prev) => prev.map((u) => (u.id === updated.id ? updated : u)));
      showToast(
        updated.is_active
          ? `“${user.username}” can now sign in.`
          : `“${user.username}” has been deactivated.`,
      );
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Update failed.');
    }
  }

  const columns: Column<User>[] = [
    {
      key: 'username',
      header: 'Username',
      render: (u) => <span style={{ fontWeight: 600 }}>{u.username}</span>,
    },
    {
      key: 'scope',
      header: 'Read scope',
      render: (u) => {
        if (u.read_all) {
          return <span className="users-scope-pill is-all">All teams</span>;
        }
        if (u.teams.length === 0) {
          return <span className="users-scope-pill is-none">No teams</span>;
        }
        return (
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {u.teams.map((id) => (
              <span key={id} className="users-scope-pill is-team">
                {teamName(id)}
              </span>
            ))}
          </div>
        );
      },
    },
    {
      key: 'active',
      header: 'Status',
      width: '110px',
      render: (u) => (
        <span className={`users-active-dot ${u.is_active ? 'is-active' : 'is-inactive'}`}>
          {u.is_active ? 'Active' : 'Inactive'}
        </span>
      ),
    },
    {
      key: 'actions',
      header: '',
      width: '360px',
      render: (u) => (
        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => setModal({ kind: 'edit', editing: u })}
          >
            Edit
          </button>
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => setModal({ kind: 'reset', user: u })}
          >
            Reset password
          </button>
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => void handleToggleActive(u)}
          >
            {u.is_active ? 'Deactivate' : 'Activate'}
          </button>
          <button
            className="btn btn-danger-outline btn-sm"
            onClick={() => void handleDelete(u)}
          >
            Delete
          </button>
        </div>
      ),
    },
  ];

  return (
    <>
      <div className="top-bar">
        <div>
          <span className="top-bar-title">Users</span>
          <span className="top-bar-sub">Viewer accounts &amp; read scope</span>
        </div>
      </div>

      <div className="page-body">
        {loadError ? (
          <div className="panel">
            <ErrorState
              title="Couldn't load users"
              hint="The user list failed to load. Try again."
              onRetry={() => void loadAll()}
            />
          </div>
        ) : (
          <>
          <div className="table-toolbar">
            <span className="table-toolbar-label">
              {users.length} {users.length === 1 ? 'user' : 'users'}
            </span>
            <span className="table-toolbar-spacer" />
            <button
              className="btn btn-primary btn-sm"
              onClick={() => setModal({ kind: 'edit', editing: null })}
            >
              + Add User
            </button>
          </div>
          <div className="panel">
            <DataTable
              columns={columns}
              rows={users}
              rowKey={(u) => u.id}
              empty="No users yet. Click + Add User to create one."
            />
          </div>
          </>
        )}
      </div>

      {modal.kind === 'edit' && (
        <UserForm
          open
          editing={modal.editing}
          teams={teams}
          onClose={closeModal}
          onSaved={handleSaved}
        />
      )}
      {modal.kind === 'reset' && (
        <ResetPasswordModal
          open
          user={modal.user}
          onClose={closeModal}
          onDone={(message) => {
            closeModal();
            showToast(message);
          }}
        />
      )}

      {toast && (
        <div className="users-toast" role="status">
          {toast}
        </div>
      )}
    </>
  );
}
