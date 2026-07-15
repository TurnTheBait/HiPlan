import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api/client';
import { useToast } from '../context/ToastContext';
import './CalendarPage.css';

const STATUS_LABELS_IT = {
  planning: 'In pianificazione',
  active: 'In corso',
  completed: 'Completato',
  archived: 'Archiviato',
};

const STATUS_COLORS = {
  planning: '#f59e0b', // Amber
  active: '#10b981',   // Emerald
  completed: '#3b82f6',// Blue
  archived: '#6b7280', // Gray
};

const MONTH_NAMES_IT = [
  'Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno',
  'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre'
];

const WEEKDAYS_IT = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'];

export default function CalendarPage() {
  const navigate = useNavigate();
  const toast = useToast();

  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);

  // Stato navigazione mese
  const today = new Date();
  const [currYear, setCurrYear] = useState(today.getFullYear());
  const [currMonth, setCurrMonth] = useState(today.getMonth()); // 0-11

  // Controlli e filtri
  const [viewMode, setViewMode] = useState('grid'); // 'grid' | 'timeline'
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterWorker, setFilterWorker] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedProjects, setExpandedProjects] = useState({});
  const [systemWorkers, setSystemWorkers] = useState(['Alessio', 'Edoardo', 'Ermal', 'Luca', 'Marco', 'Michelangelo', 'Cliente']);

  // Modali dettaglio
  const [selectedProject, setSelectedProject] = useState(null);
  const [selectedDayProjects, setSelectedDayProjects] = useState(null); // { dateStr, dayNum, list }

  useEffect(() => {
    loadProjects();
  }, []);

  async function loadProjects() {
    setLoading(true);
    try {
      const [projRes, workersRes] = await Promise.all([
        api.get('/projects'),
        api.get('/workers').catch(() => ({ data: [] }))
      ]);
      if (Array.isArray(workersRes.data) && workersRes.data.length > 0) {
        setSystemWorkers(workersRes.data.map(w => w.name));
      }
      const projectsWithTasks = await Promise.all(
        projRes.data.map(async (p) => {
          try {
            const { data: gData } = await api.get(`/projects/${p.id}/gantt`);
            return { ...p, tasks: Array.isArray(gData.tasks) ? gData.tasks : [] };
          } catch (e) {
            return { ...p, tasks: [] };
          }
        })
      );
      setProjects(projectsWithTasks);
    } catch (err) {
      toast.error("Errore nel caricamento delle commesse per il calendario");
    } finally {
      setLoading(false);
    }
  }

  // Elenco completo degli addetti dinamico + predefiniti
  const allWorkers = useMemo(() => {
    const setW = new Set(systemWorkers);
    projects.forEach(p => {
      if (Array.isArray(p.tasks)) {
        p.tasks.forEach(t => {
          if (Array.isArray(t.workers)) {
            t.workers.forEach(w => {
              if (w && typeof w === 'string' && w.trim()) setW.add(w.trim());
            });
          }
        });
      }
    });
    return Array.from(setW).sort((a, b) => a.localeCompare(b));
  }, [projects, systemWorkers]);

  // Filtra commesse per stato, addetto e ricerca
  const filteredProjects = useMemo(() => {
    return projects.filter(p => {
      if (filterStatus !== 'all' && p.status !== filterStatus) return false;
      if (filterWorker !== 'all') {
        const hasWorkerTask = Array.isArray(p.tasks) && p.tasks.some(t => Array.isArray(t.workers) && t.workers.includes(filterWorker));
        if (!hasWorkerTask) return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const code = (p.code || '').toLowerCase();
        const name = (p.name || '').toLowerCase();
        const client = (p.client || '').toLowerCase();
        if (!code.includes(q) && !name.includes(q) && !client.includes(q)) return false;
      }
      return true;
    });
  }, [projects, filterStatus, filterWorker, searchQuery]);

  // Gestione Mese Precedente / Successivo / Oggi
  function prevMonth() {
    if (currMonth === 0) {
      setCurrMonth(11);
      setCurrYear(y => y - 1);
    } else {
      setCurrMonth(m => m - 1);
    }
  }

  function nextMonth() {
    if (currMonth === 11) {
      setCurrMonth(0);
      setCurrYear(y => y - 1);
    } else {
      setCurrMonth(m => m + 1);
    }
  }

  function goToToday() {
    setCurrYear(today.getFullYear());
    setCurrMonth(today.getMonth());
  }

  // Generazione calendario mensile
  const daysInMonth = new Date(currYear, currMonth + 1, 0).getDate();
  
  // Il giorno della settimana del 1° del mese (0 = Dom, 1 = Lun, ... 6 = Sab)
  // Convertiamo in standard italiano: 0 = Lun ... 6 = Dom
  const firstDayRaw = new Date(currYear, currMonth, 1).getDay();
  const firstDayIndex = firstDayRaw === 0 ? 6 : firstDayRaw - 1;

  // Calcola se un progetto è attivo in una certa data "YYYY-MM-DD"
  function isProjectActiveOnDate(project, dateStr) {
    if (!project.start_date) return false;
    const start = project.start_date.substring(0, 10);
    const end = project.end_date ? project.end_date.substring(0, 10) : start;
    return dateStr >= start && dateStr <= end;
  }

  // Costruisce array per la griglia
  const calendarCells = useMemo(() => {
    const cells = [];
    
    // Giorni mese precedente
    const prevMonthDays = new Date(currYear, currMonth, 0).getDate();
    for (let i = firstDayIndex - 1; i >= 0; i--) {
      const dNum = prevMonthDays - i;
      cells.push({
        dayNum: dNum,
        isOtherMonth: true,
        dateStr: null,
        projectsList: [],
      });
    }

    // Giorni mese corrente
    for (let d = 1; d <= daysInMonth; d++) {
      const monthStr = String(currMonth + 1).padStart(2, '0');
      const dayStr = String(d).padStart(2, '0');
      const dateStr = `${currYear}-${monthStr}-${dayStr}`;
      
      const activeList = [];
      filteredProjects.forEach(p => {
        if (filterWorker !== 'all') {
          // Quando si filtra per addetto, controlla le singole fasi dell'addetto attive in questa data
          const matchingTasks = (p.tasks || []).filter(t => {
            if (!Array.isArray(t.workers) || !t.workers.includes(filterWorker)) return false;
            const tStart = t.start_date ? t.start_date.substring(0, 10) : '';
            const tEnd = t.end_date ? t.end_date.substring(0, 10) : tStart;
            return tStart <= dateStr && tEnd >= dateStr;
          });
          if (matchingTasks.length > 0) {
            activeList.push({
              ...p,
              matchingPhases: matchingTasks,
              displayTitle: `${p.code ? `[${p.code}] ` : ''}Fase: ${matchingTasks.map(t => t.text).join(' + ')}`,
            });
          }
        } else {
          if (isProjectActiveOnDate(p, dateStr)) {
            activeList.push({
              ...p,
              displayTitle: `${p.code ? `[${p.code}] ` : ''}${p.name}`,
            });
          }
        }
      });
      
      cells.push({
        dayNum: d,
        isOtherMonth: false,
        dateStr,
        projectsList: activeList,
        isToday: dateStr === today.toISOString().substring(0, 10),
      });
    }

    // Giorni mese successivo per completare la griglia (42 celle o fino a fine settimana)
    const remaining = (7 - (cells.length % 7)) % 7;
    for (let i = 1; i <= remaining; i++) {
      cells.push({
        dayNum: i,
        isOtherMonth: true,
        dateStr: null,
        projectsList: [],
      });
    }

    return cells;
  }, [currYear, currMonth, filteredProjects, firstDayIndex, daysInMonth, filterWorker]);

  // Funzione per formattare la durata in giorni tra due date
  function getDurationDays(start, end) {
    if (!start) return '-';
    const s = new Date(start);
    const e = end ? new Date(end) : s;
    const diffTime = Math.abs(e - s);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
    return `${diffDays} giorni`;
  }

  return (
    <div className="calendar-page">
      {/* Intestazione e Toolbar */}
      <div className="calendar-header-toolbar">
        <div className="calendar-nav-section">
          <h1 className="calendar-month-title">
            {MONTH_NAMES_IT[currMonth]} {currYear}
          </h1>
          <div className="calendar-nav-buttons">
            <button className="calendar-nav-btn" onClick={prevMonth} title="Mese precedente">‹ Prec.</button>
            <button className="calendar-nav-btn today" onClick={goToToday} title="Vai a oggi">Oggi</button>
            <button className="calendar-nav-btn" onClick={nextMonth} title="Mese successivo">Succ. ›</button>
          </div>
        </div>

        <div className="calendar-actions-section">
          <input
            type="text"
            className="input"
            style={{ width: 200, minWidth: 140, maxWidth: '100%', flex: '1 1 150px', padding: '8px 12px' }}
            placeholder="Cerca commessa o cliente..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />

          <select
            className="input"
            style={{ width: 160, minWidth: 120, maxWidth: '100%', flex: '0 1 auto', padding: '8px 12px' }}
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
          >
            <option value="all">Tutti gli stati</option>
            <option value="active">In corso</option>
            <option value="planning">In pianificazione</option>
            <option value="completed">Completati</option>
            <option value="archived">Archiviati</option>
          </select>

          <select
            className="input"
            style={{ width: 170, minWidth: 130, maxWidth: '100%', flex: '0 1 auto', padding: '8px 12px' }}
            value={filterWorker}
            onChange={(e) => setFilterWorker(e.target.value)}
          >
            <option value="all">👥 Tutti gli addetti</option>
            {allWorkers.map(w => (
              <option key={w} value={w}>👤 {w}</option>
            ))}
          </select>

          <div className="calendar-view-toggle">
            <button
              className={`calendar-view-btn ${viewMode === 'grid' ? 'active' : ''}`}
              onClick={() => setViewMode('grid')}
            >
              <span>▦</span> Griglia Mese
            </button>
            <button
              className={`calendar-view-btn ${viewMode === 'timeline' ? 'active' : ''}`}
              onClick={() => setViewMode('timeline')}
            >
              <span>▤</span> Timeline
            </button>
          </div>
        </div>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 60, color: 'var(--text-secondary)' }}>
          <div className="spinner" style={{ margin: '0 auto 16px' }} />
          Caricamento calendario commesse in corso...
        </div>
      ) : viewMode === 'grid' ? (
        /* VISTA GRIGLIA MESE */
        <div className="calendar-grid-container">
          <div className="calendar-weekdays-header">
            {WEEKDAYS_IT.map((day, idx) => (
              <div key={day} className={`calendar-weekday ${idx >= 5 ? 'weekend' : ''}`}>
                {day}
              </div>
            ))}
          </div>

          <div className="calendar-days-grid">
            {calendarCells.map((cell, idx) => {
              const isWeekend = idx % 7 >= 5;
              return (
                <div
                  key={idx}
                  className={`calendar-day-cell ${cell.isOtherMonth ? 'other-month' : ''} ${isWeekend ? 'weekend-cell' : ''} ${cell.isToday ? 'today-cell' : ''}`}
                  onClick={() => {
                    if (!cell.isOtherMonth && cell.projectsList.length > 0) {
                      setSelectedDayProjects({
                        dateStr: cell.dateStr,
                        dayNum: cell.dayNum,
                        list: cell.projectsList,
                      });
                    }
                  }}
                >
                  <div className="calendar-day-header">
                    <span className="calendar-day-number">{cell.dayNum}</span>
                    {!cell.isOtherMonth && cell.projectsList.length > 0 && (
                      <span className="calendar-day-badge">
                        {cell.projectsList.length} {filterWorker !== 'all' ? (cell.projectsList.length === 1 ? 'fase' : 'fasi') : (cell.projectsList.length === 1 ? 'commessa' : 'commesse')}
                      </span>
                    )}
                  </div>

                  {!cell.isOtherMonth && (
                    <div className="calendar-projects-list">
                      {cell.projectsList.slice(0, 3).map(proj => {
                        const color = proj.color || '#185FA5';
                        return (
                          <div
                            key={proj.id}
                            className="calendar-project-pill"
                            style={{
                              borderLeftColor: color,
                              background: `${color}26`,
                            }}
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedProject(proj);
                            }}
                            title={`${proj.code ? `[${proj.code}] ` : ''}${proj.displayTitle || proj.name} (${STATUS_LABELS_IT[proj.status] || proj.status})`}
                          >
                            <span className="pill-text">
                              <strong>{proj.code ? `${proj.code} ` : ''}</strong>
                              {proj.displayTitle ? proj.displayTitle.replace(proj.code ? `[${proj.code}] ` : '', '') : proj.name}
                            </span>
                            <span
                              className="pill-status-dot"
                              style={{ background: STATUS_COLORS[proj.status] || '#a5b4fc' }}
                            />
                          </div>
                        );
                      })}
                      {cell.projectsList.length > 3 && (
                        <div
                          className="calendar-more-pill"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedDayProjects({
                              dateStr: cell.dateStr,
                              dayNum: cell.dayNum,
                              list: cell.projectsList,
                            });
                          }}
                        >
                          + altre {cell.projectsList.length - 3} commesse...
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        /* VISTA TIMELINE MESE */
        <div className="calendar-timeline-container">
          <div className="timeline-header-row">
            <div className="timeline-project-col">Commessa / Progetto</div>
            <div className="timeline-days-scroll">
              {Array.from({ length: daysInMonth }, (_, i) => i + 1).map((d) => {
                const dayDate = new Date(currYear, currMonth, d);
                const dayOfWeek = dayDate.getDay();
                const isWknd = dayOfWeek === 0 || dayOfWeek === 6;
                const monthStr = String(currMonth + 1).padStart(2, '0');
                const dayStr = String(d).padStart(2, '0');
                const isToday = `${currYear}-${monthStr}-${dayStr}` === today.toISOString().substring(0, 10);
                return (
                  <div key={d} className={`timeline-day-col-header ${isWknd ? 'weekend' : ''} ${isToday ? 'today' : ''}`}>
                    <span>{WEEKDAYS_IT[dayOfWeek === 0 ? 6 : dayOfWeek - 1]}</span>
                    <span>{d}</span>
                  </div>
                );
              })}
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {filteredProjects.length === 0 ? (
              <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-secondary)' }}>
                Nessuna commessa trovata per i criteri selezionati in questo mese.
              </div>
            ) : (
              filteredProjects.map((proj) => {
                const color = proj.color || '#185FA5';
                const monthStartStr = `${currYear}-${String(currMonth + 1).padStart(2, '0')}-01`;
                const monthEndStr = `${currYear}-${String(currMonth + 1).padStart(2, '0')}-${String(daysInMonth).padStart(2, '0')}`;
                
                const pStart = proj.start_date ? proj.start_date.substring(0, 10) : monthStartStr;
                const pEnd = proj.end_date ? proj.end_date.substring(0, 10) : pStart;

                // Controlla se visibile in questo mese
                if (pEnd < monthStartStr || pStart > monthEndStr) {
                  return (
                    <div key={proj.id} className="timeline-project-row">
                      <div className="timeline-project-info" onClick={() => setSelectedProject(proj)} style={{ cursor: 'pointer' }}>
                        <span className="timeline-proj-title">{proj.code ? `[${proj.code}] ` : ''}{proj.name}</span>
                        <span className="timeline-proj-meta">{proj.client || 'Nessun cliente'}</span>
                      </div>
                      <div className="timeline-row-grid">
                        {Array.from({ length: daysInMonth }, (_, i) => i + 1).map((d) => {
                          const dayDate = new Date(currYear, currMonth, d);
                          const isWk = dayDate.getDay() === 0 || dayDate.getDay() === 6;
                          return <div key={d} className={`timeline-cell ${isWk ? 'weekend' : ''}`} />;
                        })}
                      </div>
                    </div>
                  );
                }

                // Calcolo indici colonna (1-indexed)
                const startDayNum = pStart < monthStartStr ? 1 : parseInt(pStart.substring(8, 10), 10);
                const endDayNum = pEnd > monthEndStr ? daysInMonth : parseInt(pEnd.substring(8, 10), 10);
                const spanDays = Math.max(1, endDayNum - startDayNum + 1);

                const matchingTasks = (proj.tasks || []).filter(t => {
                  if (filterWorker !== 'all') {
                    return Array.isArray(t.workers) && t.workers.includes(filterWorker);
                  }
                  return true;
                });
                const isExpanded = expandedProjects[proj.id] || filterWorker !== 'all';

                return (
                  <React.Fragment key={proj.id}>
                    <div className="timeline-project-row">
                      <div className="timeline-project-info" onClick={() => setSelectedProject(proj)} style={{ cursor: 'pointer' }}>
                        <span className="timeline-proj-title" title={proj.name}>
                          <strong>{proj.code ? `[${proj.code}] ` : ''}</strong>
                          {proj.name}
                        </span>
                        <span className="timeline-proj-meta">
                          <span style={{ width: 8, height: 8, borderRadius: '50%', background: STATUS_COLORS[proj.status] || '#a5b4fc', display: 'inline-block' }} />
                          {STATUS_LABELS_IT[proj.status] || proj.status}
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setExpandedProjects(prev => ({ ...prev, [proj.id]: !prev[proj.id] }));
                            }}
                            style={{
                              background: 'var(--bg-primary)',
                              border: '1px solid var(--border-subtle)',
                              borderRadius: 4,
                              padding: '1px 6px',
                              fontSize: '0.68rem',
                              color: 'var(--text-secondary)',
                              cursor: 'pointer',
                              marginLeft: 'auto'
                            }}
                            title="Mostra singole fasi"
                          >
                            {isExpanded ? '▼ Fasi' : `► Fasi (${proj.tasks?.length || 0})`}
                          </button>
                        </span>
                      </div>

                      <div className="timeline-row-grid">
                        {Array.from({ length: daysInMonth }, (_, i) => i + 1).map((d) => {
                          const dayDate = new Date(currYear, currMonth, d);
                          const isWk = dayDate.getDay() === 0 || dayDate.getDay() === 6;
                          const monthStr = String(currMonth + 1).padStart(2, '0');
                          const dayStr = String(d).padStart(2, '0');
                          const isToday = `${currYear}-${monthStr}-${dayStr}` === today.toISOString().substring(0, 10);
                          return <div key={d} className={`timeline-cell ${isWk ? 'weekend' : ''} ${isToday ? 'today' : ''}`} />;
                        })}

                        {/* Barra Commessa Principale */}
                        <div
                          className="timeline-bar"
                          style={{
                            left: `${(startDayNum - 1) * 38 + 2}px`,
                            width: `${spanDays * 38 - 4}px`,
                            background: `linear-gradient(135deg, ${color}, ${color}dd)`,
                          }}
                          onClick={() => setSelectedProject(proj)}
                          title={`${proj.name} (${pStart} -> ${pEnd})`}
                        >
                          {proj.code ? `[${proj.code}] ` : ''}{proj.name}
                        </div>
                      </div>
                    </div>

                    {/* Sub-rows per Fasi */}
                    {isExpanded && matchingTasks.map(t => {
                      const tStart = t.start_date ? t.start_date.substring(0, 10) : monthStartStr;
                      const tEnd = t.end_date ? t.end_date.substring(0, 10) : tStart;
                      if (tEnd < monthStartStr || tStart > monthEndStr) return null; // non in questo mese

                      const tStartDayNum = tStart < monthStartStr ? 1 : parseInt(tStart.substring(8, 10), 10);
                      const tEndDayNum = tEnd > monthEndStr ? daysInMonth : parseInt(tEnd.substring(8, 10), 10);
                      const tSpanDays = Math.max(1, tEndDayNum - tStartDayNum + 1);

                      return (
                        <div key={t.id} className="timeline-project-row timeline-task-subrow">
                          <div
                            className="timeline-project-info timeline-task-info"
                            onClick={() => setSelectedProject({ ...proj, selectedPhase: t })}
                            style={{ cursor: 'pointer', paddingLeft: 24 }}
                          >
                            <span className="timeline-proj-title" style={{ fontSize: '0.8125rem', color: 'var(--text-primary)' }} title={t.text}>
                              ↳ <strong>{t.text}</strong>
                            </span>
                            <span className="timeline-proj-meta" style={{ fontSize: '0.72rem' }}>
                              👤 {Array.isArray(t.workers) && t.workers.length > 0 ? t.workers.join(', ') : 'Nessuno'} | ⏱ {t.planned_hours || 8}h
                            </span>
                          </div>

                          <div className="timeline-row-grid" style={{ height: 44 }}>
                            {Array.from({ length: daysInMonth }, (_, i) => i + 1).map((d) => {
                              const dayDate = new Date(currYear, currMonth, d);
                              const isWk = dayDate.getDay() === 0 || dayDate.getDay() === 6;
                              const monthStr = String(currMonth + 1).padStart(2, '0');
                              const dayStr = String(d).padStart(2, '0');
                              const isToday = `${currYear}-${monthStr}-${dayStr}` === today.toISOString().substring(0, 10);
                              return <div key={d} className={`timeline-cell ${isWk ? 'weekend' : ''} ${isToday ? 'today' : ''}`} style={{ height: 44 }} />;
                            })}

                            <div
                              className="timeline-bar timeline-task-bar"
                              style={{
                                left: `${(tStartDayNum - 1) * 38 + 2}px`,
                                width: `${tSpanDays * 38 - 4}px`,
                                background: `linear-gradient(135deg, ${color}ee, ${color}99)`,
                                border: `1px solid ${color}`,
                              }}
                              onClick={() => setSelectedProject({ ...proj, selectedPhase: t })}
                              title={`[Fase] ${t.text} (${tStart} -> ${tEnd}) - Addetti: ${Array.isArray(t.workers) ? t.workers.join(', ') : ''}`}
                            >
                              ↳ {t.text} {filterWorker !== 'all' ? `(${filterWorker})` : ''}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </React.Fragment>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* MODALE DETTAGLIO COMMESSA (cliccando su una commessa) */}
      {selectedProject && (
        <div className="modal-overlay" onClick={() => setSelectedProject(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 540 }}>
            <div className="modal-header">
              <h2>Scheda Commessa</h2>
              <button className="btn-ghost btn-icon" onClick={() => setSelectedProject(null)}>✕</button>
            </div>

            <div className="calendar-modal-content">
              <div className="calendar-modal-header-badge">
                <span style={{
                  padding: '4px 10px',
                  borderRadius: 6,
                  background: STATUS_COLORS[selectedProject.status] || '#6366f1',
                  color: '#fff',
                  fontSize: '0.75rem',
                  fontWeight: 700
                }}>
                  {STATUS_LABELS_IT[selectedProject.status] || selectedProject.status.toUpperCase()}
                </span>
                <span style={{
                  padding: '4px 10px',
                  borderRadius: 6,
                  background: `${selectedProject.color || '#185FA5'}33`,
                  border: `1px solid ${selectedProject.color || '#185FA5'}`,
                  color: selectedProject.color || '#185FA5',
                  fontSize: '0.75rem',
                  fontWeight: 700
                }}>
                  Colore: {selectedProject.color || '#185FA5'}
                </span>
              </div>

              <div className="calendar-modal-row">
                <span className="calendar-modal-label">Codice Commessa</span>
                <span className="calendar-modal-val">{selectedProject.code || 'N/D'}</span>
              </div>

              <div className="calendar-modal-row">
                <span className="calendar-modal-label">Titolo</span>
                <span className="calendar-modal-val">{selectedProject.name}</span>
              </div>

              <div className="calendar-modal-row">
                <span className="calendar-modal-label">Cliente</span>
                <span className="calendar-modal-val">{selectedProject.client || 'Nessun cliente specificato'}</span>
              </div>

              <div className="calendar-modal-row">
                <span className="calendar-modal-label">Periodo e Durata</span>
                <span className="calendar-modal-val">
                  {selectedProject.start_date || 'N/D'} ➔ {selectedProject.end_date || 'N/D'} ({getDurationDays(selectedProject.start_date, selectedProject.end_date)})
                </span>
              </div>

              {selectedProject.description && (
                <div style={{ marginTop: 6, background: 'var(--bg-primary)', padding: 14, borderRadius: 8, border: '1px solid var(--border-subtle)' }}>
                  <span className="calendar-modal-label" style={{ display: 'block', marginBottom: 4 }}>Note e Specifiche</span>
                  <p style={{ fontSize: '0.875rem', color: 'var(--text-primary)', margin: 0 }}>
                    {selectedProject.description}
                  </p>
                </div>
              )}

              {/* Box Fasi e Addetti */}
              <div style={{ marginTop: 10, background: 'var(--bg-primary)', padding: 14, borderRadius: 8, border: '1px solid var(--border-subtle)' }}>
                <span className="calendar-modal-label" style={{ display: 'block', marginBottom: 8, color: 'var(--accent-400)', fontWeight: 700 }}>
                  📌 Fasi Operative {filterWorker !== 'all' ? `di ${filterWorker}` : `nella Commessa (${selectedProject.tasks?.length || 0})`}
                </span>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 180, overflowY: 'auto' }}>
                  {(filterWorker !== 'all' && selectedProject.matchingPhases ? selectedProject.matchingPhases : (selectedProject.tasks || [])).map(t => (
                    <div
                      key={t.id}
                      style={{
                        padding: '8px 10px',
                        background: selectedProject.selectedPhase?.id === t.id ? 'rgba(99, 102, 241, 0.15)' : 'var(--bg-secondary)',
                        borderRadius: 6,
                        borderLeft: `3px solid ${selectedProject.selectedPhase?.id === t.id ? '#6366f1' : (selectedProject.color || '#185FA5')}`,
                        fontSize: '0.8125rem'
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 600, color: 'var(--text-primary)' }}>
                        <span>↳ {t.text}</span>
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>⏱ {t.planned_hours || 8}h</span>
                      </div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: 4 }}>
                        📅 <strong>{t.start_date?.slice(0, 10)}</strong> ➔ <strong>{t.end_date?.slice(0, 10) || 'N/D'}</strong> | 👤 Addetti: <strong>{Array.isArray(t.workers) && t.workers.length > 0 ? t.workers.join(', ') : 'Nessuno'}</strong>
                      </div>
                    </div>
                  ))}
                  {(selectedProject.tasks || []).length === 0 && (
                    <span style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>Nessuna fase specificata in questa commessa.</span>
                  )}
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 24, paddingTop: 16, borderTop: '1px solid var(--border-subtle)' }}>
              <button type="button" className="btn btn-secondary" onClick={() => setSelectedProject(null)}>
                Chiudi
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => navigate(`/projects/${selectedProject.id}`)}
              >
                Apri Scheda Commessa ➔
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODALE LISTA COMMESSE PER IL GIORNO (cliccando su + N altre) */}
      {selectedDayProjects && (
        <div className="modal-overlay" onClick={() => setSelectedDayProjects(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 540 }}>
            <div className="modal-header">
              <h2>Commesse attive il {selectedDayProjects.dayNum} {MONTH_NAMES_IT[currMonth]} {currYear}</h2>
              <button className="btn-ghost btn-icon" onClick={() => setSelectedDayProjects(null)}>✕</button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxHeight: '60vh', overflowY: 'auto' }}>
              {selectedDayProjects.list.map(proj => {
                const color = proj.color || '#185FA5';
                return (
                  <div
                    key={proj.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '12px 14px',
                      background: 'var(--bg-primary)',
                      border: '1px solid var(--border-default)',
                      borderLeft: `4px solid ${color}`,
                      borderRadius: 8,
                      cursor: 'pointer',
                      transition: 'all 0.2s'
                    }}
                    onClick={() => {
                      setSelectedDayProjects(null);
                      setSelectedProject(proj);
                    }}
                  >
                    <div>
                      <div style={{ fontSize: '0.875rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                        {proj.code ? `[${proj.code}] ` : ''}{proj.name}
                      </div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: 2 }}>
                        {proj.client ? `${proj.client} — ` : ''}{STATUS_LABELS_IT[proj.status] || proj.status}
                      </div>
                    </div>
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        navigate(`/projects/${proj.id}`);
                      }}
                    >
                      Apri ➔
                    </button>
                  </div>
                );
              })}
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 20 }}>
              <button className="btn btn-secondary" onClick={() => setSelectedDayProjects(null)}>Chiudi</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
