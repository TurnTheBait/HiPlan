import { useState, useEffect } from 'react';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import './ProfilePage.css';

export default function ProfilePage() {
  const { user } = useAuth();
  const toast = useToast();
  const [vacations, setVacations] = useState([]);
  const [recoveryItems, setRecoveryItems] = useState([]);
  const [dismissedKeys, setDismissedKeys] = useState(
    () => new Set(JSON.parse(localStorage.getItem('recovery_dismissed') || '[]'))
  );
  const [form, setForm] = useState({ start_date: '', end_date: '', reason: '' });

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
      <div className="profile-header">
        <div>
          <p className="page-kicker">Gestione personale</p>
          <h1>Il mio profilo</h1>
        </div>
      </div>

      {/* Card statistiche utente */}
      <div className="profile-stats-grid">
        <div className="stat-card">
          <div className="stat-icon">👤</div>
          <div className="stat-content">
            <div className="stat-value">{user?.full_name || user?.username}</div>
            <div className="stat-label">Nome Utente</div>
          </div>
        </div>
        <div className="stat-card stat-card-email">
          <div className="stat-icon">📧</div>
          <div className="stat-content">
            <div className="stat-value stat-email-text">{user?.email}</div>
            <div className="stat-label">Email</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon">🏷️</div>
          <div className="stat-content">
            <div className="stat-value">{user?.role?.toUpperCase()}</div>
            <div className="stat-label">Ruolo</div>
          </div>
        </div>
      </div>

      {/* Form + Lista Ferie */}
      <div className="profile-content-grid">
        <section className="profile-card">
          <h3>Aggiungi ferie</h3>
          <form onSubmit={handleCreate} className="profile-form">
            <div className="form-group">
              <label>Inizio</label>
              <input type="date" value={form.start_date} onChange={e => setForm({ ...form, start_date: e.target.value })} required />
            </div>
            <div className="form-group">
              <label>Fine</label>
              <input type="date" value={form.end_date} onChange={e => setForm({ ...form, end_date: e.target.value })} required />
            </div>
            <div className="form-group">
              <label>Motivo</label>
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
                <div className="empty-icon">📅</div>
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
                    <button className="btn-delete" onClick={() => handleDelete(v.id)}>✕</button>
                  </div>
                );
              })
            )}
          </div>
        </section>
      </div>

      {/* Sezione Ore da Recuperare */}
      {recoveryItems.filter(item => !dismissedKeys.has(getRecoveryKey(item))).length > 0 && (
        <div className="profile-content-grid" style={{ marginTop: 24 }}>
          <section className="profile-card" style={{ gridColumn: '1 / -1', border: '2px solid #f59e0b', background: 'rgba(245,158,11,0.07)' }}>
            <h3 style={{ color: '#d97706', display: 'flex', alignItems: 'center', gap: 8 }}>
              ⚠️ Ore da Recuperare per Ferie
            </h3>
            <p style={{ color: 'var(--text-secondary)', marginBottom: 16, fontSize: '0.9rem' }}>
              Le seguenti fasi hanno ore pianificate che cadono nei tuoi giorni di ferie. Queste ore andrebbero recuperate in accordo con il tuo responsabile.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {recoveryItems
                .filter(item => !dismissedKeys.has(getRecoveryKey(item)))
                .map((item, i) => (
                  <div key={i} style={{
                    background: 'var(--bg-secondary)', borderRadius: 10, padding: '14px 18px',
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    borderLeft: '4px solid #f59e0b', gap: 12, flexWrap: 'wrap'
                  }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 700, fontSize: '1rem' }}>📋 {item.task_name}</div>
                      <div style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>Progetto: {item.project_name}</div>
                      <div style={{ color: '#6b7280', fontSize: '0.8rem', marginTop: 4 }}>
                        Ferie: {item.vacation_start} → {item.vacation_end}
                        {' · '}{item.vacation_days?.length || 0} giorni lavorativi sovrapposti
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{
                        background: '#f59e0b', color: '#fff', borderRadius: 8, padding: '8px 16px',
                        fontWeight: 800, fontSize: '1.1rem', whiteSpace: 'nowrap'
                      }}>
                        {item.hours_to_recover}h
                      </div>
                      <button
                        onClick={() => dismissRecoveryItem(item)}
                        title="Segna come recuperata e rimuovi dalla lista"
                        style={{
                          background: 'none', border: '1.5px solid #e5e7eb', borderRadius: 8,
                          cursor: 'pointer', padding: '6px 10px', fontSize: '1rem',
                          color: '#6b7280', transition: 'all 0.15s',
                          display: 'flex', alignItems: 'center', gap: 4
                        }}
                        onMouseEnter={e => { e.currentTarget.style.borderColor='#ef4444'; e.currentTarget.style.color='#ef4444'; }}
                        onMouseLeave={e => { e.currentTarget.style.borderColor='#e5e7eb'; e.currentTarget.style.color='#6b7280'; }}
                      >
                        🗑️
                      </button>
                    </div>
                  </div>
                ))}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
