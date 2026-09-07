import React, { useState, useMemo } from 'react';
import {
  CheckCircle,
  X,
  Layers,
  ShieldCheck,
  AlertTriangle,
  Eye,
  ZoomIn,
  ZoomOut
} from 'lucide-react';

const parseDateSafe = (d) => {
  if (!d) return null;
  if (d instanceof Date && !isNaN(d)) return d;
  const str = String(d).split(' ')[0].split('T')[0];
  const parts = str.split('-');
  if (parts.length === 3) {
    const yr = parseInt(parts[0], 10);
    const mo = parseInt(parts[1], 10) - 1;
    const dy = parseInt(parts[2], 10);
    const dt = new Date(yr, mo, dy);
    if (!isNaN(dt)) return dt;
  }
  const dt = new Date(d);
  return isNaN(dt) ? null : dt;
};

const formatDateIt = (d) => {
  const dt = parseDateSafe(d);
  return dt ? dt.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '-';
};

const formatShortDate = (d) => {
  const dt = parseDateSafe(d);
  return dt ? dt.toLocaleDateString('it-IT', { day: '2-digit', month: 'short' }) : '-';
};

const parseWorkers = (w) => {
  if (!w) return [];
  if (Array.isArray(w)) return w;
  try {
    const parsed = JSON.parse(w);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [String(w)];
  }
};

const isAlternativeOption = (sugg) => {
  if (!sugg) return false;
  if (sugg.is_alternative === true) return true;
  if (sugg.badge === 'Opzione Alternativa') return true;
  if (sugg.strategy_label && String(sugg.strategy_label).toLowerCase().includes('alternativa')) return true;
  if (sugg.title && String(sugg.title).toLowerCase().includes('opzione alternativa')) return true;
  if (String(sugg.id).startsWith('vac_reassign_alt_')) return true;
  return false;
};

