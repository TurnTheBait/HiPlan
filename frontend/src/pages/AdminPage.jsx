import { useState, useEffect } from 'react';
import api from '../api/client';
import { useToast } from '../context/ToastContext';
import './AdminPage.css';

const DEPT_LABELS = {
  ufficio_tecnico: '🔧 Ufficio Tecnico',
  produzione: '🏭 Produzione',
  acquisti: '🛒 Acquisti',
  admin: '⚙️ Admin',
};
const DEPT_COLORS = {
  ufficio_tecnico: '#3b82f6',
  produzione: '#10b981',
  acquisti: '#f59e0b',
  admin: '#8b5cf6',
};

export default function AdminPage() {
  const toast = useToast();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);

  // STATO PER COLONNE TABELLA ADMIN
  const [adminVisibleColumns, setAdminVisibleColumns] = useState(() => {
    const saved = localStorage.getItem('adminVisibleColumns');
    return saved ? JSON.parse(saved) : ['utente', 'email', 'ruolo', 'reparto', 'stato', 'registrato', 'azioni'];
  });
  const [showAdminColumnsMenu, setShowAdminColumnsMenu] = useState(false);

  function toggleAdminColumn(col) {
    setAdminVisibleColumns(prev => {
      const next = prev.includes(col) ? prev.filter(c => c !== col) : [...prev, col];
      localStorage.setItem('adminVisibleColumns', JSON.stringify(next));
      return next;
    });
  }

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    try {
      await loadUsers();
    } finally {
      setLoading(false);
    }
  }

  async function loadUsers() {
    try {
      const { data } = await api.get('/users');
      setUsers(data);
    } catch {
      toast.error('Errore caricamento utenti');
    }
  }


  async function handleRoleChange(userId, newRole) {
    try {
      await api.patch(`/users/${userId}`, { role: newRole });
      toast.success('Ruolo aggiornato');
      loadUsers();
    } catch {
      toast.error('Errore aggiornamento ruolo');
    }
  }

  async function handleDepartmentChange(userId, newDept) {
    try {
      await api.patch(`/users/${userId}`, { department: newDept || null });
      toast.success('Reparto aggiornato');
      loadUsers();
    } catch {
      toast.error('Errore aggiornamento reparto');
    }
  }

  async function handleToggleActive(userId, isActive) {
    if (!window.confirm(`Confermi la ${isActive ? 'disattivazione' : 'riattivazione'} di questo utente?`)) return;
    try {
      await api.patch(`/users/${userId}`, { is_active: !isActive });
      toast.success(isActive ? 'Utente disattivato' : 'Utente attivato');
      loadUsers();
    } catch {
      toast.error('Errore aggiornamento stato');
    }
  }

  async function handleDeleteUser(user) {
    if (!window.confirm(`Confermi l'eliminazione definitiva dell'utente '${user.username}'?`)) return;
    try {
      await api.delete(`/users/${user.id}`);
      toast.success("Utente eliminato definitivamente");
      loadUsers();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Errore durante l'eliminazione dell'utente");
    }
  }


  if (loading) return <div className="loading-screen"><div className="spinner" /></div>;

  return (
    <div className="admin-page animate-fadeIn">
      <div className="admin-header">
        <h1>Pannello di Amministrazione</h1>
        <p>Gestisci gli utenti registrati e l'elenco degli addetti assegnabili alle singole fasi delle commesse.</p>
      </div>

      {/* SEZIONE 1: UTENTI DI SISTEMA */}
      <div className="admin-section-card">
        <div className="admin-section-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h2>👤 Utenti di Sistema</h2>
            <p className="admin-section-desc">Utenti registrati con credenziali di login per accedere al gestionale HiPlan ({users.length})</p>
          </div>
          <div style={{ position: 'relative' }}>
            <button 
              className="btn btn-secondary btn-sm"
              onClick={() => setShowAdminColumnsMenu(!showAdminColumnsMenu)}
            >
              ⚙️ Colonne
            </button>
            {showAdminColumnsMenu && (
              <div className="dropdown-menu" style={{ position: 'absolute', right: 0, top: '100%', marginTop: 8, zIndex: 50, background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 8, padding: 8, boxShadow: 'var(--shadow-lg)', minWidth: 200 }}>
                {['utente', 'email', 'ruolo', 'reparto', 'stato', 'registrato', 'azioni'].map(col => (
                  <label key={col} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 8px', cursor: 'pointer', textTransform: 'capitalize' }}>
                    <input 
                      type="checkbox" 
                      checked={adminVisibleColumns.includes(col)}
                      onChange={() => toggleAdminColumn(col)}
                    />
                    {col}
                  </label>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="table-wrapper">
          <table className="table">
            <thead>
              <tr>
                {adminVisibleColumns.includes('utente') && <th>Utente</th>}
                {adminVisibleColumns.includes('email') && <th>Email</th>}
                {adminVisibleColumns.includes('ruolo') && <th>Ruolo</th>}
                {adminVisibleColumns.includes('reparto') && <th>Reparto</th>}
                {adminVisibleColumns.includes('stato') && <th>Stato</th>}
                {adminVisibleColumns.includes('registrato') && <th>Registrato</th>}
                {adminVisibleColumns.includes('azioni') && <th>Azioni</th>}
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  {adminVisibleColumns.includes('utente') && (
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
                  )}
                  {adminVisibleColumns.includes('email') && <td>{u.email}</td>}
                  {adminVisibleColumns.includes('ruolo') && (
                    <td>
                      <select
                        className="input"
                        value={u.role}
                        onChange={(e) => handleRoleChange(u.id, e.target.value)}
                        style={{ padding: '6px 10px', fontSize: '0.8125rem', minWidth: 100 }}
                      >
                        <option value="admin">Admin</option>
                        <option value="editor">Editor</option>
                        <option value="viewer">Viewer</option>
                      </select>
                    </td>
                  )}
                  {adminVisibleColumns.includes('reparto') && (
                    <td>
                      <select
                        className="input"
                        value={u.department || ''}
                        onChange={(e) => handleDepartmentChange(u.id, e.target.value)}
                        style={{ padding: '6px 10px', fontSize: '0.8125rem', minWidth: 140 }}
                      >
                        <option value="">— Nessun reparto —</option>
                        <option value="ufficio_tecnico">🔧 Ufficio Tecnico</option>
                        <option value="produzione">🏭 Produzione</option>
                        <option value="acquisti">🛒 Acquisti</option>
                        <option value="admin">⚙️ Admin</option>
                      </select>
                    </td>
                  )}
                  {adminVisibleColumns.includes('stato') && (
                    <td>
                      <span className={`badge ${u.is_active ? 'badge-active' : 'badge-archived'}`}>
                        {u.is_active ? 'Attivo' : 'Disattivato'}
                      </span>
                    </td>
                  )}
                  {adminVisibleColumns.includes('registrato') && (
                    <td style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
                      {u.created_at ? new Date(u.created_at).toLocaleDateString('it-IT') : '-'}
                    </td>
                  )}
                  {adminVisibleColumns.includes('azioni') && (
                    <td>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button
                          className={`btn btn-sm ${u.is_active ? 'btn-danger' : 'btn-primary'}`}
                          onClick={() => handleToggleActive(u.id, u.is_active)}
                        >
                          {u.is_active ? 'Disattiva' : 'Attiva'}
                        </button>
                        <button
                          className="btn btn-sm btn-ghost"
                          style={{ color: 'var(--danger)', padding: '4px 8px' }}
                          onClick={() => handleDeleteUser(u)}
                          title="Elimina definitivamente questo utente"
                        >
                          🗑️
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>


    </div>
  );
}
