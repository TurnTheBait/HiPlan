import React, { useState, useEffect } from 'react';
import api from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import './WorkloadHeatmap.css';
import { isWeekendOrHoliday } from '../../utils/workingDays';
import useDragScroll from '../../hooks/useDragScroll';
import AppIcon from '../ui/AppIcon';

export default function WorkloadHeatmap() {
  const { user } = useAuth();
  const [heatmapData, setHeatmapData] = useState({});
  const [loading, setLoading] = useState(true);
  const [expandedUsers, setExpandedUsers] = useState({});
  const [viewMode, setViewMode] = useState('day');
  const [adminVacationUser, setAdminVacationUser] = useState(null);
  const [vacationForm, setVacationForm] = useState({ start_date: '', end_date: '', reason: '' });
  const [submittingVacation, setSubmittingVacation] = useState(false);
  
  const toast = useToast();
  const gridRef = React.useRef(null);
  useDragScroll(gridRef, [loading]);
  useEffect(() => {
    fetchWorkload();
  }, []);

  const fetchWorkload = async () => {
    try {
      const res = await api.get('/workload/heatmap');
      setHeatmapData(res.data.heatmap);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleAdminAddVacation = async (e) => {
    e.preventDefault();
    if (!vacationForm.start_date || !vacationForm.end_date) {
      toast.error('Seleziona la data di inizio e di fine.');
      return;
    }
    setSubmittingVacation(true);
    try {
      const res = await api.post(`/vacations/admin/user/${adminVacationUser.id}`, vacationForm);
      toast.success('Ferie aggiunte con successo.');
      if (res.data.recovery_items?.length > 0) {
        toast.warning(`⚠️ ${res.data.recovery_items.length} fase/i con ore da recuperare rilevate.`);
      }
      setAdminVacationUser(null);
      setVacationForm({ start_date: '', end_date: '', reason: '' });
      fetchWorkload();
    } catch (err) {
      toast.error('Errore durante l\'inserimento delle ferie.');
    } finally {
      setSubmittingVacation(false);
    }
  };

  const toggleUser = (userId) => {
    setExpandedUsers(prev => ({ ...prev, [userId]: !prev[userId] }));
  };

  // Build full date range including weekends
  const allWorkDates = new Set();
  Object.values(heatmapData).forEach(u => {
    Object.keys(u.workload).forEach(d => allWorkDates.add(d));
  });

  let minDateStr = null;
  let maxDateStr = null;
  if (allWorkDates.size > 0) {
    const sorted = Array.from(allWorkDates).sort();
    minDateStr = sorted[0];
    maxDateStr = sorted[sorted.length - 1];
  }

  if (!minDateStr || !maxDateStr) {
    const today = new Date();
    const fiveDaysLater = new Date(today);
    fiveDaysLater.setDate(fiveDaysLater.getDate() + 7);
    minDateStr = today.toISOString().substring(0, 10);
    maxDateStr = fiveDaysLater.toISOString().substring(0, 10);
  }

  // Only generate all-day grid in 'day' view
  const fullDatesSet = new Set(allWorkDates);
  if (viewMode === 'day' && minDateStr && maxDateStr) {
    const start = new Date(minDateStr);
    const end = new Date(maxDateStr);
    const cur = new Date(start);
    while (cur <= end) {
      fullDatesSet.add(cur.toISOString().substring(0, 10));
      cur.setDate(cur.getDate() + 1);
    }
  }

  const sortedDates = Array.from(fullDatesSet).sort();

  const columnsMap = new Map();
  sortedDates.forEach(dStr => {
    const d = new Date(dStr);
    let key, label;
    if (viewMode === 'month') {
      key = dStr.substring(0, 7);
      label = d.toLocaleDateString('it-IT', { month: 'short', year: 'numeric' });
    } else if (viewMode === 'week') {
      const day = d.getDay();
      const diff = d.getDate() - day + (day === 0 ? -6 : 1);
      const monday = new Date(d);
      monday.setDate(diff);
      key = monday.toISOString().substring(0, 10);
      label = 'Sett. ' + monday.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit' });
    } else {
      key = dStr;
      const dayLabel = d.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit' });
      label = dayLabel;
    }
    if (!columnsMap.has(key)) columnsMap.set(key, label);
  });
  const columns = Array.from(columnsMap.keys()).sort();

  const getTodayKey = (mode) => {
    const now = new Date();
    if (mode === 'month') {
      return now.toISOString().substring(0, 7);
    } else if (mode === 'week') {
      const day = now.getDay();
      const diff = now.getDate() - day + (day === 0 ? -6 : 1);
      const monday = new Date(now);
      monday.setDate(diff);
      return monday.toISOString().substring(0, 10);
    } else {
      return now.toISOString().substring(0, 10);
    }
  };

  const todayKey = getTodayKey(viewMode);

  const scrollToToday = () => {
    if (!gridRef.current || columns.length === 0) return;
    setTimeout(() => {
      let targetEl = gridRef.current.querySelector('[data-colkey="' + todayKey + '"]');
      if (!targetEl) {
        const futureCol = columns.find(c => c >= todayKey);
        const fallbackKey = futureCol || columns[columns.length - 1];
        if (fallbackKey) targetEl = gridRef.current.querySelector('[data-colkey="' + fallbackKey + '"]');
      }
      if (targetEl && gridRef.current) {
        const containerWidth = gridRef.current.clientWidth;
        const targetOffsetLeft = targetEl.offsetLeft;
        const targetWidth = targetEl.clientWidth;
        const scrollLeft = targetOffsetLeft - (containerWidth / 2) + (targetWidth / 2) - 100;
        gridRef.current.scrollTo({ left: Math.max(0, scrollLeft), behavior: 'smooth' });
      }
    }, 60);
  };

  useEffect(() => {
    if (!loading && columns.length > 0) {
      scrollToToday();
    }
  }, [loading, columns, viewMode]);

  const capacityMap = { day: 8, week: 40, month: 160 };
  const currentCapacity = capacityMap[viewMode];

  const isColumnWeekend = (colKey) => {
    if (viewMode === 'day') {
      const d = new Date(colKey);
      return isWeekendOrHoliday(d);
    }
    return false;
  };

  const isUserOnVacation = (userId, dateStr) => {
    const userData = heatmapData[userId];
    if (!userData || !userData.vacations) return false;
    return userData.vacations.some(v => {
      return dateStr >= v.start_date && dateStr <= v.end_date;
    });
  };

  const formatDateStr = (key) => {
    const [y, m, d] = key.split('-');
    return d + '/' + m + '/' + y;
  };

  if (loading) return <div>Caricamento mappa di calore...</div>;

  return (
    <div className="workload-heatmap-container">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <div>
          <h3 style={{ margin: 0 }}>Saturazione Carichi di Lavoro</h3>
          <span style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
            Panoramica ore assegnate nelle fasi dei vari progetti (ore previste, non a consuntivo)
          </span>
        </div>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          <button 
            className="btn btn-secondary btn-sm" 
            onClick={scrollToToday}
            title="Centra la tabella sulla data di oggi"
            style={{ display: 'flex', alignItems: 'center', gap: '4px' }}
          >
            <AppIcon name="calendar" size={15} />
            Oggi
          </button>
          <select 
            className="input" 
            value={viewMode} 
            onChange={(e) => setViewMode(e.target.value)}
            style={{ width: 150 }}
          >
            <option value="day">Per Giorno</option>
            <option value="week">Per Settimana</option>
            <option value="month">Per Mese</option>
          </select>
        </div>
      </div> {/* <-- CORRETTO: Chiusura del div flexbox header che mancava */}

      <div className="heatmap-grid" ref={gridRef} style={{ gridTemplateColumns: '200px repeat(' + columns.length + ', 90px)' }}>

        {/* Header (Columns) */}
        <div className="heatmap-header-cell sticky-col sticky-header-col">Addetto</div>
        {columns.map(colKey => {
          const isWeekendCol = isColumnWeekend(colKey);
          const isTodayCol = colKey === todayKey;
          const colDateStr = viewMode === 'day' ? formatDateStr(colKey) : columnsMap.get(colKey);
          const titleParts = [];
          if (isWeekendCol) titleParts.push('Sabato/Domenica');
          if (isTodayCol) titleParts.push('Oggi');
          const titleText = colDateStr + (titleParts.length > 0 ? ' - ' + titleParts.join(', ') : '');
          return (
            <div 
              key={colKey} 
              data-colkey={colKey}
              className={'heatmap-header-cell' + (isTodayCol ? ' today-header' : '') + (isWeekendCol ? ' weekend-header' : '')}
              title={titleText}
            >
              {columnsMap.get(colKey)}
              {isTodayCol && (
                <div style={{ fontSize: '0.7rem', color: 'var(--accent-500)', fontWeight: 800 }}>Oggi</div>
              )}
            </div>
          );
        })}

        {/* Rows (Users) - sorted alphabetically by username */}
        {Object.entries(heatmapData).sort(([, a], [, b]) => (a.full_name || '').localeCompare(b.full_name || '', 'it')).map(([userId, userData]) => {

          const aggregatedWorkload = {};
          columns.forEach(c => aggregatedWorkload[c] = { hours: 0, tasks: [] });

          Object.entries(userData.workload).forEach(([dStr, dayData]) => {
            const d = new Date(dStr);
            let key;
            if (viewMode === 'month') key = dStr.substring(0, 7);
            else if (viewMode === 'week') {
              const day = d.getDay();
              const diff = d.getDate() - day + (day === 0 ? -6 : 1);
              const monday = new Date(d);
              monday.setDate(diff);
              key = monday.toISOString().substring(0, 10);
            } else {
              key = dStr;
            }

            if (aggregatedWorkload[key]) {
              aggregatedWorkload[key].hours += dayData.hours;
              dayData.tasks.forEach(t => {
                const existing = aggregatedWorkload[key].tasks.find(x => x.id === t.id);
                if (existing) {
                  existing.hours += t.hours;
                } else {
                  aggregatedWorkload[key].tasks.push({ ...t });
                }
              });
            }
          });

          const isCurrentUser = userData.username === user?.username;
          return (
            <React.Fragment key={userId}>
              <div
                className="heatmap-user-cell sticky-col sticky-user-col"
                onClick={() => toggleUser(userId)}
                style={{
                  cursor: 'pointer',
                  background: isCurrentUser ? 'rgba(59,130,246,0.13)' : undefined,
                  color: isCurrentUser ? 'var(--accent-400)' : undefined,
                  fontWeight: isCurrentUser ? 800 : undefined,
                  borderLeft: isCurrentUser ? '3px solid var(--accent-400)' : undefined,
                }}
                title="Clicca per espandere/comprimere il dettaglio progetti e fasi"
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', width: '100%' }}>
                  <span style={{ minWidth: '12px' }}>{expandedUsers[userId] ? '\u25BC' : '\u25B6'}</span>
                  <span style={{ flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {userData.full_name}{isCurrentUser ? ' (tu)' : ''}
                  </span>
                  {(user?.role === 'admin' || user?.role === 'editor') && (
                    <button
                      className="btn btn-secondary"
                      style={{ padding: '2px 4px', fontSize: '0.65rem', minWidth: 'auto', background: 'var(--bg-secondary)', border: '1px solid var(--border-default)' }}
                      title={`Inserisci ferie per ${userData.full_name}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        setAdminVacationUser({ id: userId, name: userData.full_name });
                      }}
                    >
                      ✈️ +
                    </button>
                  )}
                </div>
              </div>

              {/* Cella Saturazione */}
              {columns.map(colKey => {
                const data = aggregatedWorkload[colKey];
                
                // <-- CORRETTO: Dichiarate e calcolate le variabili mancanti
                const isVacation = isUserOnVacation(userId, colKey);
                const isWeekendCol = isColumnWeekend(colKey);
                let colorClass = '';
                
                if (!isVacation && !isWeekendCol && data.hours > 0) {
                  if (data.hours > currentCapacity) {
                    colorClass = 'over-capacity'; // Assumo tu abbia queste classi nel CSS
                  } else if (data.hours === currentCapacity) {
                    colorClass = 'at-capacity';
                  } else {
                    colorClass = 'under-capacity';
                  }
                }

                let tooltipText = '';
                
                if (isVacation) {
                  tooltipText = 'Ferie (' + formatDateStr(colKey) + ')';
                } else if (isWeekendCol) {
                  tooltipText = formatDateStr(colKey) + ' (Sabato/Domenica/Festivo)';
                } else if (data.tasks.length > 0) {
                  tooltipText = data.tasks.map(t => '📁 ' + (t.project_name || 'Progetto') + '\n   📌 ' + t.name + ': ' + (t.hours?.toFixed(1) || 0) + 'h (' + columnsMap.get(colKey) + ') | Totale Fase: ' + (t.total_assigned_hours?.toFixed(1) || '-') + 'h').join('\n\n');
                } else {
                  tooltipText = 'Nessuna ora assegnata';
                }

                let displayContent;
                if (isVacation) {
                  displayContent = '🏖️';
                } else if (isWeekendCol) {
                  displayContent = data.hours > 0 ? data.hours.toFixed(1) + 'h' : '';
                } else {
                  displayContent = data.hours > 0 ? data.hours.toFixed(1) + 'h' : '-';
                }

                return (
                  <div 
                    key={colKey} 
                    className={'heatmap-cell ' + colorClass + (colKey === todayKey ? ' today-cell' : '') + (isWeekendCol ? ' heatmap-weekend' : '')}
                    title={tooltipText}
                  >
                    {displayContent}
                  </div>
                );
              })}

              {/* Dettagli tasks se espanso */}
              {expandedUsers[userId] && (
                <div style={{ gridColumn: '1 / span ' + (columns.length + 1), padding: '12px 20px', background: 'var(--bg-tertiary)', borderTop: '1px solid var(--border-default)', borderBottom: '1px solid var(--border-default)' }}>
                  <h5 style={{ margin: '0 0 10px 0', color: 'var(--text-primary)' }}>
                    Panoramica Fasi e Progetti assegnati a <strong>{userData.full_name}</strong>:
                  </h5>
                  <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                    {columns.map(colKey => {
                       const tasks = aggregatedWorkload[colKey].tasks;
                       if (tasks.length === 0) return null;
                       return tasks.map((t, idx) => (
                         <div key={colKey + '-' + idx} style={{ padding: '8px 12px', background: 'var(--bg-card)', borderRadius: '6px', border: '1px solid var(--border-default)', fontSize: '0.82rem', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
                           <div style={{ color: 'var(--accent-500)', fontWeight: 700, marginBottom: 2 }}>
                             📁 {t.project_name || 'Progetto non specificato'}
                           </div>
                           <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                             📌 {t.name}
                           </div>
                           <div style={{ marginTop: 4, fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                             <span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{t.hours?.toFixed(1) || 0}h/giorno</span> ({columnsMap.get(colKey)}) • Totale fase: {t.total_assigned_hours ? t.total_assigned_hours.toFixed(1) + 'h' : '-'}
                           </div>
                         </div>
                       ));
                    })}
                  </div>
                </div>
              )}
            </React.Fragment>
          );
        })}
      </div> {/* <-- CORRETTO: Aggiunta la chiusura della div heatmap-grid */}

      {/* Modale Inserimento Ferie da parte dell'Admin/Editor */}
      {adminVacationUser && (
        <div className="modal-overlay" onClick={() => setAdminVacationUser(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 400 }}>
            <div className="modal-header">
              <h2>Inserisci Ferie per {adminVacationUser.name}</h2>
              <button className="btn-ghost btn-icon" onClick={() => setAdminVacationUser(null)}>
                <AppIcon name="close" />
              </button>
            </div>
            <div className="modal-content">
              <form onSubmit={handleAdminAddVacation} style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                <div className="form-group">
                  <label>Dal giorno</label>
                  <input
                    type="date"
                    className="input"
                    value={vacationForm.start_date}
                    onChange={(e) => setVacationForm({ ...vacationForm, start_date: e.target.value })}
                    required
                  />
                </div>
                <div className="form-group">
                  <label>Al giorno (compreso)</label>
                  <input
                    type="date"
                    className="input"
                    value={vacationForm.end_date}
                    onChange={(e) => setVacationForm({ ...vacationForm, end_date: e.target.value })}
                    required
                  />
                </div>
                <div className="form-group">
                  <label>Motivo (opzionale)</label>
                  <input
                    type="text"
                    className="input"
                    placeholder="Es. Ferie estive, Rol, Malattia..."
                    value={vacationForm.reason}
                    onChange={(e) => setVacationForm({ ...vacationForm, reason: e.target.value })}
                  />
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '10px' }}>
                  <button type="button" className="btn btn-secondary" onClick={() => setAdminVacationUser(null)}>
                    Annulla
                  </button>
                  <button type="submit" className="btn btn-primary" disabled={submittingVacation}>
                    {submittingVacation ? 'Salvataggio...' : 'Conferma Inserimento'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