export default function ReplanningGanttPreview({
  tasks = [],
  links = [],
  suggestions = [],
  projectStartDate,
  projectEndDate,
  onApplySuggestion,
  onClose,
  canManage = false,
  initialSuggestionId = 'all'
}) {
  const [selectedSuggestionId, setSelectedSuggestionId] = useState(initialSuggestionId || 'all');
  const [showOnlyImpacted, setShowOnlyImpacted] = useState(false);
  const [dayWidth, setDayWidth] = useState(22); // px per day (zoom)

  // Filtra suggerimenti con modifiche applicabili
  const actionableSuggestions = useMemo(() => {
    return (suggestions || []).filter((s) => s.proposed_changes);
  }, [suggestions]);

  // Suggerimenti primari per la simulazione combinata:
  // Esclude le opzioni alternative (quelle che assegnano fasi spostandole da un addetto a un altro)
  const primaryCombinedSuggestions = useMemo(() => {
    return actionableSuggestions.filter((s) => !isAlternativeOption(s));
  }, [actionableSuggestions]);

  // Suggerimento attivo (o null per 'all')
  const activeSuggestion = useMemo(() => {
    if (selectedSuggestionId === 'all') return null;
    return actionableSuggestions.find((s) => s.id === selectedSuggestionId) || null;
  }, [selectedSuggestionId, actionableSuggestions]);

  // Calcolo della simulazione dei task
  const simulatedTasks = useMemo(() => {
    const directModMap = new Map();
    const cascadeModMap = new Map();

    // Se è selezionato 'all', applichiamo solo le modifiche primarie (escludendo le opzioni alternative secondarie)
    const targets = activeSuggestion ? [activeSuggestion] : primaryCombinedSuggestions;

    targets.forEach((sugg) => {
      if (sugg.proposed_changes) {
        directModMap.set(String(sugg.proposed_changes.task_id), {
          sugg,
          changes: sugg.proposed_changes
        });
      }
      if (sugg.cascade_impact?.same_project_tasks) {
        sugg.cascade_impact.same_project_tasks.forEach((cs) => {
          cascadeModMap.set(String(cs.task_id), {
            sugg,
            cascade: cs
          });
        });
      }
    });

    return tasks.map((t) => {
      const tId = String(t.id);
      const direct = directModMap.get(tId);
      const cascade = cascadeModMap.get(tId);

      const origStart = parseDateSafe(t.start_date);
      const origEnd = parseDateSafe(t.end_date) || origStart;
      const origWorkers = parseWorkers(t.workers);

      let simStart = origStart;
      let simEnd = origEnd;
      let simWorkers = origWorkers;
      let status = 'unchanged'; // 'unchanged' | 'direct' | 'cascade'
      let shiftDays = 0;
      let relatedSugg = null;

      if (direct) {
        status = 'direct';
        relatedSugg = direct.sugg;
        simStart = parseDateSafe(direct.changes.start_date) || origStart;
        simEnd = parseDateSafe(direct.changes.end_date) || origEnd;
        simWorkers = direct.changes.workers || origWorkers;
        shiftDays = direct.changes.shift_working_days || 0;
      } else if (cascade) {
        status = 'cascade';
        relatedSugg = cascade.sugg;
        simStart = parseDateSafe(cascade.cascade.proposed_start) || origStart;
        simEnd = parseDateSafe(cascade.cascade.proposed_end) || origEnd;
        shiftDays = cascade.cascade.shift_working_days || 0;
      }

      return {
        ...t,
        origStart,
        origEnd,
        origWorkers,
        simStart,
        simEnd,
        simWorkers,
        status,
        shiftDays,
        relatedSugg
      };
    });
  }, [tasks, activeSuggestion, primaryCombinedSuggestions]);

  // Calcolo intervallo temporale armonizzato a settimane piene (Lunedì - Domenica)
  const { timelineStart, totalDays, monthsList, weeksList } = useMemo(() => {
    let minD = parseDateSafe(projectStartDate) || new Date();
    let maxD = parseDateSafe(projectEndDate) || new Date();

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (today < minD) minD = new Date(today);
    if (today > maxD) maxD = new Date(today);

    simulatedTasks.forEach((t) => {
      if (t.origStart && t.origStart < minD) minD = new Date(t.origStart);
      if (t.origEnd && t.origEnd > maxD) maxD = new Date(t.origEnd);
      if (t.simStart && t.simStart < minD) minD = new Date(t.simStart);
      if (t.simEnd && t.simEnd > maxD) maxD = new Date(t.simEnd);
    });

    // Allinea minD al Lunedì precedente (o stesso giorno se già Lunedì)
    const startMon = new Date(minD);
    startMon.setHours(0, 0, 0, 0);
    const dayOfWeek = startMon.getDay(); // 0 = Dom, 1 = Lun
    const diffToMon = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    startMon.setDate(startMon.getDate() - diffToMon);

    // Allinea maxD alla Domenica successiva + 1 settimana di respiro
    const endSun = new Date(maxD);
    endSun.setHours(0, 0, 0, 0);
    const endDow = endSun.getDay();
    const diffToSun = endDow === 0 ? 0 : 7 - endDow;
    endSun.setDate(endSun.getDate() + diffToSun + 7);

    const diffMs = endSun.getTime() - startMon.getTime();
    const totDays = Math.max(14, Math.round(diffMs / (1000 * 60 * 60 * 24)));

    // Costruisci lista settimane
    const weeks = [];
    const curWeek = new Date(startMon);
    let dayOffset = 0;
    while (curWeek < endSun) {
      weeks.push({
        date: new Date(curWeek),
        offsetDays: dayOffset
      });
      curWeek.setDate(curWeek.getDate() + 7);
      dayOffset += 7;
    }

    // Costruisci lista mesi
    const months = [];
    let curMonthDate = new Date(startMon);
    let currentMonthName = '';
    let currentMonthObj = null;

    for (let d = 0; d < totDays; d++) {
      const dateForDay = new Date(startMon);
      dateForDay.setDate(dateForDay.getDate() + d);
      const mName = dateForDay.toLocaleDateString('it-IT', { month: 'long', year: 'numeric' }).toUpperCase();

      if (mName !== currentMonthName) {
        if (currentMonthObj) {
          months.push(currentMonthObj);
        }
        currentMonthName = mName;
        currentMonthObj = {
          name: mName,
          startDay: d,
          daysCount: 1
        };
      } else if (currentMonthObj) {
        currentMonthObj.daysCount++;
      }
    }
    if (currentMonthObj) {
      months.push(currentMonthObj);
    }

    return { timelineStart: startMon, totalDays: totDays, monthsList: months, weeksList: weeks };
  }, [projectStartDate, projectEndDate, simulatedTasks]);

  // Coordinate di posizionamento in pixel
  const getDayOffset = (d) => {
    if (!d) return 0;
    const ms = d.getTime() - timelineStart.getTime();
    return ms / (1000 * 60 * 60 * 24);
  };

  const getLeftPx = (d) => {
    return Math.max(0, getDayOffset(d) * dayWidth);
  };

  const getWidthPx = (startD, endD) => {
    if (!startD || !endD) return dayWidth;
    const diff = getDayOffset(endD) - getDayOffset(startD) + 1;
    return Math.max(dayWidth, diff * dayWidth);
  };

  // Posizione Oggi e Scadenza Finale
  const today = useMemo(() => {
    const t = new Date();
    t.setHours(0, 0, 0, 0);
    return t;
  }, []);
  const todayLeftPx = getLeftPx(today);

  const deadlineDate = parseDateSafe(projectEndDate);
  const deadlineLeftPx = deadlineDate ? getLeftPx(deadlineDate) : null;

  // Filtraggio task visualizzati
  const displayedTasks = useMemo(() => {
    if (showOnlyImpacted) {
      return simulatedTasks.filter((t) => t.status !== 'unchanged');
    }
    return simulatedTasks;
  }, [simulatedTasks, showOnlyImpacted]);

  const directCount = simulatedTasks.filter((t) => t.status === 'direct').length;
  const cascadeCount = simulatedTasks.filter((t) => t.status === 'cascade').length;
  const totalTimelineWidth = totalDays * dayWidth;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(15, 23, 42, 0.75)',
        backdropFilter: 'blur(6px)',
        zIndex: 9999,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '20px',
        overflow: 'hidden'
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '1440px',
          height: '92vh',
          backgroundColor: '#ffffff',
          borderRadius: '20px',
          boxShadow: '0 25px 60px -15px rgba(0, 0, 0, 0.4)',
          border: '1px solid #e2e8f0',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* HEADER MODALE */}
        <div
          style={{
            padding: '16px 24px',
            background: 'linear-gradient(135deg, rgba(37, 99, 235, 0.08), rgba(99, 102, 241, 0.04))',
            borderBottom: '1px solid #e2e8f0',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 16
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div
              style={{
                width: 40,
                height: 40,
                borderRadius: '10px',
                background: 'linear-gradient(135deg, #2563eb, #4f46e5)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#fff',
                boxShadow: '0 4px 12px rgba(37, 99, 235, 0.25)'
              }}
            >
              <Eye size={20} />
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: '#0f172a' }}>
                  Anteprima Simulazione Gantt
                </h3>
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px',
                    padding: '2px 8px',
                    borderRadius: '12px',
                    background: '#e0f2fe',
                    color: '#0369a1',
                    border: '1px solid rgba(3, 105, 161, 0.2)'
                  }}
                >
                  Simulazione Attiva
                </span>
              </div>
              <p style={{ margin: '2px 0 0', fontSize: 12, color: '#64748b' }}>
                Confronto visivo tra <strong>Stato Attuale</strong> (barra tratteggiata) e <strong>Nuovo Stato Riprogrammato</strong> (barra piena).
                {selectedSuggestionId === 'all' && actionableSuggestions.length > primaryCombinedSuggestions.length && (
                  <span style={{ marginLeft: 6, color: '#4338ca', fontWeight: 500 }}>
                    Le opzioni alternative (riassegnazione ad altri addetti) sono escluse dalla combinazione e selezionabili singolarmente.
                  </span>
                )}
              </p>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {/* Selettore Simulazione */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: '#475569' }}>Simula:</span>
              <select
                value={selectedSuggestionId}
                onChange={(e) => setSelectedSuggestionId(e.target.value)}
                style={{
                  padding: '6px 12px',
                  borderRadius: '8px',
                  border: '1px solid #cbd5e1',
                  background: '#ffffff',
                  fontSize: 12,
                  fontWeight: 600,
                  color: '#1e293b',
                  cursor: 'pointer',
                  outline: 'none',
                  maxWidth: '380px'
                }}
              >
                <option value="all">
                  Tutte le modifiche combinate ({primaryCombinedSuggestions.length} azioni principali)
                </option>
                {actionableSuggestions.map((s, idx) => {
                  const isAlt = isAlternativeOption(s);
                  return (
                    <option key={s.id} value={s.id}>
                      {idx + 1}. {s.title} {isAlt ? '• (Opzione Alternativa)' : ''}
                    </option>
                  );
                })}
              </select>
            </div>

            {/* Controlli Zoom Scala */}
            <div style={{ display: 'flex', alignItems: 'center', background: '#f1f5f9', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '2px' }}>
              <button
                onClick={() => setDayWidth((prev) => Math.max(14, prev - 4))}
                title="Riduci zoom (-)"
                style={{
                  border: 'none',
                  background: 'transparent',
                  padding: '5px 8px',
                  cursor: 'pointer',
                  borderRadius: '6px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
              >
                <ZoomOut size={14} color="#475569" />
              </button>
              <div style={{ width: 1, height: 14, background: '#cbd5e1' }} />
              <button
                onClick={() => setDayWidth((prev) => Math.min(38, prev + 4))}
                title="Aumenta zoom (+)"
                style={{
                  border: 'none',
                  background: 'transparent',
                  padding: '5px 8px',
                  cursor: 'pointer',
                  borderRadius: '6px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
              >
                <ZoomIn size={14} color="#475569" />
              </button>
            </div>

            {/* Pulsante Chiudi */}
            <button
              onClick={onClose}
              style={{
                background: '#f1f5f9',
                border: '1px solid #cbd5e1',
                borderRadius: '8px',
                width: 32,
                height: 32,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#64748b',
                cursor: 'pointer'
              }}
              title="Chiudi anteprima"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* METRICHE E FILTRI */}
        <div
          style={{
            padding: '10px 24px',
            backgroundColor: '#f8fafc',
            borderBottom: '1px solid #e2e8f0',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 12,
            fontSize: 12
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#6366f1' }} />
              <span style={{ color: '#475569' }}>Riprogrammazioni Dirette:</span>
              <strong style={{ color: '#0f172a' }}>{directCount}</strong>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#f59e0b' }} />
              <span style={{ color: '#475569' }}>Slittamenti a Cascata:</span>
              <strong style={{ color: '#0f172a' }}>{cascadeCount}</strong>
            </div>

            {deadlineDate && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <ShieldCheck size={15} color="#10b981" />
                <span style={{ color: '#475569' }}>Scadenza Contrattuale:</span>
                <strong style={{ color: '#059669' }}>{formatDateIt(deadlineDate)}</strong>
              </div>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                color: '#334155',
                cursor: 'pointer',
                userSelect: 'none'
              }}
            >
              <input
                type="checkbox"
                checked={showOnlyImpacted}
                onChange={(e) => setShowOnlyImpacted(e.target.checked)}
                style={{ cursor: 'pointer', accentColor: '#2563eb' }}
              />
              <span>Mostra solo fasi impattate ({directCount + cascadeCount})</span>
            </label>

            {activeSuggestion && canManage && (
              <button
                className="btn btn-primary"
                onClick={() => {
                  if (onApplySuggestion) {
                    onApplySuggestion(activeSuggestion);
                  }
                }}
                style={{
                  padding: '6px 14px',
                  fontSize: 12,
                  fontWeight: 600,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  background: '#2563eb'
                }}
              >
                <CheckCircle size={14} />
                Applica Questa Modifica
              </button>
            )}
          </div>
        </div>

        {/* CONTAINER SCROLLABILE GANTT */}
        <div
          style={{
            flex: 1,
            overflow: 'auto',
            backgroundColor: '#ffffff',
            position: 'relative'
          }}
        >
          <div style={{ display: 'flex', minWidth: `${360 + totalTimelineWidth}px` }}>
            {/* COLONNA SINISTRA: ELENCO FASI (STICKY) */}
            <div
              style={{
                width: '360px',
                minWidth: '360px',
                position: 'sticky',
                left: 0,
                backgroundColor: '#ffffff',
                borderRight: '2px solid #cbd5e1',
                zIndex: 20,
                boxShadow: '4px 0 10px rgba(0, 0, 0, 0.04)'
              }}
            >
              {/* Header colonna sinistra */}
              <div
                style={{
                  height: '56px',
                  borderBottom: '2px solid #cbd5e1',
                  backgroundColor: '#f8fafc',
                  padding: '0 16px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  fontWeight: 700,
                  fontSize: 12,
                  color: '#475569',
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px'
                }}
              >
                <span>Fase / Stato</span>
                <span>Addetti</span>
              </div>

              {/* Righe elenco fasi */}
              {displayedTasks.map((task) => {
                const isDirect = task.status === 'direct';
                const isCascade = task.status === 'cascade';
                const isModified = isDirect || isCascade;
                const rowHeight = isModified ? 68 : 46;

                return (
                  <div
                    key={task.id}
                    style={{
                      height: `${rowHeight}px`,
                      borderBottom: '1px solid #e2e8f0',
                      padding: '0 16px',
                      display: 'flex',
                      flexDirection: 'column',
                      justifyContent: 'center',
                      backgroundColor: isDirect
                        ? 'rgba(99, 102, 241, 0.04)'
                        : isCascade
                          ? 'rgba(245, 158, 11, 0.04)'
                          : '#ffffff'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                      <span
                        style={{
                          fontSize: 13,
                          fontWeight: isModified ? 700 : 500,
                          color: isModified ? '#0f172a' : '#334155',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap'
                        }}
                        title={task.text}
                      >
                        {task.text}
                      </span>
                      {isDirect && (
                        <span
                          style={{
                            fontSize: 9,
                            fontWeight: 700,
                            padding: '1px 6px',
                            borderRadius: '4px',
                            background: '#ede9fe',
                            color: '#6d28d9',
                            whiteSpace: 'nowrap'
                          }}
                        >
                          Modifica
                        </span>
                      )}
                      {isCascade && (
                        <span
                          style={{
                            fontSize: 9,
                            fontWeight: 700,
                            padding: '1px 6px',
                            borderRadius: '4px',
                            background: '#fef3c7',
                            color: '#b45309',
                            whiteSpace: 'nowrap'
                          }}
                        >
                          Cascata
                        </span>
                      )}
                    </div>

                    <div
                      style={{
                        fontSize: 11,
                        color: '#64748b',
                        marginTop: 2,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 6
                      }}
                    >
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {isModified && task.simWorkers?.join(', ') !== task.origWorkers?.join(', ') ? (
                          <>
                            <span style={{ textDecoration: 'line-through', color: '#94a3b8' }}>
                              {task.origWorkers.join(', ')}
                            </span>{' '}
                            → <strong style={{ color: '#2563eb' }}>{task.simWorkers.join(', ')}</strong>
                          </>
                        ) : (
                          <span>{task.simWorkers?.join(', ') || 'Nessuno'}</span>
                        )}
                      </span>

                      {task.shiftDays > 0 && (
                        <span style={{ color: '#d97706', fontWeight: 700, fontSize: 10 }}>
                          +{task.shiftDays} gg
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* AREA CANVAS TIMELINE */}
            <div
              style={{
                width: `${totalTimelineWidth}px`,
                position: 'relative',
                backgroundColor: '#ffffff'
              }}
            >
              {/* HEADER A DUE LIVELLI: MESI E SETTIMANE */}
              <div
                style={{
                  height: '56px',
                  borderBottom: '2px solid #cbd5e1',
                  backgroundColor: '#f8fafc',
                  position: 'sticky',
                  top: 0,
                  zIndex: 10
                }}
              >
                {/* LIVELLO 1: MESI */}
                <div style={{ height: '28px', borderBottom: '1px solid #e2e8f0', display: 'flex', position: 'relative' }}>
                  {monthsList.map((m, idx) => (
                    <div
                      key={idx}
                      style={{
                        position: 'absolute',
                        left: `${m.startDay * dayWidth}px`,
                        width: `${m.daysCount * dayWidth}px`,
                        height: '28px',
                        display: 'flex',
                        alignItems: 'center',
                        paddingLeft: '10px',
                        fontSize: 11,
                        fontWeight: 700,
                        color: '#334155',
                        borderRight: '1px solid #cbd5e1',
                        backgroundColor: idx % 2 === 0 ? 'rgba(241, 245, 249, 0.7)' : 'rgba(248, 250, 252, 0.7)',
                        overflow: 'hidden',
                        whiteSpace: 'nowrap'
                      }}
                    >
                      {m.name}
                    </div>
                  ))}
                </div>

                {/* LIVELLO 2: SETTIMANE (LUNEDÌ) */}
                <div style={{ height: '28px', display: 'flex', position: 'relative' }}>
                  {weeksList.map((w, idx) => (
                    <div
                      key={idx}
                      style={{
                        position: 'absolute',
                        left: `${w.offsetDays * dayWidth}px`,
                        width: `${7 * dayWidth}px`,
                        height: '28px',
                        display: 'flex',
                        alignItems: 'center',
                        paddingLeft: '6px',
                        fontSize: 11,
                        fontWeight: 600,
                        color: '#64748b',
                        borderRight: '1px solid #e2e8f0',
                        overflow: 'hidden',
                        whiteSpace: 'nowrap'
                      }}
                    >
                      {w.date.toLocaleDateString('it-IT', { day: '2-digit', month: 'short' })}
                    </div>
                  ))}
                </div>
              </div>

              {/* GRIGLIA VERTICALE DI SFONDO (SETTIMANE) */}
              <div
                style={{
                  position: 'absolute',
                  top: '56px',
                  bottom: 0,
                  left: 0,
                  right: 0,
                  pointerEvents: 'none',
                  zIndex: 1
                }}
              >
                {weeksList.map((w, idx) => (
                  <div
                    key={idx}
                    style={{
                      position: 'absolute',
                      left: `${w.offsetDays * dayWidth}px`,
                      top: 0,
                      bottom: 0,
                      width: '1px',
                      backgroundColor: '#f1f5f9'
                    }}
                  />
                ))}

                {/* LINEA VERTICALE: OGGI */}
                <div
                  style={{
                    position: 'absolute',
                    left: `${todayLeftPx}px`,
                    top: 0,
                    bottom: 0,
                    width: '2px',
                    backgroundColor: '#2563eb',
                    zIndex: 15
                  }}
                >
                  <div
                    style={{
                      position: 'absolute',
                      top: '2px',
                      left: '4px',
                      fontSize: 9,
                      fontWeight: 700,
                      color: '#ffffff',
                      background: '#2563eb',
                      padding: '1px 5px',
                      borderRadius: '3px',
                      whiteSpace: 'nowrap'
                    }}
                  >
                    Oggi: {formatShortDate(today)}
                  </div>
                </div>

                {/* LINEA VERTICALE: SCADENZA COMMESSA */}
                {deadlineLeftPx !== null && (
                  <div
                    style={{
                      position: 'absolute',
                      left: `${deadlineLeftPx}px`,
                      top: 0,
                      bottom: 0,
                      width: '2px',
                      borderLeft: '2px dashed #dc2626',
                      zIndex: 15
                    }}
                  >
                    <div
                      style={{
                        position: 'absolute',
                        top: '2px',
                        left: '4px',
                        fontSize: 9,
                        fontWeight: 700,
                        color: '#ffffff',
                        background: '#dc2626',
                        padding: '1px 5px',
                        borderRadius: '3px',
                        whiteSpace: 'nowrap'
                      }}
                    >
                      Scadenza: {formatShortDate(deadlineDate)}
                    </div>
                  </div>
                )}
              </div>

              {/* RIGHE DI BARRE GANTT */}
              <div style={{ position: 'relative', zIndex: 5 }}>
                {displayedTasks.map((task) => {
                  const isDirect = task.status === 'direct';
                  const isCascade = task.status === 'cascade';
                  const isModified = isDirect || isCascade;
                  const rowHeight = isModified ? 68 : 46;

                  // Coordinate barra originale
                  const origLeft = getLeftPx(task.origStart);
                  const origWidth = getWidthPx(task.origStart, task.origEnd);

                  // Coordinate barra simulata
                  const simLeft = getLeftPx(task.simStart);
                  const simWidth = getWidthPx(task.simStart, task.simEnd);

                  return (
                    <div
                      key={task.id}
                      style={{
                        height: `${rowHeight}px`,
                        borderBottom: '1px solid #e2e8f0',
                        position: 'relative',
                        display: 'flex',
                        alignItems: 'center'
                      }}
                    >
                      {/* SE LA FASE È MODIFICATA: DUE CORSIE CHIARE (LANE 1: ORIGINALE, LANE 2: PROPOSTO) */}
                      {isModified ? (
                        <>
                          {/* CORSIA 1 (ALTO): STATO ORIGINALE GHOST BAR */}
                          <div
                            style={{
                              position: 'absolute',
                              left: `${origLeft}px`,
                              width: `${origWidth}px`,
                              top: '8px',
                              height: '22px',
                              borderRadius: '5px',
                              border: '1px dashed #94a3b8',
                              backgroundColor: 'rgba(226, 232, 240, 0.7)',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: origWidth > 130 ? 'space-between' : 'center',
                              padding: '0 8px',
                              fontSize: 10,
                              color: '#64748b',
                              fontWeight: 600,
                              zIndex: 6,
                              overflow: 'hidden',
                              whiteSpace: 'nowrap'
                            }}
                            title={`Stato Originale: ${formatDateIt(task.origStart)} → ${formatDateIt(task.origEnd)} (${task.origWorkers.join(', ')})`}
                          >
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              Orig: {formatShortDate(task.origStart)} - {formatShortDate(task.origEnd)}
                            </span>
                            {origWidth > 130 && (
                              <span style={{ opacity: 0.8, fontSize: 9, flexShrink: 0 }}>
                                {task.origWorkers.join(', ')}
                              </span>
                            )}
                          </div>

                          {/* CORSIA 2 (BASSO): NUOVO STATO PROPOSTO */}
                          <div
                            style={{
                              position: 'absolute',
                              left: `${simLeft}px`,
                              width: `${simWidth}px`,
                              top: '36px',
                              height: '24px',
                              borderRadius: '5px',
                              background: isDirect
                                ? 'linear-gradient(90deg, #6366f1, #4f46e5)'
                                : 'linear-gradient(90deg, #f59e0b, #d97706)',
                              boxShadow: '0 2px 6px rgba(0, 0, 0, 0.15)',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              padding: '0 8px',
                              color: '#ffffff',
                              fontSize: 11,
                              fontWeight: 600,
                              zIndex: 8,
                              overflow: 'hidden',
                              whiteSpace: 'nowrap'
                            }}
                            title={`Nuovo Stato Proposto: ${formatDateIt(task.simStart)} → ${formatDateIt(task.simEnd)} (${task.simWorkers.join(', ')})`}
                          >
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {task.text}
                            </span>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                              <span style={{ fontSize: 10, opacity: 0.9 }}>
                                {formatShortDate(task.simStart)} - {formatShortDate(task.simEnd)}
                              </span>
                              {task.shiftDays > 0 && (
                                <span
                                  style={{
                                    padding: '1px 5px',
                                    borderRadius: '3px',
                                    background: 'rgba(0, 0, 0, 0.3)',
                                    fontSize: 9,
                                    fontWeight: 700
                                  }}
                                >
                                  +{task.shiftDays}g
                                </span>
                              )}
                            </div>
                          </div>
                        </>
                      ) : (
                        /* FASE INVARIATA (SINGOLA CORSIA) */
                        <div
                          style={{
                            position: 'absolute',
                            left: `${origLeft}px`,
                            width: `${origWidth}px`,
                            height: '24px',
                            borderRadius: '5px',
                            background: 'linear-gradient(90deg, #3b82f6, #2563eb)',
                            boxShadow: '0 1px 3px rgba(0, 0, 0, 0.08)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            padding: '0 8px',
                            color: '#ffffff',
                            fontSize: 11,
                            fontWeight: 500,
                            zIndex: 6,
                            overflow: 'hidden',
                            whiteSpace: 'nowrap'
                          }}
                          title={`Fase Invariata: ${formatDateIt(task.origStart)} → ${formatDateIt(task.origEnd)} (${task.origWorkers.join(', ')})`}
                        >
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {task.text}
                          </span>
                          <span style={{ fontSize: 10, opacity: 0.85, flexShrink: 0 }}>
                            {formatShortDate(task.origStart)} - {formatShortDate(task.origEnd)}
                          </span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        {/* FOOTER: LEGENDA ELEGANTE */}
        <div
          style={{
            padding: '12px 24px',
            background: '#f8fafc',
            borderTop: '1px solid #e2e8f0',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 16,
            fontSize: 12
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 14, height: 14, borderRadius: 3, background: 'linear-gradient(90deg, #6366f1, #4f46e5)' }} />
              <span style={{ color: '#334155', fontWeight: 600 }}>Nuova Proposta (Diretta)</span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 14, height: 14, borderRadius: 3, background: 'linear-gradient(90deg, #f59e0b, #d97706)' }} />
              <span style={{ color: '#334155', fontWeight: 600 }}>Slittamento a Cascata</span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 14, height: 14, borderRadius: 3, border: '1px dashed #94a3b8', background: 'rgba(226, 232, 240, 0.8)' }} />
              <span style={{ color: '#64748b' }}>Stato Originale (Ghost)</span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 14, height: 14, borderRadius: 3, background: 'linear-gradient(90deg, #3b82f6, #2563eb)' }} />
              <span style={{ color: '#334155' }}>Fase Invariata</span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 12, height: 0, borderBottom: '2px dashed #dc2626', display: 'inline-block' }} />
              <span style={{ color: '#dc2626', fontWeight: 700 }}>Scadenza Contrattuale</span>
            </div>
          </div>

          <button
            className="btn btn-secondary"
            onClick={onClose}
            style={{ padding: '6px 16px', fontSize: 12 }}
          >
            Chiudi
          </button>
        </div>
      </div>
    </div>
  );
}
