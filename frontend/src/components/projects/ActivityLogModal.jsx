import React, { useState, useEffect } from 'react';
import api from '../../api/client';
import { useToast } from '../../context/ToastContext';
import AppIcon from '../ui/AppIcon';

export default function ActivityLogPanel({ projectId }) {
  const toast = useToast();
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('fasi');

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

  const agentLogs = logs.filter(l => l.action_text?.startsWith('[Agente pianificazione]'));
  const fasiLogs = logs.filter(l => l.category === 'phase_project_edit' && !l.action_text?.startsWith('[Agente pianificazione]'));
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
              <AppIcon name={activeTab === 'ore' ? 'clock' : activeTab === 'agent' ? 'timeline' : 'list'} size={15} />
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
    <div className="activity-log-panel commessa-summary-card">
      <div className="activity-log-header" style={{ marginBottom: 16 }}>
        <h3 style={{ margin: 0, color: 'var(--text-primary)' }}>Cronologia modifiche</h3>
      </div>
      
      <div className="activity-log-tabs" style={{ display: 'flex', flexDirection: 'row', flexWrap: 'nowrap', gap: 8 }}>
        <button
          className={`activity-log-tab ${activeTab === 'fasi' ? 'active' : ''}`}
          onClick={() => setActiveTab('fasi')}
          style={{ flex: 1, whiteSpace: 'nowrap', justifyContent: 'center' }}
        >
          <AppIcon name="list" size={15} />
          Fasi e commessa
        </button>
        <button
          className={`activity-log-tab ${activeTab === 'ore' ? 'active' : ''}`}
          onClick={() => setActiveTab('ore')}
          style={{ flex: 1, whiteSpace: 'nowrap', justifyContent: 'center' }}
        >
          <AppIcon name="clock" size={15} />
          Inserimento consuntivo ore
        </button>
        <button
          className={`activity-log-tab ${activeTab === 'agent' ? 'active' : ''}`}
          onClick={() => setActiveTab('agent')}
          style={{ flex: 1, whiteSpace: 'nowrap', justifyContent: 'center' }}
        >
          <AppIcon name="timeline" size={15} />
          Agente di pianificazione
        </button>
      </div>

      <div className="activity-log-content">
        {loading ? (
          <div className="activity-log-empty">Caricamento in corso...</div>
        ) : (
          <>
            {activeTab === 'fasi' && renderLogList(fasiLogs)}
            {activeTab === 'ore' && renderLogList(oreLogs)}
            {activeTab === 'agent' && renderLogList(agentLogs)}
          </>
        )}
      </div>
    </div>
  );
}
