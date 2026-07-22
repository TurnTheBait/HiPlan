import { useEffect, useRef, useCallback } from 'react';
import { gantt } from 'dhtmlx-gantt';
import 'dhtmlx-gantt/codebase/dhtmlxgantt.css';
import { getTaskColor } from '../../utils/phaseColors';
import { isTaskCompleted } from '../../utils/taskCompletion';
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
    gantt.config.row_height = 38;
    gantt.config.bar_height = 24;
    gantt.config.scale_height = 66;
    gantt.config.min_column_width = 38;
    gantt.config.fit_tasks = false;
    gantt.config.autosize = false;
    gantt.config.autoscroll = true;
    gantt.config.auto_scheduling = false;
    gantt.config.drag_links = true;
    gantt.config.drag_progress = false;
    gantt.config.drag_resize = true;
    gantt.config.drag_move = true;
    gantt.config.open_tree_initially = true;
    gantt.config.order_branch = true;
    gantt.config.show_progress = true;

    const baseColumns = [
      { 
        name: "text", 
        label: "Attività", 
        tree: true, 
        width: 210, 
        resize: true,
        template: function(task) {
          const isCompleted = isTaskCompleted(task);
          const checkIcon = isCompleted ? `<span style="color: #10b981; font-weight: bold; margin-right: 6px;" title="Fase completata">✓</span>` : '';
          return `${checkIcon}${task.text || ''}`;
        }
      },
      { name: "start_date", label: "Inizio", align: "center", width: 85, resize: true },
      { 
        name: "duration", 
        label: "Durata", 
        align: "center", 
        width: 105,
        template: function (task) {
          return `${task.duration || 1}g (${task.planned_hours || (task.duration ? task.duration * 8 : 8)}h)`;
        }
      },
      {
        name: "progress",
        label: "Progresso",
        align: "center",
        width: 70,
        template: function(task) { 
          const isComp = isTaskCompleted(task);
          return (isComp ? 100 : Math.round((task.progress || 0) * 100)) + "%"; 
        }
      },
      {
        name: "priority",
        label: "Priorità",
        align: "center",
        width: 80,
        template: function(task) { 
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
        template: function(task) { return Array.isArray(task.workers) ? task.workers.join(', ') : ''; }
      },
      { name: "add", label: "", width: 36 },
    ];
    
    // Inizializza con le colonne visibili attuali o di default
    gantt.config.columns = baseColumns.filter(c => 
      c.name === 'text' || (!readOnly && c.name === 'add') || (visibleColumns && visibleColumns.includes(c.name))
    );

    // Scala temporale (Mese in italiano, Giorno della settimana: Lun Mar Mer..., Numero del giorno: 12 13 14...)
    const mesiItaliani = ['Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno', 'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre'];
    const giorniItaliani = ['Dom', 'Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab'];
    gantt.config.scales = [
      { unit: "month", step: 1, format: function (date) { return `${mesiItaliani[date.getMonth()]} ${date.getFullYear()}`; } },
      { unit: "day", step: 1, format: function (date) { return giorniItaliani[date.getDay()]; } },
      { unit: "day", step: 1, format: "%d" },
    ];

    // Tooltip e Marker per il giorno di oggi
    gantt.plugins({ tooltip: true, marker: true });
    gantt.templates.tooltip_text = function (start, end, task) {
      return `<b>${task.text}</b><br/>
        Inizio: ${gantt.templates.tooltip_date_format(start)}<br/>
        Fine: ${gantt.templates.tooltip_date_format(end)}<br/>
        Durata: <b>${task.duration || 1} giorni</b> (${task.planned_hours || (task.duration ? task.duration * 8 : 8)} ore previste)<br/>
        Progresso: ${Math.round((task.progress || 0) * 100)}%`;
    };

    // Colori barre per priorità e fasi / nascondi bar per milestone / classe verde se completata
    gantt.templates.task_class = function (start, end, task) {
      if (task.type === 'milestone' || Number(task.duration) === 0) {
        return 'gantt-hidden-milestone';
      }
      const isCompleted = isTaskCompleted(task);
      if (isCompleted) {
        return 'gantt-task-completed';
      }
      return '';
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
      return isCompleted ? 'gantt-row-completed' : '';
    };
    gantt.templates.task_row_class = function (start, end, task) {
      const isCompleted = isTaskCompleted(task);
      return isCompleted ? 'gantt-row-completed' : '';
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
      if (unit === "day" && isWeekendOrHoliday(date)) {
        classes.push("gantt_weekend_cell");
      }
      if (date <= today && today < cellEnd) {
        classes.push("gantt_today_cell");
      }
      return classes.join(" ");
    };

    // Evidenziazione delle celle di intestazione della scala temporale per sabato, domenica, festivi e oggi
    gantt.templates.scale_cell_class = function (date, scale) {
      const today = new Date();
      const scales = gantt.config.scales || [];
      const bottomScale = scales.length > 0 ? scales[scales.length - 1] : { unit: "day", step: 1 };
      const unit = (scale && scale.unit) ? scale.unit : (bottomScale.unit || "day");
      const step = (scale && scale.step) ? scale.step : (bottomScale.step || 1);
      const cellEnd = getCellEndDate(date, unit, step);

      const classes = [];
      if (unit === "day" && isWeekendOrHoliday(date)) {
        classes.push("gantt_weekend_scale_cell");
      }
      if (date <= today && today < cellEnd) {
        classes.push("gantt_today_scale_cell");
      }
      return classes.join(" ");
    };

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
          duration: task.duration,
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

gantt.attachEvent("onBeforeLinkDelete", (id, item) => {
      if (!window.confirm("Confermi l'eliminazione di questa dipendenza tra fasi?")) {
        return false;
      }
      return true;
    });

    gantt.attachEvent("onAfterLinkDelete", (id) => {
      if (onLinkDeleteRef.current) onLinkDeleteRef.current(id, true);
    });

    const handleResize = () => {
      if (initialized.current) gantt.setSizes();
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
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
        width: 210, 
        resize: true,
        template: function(task) {
          const isCompleted = isTaskCompleted(task);
          const checkIcon = isCompleted ? `<span style="color: #10b981; font-weight: bold; margin-right: 6px;" title="Fase completata">✓</span>` : '';
          return `${checkIcon}${task.text || ''}`;
        }
      },
      { name: "start_date", label: "Inizio", align: "center", width: 85, resize: true },
      { 
        name: "duration", 
        label: "Durata", 
        align: "center", 
        width: 105,
        template: function (task) {
          return `${task.duration || 1}g (${task.planned_hours || (task.duration ? task.duration * 8 : 8)}h)`;
        }
      },
      {
        name: "progress",
        label: "Progresso",
        align: "center",
        width: 70,
        template: function(task) { return Math.round((task.progress || 0) * 100) + "%"; }
      },
      {
        name: "priority",
        label: "Priorità",
        align: "center",
        width: 80,
        template: function(task) { 
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
        template: function(task) { return Array.isArray(task.workers) ? task.workers.join(', ') : ''; }
      },
      { name: "add", label: "", width: 36 },
    ];

    gantt.config.columns = baseColumns.filter(c => 
      c.name === 'text' || (!readOnly && c.name === 'add') || (visibleColumns && visibleColumns.includes(c.name))
    );
    gantt.render();
  }, [visibleColumns, readOnly]);

  const drawCustomMarkers = useCallback(() => {
    try {
      if (!initialized.current || !gantt.$task_data || typeof gantt.posFromDate !== 'function') return;

      // Rimuovi vecchi marker custom
      const existing = gantt.$task_data.querySelectorAll('.custom-project-marker');
      existing.forEach(el => el.remove());

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
            gantt.$task_data.appendChild(markerDiv);
          }
        } catch (e) { /* scala non ancora pronta */ }
      }

      if (eDate) {
        try {
          const posEnd = gantt.posFromDate(eDate);
          if (typeof posEnd === 'number' && !isNaN(posEnd) && posEnd >= 0) {
            const formattedE = `${String(eDate.getDate()).padStart(2, '0')}/${String(eDate.getMonth() + 1).padStart(2, '0')}/${eDate.getFullYear()}`;
            const markerDiv = document.createElement('div');
            markerDiv.className = 'custom-project-marker custom-end-marker';
            markerDiv.style.left = `${posEnd}px`;
            markerDiv.style.top = '0px';
            markerDiv.style.height = `${totalRowsHeight}px`;
            markerDiv.title = `Fine Commessa: ${formattedE}`;
            gantt.$task_data.appendChild(markerDiv);
          }
        } catch (e) { /* scala non ancora pronta */ }
      }

      // Linee verticali per Eventi/Milestone (fase senza durata ma solo data)
      const taskList = Array.isArray(tasksRef.current) ? tasksRef.current : [];
      taskList.forEach(t => {
        if (t && (t.type === 'milestone' || Number(t.duration) === 0)) {
          const mDate = parseDateSafe(t.start_date);
          if (mDate) {
            try {
              const pos = gantt.posFromDate(mDate);
              if (typeof pos === 'number' && !isNaN(pos) && pos >= 0) {
                const formattedM = `${String(mDate.getDate()).padStart(2, '0')}/${String(mDate.getMonth() + 1).padStart(2, '0')}/${mDate.getFullYear()}`;
                const markerDiv = document.createElement('div');
                markerDiv.className = 'custom-project-marker custom-milestone-marker';
                markerDiv.style.left = `${pos}px`;
                markerDiv.style.top = '0px';
                markerDiv.style.height = `${totalRowsHeight}px`;
                const markerColor = t.color || '#f59e0b';
                markerDiv.style.borderLeft = `2px dashed ${markerColor}`;
                markerDiv.title = `Evento: ${t.text || 'Milestone'} (${formattedM})`;

                let taskTop = 4;
                try {
                  if (typeof gantt.getTaskTop === 'function') {
                    let topVal = gantt.getTaskTop(String(t.id));
                    if (typeof topVal !== 'number' || isNaN(topVal)) {
                      topVal = gantt.getTaskTop(t.id);
                    }
                    if (typeof topVal !== 'number' || isNaN(topVal)) {
                      topVal = gantt.getTaskTop(Number(t.id));
                    }
                    if (typeof topVal === 'number' && !isNaN(topVal)) {
                      taskTop = topVal + 4;
                    }
                  }
                } catch (e) {
                  taskTop = 4;
                }

                const badge = document.createElement('div');
                badge.className = 'custom-marker-badge';
                badge.style.border = `1px solid ${markerColor}`;
                badge.style.color = markerColor;
                badge.style.backgroundColor = 'var(--bg-primary, #ffffff)';
                badge.style.setProperty('top', `${taskTop}px`, 'important');
                badge.textContent = `📍 ${t.text || 'Evento'}`;
                markerDiv.appendChild(badge);

                gantt.$task_data.appendChild(markerDiv);
              }
            } catch (e) { /* scala non ancora pronta */ }
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

    gantt.clearAll();
    gantt.parse({
      data: sortedTaskList.map(t => {
        const isCompleted = isTaskCompleted(t);
        return {
          ...t,
          id: String(t.id),
          text: t.text,
          start_date: t.start_date,
          duration: t.duration,
          progress: isCompleted ? 1 : t.progress,
          parent: t.parent === '0' || !t.parent ? 0 : String(t.parent),
          open: Boolean(t.open),
          type: (t.type === 'milestone' || Number(t.duration) === 0) ? gantt.config.types.milestone : gantt.config.types.task,
          color: isCompleted ? '#10b981' : getTaskColor(t),
        };
      }),
      links: validLinks.map(l => ({
        id: String(l.id),
        source: String(l.source),
        target: String(l.target),
        type: String(l.type || '0'),
      })),
    });

    gantt.sort("start_date", false);
    drawCustomMarkers();

    try {
      const pos = gantt.posFromDate(new Date(minDate.getTime() - 7 * 86400000));
      if (typeof pos === 'number' && !isNaN(pos)) {
        gantt.scrollTo(Math.max(0, pos), null);
      }
    } catch (e) { /* ignore */ }
  }, [tasks, links, drawCustomMarkers]);


  return <div ref={containerRef} className="gantt-container" />;
}
