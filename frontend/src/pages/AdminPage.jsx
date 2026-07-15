import { useState, useEffect } from 'react';
import api from '../api/client';
import { useToast } from '../context/ToastContext';
import './AdminPage.css';

export default function AdminPage() {
  const toast = useToast();
  const [users, setUsers] = useState([]);
  const [workers, setWorkers] = useState([]);
  const [newWorkerName, setNewWorkerName] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    try {
      await Promise.all([loadUsers(), loadWorkers()]);
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

  async function loadWorkers() {
    try {
      const { data } = await api.get('/workers');
      setWorkers(data);
    } catch {
      toast.error('Errore caricamento addetti alle fasi');
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

  async function handleToggleActive(userId, isActive) {
    try {
      await api.patch(`/users/${userId}`, { is_active: !isActive });
      toast.success(isActive ? 'Utente disattivato' : 'Utente attivato');
      loadUsers();
    } catch {
      toast.error('Errore aggiornamento stato');
    }
  }

  async function handleAddWorker(e) {
    e.preventDefault();
    if (!newWorkerName.trim()) return;
    try {
      await api.post('/workers', { name: newWorkerName.trim() });
      toast.success("Addetto aggiunto all'elenco selezionabile");
      setNewWorkerName('');
      loadWorkers();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Errore durante l'aggiunta dell'addetto");
    }
  }

  async function handleDeleteWorker(worker) {
    if (!window.confirm(`Rimuovere '${worker.name}' dagli addetti selezionabili nel sistema?`)) return;
    try {
      await api.delete(`/workers/${worker.id}`);
      toast.success("Addetto rimosso dall'elenco selezionabile");
      loadWorkers();
    } catch {
      toast.error("Errore durante la rimozione dell'addetto");
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
        <div className="admin-section-header">
          <h2>👤 Utenti di Sistema</h2>
          <p className="admin-section-desc">Utenti registrati con credenziali di login per accedere al gestionale GanttFlow ({users.length})</p>
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
                      <option value="editor">Editor</option>
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

      {/* SEZIONE 2: ADDETTI ALLE FASI (GANTT) */}
      <div className="admin-section-card" style={{ marginTop: 32 }}>
        <div className="admin-section-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 16 }}>
          <div>
            <h2>👷 Addetti alle Fasi (Gantt)</h2>
            <p className="admin-section-desc">
              Elenco predefinito degli addetti selezionabili durante la configurazione delle singole fasi di una commessa ({workers.length})
            </p>
          </div>

          <form onSubmit={handleAddWorker} style={{ display: 'flex', gap: 8, minWidth: 280 }}>
            <input
              type="text"
              className="input"
              placeholder="Nome del nuovo addetto..."
              value={newWorkerName}
              onChange={(e) => setNewWorkerName(e.target.value)}
              style={{ flex: 1, padding: '8px 12px' }}
            />
            <button type="submit" className="btn btn-primary" style={{ whiteSpace: 'nowrap' }}>
              + Aggiungi
            </button>
          </form>
        </div>

        <div className="table-wrapper" style={{ marginTop: 12 }}>
          <table className="table">
            <thead>
              <tr>
                <th>Addetto</th>
                <th>Stato</th>
                <th>Tipo / Data Aggiunta</th>
                <th style={{ textAlign: 'right' }}>Azioni</th>
              </tr>
            </thead>
            <tbody>
              {workers.length === 0 ? (
                <tr>
                  <td colSpan="4" style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '24px 0' }}>
                    Nessun addetto configurato nel sistema. Aggiungine uno usando il modulo in alto a destra.
                  </td>
                </tr>
              ) : (
                workers.map((w) => (
                  <tr key={w.id}>
                    <td>
                      <div className="admin-user-cell">
                        <div className="sidebar-avatar" style={{ width: 30, height: 30, fontSize: '0.75rem', background: 'var(--accent-primary)' }}>
                          {w.name?.[0]?.toUpperCase() || '?'}
                        </div>
                        <span className="admin-username" style={{ fontWeight: 600 }}>{w.name}</span>
                      </div>
                    </td>
                    <td>
                      <span className="badge badge-active">Selezionabile</span>
                    </td>
                    <td style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
                      {w.created_at ? new Date(w.created_at).toLocaleDateString('it-IT') : 'Predefinito'}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <button
                        type="button"
                        className="btn btn-sm btn-danger"
                        onClick={() => handleDeleteWorker(w)}
                        title="Rimuovi questo addetto dagli elenchi selezionabili"
                      >
                        ✕ Rimuovi
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
