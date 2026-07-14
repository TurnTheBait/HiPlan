import { useState, useEffect } from 'react';
import api from '../api/client';
import { useToast } from '../context/ToastContext';
import './AdminPage.css';

export default function AdminPage() {
  const toast = useToast();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { loadUsers(); }, []);

  async function loadUsers() {
    try {
      const { data } = await api.get('/users');
      setUsers(data);
    } catch { toast.error('Errore caricamento utenti'); }
    finally { setLoading(false); }
  }

  async function handleRoleChange(userId, newRole) {
    try {
      await api.patch(`/users/${userId}`, { role: newRole });
      toast.success('Ruolo aggiornato');
      loadUsers();
    } catch { toast.error('Errore aggiornamento ruolo'); }
  }

  async function handleToggleActive(userId, isActive) {
    try {
      await api.patch(`/users/${userId}`, { is_active: !isActive });
      toast.success(isActive ? 'Utente disattivato' : 'Utente attivato');
      loadUsers();
    } catch { toast.error('Errore aggiornamento stato'); }
  }

  if (loading) return <div className="loading-screen"><div className="spinner" /></div>;

  return (
    <div className="admin-page animate-fadeIn">
      <div className="admin-header">
        <h1>Gestione Utenti</h1>
        <p>{users.length} utenti registrati</p>
      </div>

      <div className="table-wrapper">
        <table className="table">
          <thead>
            <tr>
              <th>Utente</th>
              <th>Email</th>
              <th>Ruolo</th>
              <th>Stato</th>
              <th>Registrato</th>
              <th>Azioni</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>
                  <div className="admin-user-cell">
                    <div className="sidebar-avatar" style={{ width: 30, height: 30, fontSize: '0.75rem' }}>
                      {u.username?.[0]?.toUpperCase() || '?'}
                    </div>
                    <div>
                      <span className="admin-username">{u.full_name || u.username}</span>
                      <span className="admin-handle">@{u.username}</span>
                    </div>
                  </div>
                </td>
                <td>{u.email}</td>
                <td>
                  <select
                    className="input"
                    value={u.role}
                    onChange={(e) => handleRoleChange(u.id, e.target.value)}
                    style={{ padding: '6px 10px', fontSize: '0.8125rem', minWidth: 100 }}
                  >
                    <option value="admin">Admin</option>
                    <option value="pm">PM</option>
                    <option value="viewer">Viewer</option>
                  </select>
                </td>
                <td>
                  <span className={`badge ${u.is_active ? 'badge-active' : 'badge-archived'}`}>
                    {u.is_active ? 'Attivo' : 'Disattivato'}
                  </span>
                </td>
                <td style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
                  {u.created_at ? new Date(u.created_at).toLocaleDateString('it-IT') : '-'}
                </td>
                <td>
                  <button
                    className={`btn btn-sm ${u.is_active ? 'btn-danger' : 'btn-primary'}`}
                    onClick={() => handleToggleActive(u.id, u.is_active)}
                  >
                    {u.is_active ? 'Disattiva' : 'Attiva'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
