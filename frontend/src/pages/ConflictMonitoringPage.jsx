import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api/client';
import { useToast } from '../context/ToastContext';
import AppIcon from '../components/ui/AppIcon';
import './ConflictMonitoringPage.css';

import WorkloadHeatmap from '../components/workload/WorkloadHeatmap';

export default function ConflictMonitoringPage() {
  const [conflicts, setConflicts] = useState([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  const toast = useToast();

  useEffect(() => {
    loadConflicts();
  }, []);

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

      <div className="section-heading">
        <h2>Conflitti</h2>
        <p style={{ color: 'var(--text-secondary)' }}>Dettaglio delle sovrapposizioni critiche di pianificazione sulle fasi.</p>
      </div>

      {conflicts.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon"><AppIcon name="check" size={24} /></div>
          <h3>Nessuna Sovrapposizione Trovata</h3>
          <p>Tutti gli addetti hanno una schedulazione pulita a partire da oggi.</p>
        </div>
      ) : (
        <div className="conflicts-grid" style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginTop: '20px' }}>
          {conflicts.map((c, idx) => (
            <div key={idx} className="conflict-card card">
              <div className="conflict-card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                <h3 style={{ margin: 0, color: 'var(--accent-400)' }}><AppIcon name="user" />{c.worker}</h3>
                <span className="badge badge-high" style={{ fontSize: '0.85rem' }}><AppIcon name="calendar" size={14} />{formatDate(c.date)}</span>
              </div>
              <p className="conflict-desc" style={{ color: 'var(--text-secondary)', marginBottom: '16px', fontSize: '0.9rem' }}>
                Ore totali stimate: <strong>{c.total_hours}h</strong> (limite 8h superato) distribuite su <strong>{c.tasks.length}</strong> fasi:
              </p>
              
              <div className="conflict-tasks-list" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {c.tasks.map(t => (
                  <div key={t.task_id} className="conflict-task-item" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--bg-tertiary)', padding: '12px', borderRadius: '8px', borderLeft: '4px solid #f59e0b' }}>
                    <div className="task-info" style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      <span className="task-project" style={{ fontSize: '0.85rem', color: '#9ca3af' }}>🏢 {t.project_name}</span>
                      <span className="task-name" style={{ fontWeight: 500 }}>👉 {t.task_name} <span style={{ color: 'var(--accent-400)', fontSize: '0.85rem', marginLeft: '8px' }}>({t.daily_hours}h)</span></span>
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
  );
}
