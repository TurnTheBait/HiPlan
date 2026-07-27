import React, { useState, useEffect } from 'react';
import api from '../../api/client';
import { useToast } from '../../context/ToastContext';

export default function ActivityLogPanel({ projectId }) {
  const toast = useToast();
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('fasi'); // 'fasi' or 'ore'

  useEffect(() => {
    fetchLogs();
  }, [projectId]);

  const fetchLogs = async () => {
    try {
      setLoading(true);
      const res = await api.get(`/projects/${projectId}/activity_logs`);
      setLogs(res.data);
    } catch (err) {
      console.error(err);
      toast.error('Errore nel caricamento della cronologia modifiche');
    } finally {
      setLoading(false);
    }
  };

  const fasiLogs = logs.filter(l => l.category === 'phase_project_edit');
  const oreLogs = logs.filter(l => l.category === 'hours_log');

  const renderLogList = (logList) => {
    if (logList.length === 0) {
      return (
        <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-muted)' }}>
          Nessuna attività registrata in questa sezione.
        </div>
      );
    }

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {logList.map(log => (
          <div key={log.id} style={{
            padding: '12px',
            backgroundColor: 'var(--bg-secondary)',
            borderRadius: '8px',
            border: '1px solid var(--border-color)',
            fontSize: '0.9rem'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
              <strong style={{ color: 'var(--accent-500)' }}>{log.user_name}</strong>
              <span style={{ fontSize: '0.8rem', color: 'var(--text-tertiary)' }}>
                {log.created_at ? new Date(log.created_at).toLocaleString() : ''}
              </span>
            </div>
            <div style={{ color: 'var(--text-primary)' }}>
              {log.action_text}
            </div>
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="activity-log-panel card" style={{ marginTop: '20px', display: 'flex', flexDirection: 'column' }}>
      <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ margin: 0, fontSize: '1.2rem' }}>Cronologia Modifiche</h2>
      </div>
      
      <div className="ut-tabs" style={{ marginBottom: 16, paddingBottom: 0, paddingTop: 16 }}>
        <button 
          className={`ut-tab-btn ${activeTab === 'fasi' ? 'active' : ''}`} 
          onClick={() => setActiveTab('fasi')}
        >
          Fasi e Commessa
        </button>
        <button 
          className={`ut-tab-btn ${activeTab === 'ore' ? 'active' : ''}`} 
          onClick={() => setActiveTab('ore')}
        >
          Inserimento Consuntivo Ore
        </button>
      </div>

      <div style={{ padding: '0 16px 16px' }}>
        {loading ? (
          <div style={{ padding: '20px', textAlign: 'center' }}>Caricamento in corso...</div>
        ) : (
          <>
            {activeTab === 'fasi' && renderLogList(fasiLogs)}
            {activeTab === 'ore' && renderLogList(oreLogs)}
          </>
        )}
      </div>
    </div>
  );
}
