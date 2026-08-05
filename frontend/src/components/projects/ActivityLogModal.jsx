import React, { useState, useEffect } from 'react';
import api from '../../api/client';
import { useToast } from '../../context/ToastContext';
import AppIcon from '../ui/AppIcon';

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
        <div className="activity-log-empty">
          Nessuna attività registrata in questa sezione.
        </div>
      );
    }

    return (
      <div className="activity-log-list">
        {logList.map(log => (
          <div key={log.id} className="activity-log-entry">
            <span className="activity-log-entry-icon">
              <AppIcon name={activeTab === 'ore' ? 'clock' : 'list'} size={15} />
            </span>
            <div className="activity-log-entry-body">
              <strong>{log.user_name}</strong>
              <span>{log.action_text}</span>
            </div>
            <time>{log.created_at ? new Date(log.created_at).toLocaleString('it-IT') : ''}</time>
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="activity-log-panel">
      <div className="commessa-summary-card" style={{ marginBottom: 16, padding: '16px 20px' }}>
        <h3 style={{ margin: 0, color: 'var(--text-primary)' }}>Cronologia modifiche</h3>
        <p style={{ color: 'var(--text-secondary)', fontSize: 14, marginTop: 6, marginBottom: 0 }}>
          Questo pannello mostra l'elenco delle modifiche apportate alla commessa e la consuntivazione oraria.
        </p>
      </div>

      <div className="activity-log-tabs">
        <button
          className={`activity-log-tab ${activeTab === 'fasi' ? 'active' : ''}`}
          onClick={() => setActiveTab('fasi')}
        >
          <AppIcon name="list" size={15} />
          Fasi e commessa
        </button>
        <button
          className={`activity-log-tab ${activeTab === 'ore' ? 'active' : ''}`}
          onClick={() => setActiveTab('ore')}
        >
          <AppIcon name="clock" size={15} />
          Inserimento consuntivo ore
        </button>
      </div>

      <div className="activity-log-content">
        {loading ? (
          <div className="activity-log-empty">Caricamento in corso...</div>
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
