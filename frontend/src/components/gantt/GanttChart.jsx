import { useEffect, useRef, useCallback } from 'react';
import { gantt } from 'dhtmlx-gantt';
import 'dhtmlx-gantt/codebase/dhtmlxgantt.css';
import { getTaskColor } from '../../utils/phaseColors';
import { isTaskCompleted, calculateTaskEffHours } from '../../utils/taskCompletion';
import { isWeekendOrHoliday } from '../../utils/workingDays';
import './GanttChart.css';

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

export { isWeekendOrHoliday };

export default function GanttChart({ tasks, links, onTaskUpdate, onTaskCreate, onTaskDelete, onLinkCreate, onLinkDelete, onEditTask, onNewTask, visibleColumns, readOnly, projectStartDate, projectEndDate }) {

  const containerRef = useRef(null);
  const initialized = useRef(false);
  const initialScrollDone = useRef(false);
  const markerIdsRef = useRef([]);
  const projectStartDateRef = useRef(projectStartDate);
  const projectEndDateRef = useRef(projectEndDate);
  const drawCustomMarkersRef = useRef(null);
  const tasksRef = useRef(tasks);
  const onTaskUpdateRef = useRef(onTaskUpdate);
  const onTaskCreateRef = useRef(onTaskCreate);
  const onTaskDeleteRef = useRef(onTaskDelete);
  const onLinkCreateRef = useRef(onLinkCreate);
  const onLinkDeleteRef = useRef(onLinkDelete);
  const onEditTaskRef = useRef(onEditTask);
  const onNewTaskRef = useRef(onNewTask);

  useEffect(() => {
    projectStartDateRef.current = projectStartDate;
    projectEndDateRef.current = projectEndDate;
    tasksRef.current = tasks;
  }, [projectStartDate, projectEndDate, tasks]);

  useEffect(() => {
    onTaskUpdateRef.current = onTaskUpdate;
    onTaskCreateRef.current = onTaskCreate;
    onTaskDeleteRef.current = onTaskDelete;
    onLinkCreateRef.current = onLinkCreate;
    onLinkDeleteRef.current = onLinkDelete;
    onEditTaskRef.current = onEditTask;
    onNewTaskRef.current = onNewTask;
  });

  useEffect(() => {
    if (!containerRef.current || initialized.current) return;
    initialized.current = true;

    // Disabilita popup nativi di errore DHTMLX
    gantt.config.show_errors = false;

    // Configurazione
    gantt.config.readonly = Boolean(readOnly);
    gantt.config.date_format = "%Y-%m-%d %H:%i";
    gantt.config.xml_date = "%Y-%m-%d %H:%i";
    gantt.config.row_height = 44;
    gantt.config.bar_height = 26;
    gantt.config.scale_height = 64;
    gantt.config.min_column_width = 38;
    gantt.config.fit_tasks = false;
    gantt.config.autosize = false;
    gantt.config.autoscroll = true;
    // Configurazione link e task
    gantt.config.show_links = true;
    gantt.config.drag_links = true;
    gantt.config.drag_resize = false;
    gantt.config.drag_move = false;

    // Disabilita i popup nativi di conferma per l'eliminazione dei link
    gantt.config.confirm_link_deleting = false;
    if (gantt.locale && gantt.locale.labels) {
      gantt.locale.labels.confirm_link_deleting = null;
    }
    gantt.config.auto_scheduling = false;
    gantt.config.drag_progress = false;
    gantt.config.open_tree_initially = true;
    gantt.config.order_branch = true;
    gantt.config.show_progress = true;
    gantt.config.sort = true;
    gantt.config.scroll_on_click = false;

    const baseColumns = [
      {
        name: "text",
        label: "Attività",
        tree: true,
        width: 300,
        align: "left",
        resize: true,
        template: function (task) {
          const isCompleted = isTaskCompleted(task);
          const checkIcon = isCompleted ? `<span style="color: #10b981; font-weight: bold; margin-right: 6px;" title="Fase completata">✓</span>` : '';
          return `${checkIcon}${task.text || ''}`;
        }
      },
      {
        name: "start_date",
        label: "Inizio",
        align: "center",
        width: 85,
        resize: true,
        template: function (task) {
          if (task.type === 'milestone') return '-';
          return gantt.templates.date_grid(task.start_date, task);
        }
      },
      {
        name: "end_date",
        label: "Fine",
        align: "center",
        width: 85,
        resize: true,
        template: function (task) {
          if (task.type === 'milestone') return '-';
          if (!task.end_date) return '';
          const end = new Date(task.end_date);
          end.setDate(end.getDate() - 1);
          return gantt.templates.date_grid(end, task);
        }
      },
      {
        name: "event_date",
        label: "Data Evento",
        align: "center",
        width: 95,
        resize: true,
        template: function (task) {
          if (task.type === 'milestone') return gantt.templates.date_grid(task.start_date, task);
          return '-';
        }
      },
      {
        name: "duration",
        label: "Durata",
        align: "center",
        width: 105,
        template: function (task) {
          if (task.type === 'milestone') return '-';
          const d = task.orig_duration || task.duration || 1; return `${d}g (${task.planned_hours || (d * 8)}h)`;
        }
      },
      {
        name: "progress",
        label: "Progresso",
        align: "center",
        width: 70,
        template: function (task) {
          const isComp = isTaskCompleted(task);
          return (isComp ? 100 : Math.round((task.progress || 0) * 100)) + "%";
        }
      },
      {
        name: "priority",
        label: "Priorità",
        align: "center",
        width: 80,
        template: function (task) {
          const p = task.priority || 'medium';
          if (p === 'low') return 'Bassa';
          if (p === 'high') return 'Alta';
          if (p === 'critical') return 'Critica';
          return 'Media';
        }
      },
      {
        name: "workers",
        label: "Addetti",
        align: "center",
        width: 120,
        template: function (task) { return Array.isArray(task.workers) ? task.workers.join(', ') : ''; }
      },
      {
        name: "department",
        label: "Reparto",
        align: "center",
        width: 120,
        template: function (task) {
          if (!task.department || task.department === 'tutti') return '';
          let color = '#6b7280';
          let label = task.department;
          if (task.department === 'ufficio_tecnico') { color = '#3b82f6'; label = 'Ufficio Tecnico'; }
          else if (task.department === 'produzione') { color = '#10b981'; label = 'Produzione'; }
          else if (task.department === 'acquisti') { color = '#f59e0b'; label = 'Acquisti'; }
          else if (task.department === 'commerciale') { color = '#ec4899'; label = 'Commerciale'; }
          return `<div style="display:inline-flex; align-items:center; height:20px; padding:0 8px; border-radius:10px; font-size:11px; font-weight:600; background-color:${color}18; color:${color}; border:1px solid ${color}44; line-height:normal; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; vertical-align:middle;">${label}</div>`;
        }
      },
    ];

    // Inizializza con le colonne visibili attuali o di default
    gantt.config.columns = baseColumns.filter(c =>
      c.name === 'text' || (visibleColumns && visibleColumns.includes(c.name))
    );

    // Scala temporale (Mese in italiano, Giorno della settimana: Lun Mar Mer..., Numero del giorno: 12 13 14...)
    const mesiItaliani = ['Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno', 'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre'];
    const giorniItaliani = ['Dom', 'Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab'];
    const dayCssFunc = function (date) {
      const today = new Date();
      const isToday = date.getFullYear() === today.getFullYear() &&
                      date.getMonth() === today.getMonth() &&
                      date.getDate() === today.getDate();
      if (isToday) return "gantt_today_scale_cell";
      if (isWeekendOrHoliday(date)) return "gantt_weekend_scale_cell";
      return "";
    };
    gantt.config.scales = [
      { unit: "month", step: 1, format: function (date) { return `${mesiItaliani[date.getMonth()]} ${date.getFullYear()}`; } },
      { unit: "day", step: 1, css: dayCssFunc, format: function (date) { return giorniItaliani[date.getDay()]; } },
      { unit: "day", step: 1, css: dayCssFunc, format: "%d" },
    ];

    // Tooltip e Marker per il giorno di oggi e Drag Timeline
    gantt.plugins({ tooltip: true, marker: true, drag_timeline: true });
    gantt.config.drag_timeline = {
      ignore: ".gantt_task_line, .gantt_task_link, .gantt_link_control, .gantt_link_point",
      useKey: false
    };
    gantt.templates.tooltip_text = function (start, end, task) {
      if (task.type === 'milestone') {
        return `<b>${task.text}</b><br/>
          Data Evento: ${gantt.templates.tooltip_date_format(start)}<br/>
          <i>Evento / Scadenza</i>`;
      }
      const d = task.orig_duration || task.duration || 1;
      let durationText = `<b>${d} giorni</b>`;
      durationText += ` (${task.planned_hours || (d * 8)} ore previste)`;
      return `<b>${task.text}</b><br/>
        Inizio: ${gantt.templates.tooltip_date_format(start)}<br/>
        Fine: ${gantt.templates.tooltip_date_format(new Date(end.getTime() - 86400000))}<br/>
        Durata: ${durationText}<br/>
        Progresso: ${Math.round((task.progress || 0) * 100)}%`;
    };

    // Colori barre per priorità e fasi / nascondi bar per milestone / classe verde se completata
    gantt.templates.task_class = function (start, end, task) {
      if (task.type === 'milestone') {
        return 'gantt-hidden-milestone';
      }
      const isCompleted = isTaskCompleted(task);
      const isOverrun = Boolean(task.is_overrun);
      const classes = [];
      if (isCompleted) {
        classes.push('gantt-task-completed');
      } else if (isOverrun) {
        classes.push('gantt-task-overrun');
      }

      return classes.join(' ');
    };

    // Milestone e spunta di completamento
    gantt.templates.task_text = function (start, end, task) {
      if (task.type === 'milestone') return '';
      const isCompleted = isTaskCompleted(task);
      const check = isCompleted ? '✓ ' : '';
      return `${check}${task.text || ''}`;
    };

    // Classe CSS per colorare di verde lo sfondo dell'intera riga della fase completata sia in griglia che in timeline
    gantt.templates.grid_row_class = function (start, end, task) {
      const isCompleted = isTaskCompleted(task);
      if (isCompleted) return 'gantt-row-completed';
      if (task.type === 'milestone') return 'gantt-row-milestone-pending';
      return '';
    };
    gantt.templates.task_row_class = function (start, end, task) {
      const isCompleted = isTaskCompleted(task);
      if (isCompleted) return 'gantt-row-completed';
      if (task.type === 'milestone') return 'gantt-row-milestone-pending';
      return '';
    };

    // Abilita l'ereditarietà della classe CSS su tutte le sottoscale dell'header
    gantt.config.inherit_scale_class = true;

    // Configurazione orari e giorni lavorativi (esclude sabati, domeniche e festivi)
    gantt.config.work_time = true;
    gantt.config.correct_work_time = true;
    gantt.config.is_work_time = function (date) {
      return !isWeekendOrHoliday(date);
    };

    // Funzione helper per calcolare la fine esatta di una cella temporale (giorno, settimana, mese, trimestre, anno)
    function getCellEndDate(date, unit, step = 1) {
      if (unit === "quarter") return gantt.date.add(date, step * 3, "month");
      if (unit === "week") return gantt.date.add(date, step, "week");
      if (unit === "month") return gantt.date.add(date, step, "month");
      if (unit === "year") return gantt.date.add(date, step, "year");
      return gantt.date.add(date, step, "day");
    }

    // Evidenziazione della colonna verticale di sabato, domenica, festivi e oggi su tutte le viste
    gantt.templates.timeline_cell_class = function (task, date) {
      const today = new Date();
      const scales = gantt.config.scales || [];
      const bottomScale = scales.length > 0 ? scales[scales.length - 1] : { unit: "day", step: 1 };
      const unit = bottomScale.unit || "day";
      const step = bottomScale.step || 1;
      const cellEnd = getCellEndDate(date, unit, step);

      const classes = [];
      let isTaskExcluded = false;
      if (task && unit === "day") {
        let exDates = [];
        if (typeof task.excluded_dates === 'string') {
          try { exDates = JSON.parse(task.excluded_dates); } catch (e) { }
        } else if (Array.isArray(task.excluded_dates)) {
          exDates = task.excluded_dates;
        }
        const dStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
        if (exDates.includes(dStr)) {
          isTaskExcluded = true;
        }
      }

      if (unit === "day" && (isWeekendOrHoliday(date) || isTaskExcluded)) {
        classes.push("gantt_weekend_cell");
      }
      if (date <= today && today < cellEnd) {
        classes.push("gantt_today_cell");
      }
      return classes.join(" ");
    };

    // Evidenziazione delle celle di intestazione per la data di oggi (funziona per giorno, settimana, mese, trimestre, anno)
    gantt.templates.scale_cell_class = function (date, scale) {
      const today = new Date();
      const unit = scale ? scale.unit : "day";
      const step = (scale && scale.step) ? scale.step : 1;
      const cellEnd = getCellEndDate(date, unit, step);
      if (date <= today && today < cellEnd) {
        return "gantt_today_scale_cell";
      }
      return "";
    };

    // Layer per mostrare ore consuntivate extra (fuori dal periodo previsto)
    gantt.init(containerRef.current);

    gantt.attachEvent("onGanttRender", () => {
      if (drawCustomMarkersRef.current) drawCustomMarkersRef.current();
    });
    gantt.attachEvent("onGanttScroll", () => {
      if (drawCustomMarkersRef.current) drawCustomMarkersRef.current();
    });
    gantt.attachEvent("onTaskOpened", () => {
      if (drawCustomMarkersRef.current) drawCustomMarkersRef.current();
    });
    gantt.attachEvent("onTaskClosed", () => {
      if (drawCustomMarkersRef.current) drawCustomMarkersRef.current();
    });
    gantt.attachEvent("onDataRender", () => {
      if (drawCustomMarkersRef.current) drawCustomMarkersRef.current();
    });
    gantt.attachEvent("onAfterTaskAdd", () => {
      if (drawCustomMarkersRef.current) drawCustomMarkersRef.current();
    });
    gantt.attachEvent("onAfterTaskDelete", () => {
      if (drawCustomMarkersRef.current) drawCustomMarkersRef.current();
    });

    // Intercettazione doppio click e tasto "+" per aprire il modal React in italiano (con giorni, ore e addetti)
    gantt.attachEvent("onTaskDblClick", (id, e) => {
      const task = gantt.getTask(id);
      if (task && onEditTaskRef.current) {
        onEditTaskRef.current(task);
        return false;
      }
      return true;
    });

    gantt.attachEvent("onBeforeLightbox", (id) => {
      const task = gantt.getTask(id);
      if (task && task.$new) {
        gantt.deleteTask(id);
        if (onNewTaskRef.current) {
          onNewTaskRef.current(task.parent && task.parent !== 0 ? String(task.parent) : null);
        }
      } else if (task && onEditTaskRef.current) {
        onEditTaskRef.current(task);
      }
      return false; // Blocca 100% la lightbox inglese di DHTMLX
    });

    // Event handlers
    gantt.attachEvent("onAfterTaskDrag", (id, mode) => {
      const task = gantt.getTask(id);
      if (onTaskUpdateRef.current) {
        onTaskUpdateRef.current(id, {
          start_date: gantt.date.date_to_str("%Y-%m-%d")(task.start_date),
          duration: task.orig_duration || task.duration,
          progress: task.progress,
        });
      }
    });

    gantt.attachEvent("onAfterTaskAdd", (id, item) => {
      if (onTaskCreateRef.current) {
        onTaskCreateRef.current({
          text: item.text,
          start_date: gantt.date.date_to_str("%Y-%m-%d")(item.start_date),
          duration: item.duration || 1,
          parent_id: item.parent && item.parent !== 0 ? String(item.parent) : null,
        }, id);
      }
    });

    gantt.attachEvent("onBeforeTaskDelete", (id, item) => {
      if (!window.confirm(`Confermi l'eliminazione della fase di lavorazione "${item.text || 'selezionata'}"?`)) {
        return false;
      }
      return true;
    });

    gantt.attachEvent("onAfterTaskDelete", (id) => {
      if (onTaskDeleteRef.current) onTaskDeleteRef.current(id, true);
    });

    gantt.attachEvent("onBeforeLinkAdd", (id, link) => {
      if (!link.source || !link.target || String(link.source) === String(link.target)) return false;
      const existing = gantt.getLinks().find(l =>
        String(l.source) === String(link.source) && String(l.target) === String(link.target) && String(l.id) !== String(id)
      );
      if (existing) return false;
      return true;
    });

    gantt.attachEvent("onAfterLinkAdd", (id, item) => {
      if (onLinkCreateRef.current) {
        onLinkCreateRef.current({
          source: String(item.source),
          target: String(item.target),
          type: String(item.type || '0'),
        }, id);
      }
    });

    gantt.attachEvent("onLinkDblClick", (id) => {
      if (onLinkDeleteRef.current) {
        onLinkDeleteRef.current(id, false);
      }
      return false; // blocks native DHTMLX popup
    });

    gantt.attachEvent("onBeforeLinkDelete", (id, link) => {
      if (window.__programmaticLinkDelete) return true;
      if (onLinkDeleteRef.current) {
        onLinkDeleteRef.current(id, false);
      }
      return false;
    });

    const handleResize = () => {
      if (initialized.current) gantt.setSizes();
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      if (gantt.ext && gantt.ext.tooltips && gantt.ext.tooltips.tooltip) {
        gantt.ext.tooltips.tooltip.hide();
      }
      const removeTooltips = () => {
        const leftoverTooltips = document.querySelectorAll('.gantt_tooltip');
        leftoverTooltips.forEach(t => t.remove());
      };
      removeTooltips();
      setTimeout(removeTooltips, 100);
      setTimeout(removeTooltips, 500);
    };
  }, []);

  // Ascolta i cambiamenti di visibleColumns o readOnly per aggiornare la griglia
  useEffect(() => {
    if (!initialized.current) return;

    gantt.config.readonly = Boolean(readOnly);

    const baseColumns = [
      {
        name: "text",
        label: "Attività",
        tree: true,
        width: 300,
        resize: true,
        template: function (task) {
          const isCompleted = isTaskCompleted(task);
          const checkIcon = isCompleted ? `<span style="color: #10b981; font-weight: bold; margin-right: 6px;" title="Fase completata">✓</span>` : '';
          return `${checkIcon}${task.text || ''}`;
        }
      },
      {
        name: "start_date",
        label: "Inizio",
        align: "center",
        width: 85,
        resize: true,
        template: function (task) {
          if (task.type === 'milestone') return '-';
          return gantt.templates.date_grid(task.start_date, task);
        }
      },
      {
        name: "end_date",
        label: "Fine",
        align: "center",
        width: 85,
        resize: true,
        template: function (task) {
          if (task.type === 'milestone') return '-';
          if (!task.end_date) return '';
          const end = new Date(task.end_date);
          end.setDate(end.getDate() - 1);
          return gantt.templates.date_grid(end, task);
        }
      },
      {
        name: "event_date",
        label: "Data Evento",
        align: "center",
        width: 95,
        resize: true,
        template: function (task) {
          if (task.type === 'milestone') return gantt.templates.date_grid(task.start_date, task);
          return '-';
        }
      },
      {
        name: "duration",
        label: "Durata",
        align: "center",
        width: 105,
        template: function (task) {
          if (task.type === 'milestone') return '-';
          const d = task.orig_duration || task.duration || 1; return `${d}g (${task.planned_hours || (d * 8)}h)`;
        }
      },
      {
        name: "progress",
        label: "Progresso",
        align: "center",
        width: 70,
        template: function (task) { return Math.round((task.progress || 0) * 100) + "%"; }
      },
      {
        name: "priority",
        label: "Priorità",
        align: "center",
        width: 80,
        template: function (task) {
          const p = task.priority || 'medium';
          if (p === 'low') return 'Bassa';
          if (p === 'high') return 'Alta';
          if (p === 'critical') return 'Critica';
          return 'Media';
        }
      },
      {
        name: "workers",
        label: "Addetti",
        align: "center",
        width: 120,
        template: function (task) { return Array.isArray(task.workers) ? task.workers.join(', ') : ''; }
      },
      {
        name: "department",
        label: "Reparto",
        align: "center",
        width: 120,
        template: function (task) {
          if (!task.department || task.department === 'tutti') return '';
          let color = '#6b7280';
          let label = task.department;
          if (task.department === 'ufficio_tecnico') { color = '#3b82f6'; label = 'Ufficio Tecnico'; }
          else if (task.department === 'produzione') { color = '#10b981'; label = 'Produzione'; }
          else if (task.department === 'acquisti') { color = '#f59e0b'; label = 'Acquisti'; }
          else if (task.department === 'commerciale') { color = '#ec4899'; label = 'Commerciale'; }
          return `<div style="display:inline-flex; align-items:center; height:20px; padding:0 8px; border-radius:10px; font-size:11px; font-weight:600; background-color:${color}18; color:${color}; border:1px solid ${color}44; line-height:normal; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; vertical-align:middle;">${label}</div>`;
        }
      },
    ];

    gantt.config.columns = baseColumns.filter(c =>
      c.name === 'text' || (visibleColumns && visibleColumns.includes(c.name))
    );
    gantt.render();
  }, [visibleColumns, readOnly]);

  const drawCustomMarkers = useCallback(() => {
    try {
      if (!initialized.current || !gantt.$task_data || typeof gantt.posFromDate !== 'function') return;

      // Rimuovi vecchi marker custom
      const existing = gantt.$task_data.querySelectorAll('.custom-project-marker');
      existing.forEach(el => el.remove());
      
      const existingExtra = gantt.$task_data.querySelectorAll('.custom-extra-hours-marker');
      existingExtra.forEach(el => el.remove());

      if (Array.isArray(tasksRef.current)) {
        tasksRef.current.forEach(task => {
          if (task.type === 'milestone') return;
          if (!task.actual_hours || typeof task.actual_hours !== 'object') return;
          if (!task.start_date || !task.end_date) return;
          
          try {
            if (!gantt.isTaskExists(task.id)) return;
            
            const ganttTask = gantt.getTask(task.id);
            const taskTop = gantt.getTaskTop(task.id);
            const rowHeight = gantt.config.row_height || 44;
            
            const extraDays = {};
            const tStart = new Date(ganttTask.start_date).setHours(0,0,0,0);
            const tEnd = new Date(ganttTask.end_date).setHours(0,0,0,0);
            
            Object.values(task.actual_hours).forEach(dayMap => {
              if (dayMap && typeof dayMap === 'object') {
                Object.keys(dayMap).forEach(dateStr => {
                  const h = Number(dayMap[dateStr]) || 0;
                  if (h > 0) {
                    const parts = dateStr.split('-');
                    if (parts.length === 3) {
                      const d = new Date(parts[0], parts[1]-1, parts[2]);
                      const time = d.getTime();
                      if (time < tStart || time >= tEnd) {
                        extraDays[dateStr] = (extraDays[dateStr] || 0) + h;
                      }
                    }
                  }
                });
              }
            });
            
            const ganttState = gantt.getState();
            Object.keys(extraDays).forEach(dateStr => {
              const h = extraDays[dateStr];
              const parts = dateStr.split('-');
              const d = new Date(parts[0], parts[1]-1, parts[2]);
              
              // Disegna il marker SOLO se visibile nella scala attuale (evita espansione infinita layout)
              if (ganttState.min_date && ganttState.max_date) {
                if (d < ganttState.min_date || d > ganttState.max_date) return;
              }
              
              const pos = gantt.posFromDate(d);
              const nextDay = gantt.date.add(d, 1, 'day');
              const endPos = gantt.posFromDate(nextDay);
              if (!isFinite(pos) || !isFinite(endPos)) return;
              
              const width = endPos - pos;

              const size = 18;
              const markerDiv = document.createElement('div');
              markerDiv.className = 'custom-extra-hours-marker';
              markerDiv.style.position = 'absolute';
              markerDiv.style.left = (pos + width / 2 - size / 2) + 'px';
              markerDiv.style.width = size + 'px';
              markerDiv.style.height = size + 'px';
              markerDiv.style.top = (taskTop + rowHeight / 2 - size / 2) + 'px';
              markerDiv.style.borderRadius = '50%';
              markerDiv.style.backgroundColor = '#f59e0b';
              markerDiv.style.color = '#ffffff';
              markerDiv.style.display = 'flex';
              markerDiv.style.alignItems = 'center';
              markerDiv.style.justifyContent = 'center';
              markerDiv.style.zIndex = 10;
              markerDiv.style.pointerEvents = 'auto'; 
              markerDiv.style.boxShadow = '0 2px 5px rgba(245, 158, 11, 0.4)';
              markerDiv.style.cursor = 'pointer';
              markerDiv.title = `${h}h extra il ${parts[2]}/${parts[1]}/${parts[0]}`;
              markerDiv.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>`;
              
              gantt.$task_data.appendChild(markerDiv);
            });
          } catch (e) {
            console.warn("Errore rendering marker extra hours per task", task.id, e);
          }
        });
      }

      const visibleTasksCount = (typeof gantt.getVisibleTaskCount === 'function' ? gantt.getVisibleTaskCount() : 0) || (Array.isArray(tasksRef.current) ? tasksRef.current.length : 10);
      const rowHeight = gantt.config.row_height || 38;
      const totalRowsHeight = Math.max(
        gantt.$task_data ? gantt.$task_data.scrollHeight : 0,
        gantt.$task_bg ? gantt.$task_bg.scrollHeight : 0,
        gantt.$grid_data ? gantt.$grid_data.scrollHeight : 0,
        visibleTasksCount * rowHeight + 500
      );

      const sDate = parseDateSafe(projectStartDateRef.current);
      const eDate = parseDateSafe(projectEndDateRef.current);

      if (sDate) {
        try {
          const posStart = gantt.posFromDate(sDate);
          if (typeof posStart === 'number' && !isNaN(posStart) && posStart >= 0) {
            const formattedS = `${String(sDate.getDate()).padStart(2, '0')}/${String(sDate.getMonth() + 1).padStart(2, '0')}/${sDate.getFullYear()}`;
            const markerDiv = document.createElement('div');
            markerDiv.className = 'custom-project-marker custom-start-marker';
            markerDiv.style.left = `${posStart}px`;
            markerDiv.style.top = '0px';
            markerDiv.style.height = `${totalRowsHeight}px`;
            markerDiv.title = `Avvio Commessa: ${formattedS}`;

            const badgeDiv = document.createElement('div');
            badgeDiv.className = 'custom-marker-badge';
            badgeDiv.innerText = 'Inizio Commessa';
            markerDiv.appendChild(badgeDiv);

            gantt.$task_data.appendChild(markerDiv);
          }
        } catch (e) { /* scala non ancora pronta */ }
      }

      if (eDate) {
        try {
          const markerEndDate = new Date(eDate);
          markerEndDate.setHours(23, 59, 59, 999);
          const posEnd = gantt.posFromDate(markerEndDate);
          if (typeof posEnd === 'number' && !isNaN(posEnd) && posEnd >= 0) {
            const formattedE = `${String(eDate.getDate()).padStart(2, '0')}/${String(eDate.getMonth() + 1).padStart(2, '0')}/${eDate.getFullYear()}`;
            const markerDiv = document.createElement('div');
            markerDiv.className = 'custom-project-marker custom-end-marker';
            markerDiv.style.left = `${posEnd}px`;
            markerDiv.style.top = '0px';
            markerDiv.style.height = `${totalRowsHeight}px`;
            markerDiv.title = `Fine Commessa: ${formattedE}`;

            const badgeDiv = document.createElement('div');
            badgeDiv.className = 'custom-marker-badge';
            badgeDiv.innerText = 'Fine Commessa';
            markerDiv.appendChild(badgeDiv);

            gantt.$task_data.appendChild(markerDiv);
          }
        } catch (e) { /* scala non ancora pronta */ }
      }

      // Linee verticali per Eventi/Milestone (fase senza durata ma solo data)
      const taskList = Array.isArray(tasksRef.current) ? tasksRef.current : [];
      taskList.forEach(t => {
        if (t && t.type === 'milestone') {
          const mDate = parseDateSafe(t.start_date);
          if (mDate) {
            try {
              const pos = gantt.posFromDate(mDate);
              if (typeof pos === 'number' && !isNaN(pos) && pos >= 0) {
                const nextDay = gantt.date.add(mDate, 1, 'day');
                const nextPos = gantt.posFromDate(nextDay);
                const colWidth = (typeof nextPos === 'number' && !isNaN(nextPos) && nextPos > pos) ? (nextPos - pos) : (gantt.config.min_column_width || 38);
                const centerPos = pos + Math.floor(colWidth / 2);

                const formattedM = `${String(mDate.getDate()).padStart(2, '0')}/${String(mDate.getMonth() + 1).padStart(2, '0')}/${mDate.getFullYear()}`;
                const markerColor = t.color || '#8b5cf6';
                const markerDiv = document.createElement('div');
                markerDiv.className = 'custom-project-marker custom-milestone-marker';
                markerDiv.style.left = `${centerPos}px`;
                markerDiv.style.top = '0px';
                markerDiv.style.height = `${totalRowsHeight}px`;
                markerDiv.style.borderLeft = `2px solid ${markerColor}`;
                markerDiv.title = `Milestone: ${t.text || 'Evento'} (${formattedM})`;

                let taskTop = 22;
                try {
                  const rHeight = gantt.config.row_height || 44;
                  if (typeof gantt.getTaskTop === 'function') {
                    let topVal = gantt.getTaskTop(String(t.id));
                    if (typeof topVal !== 'number' || isNaN(topVal)) {
                      topVal = gantt.getTaskTop(t.id);
                    }
                    if (typeof topVal !== 'number' || isNaN(topVal)) {
                      topVal = gantt.getTaskTop(Number(t.id));
                    }
                    if (typeof topVal === 'number' && !isNaN(topVal)) {
                      taskTop = topVal + Math.floor(rHeight / 2);
                    }
                  }
                } catch (e) {
                  taskTop = 22;
                }

                const badge = document.createElement('div');
                badge.className = 'custom-marker-badge custom-milestone-badge';
                badge.style.backgroundColor = markerColor;
                badge.style.color = '#ffffff';
                badge.style.border = `1px solid rgba(255, 255, 255, 0.5)`;
                badge.style.boxShadow = `0 2px 8px rgba(0, 0, 0, 0.25)`;
                badge.style.setProperty('top', `${taskTop}px`, 'important');
                badge.style.setProperty('left', `0px`, 'important');
                badge.style.setProperty('transform', `translate(-50%, -50%)`, 'important');
                badge.textContent = `📍 ${t.text || 'Milestone'}`;
                markerDiv.appendChild(badge);

                gantt.$task_data.appendChild(markerDiv);
              }
            } catch (e) { /* errore rendering marker milestone */ }
          }
        }
      });
    } catch (err) {
      // Ignora errori di rendering marker dhtmlx
    }
  }, []);

  useEffect(() => {
    drawCustomMarkersRef.current = drawCustomMarkers;
    if (initialized.current) {
      try { drawCustomMarkers(); } catch (e) { /* ignore */ }
    }
  }, [drawCustomMarkers, projectStartDate, projectEndDate, tasks]);

  // Aggiorna i dati quando cambiano
  useEffect(() => {
    if (!initialized.current || !tasks) return;
    const taskList = Array.isArray(tasks) ? tasks : [];
    const linkList = Array.isArray(links) ? links : [];
    const taskIds = new Set(taskList.map(t => String(t.id)));
    const seenLinks = new Set();

    const validLinks = linkList.filter(l => {
      if (!l || !l.id || !l.source || !l.target) return false;
      const src = String(l.source);
      const tgt = String(l.target);
      if (!taskIds.has(src) || !taskIds.has(tgt)) return false;
      const linkKey = `${src}->${tgt}->${l.type || '0'}`;
      if (seenLinks.has(linkKey)) return false;
      seenLinks.add(linkKey);
      return true;
    });

    const sortedTaskList = [...taskList].sort((a, b) => {
      const da = new Date(a.start_date ? String(a.start_date).split(' ')[0] : '1970-01-01');
      const db = new Date(b.start_date ? String(b.start_date).split(' ')[0] : '1970-01-01');
      if (da < db) return -1;
      if (da > db) return 1;
      return (a.id || 0) - (b.id || 0);
    });

    let minDate = parseDateSafe(projectStartDateRef.current) || new Date();
    let maxDate = parseDateSafe(projectEndDateRef.current) || new Date(minDate.getTime() + 30 * 86400000);

    sortedTaskList.forEach(t => {
      const s = parseDateSafe(t.start_date);
      if (s && (!minDate || s < minDate)) minDate = s;
      const e = parseDateSafe(t.end_date);
      if (e && (!maxDate || e > maxDate)) maxDate = e;
    });

    // Rende la timeline navigabile e scorrevole per giorni anche prima della data di inizio (e dopo la fine)
    const scaleStart = new Date(minDate.getFullYear() - 1, minDate.getMonth(), 1);
    const scaleEnd = new Date(maxDate.getFullYear() + 1, maxDate.getMonth() + 1, 0);
    gantt.config.start_date = scaleStart;
    gantt.config.end_date = scaleEnd;

    let currentScrollState = null;
    let currentVisibleDate = null;
    if (gantt.getTaskCount && gantt.getTaskCount() > 0) {
      currentScrollState = gantt.getScrollState();
      try {
        currentVisibleDate = gantt.dateFromPos(currentScrollState.x);
      } catch (e) { /* ignore */ }
    }

    window.__programmaticLinkDelete = true;
    gantt.clearAll();
    gantt.parse({
      data: sortedTaskList.map(t => {
        const isCompleted = isTaskCompleted(t);
        const totEff = calculateTaskEffHours(t);
        const plannedH = Number(t.planned_hours || 8.0);
        const isOverrun = plannedH > 0 && totEff > plannedH;

        let parsedEndDate = t.end_date;
        if (parsedEndDate && t.type !== 'milestone') {
          const dateParts = String(parsedEndDate).split(' ')[0].split('T')[0].split('-');
          if (dateParts.length === 3) {
            const ed = new Date(parseInt(dateParts[0]), parseInt(dateParts[1]) - 1, parseInt(dateParts[2]));
            ed.setDate(ed.getDate() + 1);
            const y = ed.getFullYear();
            const m = String(ed.getMonth() + 1).padStart(2, '0');
            const d = String(ed.getDate()).padStart(2, '0');
            parsedEndDate = `${y}-${m}-${d}`;
          }
        }
        const taskPayload = {
          ...t,
          end_date: parsedEndDate,

          id: String(t.id),
          text: t.text,
          start_date: t.start_date,
          orig_duration: t.orig_duration || t.duration,
          // duration: t.duration,
          progress: isCompleted ? 1 : Math.min(1, t.progress || (plannedH > 0 ? totEff / plannedH : 0)),
          parent: t.parent === '0' || !t.parent ? 0 : String(t.parent),
          open: Boolean(t.open),
          type: t.type === 'milestone' ? gantt.config.types.milestone : gantt.config.types.task,
          color: isCompleted ? '#10b981' : (isOverrun ? '#ef4444' : getTaskColor(t)),
          is_overrun: isOverrun,
        };

        return taskPayload;
      }),
      links: validLinks.map(l => ({
        id: String(l.id),
        source: String(l.source),
        target: String(l.target),
        type: String(l.type || '0'),
      })),
    });
    window.__programmaticLinkDelete = false;

    gantt.sort("start_date", false);
    drawCustomMarkers();

    try {
      if (!initialScrollDone.current) {
        initialScrollDone.current = true;
        const pos = gantt.posFromDate(new Date(Date.now() - 3 * 86400000));
        if (typeof pos === 'number' && !isNaN(pos)) {
          gantt.scrollTo(Math.max(0, pos), null);
        }
      } else if (currentScrollState && currentVisibleDate) {
        const newPos = gantt.posFromDate(currentVisibleDate);
        if (typeof newPos === 'number' && !isNaN(newPos)) {
          gantt.scrollTo(newPos, currentScrollState.y);
        } else {
          gantt.scrollTo(currentScrollState.x, currentScrollState.y);
        }
      } else {
        const pos = gantt.posFromDate(new Date(Date.now() - 3 * 86400000));
        if (typeof pos === 'number' && !isNaN(pos)) {
          gantt.scrollTo(Math.max(0, pos), null);
        }
      }
    } catch (e) { /* ignore */ }
  }, [tasks, links, drawCustomMarkers]);


  const handleMouseLeave = () => {
    if (gantt.ext && gantt.ext.tooltips && gantt.ext.tooltips.tooltip) {
      gantt.ext.tooltips.tooltip.hide();
    }
    const leftoverTooltips = document.querySelectorAll('.gantt_tooltip');
    leftoverTooltips.forEach(t => t.remove());
  };

  return <div ref={containerRef} className="gantt-container" onMouseLeave={handleMouseLeave} />;
}
