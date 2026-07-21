import React, { useState } from 'react';
import { getTaskColor } from '../../utils/phaseColors';
import { isTaskCompleted } from '../../utils/taskCompletion';

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

const WEEKDAYS_IT = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'];

export default function TimelineView({ projects, currYear, currMonth, filterWorker, onSelectProject }) {
  const today = new Date();
  const daysInMonth = new Date(currYear, currMonth + 1, 0).getDate();
  const [expandedProjects, setExpandedProjects] = useState({});

  return (
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
        {projects.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-secondary)' }}>
            Nessuna commessa o fase trovata per te in questo mese.
          </div>
        ) : (
          projects.map((proj) => {
            const color = proj.color || '#185FA5';
            const monthStartStr = `${currYear}-${String(currMonth + 1).padStart(2, '0')}-01`;
            const monthEndStr = `${currYear}-${String(currMonth + 1).padStart(2, '0')}-${String(daysInMonth).padStart(2, '0')}`;
            
            const pStart = proj.start_date ? proj.start_date.substring(0, 10) : monthStartStr;
            const pEnd = proj.end_date ? proj.end_date.substring(0, 10) : pStart;

            // Controlla se visibile in questo mese
            if (pEnd < monthStartStr || pStart > monthEndStr) {
              return (
                <div key={proj.id} className="timeline-project-row">
                  <div className="timeline-project-info" onClick={() => onSelectProject(proj)} style={{ cursor: 'pointer' }}>
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
              if (filterWorker && filterWorker !== 'all') {
                return Array.isArray(t.workers) && t.workers.includes(filterWorker);
              }
              return true;
            });
            const isExpanded = expandedProjects[proj.id] || (filterWorker && filterWorker !== 'all');

            return (
              <React.Fragment key={proj.id}>
                <div className="timeline-project-row">
                  <div className="timeline-project-info" onClick={() => onSelectProject(proj)} style={{ cursor: 'pointer' }}>
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
                      onClick={() => onSelectProject(proj)}
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
                  const tColor = getTaskColor(t);
                  const isCompleted = isTaskCompleted(t);

                  return (
                    <div key={t.id} className={`timeline-project-row timeline-task-subrow ${isCompleted ? 'timeline-row-completed' : ''}`}>
                      <div
                        className={`timeline-project-info timeline-task-info ${isCompleted ? 'timeline-row-completed' : ''}`}
                        onClick={() => onSelectProject({ ...proj, selectedPhase: t })}
                        style={{ cursor: 'pointer', paddingLeft: 24, borderLeft: `3px solid ${isCompleted ? '#10b981' : tColor}` }}
                      >
                        <span className="timeline-proj-title" style={{ fontSize: '0.8125rem', color: 'var(--text-primary)' }} title={t.text}>
                          ↳ {isCompleted && <span style={{ color: '#10b981', fontWeight: 'bold', marginRight: '6px' }} title="Fase completata">✓</span>}
                          <strong>{t.text}</strong>
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
                            background: isCompleted ? '#10b981' : `linear-gradient(135deg, ${tColor}ee, ${tColor}99)`,
                            border: `1px solid ${isCompleted ? '#059669' : tColor}`,
                          }}
                          onClick={() => onSelectProject({ ...proj, selectedPhase: t })}
                          title={`[Fase] ${t.text} (${tStart} -> ${tEnd}) - Addetti: ${Array.isArray(t.workers) ? t.workers.join(', ') : ''}`}
                        >
                          ↳ {isCompleted ? '✓ ' : ''}{t.text} {(filterWorker && filterWorker !== 'all') ? `(${filterWorker})` : ''}
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
  );
}
