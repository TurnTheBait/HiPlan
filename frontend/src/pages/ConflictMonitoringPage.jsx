import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api/client';
import { useToast } from '../context/ToastContext';
import { useAuth } from '../context/AuthContext';
import AppIcon from '../components/ui/AppIcon';
import './ConflictMonitoringPage.css';

import WorkloadHeatmap from '../components/workload/WorkloadHeatmap';

export default function ConflictMonitoringPage() {
  const { user } = useAuth();
  const [conflicts, setConflicts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isConflictsOpen, setIsConflictsOpen] = useState(true);

  const [vacations, setVacations] = useState([]);
  const [isVacationsOpen, setIsVacationsOpen] = useState(false);
  const [editingVacation, setEditingVacation] = useState(null);
  const [deletingVacation, setDeletingVacation] = useState(null);

  const navigate = useNavigate();
  const toast = useToast();

  useEffect(() => {
    loadConflicts();
    loadVacations();
  }, []);

  async function loadVacations() {
    try {
      const { data } = await api.get('/vacations/all');
      setVacations(data);
    } catch (err) {
      toast.error('Errore durante il caricamento ferie');
    }
  }

  async function handleEditVacation(e) {
    e.preventDefault();
    try {
      await api.put(`/vacations/admin/${editingVacation.id}`, {
        start_date: editingVacation.start_date,
        end_date: editingVacation.end_date,
        reason: editingVacation.reason
      });
      toast.success('Ferie modificate con successo');
      setEditingVacation(null);
      loadVacations();
      loadConflicts();
    } catch (err) {
      toast.error('Errore durante la modifica');
    }
  }

  async function handleDeleteVacation() {
    try {
      await api.delete(`/vacations/admin/${deletingVacation.id}`);
      toast.success('Ferie eliminate con successo');
      setDeletingVacation(null);
      loadVacations();
      loadConflicts();
    } catch (err) {
      toast.error('Errore durante l\'eliminazione');
    }
  }

  async function loadConflicts() {
    try {
      setLoading(true);
      const { data } = await api.get('/users/conflicts');
      setConflicts(data);
    } catch (err) {
      toast.error('Errore durante il caricamento dei conflitti');
    } finally {
      setLoading(false);
    }
  }

  function formatDate(isoString) {
    const d = new Date(isoString);
    return d.toLocaleDateString('it-IT', { weekday: 'short', day: '2-digit', month: 'long', year: 'numeric' });
  }

  if (loading) return <div className="loading-screen"><div className="spinner" /></div>;

  return (
    <div className="conflicts-page animate-fadeIn">
      <WorkloadHeatmap />

      {/* Conflitti Collapsible Section */}
      <div style={{ background: 'var(--bg-secondary)', borderRadius: '8px', border: '1px solid var(--border-default)', marginTop: '20px', overflow: 'hidden' }}>
        <div
          className="section-heading"
          onClick={() => setIsConflictsOpen(!isConflictsOpen)}
          style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px', transition: 'background 0.2s', margin: 0 }}
        >
          <div>
            <h2 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
              <AppIcon name="alert" />
              Conflitti
            </h2>
            <p style={{ color: 'var(--text-secondary)', margin: '4px 0 0 0' }}>Dettaglio delle sovrapposizioni critiche di pianificazione sulle fasi.</p>
          </div>
          <div>{isConflictsOpen ? <AppIcon name="chevronUp" /> : <AppIcon name="chevronDown" />}</div>
        </div>

        {isConflictsOpen && (
          <div style={{ padding: '16px', borderTop: '1px solid var(--border-default)', background: 'var(--bg-primary)' }}>
          {conflicts.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon"><AppIcon name="check" size={24} /></div>
              <h3>Nessuna Sovrapposizione Trovata</h3>
              <p>Tutti gli addetti hanno una schedulazione pulita a partire da oggi.</p>
            </div>
          ) : (
            <div className="conflicts-grid" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {conflicts.map((c, idx) => (
                <div key={idx} className="conflict-card card">
                  <div className="conflict-card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                    <h3 style={{ margin: 0, color: 'var(--accent-400)', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '16px' }}>
                      <AppIcon name="user" />
                      {c.worker}
                    </h3>
                    <span className="badge badge-high" style={{ fontSize: '0.85rem' }}><AppIcon name="calendar" size={14} />{formatDate(c.date)}</span>
                  </div>
                  <p className="conflict-desc" style={{ color: 'var(--text-secondary)', marginBottom: '16px', fontSize: '0.9rem' }}>
                    Ore totali stimate: <strong>{c.total_hours}h</strong> (limite 8h superato) distribuite su <strong>{c.tasks.length}</strong> fasi:
                  </p>

                  <div className="conflict-tasks-list" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    {c.tasks.map(t => (
                      <div key={t.task_id} className="conflict-task-item" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--bg-tertiary)', padding: '12px', borderRadius: '8px', borderLeft: '4px solid #f59e0b' }}>
                        <div className="task-info" style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                          <span className="task-name" style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.85rem', fontWeight: 500 }}>
                            <span style={{ color: 'var(--secondary)', display: 'flex', alignItems: 'center' }}><AppIcon name="list" size={15} /></span>
                            {t.task_name} <span style={{ color: 'var(--accent-400)', fontSize: '0.85rem', marginLeft: '0px' }}>({t.daily_hours}h)</span>
                          </span>
                          <span className="task-project" style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.85rem', color: '#9ca3af' }}>
                            <AppIcon name="projects" size={14} />
                            Progetto: {t.project_code && t.project_code !== "—" ? `${t.project_code}${t.project_name && t.project_name !== t.project_code && t.project_name !== "—" ? ` - ${t.project_name}` : ''}` : t.project_name}
                          </span>
                        </div>
                        <button
                          className="btn btn-primary btn-sm"
                          onClick={() => navigate(`/projects/${t.project_id}`)}
                        >
                          Vai alla Commessa
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      </div>

      {/* Panoramica Ferie Collapsible Section */}
      <div style={{ background: 'var(--bg-secondary)', borderRadius: '8px', border: '1px solid var(--border-default)', marginTop: '20px', overflow: 'hidden' }}>
        <div
          className="section-heading"
          onClick={() => setIsVacationsOpen(!isVacationsOpen)}
          style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px', transition: 'background 0.2s', margin: 0 }}
        >
          <div>
            <h2 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '1.2rem' }}>🏖️</span>
              Panoramica Ferie
            </h2>
            <p style={{ color: 'var(--text-secondary)', margin: '4px 0 0 0' }}>Gestione centralizzata delle ferie inserite.</p>
          </div>
          <div>{isVacationsOpen ? <AppIcon name="chevronUp" /> : <AppIcon name="chevronDown" />}</div>
        </div>

        {isVacationsOpen && (
          <div style={{ padding: '16px', borderTop: '1px solid var(--border-default)', background: 'var(--bg-primary)' }}>
          {vacations.length === 0 ? (
            <div className="empty-state">
              <p>Nessuna ferie inserita.</p>
            </div>
          ) : (
            <div className="card" style={{ padding: '0', overflow: 'hidden' }}>
              <div style={{ overflowX: 'auto' }}>
                <table className="table" style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', minWidth: '700px' }}>
                  <thead style={{ background: 'var(--bg-tertiary)' }}>
                    <tr>
                      <th style={{ padding: '12px' }}>Addetto</th>
                      <th style={{ padding: '12px' }}>Dal</th>
                      <th style={{ padding: '12px' }}>Al</th>
                      <th style={{ padding: '12px' }}>Motivo</th>
                      {(user?.role === 'admin' || user?.role === 'editor') && <th style={{ padding: '12px', textAlign: 'right' }}>Azioni</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {vacations.sort((a, b) => b.start_date.localeCompare(a.start_date)).map(v => (
                      <tr key={v.id} style={{ borderTop: '1px solid var(--border-default)' }}>
                        <td style={{ padding: '12px', fontWeight: 600 }}>{v.full_name || v.username}</td>
                        <td style={{ padding: '12px' }}>{formatDate(v.start_date)}</td>
                        <td style={{ padding: '12px' }}>{formatDate(v.end_date)}</td>
                        <td style={{ padding: '12px', color: 'var(--text-secondary)' }}>{v.reason || '—'}</td>
                        {(user?.role === 'admin' || user?.role === 'editor') && (
                          <td style={{ padding: '12px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                            <button className="btn btn-secondary btn-sm" style={{ marginRight: '8px' }} onClick={() => setEditingVacation(v)}>✏️ Modifica</button>
                            <button className="btn btn-secondary btn-sm" style={{ color: 'var(--error-500)', borderColor: 'var(--error-500)' }} onClick={() => setDeletingVacation(v)}>🗑️ Elimina</button>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
      </div>

      {/* Edit Modal */}
      {editingVacation && (
        <div className="modal-overlay" onClick={() => setEditingVacation(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 400 }}>
            <div className="modal-header">
              <h2>Modifica Ferie di {editingVacation.full_name || editingVacation.username}</h2>
              <button className="btn-ghost btn-icon" onClick={() => setEditingVacation(null)}>
                <AppIcon name="close" />
              </button>
            </div>
            <div className="modal-content">
              <form onSubmit={handleEditVacation} style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                <div className="form-group">
                  <label>Dal giorno</label>
                  <input
                    type="date"
                    className="input"
                    value={editingVacation.start_date}
                    onChange={(e) => setEditingVacation({ ...editingVacation, start_date: e.target.value })}
                    required
                  />
                </div>
                <div className="form-group">
                  <label>Al giorno (compreso)</label>
                  <input
                    type="date"
                    className="input"
                    value={editingVacation.end_date}
                    onChange={(e) => setEditingVacation({ ...editingVacation, end_date: e.target.value })}
                    required
                  />
                </div>
                <div className="form-group">
                  <label>Motivo (opzionale)</label>
                  <input
                    type="text"
                    className="input"
                    placeholder="Es. Ferie estive, Rol, Malattia..."
                    value={editingVacation.reason || ''}
                    onChange={(e) => setEditingVacation({ ...editingVacation, reason: e.target.value })}
                  />
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '10px' }}>
                  <button type="button" className="btn btn-secondary" onClick={() => setEditingVacation(null)}>
                    Annulla
                  </button>
                  <button type="submit" className="btn btn-primary">
                    Salva Modifiche
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Delete Modal */}
      {deletingVacation && (
        <div className="modal-overlay" onClick={() => setDeletingVacation(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 400 }}>
            <div className="modal-header">
              <h2 style={{ color: 'var(--error-500)' }}>Elimina Ferie</h2>
              <button className="btn-ghost btn-icon" onClick={() => setDeletingVacation(null)}>
                <AppIcon name="close" />
              </button>
            </div>
            <div className="modal-content">
              <p>Sei sicuro di voler eliminare le ferie di <strong>{deletingVacation.full_name || deletingVacation.username}</strong> dal {formatDate(deletingVacation.start_date)} al {formatDate(deletingVacation.end_date)}?</p>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginTop: '10px' }}>Questo ripristinerà eventuali conflitti o ore mancanti sulle fasi precedentemente accavallate.</p>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '20px' }}>
                <button type="button" className="btn btn-secondary" onClick={() => setDeletingVacation(null)}>
                  Annulla
                </button>
                <button type="button" className="btn btn-primary" style={{ background: 'var(--error-500)', borderColor: 'var(--error-500)' }} onClick={handleDeleteVacation}>
                  Conferma Eliminazione
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
