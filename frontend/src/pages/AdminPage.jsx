import { useState, useEffect } from 'react';
import api from '../api/client';
import { useToast } from '../context/ToastContext';
import AppIcon from '../components/ui/AppIcon';
import './AdminPage.css';

const DEPT_LABELS = {
  ufficio_tecnico: 'Ufficio Tecnico',
  produzione: 'Produzione',
  acquisti: 'Acquisti',
  admin: 'Admin',
  condivisa: 'Condivisa tra più reparti',
};
const DEPT_COLORS = {
  ufficio_tecnico: '#3b82f6',
  produzione: '#10b981',
  acquisti: '#f59e0b',
  admin: '#8b5cf6',
  condivisa: '#8b5cf6',
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
    default_days: '',
    default_hours: '',
  });
  const [globalBannerForm, setGlobalBannerForm] = useState({ text: '', type: 'info', duration_hours: 24, isManualDate: false, manualDate: '' });
  const [globalBanners, setGlobalBanners] = useState([]);
  const [ticketPhases, setTicketPhases] = useState([]);
  const [newTicketPhase, setNewTicketPhase] = useState('');
  const [lastBackup, setLastBackup] = useState(null);
  const [emailLogs, setEmailLogs] = useState([]);
  const [scheduledEmails, setScheduledEmails] = useState([]);
  const [emailLogTab, setEmailLogTab] = useState('sent'); // 'sent' | 'scheduled'
  const [loading, setLoading] = useState(true);
  const [todoEmailSettings, setTodoEmailSettings] = useState({ todo_notification_email: '' });
  const [smtpSettings, setSmtpSettings] = useState(null);
  const [savingEmailSettings, setSavingEmailSettings] = useState(false);
  // STATO PER COLONNE TABELLA ADMIN
  const [adminVisibleColumns, setAdminVisibleColumns] = useState(() => {
    const saved = localStorage.getItem('adminVisibleColumns');
    return saved ? JSON.parse(saved) : ['utente', 'email', 'ruolo', 'reparto', 'stato', 'registrato', 'azioni'];
  });
  const [showAdminColumnsMenu, setShowAdminColumnsMenu] = useState(false);
  const [managingUser, setManagingUser] = useState(null);
  const [newPassword, setNewPassword] = useState('');
  
  const [showAddUserModal, setShowAddUserModal] = useState(false);
  const [newUserForm, setNewUserForm] = useState({
    username: '',
    email: '',
    full_name: '',
    password: '',
    role: 'viewer',
    department: 'ufficio_tecnico'
  });

  const [collapsedSections, setCollapsedSections] = useState({
    annunci: true,
    users: true,
    templates: true,
    ticketPhases: true,
    todoEmail: true,
    emails: true,
    backup: true
  });

  const toggleSection = (section) => {
    setCollapsedSections(prev => ({ ...prev, [section]: !prev[section] }));
  };

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

  async function handleCreateUser(e) {
    e.preventDefault();
    try {
      await api.post('/auth/register', newUserForm);
      toast.success('Utente creato con successo!');
      setShowAddUserModal(false);
      setNewUserForm({
        username: '',
        email: '',
        full_name: '',
        password: '',
        role: 'viewer',
        department: 'ufficio_tecnico'
      });
      loadUsers();
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Errore durante la creazione utente');
    }
  }

  async function loadData() {
    setLoading(true);
    try {
      await Promise.all([loadUsers(), loadPhaseTemplates(), loadGlobalBanners(), loadTicketPhases(), loadLastBackup(), loadEmailLogs(), loadTodoEmailSettings()]);
    } finally {
      setLoading(false);
    }
  }

  async function loadTodoEmailSettings() {
    try {
      const [{ data: emailSettings }, { data: smtp }] = await Promise.all([
        api.get('/settings/todo-email-settings'),
        api.get('/settings/smtp-settings'),
      ]);
      setTodoEmailSettings(emailSettings);
      setSmtpSettings(smtp);
    } catch (e) {
      console.error('Errore caricamento impostazioni email TODO:', e);
    }
  }

  async function saveTodoEmailSettings(e) {
    e.preventDefault();
    setSavingEmailSettings(true);
    try {
      const { data } = await api.put('/settings/todo-email-settings', todoEmailSettings);
      setTodoEmailSettings(data);
      toast.success('Impostazioni email TODO salvate');
    } catch {
      toast.error('Errore nel salvataggio delle impostazioni email');
    } finally {
      setSavingEmailSettings(false);
    }
  }

  async function loadGlobalBanners() {
    try {
      const { data } = await api.get('/settings/global-banner');
      setGlobalBanners(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error(e);
    }
  }

  async function loadLastBackup() {
    try {
      const { data } = await api.get('/settings/backup/status');
      setLastBackup(data.last_backup);
    } catch (e) {
      console.error('Errore caricamento stato backup:', e);
    }
  }

  async function loadEmailLogs() {
    try {
      const [{ data: logs }, { data: sched }] = await Promise.all([
        api.get('/admin/email-logs'),
        api.get('/admin/email-logs/scheduled')
      ]);
      setEmailLogs(Array.isArray(logs) ? logs : []);
      setScheduledEmails(Array.isArray(sched) ? sched : []);
    } catch (e) {
      console.error(e);
    }
  }

  async function handleTriggerBackup() {
    try {
      toast.info('Avvio backup in corso...');
      const { data } = await api.post('/settings/backup/trigger');
      toast.success(data.message || 'Backup completato');
      if (data.last_backup) setLastBackup(data.last_backup);
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Errore durante il backup');
    }
  }


  async function deleteScheduledEmail(todoId) {
    if (!window.confirm("Sei sicuro di voler annullare questa notifica programmata?")) return;
    try {
      await api.delete(`/admin/email-logs/scheduled/${todoId}`);
      toast.success('Notifica annullata');
      await loadEmailLogs();
    } catch {
      toast.error('Errore durante l\'annullamento della notifica');
    }
  }

  async function addGlobalBanner(e) {
    e.preventDefault();
    if (!globalBannerForm.text.trim()) return;

    let hours = globalBannerForm.duration_hours;
    if (globalBannerForm.isManualDate) {
      if (!globalBannerForm.manualDate) {
        toast.error('Seleziona una data di scadenza valida');
        return;
      }
      const expDate = new Date(globalBannerForm.manualDate);
      const now = new Date();
      if (expDate <= now) {
        toast.error('La data di scadenza deve essere futura');
        return;
      }
      hours = Math.ceil((expDate.getTime() - now.getTime()) / (1000 * 60 * 60));
    }

    try {
      const payload = {
        text: globalBannerForm.text,
        type: globalBannerForm.type,
        duration_hours: hours
      };
      const res = await api.post('/settings/global-banner', payload);
      setGlobalBanners(prev => [...prev, res.data]);
      setGlobalBannerForm({ text: '', type: 'info', duration_hours: 24, isManualDate: false, manualDate: '' });
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

  async function loadTicketPhases() {
    try {
      const res = await api.get('/settings/ticket_phases');
      setTicketPhases(res.data || []);
    } catch { /* ignore */ }
  }

  async function saveTicketPhases(phasesToSave) {
    try {
      const res = await api.put('/settings/ticket_phases', { phases: phasesToSave });
      setTicketPhases(res.data);
      toast.success('Fasi ticket aggiornate');
    } catch {
      toast.error('Errore aggiornamento fasi ticket');
    }
  }

  function handleAddTicketPhase() {
    if (!newTicketPhase.trim()) return;
    const nextPhases = [...ticketPhases, newTicketPhase.trim()];
    setNewTicketPhase('');
    saveTicketPhases(nextPhases);
  }

  function handleRemoveTicketPhase(index) {
    if (!window.confirm("Eliminare questa fase?")) return;
    const nextPhases = ticketPhases.filter((_, i) => i !== index);
    saveTicketPhases(nextPhases);
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
      const payload = {
        ...templateForm,
        default_days: templateForm.default_days !== '' ? Number(templateForm.default_days) : null,
        default_hours: templateForm.default_hours !== '' ? Number(templateForm.default_hours) : null,
      };

      if (editingTemplate) {
        await api.put(`/phase-templates/${editingTemplate.id}`, payload);
        toast.success('Fase preimpostata modificata con successo');
      } else {
        await api.post('/phase-templates', { ...payload, is_custom: true });
        toast.success('Nuova fase preimpostata aggiunta con successo');
      }
      setShowAddTemplateModal(false);
      setEditingTemplate(null);
      setTemplateForm({ name: '', department: 'ufficio_tecnico', default_color: '#3b82f6', default_days: '', default_hours: '' });
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
      default_days: tpl.default_days != null ? tpl.default_days : '',
      default_hours: tpl.default_hours != null ? tpl.default_hours : '',
    });
    setShowAddTemplateModal(true);
  }

  function openNewTemplate() {
    setEditingTemplate(null);
    setTemplateForm({
      name: '',
      department: filterDept !== 'all' ? filterDept : 'ufficio_tecnico',
      default_color: DEPT_COLORS[filterDept] || '#3b82f6',
      default_days: '',
      default_hours: '',
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
      if (managingUser?.id === user.id) setManagingUser(null);
      loadUsers();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Errore durante l'eliminazione dell'utente");
    }
  }

  async function handleResetPassword(e) {
    e.preventDefault();
    if (newPassword.length < 6) {
      toast.error("La password deve essere di almeno 6 caratteri");
      return;
    }
    if (!window.confirm(`Confermi di voler reimpostare la password per '${managingUser.username}'?`)) return;
    try {
      await api.post(`/users/${managingUser.id}/reset-password`, { new_password: newPassword });
      toast.success("Password reimpostata con successo");
      setNewPassword('');
    } catch (err) {
      toast.error(err.response?.data?.detail || "Errore durante il reset della password");
    }
  }


  if (loading) return <div className="loading-screen"><div className="spinner" /></div>;

  return (
    <div className="admin-page animate-fadeIn">

      {/* SEZIONE BACHECA AZIENDALE */}
      <div className={`admin-section-card ${collapsedSections.annunci ? 'is-collapsed' : ''}`} style={{ marginBottom: 30 }}>
        <div className="admin-section-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16 }}>
          <div style={{ cursor: 'pointer', flex: 1 }} onClick={() => toggleSection('annunci')}>
            <h2><AppIcon name="megaphone" /> Annunci</h2>
            <p className="admin-section-desc">Annunci in evidenza che appariranno a tutti gli utenti in cima alla Dashboard.</p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 4 }}>
            <div style={{ cursor: 'pointer', color: 'var(--text-muted)' }} onClick={() => toggleSection('annunci')}>
              <AppIcon name={collapsedSections.annunci ? 'chevronDown' : 'chevronUp'} size={18} />
            </div>
          </div>
        </div>
        {!collapsedSections.annunci && (
          <div className="admin-section-content">
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
                  <option value="info">Info</option>
                  <option value="warning">Avviso</option>
                  <option value="success">Successo</option>
                  <option value="error">Urgente</option>
                </select>
              </div>
              <div className="input-group" style={{ width: 140, marginBottom: 0 }}>
                <select
                  className="input"
                  value={globalBannerForm.isManualDate ? 'manual' : globalBannerForm.duration_hours}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (val === 'manual') {
                      setGlobalBannerForm({ ...globalBannerForm, isManualDate: true });
                    } else {
                      setGlobalBannerForm({ ...globalBannerForm, isManualDate: false, duration_hours: Number(val) });
                    }
                  }}
                >
                  <option value={12}>1/2 Giornata</option>
                  <option value={24}>1 Giorno</option>
                  <option value={48}>2 Giorni</option>
                  <option value={168}>1 Settimana</option>
                  <option value={336}>2 Settimane</option>
                  <option value={504}>3 Settimane</option>
                  <option value={720}>1 Mese</option>
                  <option value="manual">Data Manuale...</option>
                </select>
              </div>
              {globalBannerForm.isManualDate && (
                <div className="input-group" style={{ width: 200, marginBottom: 0 }}>
                  <input
                    type="datetime-local"
                    className="input"
                    value={globalBannerForm.manualDate}
                    min={new Date(new Date().getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16)}
                    onChange={(e) => setGlobalBannerForm({ ...globalBannerForm, manualDate: e.target.value })}
                  />
                </div>
              )}
              <button type="submit" className="btn btn-primary" style={{ height: 42 }}>
                Aggiungi Annuncio
              </button>
            </form>

            {globalBanners.length > 0 && (
              <div style={{ marginTop: 24, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <h4 style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Annunci Attivi</h4>
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
                        {' | '}Scadenza: {new Date(new Date(b.created_at).getTime() + (b.duration_hours || 24) * 60 * 60 * 1000).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                    <button onClick={() => deleteGlobalBanner(b.id)} className="btn btn-ghost" style={{ padding: '6px 10px', color: 'var(--text-muted)' }} title="Elimina annuncio">
                      <AppIcon name="trash" size={15} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* SEZIONE 1: UTENTI DI SISTEMA */}
      <div className={`admin-section-card ${collapsedSections.users ? 'is-collapsed' : ''}`}>
        <div className="admin-section-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16 }}>
          <div style={{ cursor: 'pointer', flex: 1 }} onClick={() => toggleSection('users')}>
            <h2><AppIcon name="users" /> Utenti di sistema</h2>
            <p className="admin-section-desc">Utenti registrati con credenziali di login per accedere al gestionale HiPlan ({users.length})</p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 4 }}>
            {!collapsedSections.users && (
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                <button
                  className="btn btn-primary btn-sm"
                  onClick={() => setShowAddUserModal(true)}
                >
                  <AppIcon name="plus" />
                  Crea Utente
                </button>
                <div style={{ position: 'relative' }}>
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => setShowAdminColumnsMenu(!showAdminColumnsMenu)}
                  >
                    <AppIcon name="columns" />
                    Colonne
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
            )}
            <div style={{ cursor: 'pointer', color: 'var(--text-muted)' }} onClick={() => toggleSection('users')}>
              <AppIcon name={collapsedSections.users ? 'chevronDown' : 'chevronUp'} size={18} />
            </div>
          </div>
        </div>

        {!collapsedSections.users && (
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
                          <option value="ufficio_tecnico">Ufficio Tecnico</option>
                          <option value="produzione">Produzione</option>
                          <option value="acquisti">Acquisti</option>
                          <option value="admin">Admin</option>
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
                        <button
                          className="btn btn-sm btn-secondary"
                          onClick={() => { setManagingUser(u); setNewPassword(''); }}
                        >
                          Gestisci
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* SEZIONE 2: FASI DI LAVORAZIONE PREIMPOSTATE */}
      <div className={`admin-section-card ${collapsedSections.templates ? 'is-collapsed' : ''}`} style={{ marginTop: 32 }}>
        <div className="admin-section-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16 }}>
          <div style={{ cursor: 'pointer', flex: 1 }} onClick={() => toggleSection('templates')}>
            <h2><AppIcon name="list" /> Fasi di lavorazione preimpostate</h2>
            <p className="admin-section-desc">
              Gestisci l'elenco delle fasi suggerite nel menu a tendina quando gli addetti creano o modificano le attività di commessa ({phaseTemplates.filter(t => filterDept === 'all' || t.department === filterDept || t.department === 'condivisa').length} visualizzate).
            </p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 4 }}>
            {!collapsedSections.templates && (
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                <select
                  className="input"
                  value={filterDept}
                  onChange={(e) => setFilterDept(e.target.value)}
                  style={{ padding: '6px 12px', fontSize: '0.85rem', fontWeight: 600 }}
                >
                  <option value="all">Tutti i reparti ({phaseTemplates.length})</option>
                  <option value="ufficio_tecnico">Ufficio Tecnico ({phaseTemplates.filter(t => t.department === 'ufficio_tecnico').length})</option>
                  <option value="produzione">Produzione ({phaseTemplates.filter(t => t.department === 'produzione').length})</option>
                  <option value="acquisti">Acquisti ({phaseTemplates.filter(t => t.department === 'acquisti').length})</option>
                  <option value="condivisa">Condivisa tra più reparti ({phaseTemplates.filter(t => t.department === 'condivisa').length})</option>
                </select>
                <button
                  className="btn btn-primary btn-sm"
                  onClick={openNewTemplate}
                  style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                >
                  <span>+</span> Nuova Fase Preimpostata
                </button>
              </div>
            )}
            <div style={{ cursor: 'pointer', color: 'var(--text-muted)' }} onClick={() => toggleSection('templates')}>
              <AppIcon name={collapsedSections.templates ? 'chevronDown' : 'chevronUp'} size={18} />
            </div>
          </div>
        </div>

        {!collapsedSections.templates && (
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
                {phaseTemplates.filter(t => filterDept === 'all' || t.department === filterDept || t.department === 'condivisa').length === 0 ? (
                  <tr>
                    <td colSpan={5} style={{ textAlign: 'center', padding: '30px 10px', color: 'var(--text-muted)' }}>
                      Nessuna fase preimpostata per il filtro selezionato.
                    </td>
                  </tr>
                ) : (
                  phaseTemplates.filter(t => filterDept === 'all' || t.department === filterDept || t.department === 'condivisa').sort((a, b) => (a.name || '').localeCompare(b.name || '', 'it')).map((tpl) => (
                    <tr key={tpl.id}>
                      <td>
                        <div style={{ fontWeight: 600, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 10 }}>
                          <span style={{ display: 'inline-block', width: 14, height: 14, borderRadius: '50%', background: tpl.default_color || '#3b82f6', border: '1px solid var(--border-default)', flexShrink: 0 }} />
                          <span>{tpl.name}</span>
                        </div>
                      </td>
                      <td>
                        <span className="badge" style={{ background: DEPT_COLORS[tpl.department] ? `${DEPT_COLORS[tpl.department]}20` : 'var(--bg-tertiary)', color: DEPT_COLORS[tpl.department] || 'var(--text-secondary)', border: `1px solid ${DEPT_COLORS[tpl.department] || 'var(--border)'}40` }}>
                          {DEPT_LABELS[tpl.department] || (tpl.department === 'condivisa' ? 'Condivisa tra più reparti' : tpl.department)}
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
                            className="btn btn-secondary btn-icon"
                            onClick={() => openEditTemplate(tpl)}
                            title="Modifica nome, reparto o colore"
                            aria-label="Modifica fase preimpostata"
                          >
                            <AppIcon name="edit" size={15} />
                          </button>
                          <button
                            className="btn btn-ghost btn-icon"
                            style={{ color: 'var(--danger)' }}
                            onClick={() => handleDeleteTemplate(tpl)}
                            title="Elimina fase preimpostata"
                            aria-label="Elimina fase preimpostata"
                          >
                            <AppIcon name="trash" size={15} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* SEZIONE 3: FASI TICKET */}
      <div className={`admin-section-card ${collapsedSections.ticketPhases ? 'is-collapsed' : ''}`} style={{ marginTop: 32 }}>
        <div className="admin-section-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16 }}>
          <div style={{ cursor: 'pointer', flex: 1 }} onClick={() => toggleSection('ticketPhases')}>
            <h2><AppIcon name="ticket" /> Fasi ticket</h2>
            <p className="admin-section-desc">
              Personalizza l'elenco delle fasi o eventi selezionabili quando si risponde a un ticket (es. "Inviato al cliente", "In lavorazione").
            </p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 4 }}>
            <div style={{ cursor: 'pointer', color: 'var(--text-muted)' }} onClick={() => toggleSection('ticketPhases')}>
              <AppIcon name={collapsedSections.ticketPhases ? 'chevronDown' : 'chevronUp'} size={18} />
            </div>
          </div>
        </div>
        {!collapsedSections.ticketPhases && (
          <div style={{ maxWidth: '100%' }}>
            <div className="ticket-phases-list" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12, marginBottom: 12 }}>
              {ticketPhases.map((phase, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--bg-tertiary)', padding: '6px 12px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)' }}>
                  <span style={{ fontSize: '0.75rem', fontWeight: 500 }}>{phase}</span>
                  <button
                    className="btn-icon"
                    onClick={() => handleRemoveTicketPhase(i)}
                    style={{ color: 'var(--danger)', opacity: 0.7 }}
                    title="Elimina fase ticket"
                  >
                    <AppIcon name="trash" size={15} />
                  </button>
                </div>
              ))}
              {ticketPhases.length === 0 && (
                <div style={{ padding: 12, color: 'var(--text-muted)', fontSize: '0.9rem', gridColumn: '1 / -1' }}>
                  Nessuna fase personalizzata impostata.
                </div>
              )}
            </div>
            <div style={{ display: 'flex', gap: 12, maxWidth: 800 }}>
              <input
                className="input"
                style={{ flex: 1 }}
                placeholder="Es: Risposta dal cliente"
                value={newTicketPhase}
                onChange={e => setNewTicketPhase(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleAddTicketPhase(); }}
              />
              <button className="btn btn-primary" onClick={handleAddTicketPhase}>
                Aggiungi Fase
              </button>
            </div>
          </div>
        )}
      </div>

      {/* SEZIONE LOG EMAIL */}
      <div className={`admin-section-card ${collapsedSections.emails ? 'is-collapsed' : ''}`} style={{ marginTop: 32, marginBottom: 30 }}>
        <div className="admin-section-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16 }}>
          <div style={{ cursor: 'pointer', flex: 1 }} onClick={() => toggleSection('emails')}>
            <h2><AppIcon name="mail" /> Notifiche email</h2>
            <p className="admin-section-desc">Cronologia delle comunicazioni e riepilogo degli invii futuri.</p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 4 }}>
            {!collapsedSections.emails && (
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                <div className="tabs" style={{ display: 'flex', gap: 8 }}>
                  <button
                    className={`btn btn-sm ${emailLogTab === 'sent' ? 'btn-primary' : 'btn-ghost'}`}
                    onClick={() => setEmailLogTab('sent')}
                  >
                    Inviate ({emailLogs.length})
                  </button>
                  <button
                    className={`btn btn-sm ${emailLogTab === 'scheduled' ? 'btn-primary' : 'btn-ghost'}`}
                    onClick={() => setEmailLogTab('scheduled')}
                  >
                    Programmate ({scheduledEmails.length})
                  </button>
                </div>
              </div>
            )}
            <div style={{ cursor: 'pointer', color: 'var(--text-muted)' }} onClick={() => toggleSection('emails')}>
              <AppIcon name={collapsedSections.emails ? 'chevronDown' : 'chevronUp'} size={18} />
            </div>
          </div>
        </div>

        {!collapsedSections.emails && (
          <div className="table-wrapper" style={{ maxHeight: 520, overflowY: 'auto' }}>
            {emailLogTab === 'sent' ? (
              <table className="table">
                <thead>
                  <tr>
                    <th>Data</th>
                    <th>Destinatario</th>
                    <th>Oggetto</th>
                    <th>Stato</th>
                    <th>Errore</th>
                  </tr>
                </thead>
                <tbody>
                  {emailLogs.length === 0 ? (
                    <tr>
                      <td colSpan="5" style={{ textAlign: 'center', padding: 20, color: 'var(--text-muted)' }}>
                        Nessuna email inviata di recente.
                      </td>
                    </tr>
                  ) : (
                    emailLogs.map(log => (
                      <tr key={log.id}>
                        <td style={{ whiteSpace: 'nowrap' }}>{new Date(log.created_at).toLocaleString()}</td>
                        <td>{log.recipient}</td>
                        <td>{log.subject}</td>
                        <td>
                          {log.status === 'success' ? (
                            <span className="badge badge-success">Inviata</span>
                          ) : (
                            <span className="badge badge-error">Errore</span>
                          )}
                        </td>
                        <td style={{ color: 'var(--danger)', fontSize: '0.85rem' }}>
                          {log.error_message || '-'}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>Data Prevista</th>
                    <th>Tipo Promemoria</th>
                    <th>Oggetto</th>
                    <th>Destinatari</th>
                    <th style={{ width: 80, textAlign: 'center' }}>Azioni</th>
                  </tr>
                </thead>
                <tbody>
                  {scheduledEmails.length === 0 ? (
                    <tr>
                      <td colSpan="4" style={{ textAlign: 'center', padding: 20, color: 'var(--text-muted)' }}>
                        Nessuna email programmata.
                      </td>
                    </tr>
                  ) : (
                    scheduledEmails.map((log, index) => (
                      <tr key={index}>
                        <td style={{ whiteSpace: 'nowrap' }}>{new Date(log.date).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}</td>
                        <td><span className="badge badge-warning">{log.type}</span></td>
                        <td>{log.subject}</td>
                        <td>{log.recipients}</td>
                        <td style={{ textAlign: 'center' }}>
                          <button
                            className="btn btn-sm btn-ghost"
                            title="Annulla notifica"
                            onClick={() => deleteScheduledEmail(log.id)}
                            style={{ color: 'var(--danger)', padding: '4px 8px' }}
                            aria-label="Annulla notifica"
                          >
                            <AppIcon name="close" size={14} />
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>

      {/* SEZIONE BACKUP */}
      <div className={`admin-section-card ${collapsedSections.backup ? 'is-collapsed' : ''}`} style={{ marginTop: 32, marginBottom: 30 }}>
        <div className="admin-section-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16 }}>
          <div style={{ cursor: 'pointer', flex: 1 }} onClick={() => toggleSection('backup')}>
            <h2><AppIcon name="save" /> Backup di Sistema</h2>
            <p className="admin-section-desc">Stato del salvataggio dati e archivi ZIP generati.</p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 4 }}>
            {!collapsedSections.backup && (
              <button className="btn btn-primary btn-sm" onClick={handleTriggerBackup}>
                <AppIcon name="refresh" size={14} /> Esegui Ora
              </button>
            )}
            <div style={{ cursor: 'pointer', color: 'var(--text-muted)' }} onClick={() => toggleSection('backup')}>
              <AppIcon name={collapsedSections.backup ? 'chevronDown' : 'chevronUp'} size={18} />
            </div>
          </div>
        </div>

        {!collapsedSections.backup && (
          <div style={{ padding: '16px 20px', background: 'var(--bg-tertiary)', borderRadius: 8, marginTop: 16 }}>
            {lastBackup ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 14 }}>
                <div><strong>Ultimo backup completato:</strong> {new Date(lastBackup.date).toLocaleString()}</div>
                <div><strong>Dimensione archivio:</strong> {lastBackup.size_mb} MB</div>
                <div><strong>File:</strong> <code>{lastBackup.filename}</code></div>
                <div style={{ marginTop: 8, fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                  Il backup settimanale viene eseguito automaticamente ogni domenica notte. Include il database completo e tutti gli allegati.
                </div>
              </div>
            ) : (
              <div style={{ color: 'var(--text-muted)' }}>Nessun backup trovato nel sistema.</div>
            )}
          </div>
        )}
      </div>

      {/* MODALE AGGIUNTA/MODIFICA TEMPLATE */}
      {showAddTemplateModal && (
        <div className="modal-overlay animate-fadeIn">
          <div className="modal" style={{ maxWidth: 650, background: 'var(--bg-secondary)', border: '1px solid var(--border-default)', boxShadow: 'var(--shadow-xl)' }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{editingTemplate ? 'Modifica Fase Preimpostata' : 'Nuova Fase Preimpostata'}</h2>
              <button className="btn-ghost btn-icon" type="button" onClick={() => setShowAddTemplateModal(false)} aria-label="Chiudi">
                <AppIcon name="close" />
              </button>
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
                    <option value="ufficio_tecnico">Ufficio Tecnico</option>
                    <option value="produzione">Produzione</option>
                    <option value="acquisti">Acquisti</option>
                    <option value="condivisa">Condivisa tra più reparti</option>
                  </select>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 4, display: 'block' }}>
                    Questa fase comparirà nel menu a tendina di tutti gli addetti del reparto selezionato.
                  </span>
                </div>

                <div style={{ display: 'flex', gap: 16, marginTop: 14 }}>
                  <div className="input-group" style={{ flex: 1 }}>
                    <label>Giorni Lavorativi Previsti</label>
                    <input
                      type="number"
                      step="1"
                      min="0"
                      className="input"
                      value={templateForm.default_days}
                      onChange={(e) => setTemplateForm({ ...templateForm, default_days: e.target.value })}
                      placeholder="es. 3"
                    />
                  </div>
                  <div className="input-group" style={{ flex: 1 }}>
                    <label>Ore Previste</label>
                    <input
                      type="number"
                      step="0.5"
                      min="0"
                      className="input"
                      value={templateForm.default_hours}
                      onChange={(e) => setTemplateForm({ ...templateForm, default_hours: e.target.value })}
                      placeholder="es. 24"
                    />
                  </div>
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
      {/* MODAL CREAZIONE UTENTE */}
      {showAddUserModal && (
        <div className="modal-overlay animate-fadeIn">
          <div className="modal" style={{ maxWidth: 500, background: 'var(--bg-secondary)', border: '1px solid var(--border-default)', boxShadow: 'var(--shadow-xl)' }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Crea Nuovo Utente</h2>
              <button className="btn-ghost btn-icon" type="button" onClick={() => setShowAddUserModal(false)} aria-label="Chiudi">
                <AppIcon name="close" />
              </button>
            </div>
            <form onSubmit={handleCreateUser}>
              <div className="modal-body">
                <div className="input-group">
                  <label>Nome Utente (Username) *</label>
                  <input
                    className="input"
                    value={newUserForm.username}
                    onChange={(e) => setNewUserForm({ ...newUserForm, username: e.target.value })}
                    required
                    placeholder="es. mario.rossi"
                  />
                </div>
                
                <div className="input-group" style={{ marginTop: 14 }}>
                  <label>Email *</label>
                  <input
                    type="email"
                    className="input"
                    value={newUserForm.email}
                    onChange={(e) => setNewUserForm({ ...newUserForm, email: e.target.value })}
                    required
                    placeholder="es. mario@example.com"
                  />
                </div>

                <div className="input-group" style={{ marginTop: 14 }}>
                  <label>Nome Completo</label>
                  <input
                    className="input"
                    value={newUserForm.full_name}
                    onChange={(e) => setNewUserForm({ ...newUserForm, full_name: e.target.value })}
                    placeholder="es. Mario Rossi"
                  />
                </div>

                <div className="input-group" style={{ marginTop: 14 }}>
                  <label>Password *</label>
                  <input
                    type="password"
                    className="input"
                    value={newUserForm.password}
                    onChange={(e) => setNewUserForm({ ...newUserForm, password: e.target.value })}
                    required
                    placeholder="Scegli una password"
                  />
                </div>

                <div style={{ display: 'flex', gap: 16, marginTop: 14 }}>
                  <div className="input-group" style={{ flex: 1 }}>
                    <label>Ruolo *</label>
                    <select
                      className="input"
                      value={newUserForm.role}
                      onChange={(e) => setNewUserForm({ ...newUserForm, role: e.target.value })}
                      required
                    >
                      <option value="viewer">Viewer (Solo lettura)</option>
                      <option value="editor">Editor (Lettura/Scrittura parziale)</option>
                      <option value="admin">Admin (Completo)</option>
                    </select>
                  </div>
                  
                  <div className="input-group" style={{ flex: 1 }}>
                    <label>Reparto *</label>
                    <select
                      className="input"
                      value={newUserForm.department}
                      onChange={(e) => setNewUserForm({ ...newUserForm, department: e.target.value })}
                      required
                    >
                      <option value="ufficio_tecnico">Ufficio Tecnico</option>
                      <option value="produzione">Produzione</option>
                      <option value="acquisti">Acquisti</option>
                      <option value="admin">Admin</option>
                    </select>
                  </div>
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setShowAddUserModal(false)}>
                  Annulla
                </button>
                <button type="submit" className="btn btn-primary">
                  Crea Utente
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL GESTIONE UTENTE */}
      {managingUser && (
        <div className="modal-overlay">
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 450 }}>
            <div className="modal-header">
              <h2>Azioni per @{managingUser.username}</h2>
              <button className="btn-ghost btn-icon" onClick={() => setManagingUser(null)} aria-label="Chiudi">
                <AppIcon name="close" />
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
              <form onSubmit={handleResetPassword} style={{ background: 'var(--bg-tertiary)', padding: 16, borderRadius: 8 }}>
                <h4 className="inline-heading" style={{ marginBottom: 12 }}><AppIcon name="lock" size={16} />Modifica password</h4>
                <div className="input-group" style={{ marginBottom: 12 }}>
                  <input
                    type="text"
                    className="input"
                    value={newPassword}
                    onChange={e => setNewPassword(e.target.value)}
                    placeholder="Nuova password..."
                  />
                </div>
                <button type="submit" className="btn btn-primary btn-sm">Salva Password</button>
              </form>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <h4 className="inline-heading"><AppIcon name="settings" size={16} /> Altre azioni</h4>
                <button
                  className={`btn ${managingUser.is_active ? 'btn-secondary' : 'btn-primary'}`}
                  style={{ justifyContent: 'center' }}
                  onClick={() => { handleToggleActive(managingUser.id, managingUser.is_active); setManagingUser(null); }}
                >
                  {managingUser.is_active ? 'Disattiva account' : 'Attiva account'}
                </button>

                {managingUser.username !== 'admin' && (
                  <button
                    className="btn btn-danger"
                    style={{ justifyContent: 'center' }}
                    onClick={() => handleDeleteUser(managingUser)}
                  >
                    <AppIcon name="trash" />
                    Elimina definitivamente
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
