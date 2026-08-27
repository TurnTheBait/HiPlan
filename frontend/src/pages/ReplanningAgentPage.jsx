import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api/client';
import { useToast } from '../context/ToastContext';
import { useAuth } from '../context/AuthContext';
import AppIcon from '../components/ui/AppIcon';
import MultiSelectDropdown from '../components/ui/MultiSelectDropdown';
import './ReplanningAgentPage.css';

export default function ReplanningAgentPage() {
  const { user } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();

  const [suggestions, setSuggestions] = useState([]);
  const [loadingSuggestions, setLoadingSuggestions] = useState(true);
  const [activeTab, setActiveTab] = useState('suggestions');

  const [filterProject, setFilterProject] = useState(() => JSON.parse(localStorage.getItem('agentFilterProject') || '[]'));
  const [filterType, setFilterType] = useState(() => JSON.parse(localStorage.getItem('agentFilterType') || '[]'));
  const [filterDept, setFilterDept] = useState(() => JSON.parse(localStorage.getItem('agentFilterDept') || '[]'));

  useEffect(() => { localStorage.setItem('agentFilterProject', JSON.stringify(filterProject)); }, [filterProject]);
  useEffect(() => { localStorage.setItem('agentFilterType', JSON.stringify(filterType)); }, [filterType]);
  useEffect(() => { localStorage.setItem('agentFilterDept', JSON.stringify(filterDept)); }, [filterDept]);
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

  function getActionBadge(type) {
    switch (type) {
      case 'project_end_exceeded': return { label: 'Scadenza Commessa', color: '#8b5cf6', icon: 'projects' };
      case 'delay_conflict': return { label: 'In Ritardo', color: '#eab308', icon: 'clock' };
      case 'vacation_conflict': return { label: 'Ferie', color: '#f59e0b', icon: 'vacations' };
      case 'overload_conflict': return { label: 'Sovraccarico', color: '#f97316', icon: 'user' };
      case 'missing_data': return { label: 'Dato Mancante', color: '#0ea5e9', icon: 'alertTriangle' };
      case 'zero_hours': return { label: 'Mancata Consuntivazione', color: '#8b5cf6', icon: 'user' };
      default: return { label: type, color: '#64748b', icon: 'notes' };
    }
  }

  const pendingSuggestions = suggestions.filter(s => !archivedKeys.includes(s.id));
  const archivedSuggestionsList = suggestions.filter(s => archivedKeys.includes(s.id));
  const baseListForFilters = activeTab === 'archived' ? archivedSuggestionsList : pendingSuggestions;

  const uniqueProjects = [...new Set(baseListForFilters.map(s => s.project_name))].filter(Boolean).sort();
  const uniqueTypes = [...new Set(baseListForFilters.map(s => s.type))].filter(Boolean).sort();

  const filteredSuggestions = baseListForFilters.filter(s => {
    if (filterProject.length > 0 && !filterProject.includes(s.project_name)) return false;
    if (filterType.length > 0 && !filterType.includes(s.type)) return false;
    if (filterDept.length > 0 && !filterDept.includes(s.department)) return false;
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

      {/* ── Barra filtri e tab unificata ── */}
      <div style={{
        display: 'flex', flexDirection: 'column', gap: 16,
        padding: '12px', marginBottom: 24,
        border: '1px solid var(--border-subtle)', borderRadius: 14,
        background: 'var(--bg-card)', boxShadow: 'var(--shadow-sm)'
      }}>

        {/* Riga Superiore: Tab Selector a sinistra, Aggiorna a destra */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div className="projects-filters" style={{ margin: 0 }}>
            {[
              { id: 'suggestions', label: 'In Sospeso', count: pendingSuggestions.length },
              { id: 'archived', label: 'Archiviati', count: archivedSuggestionsList.length },
            ].map(tab => (
              <button
                key={tab.id}
                onClick={() => { setActiveTab(tab.id); setFilterProject([]); setFilterType([]); setFilterDept([]); }}
                className={`filter-chip ${activeTab === tab.id ? 'active' : ''}`}
                style={{ display: 'flex', alignItems: 'center', gap: 6 }}
              >
                {tab.label}
                <span style={{
                  fontSize: 11, fontWeight: 700,
                  background: activeTab === tab.id ? 'var(--accent-500)' : 'var(--bg-tertiary)',
                  color: activeTab === tab.id ? '#fff' : 'var(--text-muted)',
                  padding: '1px 7px', borderRadius: 99,
                }}>
                  {tab.count}
                </span>
              </button>
            ))}
          </div>

          <button
            className="btn btn-primary"
            onClick={() => loadSuggestions()}
            style={{ display: 'flex', alignItems: 'center', gap: 6, minHeight: 38 }}
          >
            <AppIcon name="update" size={14} /> Aggiorna
          </button>
        </div>

        {/* Riga Inferiore: Filtri (sotto il selettore tab) */}
        <div style={{
          display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap'
        }}>
          <span style={{ color: 'var(--text-muted)', display: 'flex', alignItems: 'center' }}>
            <AppIcon name="filter" size={14} />
          </span>

          <MultiSelectDropdown
            value={filterProject}
            onChange={setFilterProject}
            placeholder="Tutte le commesse"
            options={Array.from(new Set([...uniqueProjects, ...filterProject])).map(p => ({ label: p, value: p }))}
            style={{ minWidth: 200, flex: 1, maxWidth: 300 }}
          />

          <MultiSelectDropdown
            value={filterType}
            onChange={setFilterType}
            placeholder="Tutte le tipologie"
            options={Array.from(new Set([...uniqueTypes, ...filterType])).map(t => ({ label: getActionBadge(t).label, value: t }))}
            style={{ minWidth: 200, flex: 1, maxWidth: 300 }}
          />

          <MultiSelectDropdown
            value={filterDept}
            onChange={setFilterDept}
            placeholder="Tutti i reparti"
            options={[
              { label: 'Ufficio Tecnico', value: 'ufficio_tecnico' },
              { label: 'Acquisti', value: 'acquisti' },
              { label: 'Produzione', value: 'produzione' }
            ]}
            style={{ minWidth: 200, flex: 1, maxWidth: 300 }}
          />

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, whiteSpace: 'nowrap', marginLeft: 'auto' }}>
            <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Ordina per:</span>
            <select
              className="input"
              value={sortBy}
              onChange={e => setSortBy(e.target.value)}
              style={{ padding: '6px 12px', fontSize: 13, borderRadius: 10, minHeight: 38, minWidth: 200 }}
            >
              <option value="date_asc">Data (più vicine a oggi)</option>
              <option value="date_desc">Data (più lontane)</option>
              <option value="project">Commessa (A-Z)</option>
              <option value="type">Tipologia</option>
            </select>
          </div>
        </div>
      </div>

      {/* ── Contenuto ── */}
      {loadingSuggestions ? (
        <div style={{ padding: 60, textAlign: 'center', color: 'var(--text-secondary)' }}>
          Calcolo suggerimenti in corso…
        </div>
      ) : baseListForFilters.length === 0 ? (
        <div className="empty-state" style={{ padding: 60, textAlign: 'center', background: 'var(--bg-card)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-subtle)' }}>
          <AppIcon name="checkCircle" size={36} style={{ color: '#10b981', marginBottom: 14 }} />
          <h3 style={{ margin: '0 0 8px' }}>Nessun conflitto rilevato!</h3>
          <p style={{ margin: 0, color: 'var(--text-secondary)' }}>La pianificazione attuale è perfetta. Non ci sono sovrapposizioni o problemi da risolvere.</p>
        </div>
      ) : filteredSuggestions.length === 0 ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-secondary)', background: 'var(--bg-card)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-subtle)' }}>
          Nessun suggerimento corrisponde ai filtri attuali.
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(400px, 1fr))', gap: 16 }}>
          {filteredSuggestions.map(s => {
            let badge = { ...getActionBadge(s.type) };

            if (s.type === 'delay_conflict') {
              if (s.reason && s.reason.toLowerCase().includes('ritardo critico')) {
                badge.color = '#e2445c';
                badge.label = 'Ritardo Critico';
              } else if (s.reason && s.reason.toLowerCase().includes('scaduta')) {
                badge.color = '#e2445c';
                badge.label = 'Scaduta';
              } else if (s.reason && s.reason.toLowerCase().includes('superato le ore previste')) {
                badge.color = '#db2777';
                badge.label = 'Sforamento Ore';
              } else {
                badge.color = '#f59e0b';
                badge.label = 'Ritardo';
              }
            } else if (s.type === 'project_end_exceeded') {
              badge.color = '#e2445c';
            }

            return (
              <div
                key={s.id}
                className="card"
                style={{
                  borderLeft: `4px solid ${badge.color}`,
                  borderRadius: 'var(--radius-lg)',
                  padding: '18px 20px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 14,
                  boxShadow: 'var(--shadow-sm)',
                  transition: 'box-shadow 0.18s, transform 0.18s',
                  cursor: 'default',
                }}
                onMouseEnter={e => { e.currentTarget.style.boxShadow = 'var(--shadow-md)'; e.currentTarget.style.transform = 'translateY(-2px)'; }}
                onMouseLeave={e => { e.currentTarget.style.boxShadow = 'var(--shadow-sm)'; e.currentTarget.style.transform = 'none'; }}
              >
                {/* Header: icona + badge */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ background: `${badge.color}18`, color: badge.color, padding: 9, borderRadius: '50%', flexShrink: 0 }}>
                    <AppIcon name={badge.icon || 'alert'} size={18} />
                  </div>
                  <span style={{
                    fontSize: 11, fontWeight: 700, padding: '3px 10px',
                    borderRadius: 99, background: badge.color, color: '#fff',
                    letterSpacing: '0.03em',
                  }}>
                    {badge.label}
                  </span>
                </div>

                {/* Corpo */}
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <h4 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 700, lineHeight: 1.45, color: 'var(--text-primary)' }}>
                    {s.reason}
                  </h4>

                  <div style={{
                    fontSize: 12, color: 'var(--text-secondary)',
                    background: 'var(--bg-secondary)',
                    padding: '9px 12px', borderRadius: 8,
                    border: '1px solid var(--border-subtle)',
                    borderLeft: s.project_name ? `4px solid ${s.project_color || '#185FA5'}` : '1px solid var(--border-subtle)',
                    display: 'flex', flexDirection: 'column', gap: 4,
                  }}>
                    <span>
                      <span style={{ color: 'var(--text-muted)' }}>Commessa: </span>
                      <strong style={{ color: 'var(--text-primary)' }}>{s.project_code ? `${s.project_code} – ${s.project_name}` : s.project_name}</strong>
                    </span>
                    {s.task_name && (
                      <span>
                        <span style={{ color: 'var(--text-muted)' }}>Fase: </span>
                        <strong style={{ color: 'var(--text-primary)' }}>{s.task_name}</strong>
                      </span>
                    )}
                  </div>
                </div>

                {/* Footer azioni */}
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', borderTop: '1px solid var(--border-subtle)', paddingTop: 12 }}>
                  {s.project_id && (
                    <button
                      className="btn btn-primary"
                      onClick={() => navigate(`/projects/${s.project_id}`)}
                      style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.82rem', padding: '6px 14px' }}
                    >
                      Vai alla commessa <AppIcon name="arrowRight" size={13} />
                    </button>
                  )}
                  {activeTab === 'suggestions' ? (
                    <button
                      className="btn btn-secondary"
                      onClick={() => handleArchive(s)}
                      title="Archivia"
                      style={{ padding: '6px 14px', fontSize: '0.82rem' }}
                    >
                      <AppIcon name="archive" size={13} />
                    </button>
                  ) : (
                    <button
                      className="btn btn-secondary"
                      onClick={() => handleRestore(s)}
                      title="Ripristina"
                      style={{ padding: '6px 14px', fontSize: '0.82rem', display: 'flex', alignItems: 'center', gap: 6 }}
                    >
                      <AppIcon name="undo" size={13} /> Ripristina
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
