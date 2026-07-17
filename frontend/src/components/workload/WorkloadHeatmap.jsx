import React, { useState, useEffect } from 'react';
import api from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import './WorkloadHeatmap.css';

export default function WorkloadHeatmap() {
  const { user } = useAuth();
  const [heatmapData, setHeatmapData] = useState({});
  const [loading, setLoading] = useState(true);
  const [expandedUsers, setExpandedUsers] = useState({});
  const [viewMode, setViewMode] = useState('day'); // 'day', 'week', 'month'
  const gridRef = React.useRef(null);

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

  const toggleUser = (userId) => {
    setExpandedUsers(prev => ({ ...prev, [userId]: !prev[userId] }));
  };

  // Raggruppamento date in colonne
  const allDates = new Set();
  Object.values(heatmapData).forEach(u => {
    Object.keys(u.workload).forEach(d => allDates.add(d));
  });

  // Se non ci sono dati, mostra almeno i prossimi 5 giorni lavorativi
  if (allDates.size === 0) {
    const today = new Date();
    for (let i = 0; i < 7; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() + i);
      if (d.getDay() !== 0 && d.getDay() !== 6) {
        allDates.add(d.toISOString().substring(0, 10));
      }
    }
  }

  const sortedDates = Array.from(allDates).sort();

  const columnsMap = new Map();
  sortedDates.forEach(dStr => {
    const d = new Date(dStr);
    let key, label;
    if (viewMode === 'month') {
      key = dStr.substring(0, 7); // YYYY-MM
      label = d.toLocaleDateString('it-IT', { month: 'short', year: 'numeric' });
    } else if (viewMode === 'week') {
      const day = d.getDay();
      const diff = d.getDate() - day + (day === 0 ? -6 : 1);
      const monday = new Date(d);
      monday.setDate(diff);
      key = monday.toISOString().substring(0, 10);
      label = "Sett. " + monday.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit' });
    } else {
      key = dStr;
      label = d.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit' });
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
      let targetEl = gridRef.current.querySelector(`[data-colkey="${todayKey}"]`);
      if (!targetEl) {
        const futureCol = columns.find(c => c >= todayKey);
        const fallbackKey = futureCol || columns[columns.length - 1];
        if (fallbackKey) targetEl = gridRef.current.querySelector(`[data-colkey="${fallbackKey}"]`);
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
            📍 Oggi
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
      </div>

      <div className="heatmap-grid" ref={gridRef} style={{ gridTemplateColumns: `200px repeat(${columns.length}, 90px)` }}>
        
        {/* Header (Columns) */}
        <div className="heatmap-header-cell sticky-col sticky-header-col">Addetto</div>
        {columns.map(colKey => (
          <div 
            key={colKey} 
            data-colkey={colKey}
            className={`heatmap-header-cell ${colKey === todayKey ? 'today-header' : ''}`}
            title={colKey === todayKey ? 'Data di Oggi' : ''}
          >
            {columnsMap.get(colKey)}
            {colKey === todayKey && (
              <div style={{ fontSize: '0.7rem', color: 'var(--accent-500)', fontWeight: 800 }}>📍 Oggi</div>
            )}
          </div>
        ))}

        {/* Rows (Users) */}
        {Object.entries(heatmapData).map(([userId, userData]) => {
          
          // Aggrega il workload per questo utente
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

          return (
            <React.Fragment key={userId}>
              <div className="heatmap-user-cell sticky-col sticky-user-col" onClick={() => toggleUser(userId)} style={{ cursor: 'pointer' }} title="Clicca per espandere/comprimere il dettaglio progetti e fasi">
                <span>{expandedUsers[userId] ? '▼' : '▶'}</span>
                {userData.full_name}
              </div>
              
              {/* Cella Saturazione */}
              {columns.map(colKey => {
                const data = aggregatedWorkload[colKey];
                const ratio = data.hours / currentCapacity;
                let colorClass = '';
                
                if (data.hours > 0) {
                  if (ratio <= 0.8) colorClass = 'heatmap-green';
                  else if (ratio <= 1.0) colorClass = 'heatmap-yellow';
                  else colorClass = 'heatmap-red';
                }

                const tooltipText = data.tasks.length > 0
                  ? data.tasks.map(t => `📁 ${t.project_name || 'Progetto'}\n   📌 ${t.name}: ${t.hours?.toFixed(1) || 0}h (${columnsMap.get(colKey)}) | Totale Fase: ${t.total_assigned_hours?.toFixed(1) || '-'}h`).join('\n\n')
                  : 'Nessuna ora assegnata';

                return (
                  <div 
                    key={colKey} 
                    className={`heatmap-cell ${colorClass} ${colKey === todayKey ? 'today-cell' : ''}`}
                    title={tooltipText}
                  >
                    {data.hours > 0 ? `${data.hours.toFixed(1)}h` : '-'}
                  </div>
                );
              })}

              {/* Dettagli tasks se espanso */}
              {expandedUsers[userId] && (
                <div style={{ gridColumn: `1 / span ${columns.length + 1}`, padding: '12px 20px', background: 'var(--bg-tertiary)', borderTop: '1px solid var(--border-default)', borderBottom: '1px solid var(--border-default)' }}>
                  <h5 style={{ margin: '0 0 10px 0', color: 'var(--text-primary)' }}>
                    Panoramica Fasi e Progetti assegnati a <strong>{userData.full_name}</strong>:
                  </h5>
                  <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                    {columns.map(colKey => {
                       const tasks = aggregatedWorkload[colKey].tasks;
                       if (tasks.length === 0) return null;
                       return tasks.map((t, idx) => (
                         <div key={`${colKey}-${idx}`} style={{ padding: '8px 12px', background: 'var(--bg-card)', borderRadius: '6px', border: '1px solid var(--border-default)', fontSize: '0.82rem', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
                           <div style={{ color: 'var(--accent-500)', fontWeight: 700, marginBottom: 2 }}>
                             📁 {t.project_name || 'Progetto non specificato'}
                           </div>
                           <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                             📌 {t.name}
                           </div>
                           <div style={{ marginTop: 4, fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                             <span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{t.hours?.toFixed(1) || 0}h/giorno</span> ({columnsMap.get(colKey)}) • Totale fase: {t.total_assigned_hours ? `${t.total_assigned_hours.toFixed(1)}h` : '-'}
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
      </div>
    </div>
  );
}
