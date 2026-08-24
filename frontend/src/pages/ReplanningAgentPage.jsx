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
  const [loadingSuggestions, setLoadingSuggestions] = useState(true);
  const [activeTab, setActiveTab] = useState('suggestions');

  const [filterProject, setFilterProject] = useState('');
  const [filterType, setFilterType] = useState('');
  const [sortBy, setSortBy] = useState('date_asc');
  const [archivedKeys, setArchivedKeys] = useState(() => JSON.parse(localStorage.getItem('agentArchivedKeys') || '[]'));

  function handleArchive(suggestion) {
    const newKeys = [...archivedKeys, suggestion.id];
    setArchivedKeys(newKeys);
    localStorage.setItem('agentArchivedKeys', JSON.stringify(newKeys));
    toast.success('Suggerimento archiviato.');
  }

  function handleRestore(suggestion) {
    const newKeys = archivedKeys.filter(k => k !== suggestion.id);
    setArchivedKeys(newKeys);
    localStorage.setItem('agentArchivedKeys', JSON.stringify(newKeys));
    toast.success('Suggerimento ripristinato.');
  }

  useEffect(() => {
    if (user?.role === 'viewer') {
      navigate('/dashboard', { replace: true });
      return;
    }
    loadSuggestions();

    const handleDataModified = () => {
      loadSuggestions();
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

  function formatDate(isoString) {
    if (!isoString) return '—';
    const d = new Date(isoString);
    return d.toLocaleDateString('it-IT');
  }

  function getActionBadge(type) {
    switch (type) {
      case 'project_end_exceeded': return { label: 'Scadenza Commessa', color: '#8b5cf6', icon: 'projects' };
      case 'delay_conflict': return { label: 'In Ritardo', color: '#eab308', icon: 'clock' };
      case 'vacation_conflict': return { label: 'Ferie', color: '#f59e0b', icon: 'vacations' };
      case 'overload_conflict': return { label: 'Sovraccarico', color: '#f97316', icon: 'user' };
      default: return { label: type, color: '#64748b', icon: 'notes' };
    }
  }

  const pendingSuggestions = suggestions.filter(s => {
    return !archivedKeys.includes(s.id);
  });

  const archivedSuggestionsList = suggestions.filter(s => {
    return archivedKeys.includes(s.id);
  });

  const baseListForFilters = activeTab === 'archived' ? archivedSuggestionsList : pendingSuggestions;

  const uniqueProjects = [...new Set(baseListForFilters.map(s => s.project_name))].filter(Boolean).sort();
  const uniqueTypes = [...new Set(baseListForFilters.map(s => s.type))].filter(Boolean).sort();

  const filteredSuggestions = baseListForFilters.filter(s => {
    if (filterProject && s.project_name !== filterProject) return false;
    if (filterType && s.type !== filterType) return false;
    return true;
  }).sort((a, b) => {
    if (sortBy === 'date_desc') return new Date(b.date || 0) - new Date(a.date || 0);
    if (sortBy === 'date_asc') return new Date(a.date || 0) - new Date(b.date || 0);
    if (sortBy === 'project') return (a.project_name || '').localeCompare(b.project_name || '');
    if (sortBy === 'type') return (a.type || '').localeCompare(b.type || '');
    return 0;
  });

  return (
    <div className="replanning-page animate-fadeIn">
      <div className="agent-header">
        <div className="agent-status-section" style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '24px', borderRadius: '12px', backgroundColor: 'var(--bg-card)', boxShadow: 'var(--shadow-sm)', padding: '14px', borderColor: 'var(--border-subtle)' }}>
          <div className="agent-status-info">
            <div className="status-indicator active">
              <AppIcon name="robot" size={28} />
            </div>
            <div>
              <p>Il sistema analizza in tempo reale le tue commesse per aiutarti a rilevare anomalie, conflitti, ferie e sovraccarichi.</p>
            </div>
          </div>
          <div className="agent-controls">
            <button className="btn btn-secondary" onClick={() => loadSuggestions()}>
              <AppIcon name="update" />
            </button>
          </div>
        </div>
      </div >

      <div className="projects-filters" style={{ marginBottom: 24 }}>
        <button
          className={`filter-chip ${activeTab === 'suggestions' ? 'active' : ''}`}
          onClick={() => setActiveTab('suggestions')}
        >
          Suggerimenti in Sospeso ({pendingSuggestions.length})
        </button>
        <button
          className={`filter-chip ${activeTab === 'archived' ? 'active' : ''}`}
          onClick={() => setActiveTab('archived')}
        >
          Archiviati ({archivedSuggestionsList.length})
        </button>
      </div>

      {
        (activeTab === 'suggestions' || activeTab === 'archived') && (
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

                  <select className="input" value={filterProject} onChange={e => setFilterProject(e.target.value)} style={{ padding: '6px 12px', fontSize: 13, borderRadius: 6, width: "200px" }}>
                    <option value="">Tutte le commesse</option>
                    {uniqueProjects.map(p => <option key={p} value={p}>{p}</option>)}
                  </select>

                  <select className="input" value={filterType} onChange={e => setFilterType(e.target.value)} style={{ padding: '6px 12px', fontSize: 13, borderRadius: 6, width: "200px" }}>
                    <option value="">Tutte le tipologie</option>
                    {uniqueTypes.map(t => <option key={t} value={t}>{getActionBadge(t).label}</option>)}
                  </select>

                  <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)' }}>Ordina per:</span>
                    <select className="input" value={sortBy} onChange={e => setSortBy(e.target.value)} style={{ padding: '6px 12px', fontSize: 13, borderRadius: 6, width: "auto" }}>
                      <option value="date_asc">Data (più vicine a oggi)</option>
                      <option value="date_desc">Data (più lontane da oggi)</option>
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
                      let badge = { ...getActionBadge(s.type) };

                      if (s.type === 'delay_conflict') {
                        if (s.reason && s.reason.toLowerCase().includes('ritardo critico')) {
                          badge.color = '#e2445c'; // Red for critical delay
                          badge.label = 'Ritardo Critico';
                        } else if (s.reason && s.reason.toLowerCase().includes('scaduta')) {
                          badge.color = '#e2445c'; // Red for expired
                          badge.label = 'Scaduta';
                        } else {
                          badge.color = '#f59e0b'; // Orange for warning/overrun
                          badge.label = 'Ritardo';
                        }
                      } else if (s.type === 'project_end_exceeded') {
                        badge.color = '#e2445c'; // Red
                      }

                      return (
                        <div key={s.id} className="suggestion-card" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)', borderRadius: 8, padding: 20, display: 'flex', gap: 20, alignItems: 'flex-start' }}>
                          <div className="suggestion-icon" style={{ background: `${badge.color}15`, color: badge.color, padding: 12, borderRadius: '50%' }}>
                            <AppIcon name={badge.icon || 'alert'} size={24} />
                          </div>
                          <div className="suggestion-content" style={{ flex: 1 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
                              <span style={{ fontSize: 12, fontWeight: 700, padding: '2px 8px', borderRadius: 12, background: badge.color, color: '#fff' }}>
                                {badge.label}
                              </span>
                              <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                                Commessa: <strong>{s.project_code ? `${s.project_code} - ${s.project_name}` : s.project_name}</strong>
                                {s.task_name && (
                                  <>
                                    <span style={{ margin: '0 8px', color: 'var(--border-strong)' }}>|</span>
                                    Fase: <strong>{s.task_name}</strong>
                                  </>
                                )}
                              </span>
                            </div>
                            <h4 style={{ margin: '0 0 8px', fontSize: '1.1rem' }}>{s.reason}</h4>
                            {/*<p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: 14 }}><strong>Azione consigliata:</strong> {s.action_label}</p>*/}
                          </div>
                          <div className="suggestion-actions" style={{ display: 'flex', gap: 8 }}>
                            {s.project_id && (
                              <button
                                className="btn btn-primary"
                                onClick={() => navigate(`/projects/${s.project_id}`)}
                                title="Vai alla commessa"
                                style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.85rem', padding: '6px 12px' }}
                              >
                                <AppIcon name="arrowRight" size={14} />
                              </button>
                            )}
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
                            {/*<button className="btn btn-primary"onClick={() => handleExecute(s)} disabled={executingId === s.id} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>{executingId === s.id ? 'Esecuzione...' : (<><AppIcon name="play" size={14} /> Esegui</>)}</button>*/}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        )
      }
    </div>
  );
}
