import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api/client';
import { useToast } from '../context/ToastContext';
import { useAuth } from '../context/AuthContext';
import AppIcon from '../components/ui/AppIcon';
import './ReplanningAgentPage.css';

export default function ReplanningAgentPage() {
  const { user } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();

  const [suggestions, setSuggestions] = useState([]);
  const [logs, setLogs] = useState([]);
  const [loadingSuggestions, setLoadingSuggestions] = useState(true);
  const [loadingLogs, setLoadingLogs] = useState(true);
  const [executingId, setExecutingId] = useState(null);
  const [revertingId, setRevertingId] = useState(null);
  const [activeTab, setActiveTab] = useState('suggestions');

  const [filterProject, setFilterProject] = useState('');
  const [filterType, setFilterType] = useState('');
  const [sortBy, setSortBy] = useState('date_desc');
  const [archivedKeys, setArchivedKeys] = useState(() => JSON.parse(localStorage.getItem('hiplan-archived-suggestions') || '[]'));

  function handleArchive(s) {
    const key = `${s.project_id}_${s.task_id}_${s.action_type}`;
    if (!archivedKeys.includes(key)) {
      const newArchived = [...archivedKeys, key];
      setArchivedKeys(newArchived);
      localStorage.setItem('hiplan-archived-suggestions', JSON.stringify(newArchived));
      window.dispatchEvent(new Event('agent-suggestions-changed'));
    }
  }

  function handleRestore(s) {
    const key = `${s.project_id}_${s.task_id}_${s.action_type}`;
    const newArchived = archivedKeys.filter(k => k !== key);
    setArchivedKeys(newArchived);
    localStorage.setItem('hiplan-archived-suggestions', JSON.stringify(newArchived));
    window.dispatchEvent(new Event('agent-suggestions-changed'));
  }

  useEffect(() => {
    if (user?.role === 'viewer') {
      navigate('/dashboard', { replace: true });
      return;
    }
    loadSuggestions();
    loadLogs();

    const handleDataModified = () => {
      loadSuggestions();
      loadLogs();
    };

    window.addEventListener('agent-data-modified', handleDataModified);
    return () => window.removeEventListener('agent-data-modified', handleDataModified);
  }, [user, navigate]);

  async function loadSuggestions() {
    try {
      setLoadingSuggestions(true);
      const { data } = await api.get('/replanning/suggestions');
      setSuggestions(data);
    } catch (err) {
      toast.error('Errore durante il calcolo dei suggerimenti.');
    } finally {
      setLoadingSuggestions(false);
    }
  }

  async function loadLogs() {
    try {
      setLoadingLogs(true);
      const { data } = await api.get('/replanning/logs');
      setLogs(data);
    } catch (err) {
      toast.error('Errore durante il caricamento dello storico.');
    } finally {
      setLoadingLogs(false);
    }
  }

  async function handleExecute(suggestion) {
    if (!window.confirm(`Sei sicuro di voler eseguire: ${suggestion.action_label}?`)) {
      return;
    }
    try {
      setExecutingId(suggestion.id);
      await api.post('/replanning/execute', {
        action_type: suggestion.action_type,
        action_payload: suggestion.action_payload
      });
      toast.success('Suggerimento applicato con successo!');
      loadSuggestions();
      loadLogs();
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Errore durante l\'esecuzione del suggerimento.');
    } finally {
      setExecutingId(null);
    }
  }

  async function handleRevert(logId) {
    if (!window.confirm('Sei sicuro di voler revocare questa azione? Le date torneranno come prima.')) {
      return;
    }
    try {
      setRevertingId(logId);
      await api.post(`/replanning/revert/${logId}`);
      toast.success('Azione revocata con successo.');
      loadSuggestions();
      loadLogs();
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Errore durante la revoca dell\'azione');
    } finally {
      setRevertingId(null);
    }
  }

  function formatDate(isoString) {
    if (!isoString) return '—';
    const d = new Date(isoString);
    return d.toLocaleDateString('it-IT');
  }

  function formatDateTime(isoString) {
    if (!isoString) return '—';
    const d = new Date(isoString);
    return d.toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' });
  }

  function getActionBadge(type) {
    switch (type) {
      case 'shift_conflict': return { label: 'Conflitto / Sovrapposizione', color: '#ef4444' };
      case 'shift_vacation': return { label: 'Ferie', color: '#f59e0b' };
      case 'shift_overload': return { label: 'Sovraccarico', color: '#f97316' };
      case 'shift_cascade': return { label: 'Cascata', color: '#3b82f6' };
      case 'extend_project': return { label: 'Scadenza Commessa', color: '#8b5cf6' };
      case 'shift_delay': return { label: 'In Ritardo', color: '#eab308' }; // yellow
      case 'warning_unaccounted': return { label: 'Ore Mancanti', color: '#ec4899' }; // pink
      default: return { label: type, color: '#64748b' };
    }
  }

  const pendingSuggestions = suggestions.filter(s => {
    const key = `${s.project_id}_${s.task_id}_${s.action_type}`;
    return !archivedKeys.includes(key);
  });

  const archivedSuggestionsList = suggestions.filter(s => {
    const key = `${s.project_id}_${s.task_id}_${s.action_type}`;
    return archivedKeys.includes(key);
  });

  const baseListForFilters = activeTab === 'archived' ? archivedSuggestionsList : pendingSuggestions;

  const uniqueProjects = [...new Set(baseListForFilters.map(s => s.project_name))].filter(Boolean).sort();
  const uniqueTypes = [...new Set(baseListForFilters.map(s => s.action_type))].filter(Boolean).sort();

  const filteredSuggestions = baseListForFilters.filter(s => {
    if (filterProject && s.project_name !== filterProject) return false;
    if (filterType && s.action_type !== filterType) return false;
    return true;
  }).sort((a, b) => {
    if (sortBy === 'date_desc') return new Date(b.date || 0) - new Date(a.date || 0);
    if (sortBy === 'date_asc') return new Date(a.date || 0) - new Date(b.date || 0);
    if (sortBy === 'project') return (a.project_name || '').localeCompare(b.project_name || '');
    if (sortBy === 'type') return (a.action_type || '').localeCompare(b.action_type || '');
    return 0;
  });

  return (
    <div className="replanning-page animate-fadeIn">
      <div className="agent-header">
        <div className="agent-status-section">
          <div className="agent-status-info">
            <div className="status-indicator active">
              <AppIcon name="robot" size={28} />
            </div>
            <div>
              <h2>Agent Suggerimenti</h2>
              <p>Il sistema analizza in tempo reale le tue commesse per suggerirti come risolvere conflitti o incongruenze.</p>
            </div>
          </div>
          <div className="agent-controls">
            <button className="btn btn-secondary" onClick={() => { loadSuggestions(); loadLogs(); }}>
              <AppIcon name="update" />
            </button>
          </div>
        </div>
      </div>

      <div className="tabs" style={{ marginBottom: 24, borderBottom: '1px solid var(--border-default)', display: 'flex', gap: 16 }}>
        <button
          className={`tab-btn ${activeTab === 'suggestions' ? 'active' : ''}`}
          onClick={() => setActiveTab('suggestions')}
          style={{ padding: '8px 16px', background: 'none', border: 'none', borderBottom: activeTab === 'suggestions' ? '2px solid var(--accent-600)' : '2px solid transparent', color: activeTab === 'suggestions' ? 'var(--accent-600)' : 'var(--text-secondary)', cursor: 'pointer', fontWeight: 600 }}
        >
          Suggerimenti in Sospeso ({pendingSuggestions.length})
        </button>
        <button
          className={`tab-btn ${activeTab === 'archived' ? 'active' : ''}`}
          onClick={() => setActiveTab('archived')}
          style={{ padding: '8px 16px', background: 'none', border: 'none', borderBottom: activeTab === 'archived' ? '2px solid var(--accent-600)' : '2px solid transparent', color: activeTab === 'archived' ? 'var(--accent-600)' : 'var(--text-secondary)', cursor: 'pointer', fontWeight: 600 }}
        >
          Archiviati ({archivedSuggestionsList.length})
        </button>
        <button
          className={`tab-btn ${activeTab === 'logs' ? 'active' : ''}`}
          onClick={() => setActiveTab('logs')}
          style={{ padding: '8px 16px', background: 'none', border: 'none', borderBottom: activeTab === 'logs' ? '2px solid var(--accent-600)' : '2px solid transparent', color: activeTab === 'logs' ? 'var(--accent-600)' : 'var(--text-secondary)', cursor: 'pointer', fontWeight: 600 }}
        >
          Storico Esecuzioni
        </button>
      </div>

      {(activeTab === 'suggestions' || activeTab === 'archived') && (
        <div className="suggestions-tab">
          {loadingSuggestions ? (
            <div className="loading-state" style={{ padding: 40, textAlign: 'center', color: 'var(--text-secondary)' }}>
              Calcolo suggerimenti in corso...
            </div>
          ) : baseListForFilters.length === 0 ? (
            <div className="empty-state" style={{ padding: 40, textAlign: 'center', background: 'var(--bg-card)', borderRadius: 8, border: '1px solid var(--border-default)' }}>
              <AppIcon name="checkCircle" size={32} style={{ color: '#10b981', marginBottom: 12 }} />
              <h3 style={{ margin: '0 0 8px' }}>Nessun conflitto rilevato!</h3>
              <p style={{ margin: 0, color: 'var(--text-secondary)' }}>La pianificazione attuale è perfetta. Non ci sono sovrapposizioni o problemi da risolvere.</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div className="filters-bar" style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', background: 'var(--bg-card)', padding: '12px 16px', borderRadius: 8, border: '1px solid var(--border-default)' }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)' }}><AppIcon name="filter" size={14} style={{ marginRight: 4, verticalAlign: '-2px' }} /></span>

                <select className="input" value={filterProject} onChange={e => setFilterProject(e.target.value)} style={{ padding: '6px 12px', fontSize: 13, borderRadius: 6, width: "auto" }}>
                  <option value="">Tutte le commesse</option>
                  {uniqueProjects.map(p => <option key={p} value={p}>{p}</option>)}
                </select>

                <select className="input" value={filterType} onChange={e => setFilterType(e.target.value)} style={{ padding: '6px 12px', fontSize: 13, borderRadius: 6, width: "auto" }}>
                  <option value="">Tutte le tipologie</option>
                  {uniqueTypes.map(t => <option key={t} value={t}>{getActionBadge(t).label}</option>)}
                </select>

                <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)' }}>Ordina per:</span>
                  <select className="input" value={sortBy} onChange={e => setSortBy(e.target.value)} style={{ padding: '6px 12px', fontSize: 13, borderRadius: 6, width: "auto" }}>
                    <option value="date_desc">Data (più recenti)</option>
                    <option value="date_asc">Data (meno recenti)</option>
                    <option value="project">Commessa (A-Z)</option>
                    <option value="type">Tipologia</option>
                  </select>
                </div>
              </div>

              {filteredSuggestions.length === 0 ? (
                <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-secondary)', background: 'var(--bg-card)', borderRadius: 8, border: '1px solid var(--border-default)' }}>
                  Nessun suggerimento corrisponde ai filtri attuali.
                </div>
              ) : (
                <div className="suggestions-list" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  {filteredSuggestions.map(s => {
                    const badge = getActionBadge(s.action_type);
                    return (
                      <div key={s.id} className="suggestion-card" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)', borderRadius: 8, padding: 20, display: 'flex', gap: 20, alignItems: 'flex-start' }}>
                        <div className="suggestion-icon" style={{ background: `${badge.color}15`, color: badge.color, padding: 12, borderRadius: '50%' }}>
                          <AppIcon name="alertCircle" size={24} />
                        </div>
                        <div className="suggestion-content" style={{ flex: 1 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
                            <span style={{ fontSize: 12, fontWeight: 700, padding: '2px 8px', borderRadius: 12, background: badge.color, color: '#fff' }}>
                              {badge.label}
                            </span>
                            <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                              Commessa: <strong>{s.project_name}</strong>
                            </span>
                          </div>
                          <h4 style={{ margin: '0 0 8px', fontSize: '1.1rem' }}>{s.reason}</h4>
                          <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: 14 }}>
                            <strong>Azione consigliata:</strong> {s.action_label}
                          </p>
                        </div>
                        <div className="suggestion-actions" style={{ display: 'flex', gap: 8 }}>
                          {activeTab === 'suggestions' ? (
                            <button
                              className="btn btn-secondary"
                              onClick={() => handleArchive(s)}
                              title="Nascondi questo suggerimento"
                            >
                              <AppIcon name="archive" size={14} />
                            </button>
                          ) : (
                            <button
                              className="btn btn-secondary"
                              onClick={() => handleRestore(s)}
                              title="Ripristina questo suggerimento"
                            >
                              <AppIcon name="undo" size={14} />
                            </button>
                          )}
                          <button
                            className="btn btn-primary"
                            onClick={() => handleExecute(s)}
                            disabled={executingId === s.id}
                            style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                          >
                            {executingId === s.id ? 'Esecuzione...' : (
                              <>
                                <AppIcon name="play" size={14} /> Esegui
                              </>
                            )}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {activeTab === 'logs' && (
        <div className="logs-tab">
          <div className="card">
            <div className="card-header">
              <h3 className="card-title">Storico Azioni Eseguite</h3>
            </div>
            <div className="card-body" style={{ padding: 0 }}>
              {loadingLogs ? (
                <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-secondary)' }}>Caricamento storico...</div>
              ) : logs.length === 0 ? (
                <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-secondary)' }}>Nessuna azione registrata.</div>
              ) : (
                <div className="table-responsive">
                  <table className="table agent-logs-table">
                    <thead>
                      <tr>
                        <th>Data e Ora</th>
                        <th>Tipo</th>
                        <th>Contesto</th>
                        <th>Modifica</th>
                        <th className="text-right">Azioni</th>
                      </tr>
                    </thead>
                    <tbody>
                      {logs.map(log => {
                        const badge = getActionBadge(log.action_type);
                        const isReverted = log.reverted;
                        return (
                          <tr key={log.id} style={{ opacity: isReverted ? 0.6 : 1 }}>
                            <td>
                              <div style={{ fontWeight: 600 }}>{formatDateTime(log.created_at)}</div>
                              {isReverted && <div style={{ fontSize: 11, color: '#ef4444', marginTop: 4 }}>Revocato il {formatDateTime(log.reverted_at)}</div>}
                            </td>
                            <td>
                              <span className="log-type-badge" style={{ background: `${badge.color}15`, color: badge.color }}>
                                {badge.label}
                              </span>
                            </td>
                            <td>
                              <div style={{ fontWeight: 600 }}>{log.task_name}</div>
                              <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{log.project_name} {log.worker_name ? `• ${log.worker_name}` : ''}</div>
                              <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 4, fontStyle: 'italic' }}>{log.reason}</div>
                            </td>
                            <td>
                              {log.action_type === 'extend_project' ? (
                                <div style={{ fontSize: 13 }}>
                                  Fine Commessa: <span style={{ textDecoration: 'line-through', color: 'var(--text-muted)' }}>{formatDate(log.old_end_date)}</span> <AppIcon name="arrowRight" size={12} /> <span style={{ fontWeight: 600, color: 'var(--accent-600)' }}>{formatDate(log.new_end_date)}</span>
                                </div>
                              ) : (
                                <div style={{ fontSize: 13 }}>
                                  Inizio: <span style={{ textDecoration: 'line-through', color: 'var(--text-muted)' }}>{formatDate(log.old_start_date)}</span> <AppIcon name="arrowRight" size={12} /> <span style={{ fontWeight: 600, color: 'var(--accent-600)' }}>{formatDate(log.new_start_date)}</span>
                                </div>
                              )}
                            </td>
                            <td className="text-right">
                              {!isReverted && (
                                <button
                                  className="btn btn-sm btn-secondary"
                                  onClick={() => handleRevert(log.id)}
                                  disabled={revertingId === log.id}
                                  title="Revoca modifica e ripristina le vecchie date"
                                >
                                  {revertingId === log.id ? '...' : <AppIcon name="undo" size={14} />} Revoca
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
