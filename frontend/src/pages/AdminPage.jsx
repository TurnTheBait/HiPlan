import { useState, useEffect, useRef } from 'react';
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
  const [phaseTemplates, setPhaseTemplates] = useState([]);
  const [filterDept, setFilterDept] = useState('all');
  const [showAddTemplateModal, setShowAddTemplateModal] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState(null);
  const [templateForm, setTemplateForm] = useState({
    name: '',
    department: 'ufficio_tecnico',
    default_color: '#3b82f6',
  });
  const [globalBannerForm, setGlobalBannerForm] = useState({ text: '', type: 'info' });
  const [globalBanners, setGlobalBanners] = useState([]);
  const [loading, setLoading] = useState(true);
  const fileInputRef = useRef(null);

  async function handleBackupJson() {
    try {
      const { data } = await api.get('/projects/backup/json');
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const d = new Date();
      a.download = `commesse_backup_${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}.json`;
      a.click();
      window.URL.revokeObjectURL(url);
      toast.success('Backup JSON scaricato!');
    } catch {
      toast.error('Errore durante il download del backup JSON');
    }
  }

  async function handleRestoreJson(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      try {
        const payload = JSON.parse(ev.target.result);
        if (!payload.commesse || !Array.isArray(payload.commesse)) {
          throw new Error('Formato JSON commesse non valido');
        }
        await api.post('/projects/restore/json', payload);
        toast.success(`Caricate ${payload.commesse.length} commesse con successo!`);
        loadData();
      } catch (err) {
        toast.error('Errore nel caricamento file JSON commesse');
      }
      e.target.value = '';
    };
    reader.readAsText(file);
  }

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
      await Promise.all([loadUsers(), loadPhaseTemplates(), loadGlobalBanners()]);
    } finally {
      setLoading(false);
    }
  }

  async function loadGlobalBanners() {
    try {
      const res = await api.get('/settings/global-banner');
      setGlobalBanners(res.data || []);
    } catch { /* ignore */ }
  }

  async function addGlobalBanner(e) {
    e.preventDefault();
    if (!globalBannerForm.text.trim()) return;
    try {
      const res = await api.post('/settings/global-banner', globalBannerForm);
      setGlobalBanners(prev => [...prev, res.data]);
      setGlobalBannerForm({ text: '', type: 'info' });
      toast.success('Annuncio aggiunto con successo');
    } catch {
      toast.error('Errore aggiunta annuncio');
    }
  }

  async function deleteGlobalBanner(id) {
    if (!window.confirm("Sei sicuro di voler eliminare questo annuncio?")) return;
    try {
      await api.delete(`/settings/global-banner/${id}`);
      setGlobalBanners(prev => prev.filter(b => b.id !== id));
      toast.success('Annuncio eliminato');
    } catch {
      toast.error('Errore eliminazione annuncio');
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

  async function loadPhaseTemplates() {
    try {
      const { data } = await api.get('/phase-templates', { params: { department: 'all' } });
      setPhaseTemplates(data);
    } catch {
      toast.error('Errore caricamento fasi preimpostate');
    }
  }

  async function handleSaveTemplate(e) {
    e.preventDefault();
    if (!templateForm.name.trim()) {
      toast.error('Il nome della fase è obbligatorio');
      return;
    }
    try {
      if (editingTemplate) {
        await api.put(`/phase-templates/${editingTemplate.id}`, templateForm);
        toast.success('Fase preimpostata modificata con successo');
      } else {
        await api.post('/phase-templates', { ...templateForm, is_custom: true });
        toast.success('Nuova fase preimpostata aggiunta con successo');
      }
      setShowAddTemplateModal(false);
      setEditingTemplate(null);
      setTemplateForm({ name: '', department: 'ufficio_tecnico', default_color: '#3b82f6' });
      loadPhaseTemplates();
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Errore durante il salvataggio della fase');
    }
  }

  async function handleDeleteTemplate(tpl) {
    if (!window.confirm(`Confermi l'eliminazione della fase preimpostata "${tpl.name}" dal reparto ${DEPT_LABELS[tpl.department] || tpl.department}?`)) return;
    try {
      await api.delete(`/phase-templates/${tpl.id}`);
      toast.success('Fase preimpostata eliminata');
      loadPhaseTemplates();
    } catch {
      toast.error('Errore durante l\'eliminazione della fase');
    }
  }

  function openEditTemplate(tpl) {
    setEditingTemplate(tpl);
    setTemplateForm({
      name: tpl.name,
      department: tpl.department,
      default_color: tpl.default_color || '#3b82f6',
    });
    setShowAddTemplateModal(true);
  }

  function openNewTemplate() {
    setEditingTemplate(null);
    setTemplateForm({
      name: '',
      department: filterDept !== 'all' ? filterDept : 'ufficio_tecnico',
      default_color: DEPT_COLORS[filterDept] || '#3b82f6',
    });
    setShowAddTemplateModal(true);
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
      <div className="admin-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 20 }}>
        <div>
          <h1>Pannello di Amministrazione</h1>
          <p>Gestisci gli utenti registrati e l'elenco degli addetti assegnabili alle singole fasi delle commesse.</p>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <button className="btn btn-secondary" style={{ width: '190px' }} onClick={handleBackupJson}>
            💾 Salva Dati (JSON)
          </button>
          <button className="btn btn-secondary" style={{ width: '190px' }} onClick={() => fileInputRef.current?.click()}>
            📂 Carica Dati (JSON)
          </button>
          <input
            type="file"
            ref={fileInputRef}
            accept=".json"
            style={{ display: 'none' }}
            onChange={handleRestoreJson}
          />
        </div>
      </div>

      {/* SEZIONE BACHECA AZIENDALE */}
      <div className="admin-section-card" style={{ marginBottom: 30 }}>
        <div className="admin-section-header">
          <h2>📢 Annunci</h2>
          <p className="admin-section-desc">Annunci in evidenza che appariranno a tutti gli utenti in cima alla Dashboard per le prossime 24h.</p>
        </div>
        <form onSubmit={addGlobalBanner} style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
          <div className="input-group" style={{ flex: 1, minWidth: 250, marginBottom: 0 }}>
            <input
              className="input"
              placeholder="Es. Venerdì gli uffici chiudono alle 16:00..."
              value={globalBannerForm.text}
              onChange={(e) => setGlobalBannerForm({ ...globalBannerForm, text: e.target.value })}
            />
          </div>
          <div className="input-group" style={{ width: 150, marginBottom: 0 }}>
            <select
              className="input"
              value={globalBannerForm.type}
              onChange={(e) => setGlobalBannerForm({ ...globalBannerForm, type: e.target.value })}
            >
              <option value="info">🔵 Info</option>
              <option value="warning">🟡 Avviso</option>
              <option value="success">🟢 Successo</option>
              <option value="error">🔴 Urgente</option>
            </select>
          </div>
          <button type="submit" className="btn btn-primary" style={{ height: 42 }}>
            Aggiungi Annuncio
          </button>
        </form>

        {globalBanners.length > 0 && (
          <div style={{ marginTop: 24, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <h4 style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Annunci Attivi (max 24h)</h4>
            {globalBanners.map(b => (
              <div key={b.id} style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                background: 'var(--bg-tertiary)', padding: '10px 14px', borderRadius: 'var(--radius-sm)',
                borderLeft: `3px solid ${b.type === 'error' ? '#ef4444' : b.type === 'warning' ? '#f59e0b' : b.type === 'success' ? '#10b981' : '#3b82f6'}`
              }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span style={{ fontSize: '0.9rem', fontWeight: 500 }}>{b.text}</span>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                    Creato: {new Date(b.created_at).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
                <button onClick={() => deleteGlobalBanner(b.id)} className="btn btn-ghost" style={{ padding: '6px 10px', color: 'var(--text-muted)' }} title="Elimina annuncio">
                  🗑️
                </button>
              </div>
            ))}
          </div>
        )}
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
              {[...users].sort((a, b) => (a.full_name || a.username || '').localeCompare(b.full_name || b.username || '', 'it')).map((u) => (
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
                        style={{ padding: '6px 32px 6px 10px', fontSize: '0.8125rem', minWidth: 100 }}
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
                        style={{ padding: '6px 32px 6px 10px', fontSize: '0.8125rem', width: 'max-content', minWidth: 160 }}
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

      {/* SEZIONE 2: FASI DI LAVORAZIONE PREIMPOSTATE */}
      <div className="admin-section-card" style={{ marginTop: 32 }}>
        <div className="admin-section-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 16 }}>
          <div>
            <h2>📋 Fasi di Lavorazione Preimpostate per Reparto</h2>
            <p className="admin-section-desc">
              Gestisci l'elenco delle fasi suggerite nel menu a tendina quando gli addetti creano o modificano le attività di commessa ({phaseTemplates.filter(t => filterDept === 'all' || t.department === filterDept || t.department === 'tutti').length} visualizzate).
            </p>
          </div>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <select
              className="input"
              value={filterDept}
              onChange={(e) => setFilterDept(e.target.value)}
              style={{ padding: '6px 12px', fontSize: '0.85rem', fontWeight: 600 }}
            >
              <option value="all">🌐 Tutti i reparti ({phaseTemplates.length})</option>
              <option value="ufficio_tecnico">🔧 Ufficio Tecnico ({phaseTemplates.filter(t => t.department === 'ufficio_tecnico').length})</option>
              <option value="produzione">🏭 Produzione ({phaseTemplates.filter(t => t.department === 'produzione').length})</option>
              <option value="acquisti">🛒 Acquisti ({phaseTemplates.filter(t => t.department === 'acquisti').length})</option>
              <option value="tutti">⚙️ Tutti / Condivise ({phaseTemplates.filter(t => t.department === 'tutti').length})</option>
            </select>
            <button
              className="btn btn-primary btn-sm"
              onClick={openNewTemplate}
              style={{ display: 'flex', alignItems: 'center', gap: 6 }}
            >
              <span>+</span> Nuova Fase Preimpostata
            </button>
          </div>
        </div>

        <div className="table-wrapper">
          <table className="table">
            <thead>
              <tr>
                <th>Nome Fase / Lavorazione</th>
                <th>Reparto Assegnato</th>
                <th>Colore Predefinito</th>
                <th>Tipo</th>
                <th style={{ width: 120 }}>Azioni</th>
              </tr>
            </thead>
            <tbody>
              {phaseTemplates.filter(t => filterDept === 'all' || t.department === filterDept || t.department === 'tutti').length === 0 ? (
                <tr>
                  <td colSpan={5} style={{ textAlign: 'center', padding: '30px 10px', color: 'var(--text-muted)' }}>
                    Nessuna fase preimpostata per il filtro selezionato.
                  </td>
                </tr>
              ) : (
                phaseTemplates.filter(t => filterDept === 'all' || t.department === filterDept || t.department === 'tutti').sort((a, b) => (a.name || '').localeCompare(b.name || '', 'it')).map((tpl) => (
                  <tr key={tpl.id}>
                    <td>
                      <div style={{ fontWeight: 600, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 10 }}>
                        <span style={{ display: 'inline-block', width: 14, height: 14, borderRadius: '50%', background: tpl.default_color || '#3b82f6', border: '1px solid var(--border-default)', flexShrink: 0 }} />
                        <span>{tpl.name}</span>
                      </div>
                    </td>
                    <td>
                      <span className="badge" style={{ background: DEPT_COLORS[tpl.department] ? `${DEPT_COLORS[tpl.department]}20` : 'var(--bg-tertiary)', color: DEPT_COLORS[tpl.department] || 'var(--text-secondary)', border: `1px solid ${DEPT_COLORS[tpl.department] || 'var(--border)'}40` }}>
                        {DEPT_LABELS[tpl.department] || (tpl.department === 'tutti' ? '⚙️ Condivisa / Tutti' : tpl.department)}
                      </span>
                    </td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontFamily: 'monospace', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                        <span style={{ display: 'inline-block', width: 22, height: 22, borderRadius: 6, background: tpl.default_color || '#3b82f6', border: '1px solid var(--border-default)' }} />
                        {tpl.default_color || '#3b82f6'}
                      </div>
                    </td>
                    <td>
                      <span className={`badge ${tpl.is_custom ? 'badge-archived' : 'badge-active'}`}>
                        {tpl.is_custom ? 'Personalizzata' : 'Predefinita'}
                      </span>
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button
                          className="btn btn-sm btn-secondary"
                          style={{ padding: '4px 8px' }}
                          onClick={() => openEditTemplate(tpl)}
                          title="Modifica nome, reparto o colore"
                        >
                          ✏️
                        </button>
                        <button
                          className="btn btn-sm btn-ghost"
                          style={{ color: 'var(--danger)', padding: '4px 8px' }}
                          onClick={() => handleDeleteTemplate(tpl)}
                          title="Elimina fase preimpostata"
                        >
                          🗑️
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* MODALE AGGIUNTA/MODIFICA TEMPLATE */}
      {showAddTemplateModal && (
        <div className="modal-overlay animate-fadeIn" onClick={() => setShowAddTemplateModal(false)}>
          <div className="modal" style={{ maxWidth: 500, background: 'var(--bg-secondary)', border: '1px solid var(--border-default)', boxShadow: 'var(--shadow-xl)' }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{editingTemplate ? 'Modifica Fase Preimpostata' : 'Nuova Fase Preimpostata'}</h2>
              <button className="btn-icon" type="button" onClick={() => setShowAddTemplateModal(false)}>×</button>
            </div>
            <form onSubmit={handleSaveTemplate}>
              <div className="modal-body">
                <div className="input-group">
                  <label>Nome Fase di Lavorazione *</label>
                  <input
                    className="input"
                    value={templateForm.name}
                    onChange={(e) => setTemplateForm({ ...templateForm, name: e.target.value })}
                    required
                    placeholder="es. Progettazione elettrica avanzata"
                  />
                </div>

                <div className="input-group" style={{ marginTop: 14 }}>
                  <label>Reparto di Assegnazione *</label>
                  <select
                    className="input"
                    value={templateForm.department}
                    onChange={(e) => setTemplateForm({ ...templateForm, department: e.target.value })}
                  >
                    <option value="ufficio_tecnico">🔧 Ufficio Tecnico</option>
                    <option value="produzione">🏭 Produzione</option>
                    <option value="acquisti">🛒 Acquisti</option>
                    <option value="tutti">⚙️ Condivisa per tutti i reparti</option>
                  </select>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 4, display: 'block' }}>
                    Questa fase comparirà nel menu a tendina di tutti gli addetti del reparto selezionato.
                  </span>
                </div>

                <div className="input-group" style={{ marginTop: 14 }}>
                  <label>Colore Predefinito sul Gantt</label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 4 }}>
                    <input
                      type="color"
                      value={templateForm.default_color || '#3b82f6'}
                      onChange={(e) => setTemplateForm({ ...templateForm, default_color: e.target.value })}
                      style={{ width: 44, height: 38, padding: 2, border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)', cursor: 'pointer', background: 'var(--bg-tertiary)' }}
                    />
                    <input
                      type="text"
                      className="input"
                      value={templateForm.default_color || '#3b82f6'}
                      onChange={(e) => setTemplateForm({ ...templateForm, default_color: e.target.value })}
                      style={{ width: 110, fontFamily: 'monospace' }}
                      placeholder="#3b82f6"
                    />
                  </div>
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setShowAddTemplateModal(false)}>
                  Annulla
                </button>
                <button type="submit" className="btn btn-primary">
                  {editingTemplate ? 'Salva Modifiche' : 'Aggiungi Fase'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}
