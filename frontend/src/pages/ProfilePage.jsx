import { useState, useEffect } from 'react';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import AppIcon from '../components/ui/AppIcon';
import './ProfilePage.css';

export default function ProfilePage() {
  const { user, fetchUser } = useAuth();
  const toast = useToast();
  const [vacations, setVacations] = useState([]);
  const [recoveryItems, setRecoveryItems] = useState([]);
  const [dismissedKeys, setDismissedKeys] = useState(
    () => new Set(JSON.parse(localStorage.getItem('recovery_dismissed') || '[]'))
  );
  const [form, setForm] = useState({ start_date: '', end_date: '', reason: '' });
  const [showEditModal, setShowEditModal] = useState(false);
  const [editForm, setEditForm] = useState({ full_name: '', username: '' });

  function openEditModal() {
    setEditForm({ full_name: user?.full_name || '', username: user?.username || '' });
    setShowEditModal(true);
  }

  async function handleSaveProfile(e) {
    e.preventDefault();
    if (!editForm.username.trim()) {
      toast.error('Lo username è obbligatorio');
      return;
    }
    try {
      await api.patch('/users/me', {
        full_name: editForm.full_name.trim() || null,
        username: editForm.username.trim()
      });
      toast.success('Profilo aggiornato con successo!');
      setShowEditModal(false);
      await fetchUser();
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Errore aggiornamento profilo');
    }
  }

  useEffect(() => {
    console.log('🔄 ProfilePage mounted, loading vacations...');
    loadVacations();
    loadRecovery();
  }, []);

  async function loadVacations() {
    try {
      const { data } = await api.get('/vacations/me');
      console.log('✓ Vacations loaded:', data);
      setVacations(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error('Errore caricamento ferie:', e);
    }
  }

  async function loadRecovery() {
    try {
      const { data } = await api.get('/vacations/me/recovery');
      setRecoveryItems(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error('Errore caricamento ore da recuperare:', e);
    }
  }

  function getRecoveryKey(item) {
    return `${item.task_id}_${item.vacation_start}`;
  }

  function dismissRecoveryItem(item) {
    const key = getRecoveryKey(item);
    setDismissedKeys(prev => {
      const next = new Set(prev);
      next.add(key);
      localStorage.setItem('recovery_dismissed', JSON.stringify([...next]));
      return next;
    });
    toast.success('Voce rimossa dalla lista.');
  }

  async function handleCreate(e) {
    e.preventDefault();

    // Validazione date
    if (!form.start_date || !form.end_date) {
      toast.error('Inserisci sia la data di inizio che di fine');
      return;
    }

    const start = new Date(form.start_date);
    const end = new Date(form.end_date);

    if (start > end) {
      toast.error('La data di inizio deve essere prima della data di fine');
      return;
    }

    try {
      const response = await api.post('/vacations/me', form);
      console.log('✓ Vacation created:', response.data);
      toast.success('Ferie create');
      if (response.data.recovery_items?.length > 0) {
        toast.warning(`⚠️ ${response.data.recovery_items.length} fase/i con ore da recuperare rilevate.`);
      }
      setForm({ start_date: '', end_date: '', reason: '' });
      await new Promise(resolve => setTimeout(resolve, 300));
      await loadVacations();
      await loadRecovery();
    } catch (err) {
      console.error('Errore creazione ferie:', err.response?.data);
      toast.error(err.response?.data?.detail || 'Errore creazione ferie');
    }
  }

  async function handleDelete(id) {
    if (!window.confirm('Eliminare queste ferie?')) return;
    try {
      await api.delete(`/vacations/me/${id}`);
      toast.success('Ferie rimosse');
      await new Promise(resolve => setTimeout(resolve, 300));
      await loadVacations();
    } catch (error) {
      console.error('Errore rimozione ferie:', error);
      toast.error('Errore rimozione ferie');
    }
  }

  const totalVacationDays = vacations.reduce((acc, v) => {
    if (v.start_date && v.end_date) {
      const start = new Date(v.start_date);
      const end = new Date(v.end_date);
      let count = 0;
      let current = new Date(start);
      while (current <= end) {
        if (current.getDay() !== 0 && current.getDay() !== 6) count++;
        current.setDate(current.getDate() + 1);
      }
      return acc + count;
    }
    return acc;
  }, 0);

  return (
    <div className="profile-page">
      <div className="page-action-bar">
        <span className="page-context-note">Dati personali e disponibilità</span>
        <button className="btn btn-secondary" onClick={openEditModal}>
          <AppIcon name="edit" />
          Modifica profilo
        </button>
      </div>

      {/* Card statistiche utente */}
      <div className="profile-stats-grid">
        <div className="stat-card">
          <div className="stat-icon"><AppIcon name="user" /></div>
          <div className="stat-content">
            <div className="stat-value" style={{ fontSize: 14 }}>{user?.full_name || user?.username}</div>
            <div className="stat-label">Nome Utente</div>
          </div>
        </div>
        <div className="stat-card stat-card-email">
          <div className="stat-icon"><AppIcon name="mail" /></div>
          <div className="stat-content">
            <div className="stat-value stat-email-text" style={{ fontSize: 14 }}>{user?.email}</div>
            <div className="stat-label">Email</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon"><AppIcon name="settings" /></div>
          <div className="stat-content">
            <div className="stat-value" style={{ fontSize: 14 }}>{user?.role?.toUpperCase()}</div>
            <div className="stat-label">Ruolo</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon"><AppIcon name="building" /></div>
          <div className="stat-content">
            <div className="stat-value" style={{ fontSize: 14 }}>
              {user?.department === 'ufficio_tecnico' ? 'Ufficio Tecnico' :
                user?.department === 'produzione' ? 'Produzione' :
                  user?.department === 'acquisti' ? 'Acquisti' :
                    user?.department === 'admin' ? 'Admin' :
                      (user?.department || 'Nessuno')}
            </div>
            <div className="stat-label">Reparto</div>
          </div>
        </div>
      </div>

      {/* Form + Lista Ferie */}
      <div className="profile-content-grid">
        <section className="profile-card">
          <h3>Aggiungi ferie</h3>
          <form onSubmit={handleCreate} className="profile-form">
            <div className="form-group">
              <label style={{ fontSize: '12px' }}>Inizio</label>
              <input type="date" value={form.start_date} onChange={e => setForm({ ...form, start_date: e.target.value })} required />
            </div>
            <div className="form-group">
              <label style={{ fontSize: '12px' }}>Fine</label>
              <input type="date" value={form.end_date} onChange={e => setForm({ ...form, end_date: e.target.value })} required />
            </div>
            <div className="form-group">
              <label style={{ fontSize: '12px' }}>Motivo</label>
              <input type="text" placeholder="Es. Riposo" value={form.reason} onChange={e => setForm({ ...form, reason: e.target.value })} />
            </div>
            <button type="submit" className="btn-primary">✓ Aggiungi ferie</button>
          </form>
        </section>

        <section className="profile-card">
          <h3>Le tue ferie</h3>
          <div className="vacation-list">
            {vacations.length === 0 ? (
              <div className="empty-state">
                <div className="empty-icon"><span className="sidebar-link-icon"><AppIcon name="calendar" size={50} /></span></div>
                <p>Nessuna vacanza registrata</p>
              </div>
            ) : (
              vacations.map(v => {
                const start = new Date(v.start_date);
                const end = new Date(v.end_date);
                // Conta solo giorni lavorativi (lunedì-venerdì)
                let workdays = 0;
                let current = new Date(start);
                while (current <= end) {
                  if (current.getDay() !== 0 && current.getDay() !== 6) workdays++;
                  current.setDate(current.getDate() + 1);
                }
                return (
                  <div key={v.id} className="vacation-item">
                    <div className="vacation-info">
                      <div className="vacation-dates">{v.start_date} → {v.end_date}</div>
                      <div className="vacation-duration">{workdays} giorni</div>
                      <div className="vacation-reason">{v.reason || 'Nessun motivo specificato'}</div>
                    </div>
                    <button className="btn-delete" onClick={() => handleDelete(v.id)} aria-label="Elimina ferie">
                      <AppIcon name="trash" size={15} />
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </section>
      </div>

      {/* Sezione Ore da Recuperare */}
      {recoveryItems.filter(item => !dismissedKeys.has(getRecoveryKey(item))).length > 0 && (
        <div className="profile-content-grid" >
          <section className="conflict-card card" style={{ gridColumn: '1 / -1' }}>
            <h3 style={{ margin: 0, color: '#f59e0b', display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
              <AppIcon name="alert-circle" /> Ore da Recuperare per Ferie
            </h3>
            <p style={{ color: 'var(--text-secondary)', marginBottom: '16px', fontSize: '0.9rem' }}>
              Le seguenti fasi hanno ore pianificate che cadono nei tuoi giorni di ferie. Queste ore andrebbero recuperate in accordo con il tuo responsabile.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {recoveryItems
                .filter(item => !dismissedKeys.has(getRecoveryKey(item)))
                .map((item, i) => (
                  <div key={i} style={{
                    background: 'white', borderRadius: '8px', padding: '12px',
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    gap: '12px', flexWrap: 'wrap', borderLeft: '4px solid #f59e0b'
                  }}>
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 500 }}>
                        <span style={{ color: 'var(--secondary)', display: 'flex', alignItems: 'center' }}><AppIcon name="list" size={15} /></span>
                        {item.task_name}
                      </span>
                      <span style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.85rem', color: '#9ca3af' }}>
                        <AppIcon name="projects" size={14} />
                        Progetto: {item.project_code && item.project_code !== "—" ? `${item.project_code}${item.project_name && item.project_name !== item.project_code && item.project_name !== "—" ? ` - ${item.project_name}` : ''}` : item.project_name}
                      </span>
                      <span style={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }}>
                        {item.vacation_days?.length || 0} giorni lavorativi sovrapposti
                      </span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <span className="badge badge-high" style={{ fontSize: '0.95rem', background: '#f59e0b', color: '#fff', border: 'none' }}>
                        {item.hours_to_recover}h
                      </span>
                      <button
                        className="btn-delete"
                        onClick={() => dismissRecoveryItem(item)}
                        title="Segna come recuperata e rimuovi dalla lista"
                        aria-label="Segna recuperata"
                      >
                        <AppIcon name="check" size={15} />
                      </button>
                    </div>
                  </div>
                ))}
            </div>
          </section>
        </div>
      )}

      {showEditModal && (
        <div className="modal-overlay" onClick={() => setShowEditModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>👤 Modifica Profilo</h2>
              <button className="btn-ghost btn-icon" onClick={() => setShowEditModal(false)} aria-label="Chiudi">
                <AppIcon name="close" />
              </button>
            </div>
            <form onSubmit={handleSaveProfile}>
              <div className="input-group">
                <label>Nome Completo</label>
                <input
                  className="input"
                  value={editForm.full_name}
                  onChange={e => setEditForm({ ...editForm, full_name: e.target.value })}
                  placeholder="Es. Mario Rossi"
                />
              </div>
              <div className="input-group">
                <label>Username *</label>
                <input
                  className="input"
                  required
                  value={editForm.username}
                  onChange={e => setEditForm({ ...editForm, username: e.target.value })}
                  placeholder="Es. m.rossi"
                />
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setShowEditModal(false)}>Annulla</button>
                <button type="submit" className="btn btn-primary">Salva Modifiche</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
