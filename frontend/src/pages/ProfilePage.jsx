import { useState, useEffect } from 'react';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import './ProfilePage.css';

export default function ProfilePage() {
  const { user } = useAuth();
  const toast = useToast();
  const [vacations, setVacations] = useState([]);
  const [form, setForm] = useState({ start_date: '', end_date: '', reason: '' });

  useEffect(() => {
    console.log('🔄 ProfilePage mounted, loading vacations...');
    loadVacations();
  }, []);

  async function loadVacations() {
    try {
      const { data } = await api.get('/me/vacations');
      console.log('✓ Vacations loaded:', data);
      setVacations(Array.isArray(data) ? data : []);
    } catch (e) { 
      console.error('Errore caricamento ferie:', e);
    }
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
      const response = await api.post('/me/vacations', form);
      console.log('✓ Vacation created:', response.data);
      toast.success('Ferie create');
      setForm({ start_date: '', end_date: '', reason: '' });
      // Piccolo delay per assicurarsi che il server abbia elaborato
      await new Promise(resolve => setTimeout(resolve, 300));
      await loadVacations();
    } catch (err) {
      console.error('Errore creazione ferie:', err.response?.data);
      toast.error(err.response?.data?.detail || 'Errore creazione ferie');
    }
  }

  async function handleDelete(id) {
    if (!window.confirm('Eliminare queste ferie?')) return;
    try {
      await api.delete(`/me/vacations/${id}`);
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
    </div>
  );
}
