import { useEffect, useRef, useCallback } from 'react';
import { gantt } from 'dhtmlx-gantt';
import 'dhtmlx-gantt/codebase/dhtmlxgantt.css';
import { getTaskColor } from '../../utils/phaseColors';
import './GanttChart.css';

export default function GanttChart({ tasks, links, onTaskUpdate, onTaskCreate, onTaskDelete, onLinkCreate, onLinkDelete, onEditTask, onNewTask, visibleColumns }) {

  const containerRef = useRef(null);
  const initialized = useRef(false);

  const onTaskUpdateRef = useRef(onTaskUpdate);
  const onTaskCreateRef = useRef(onTaskCreate);
  const onTaskDeleteRef = useRef(onTaskDelete);
  const onLinkCreateRef = useRef(onLinkCreate);
  const onLinkDeleteRef = useRef(onLinkDelete);
  const onEditTaskRef = useRef(onEditTask);
  const onNewTaskRef = useRef(onNewTask);

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
    gantt.config.date_format = "%Y-%m-%d %H:%i";
    gantt.config.xml_date = "%Y-%m-%d %H:%i";
    gantt.config.row_height = 38;
    gantt.config.bar_height = 24;
    gantt.config.scale_height = 50;
    gantt.config.min_column_width = 40;
    gantt.config.fit_tasks = false;
    gantt.config.autosize = false;
    gantt.config.autoscroll = true;
    gantt.config.auto_scheduling = false;
    gantt.config.drag_links = true;
    gantt.config.drag_progress = true;
    gantt.config.drag_resize = true;
    gantt.config.drag_move = true;
    gantt.config.open_tree_initially = true;
    gantt.config.order_branch = true;
    gantt.config.show_progress = true;

    const baseColumns = [
      { name: "text", label: "Attività", tree: true, width: 210, resize: true },
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
    
    // Inizializza con le colonne visibili attuali o di default
    gantt.config.columns = baseColumns.filter(c => 
      c.name === 'text' || c.name === 'add' || (visibleColumns && visibleColumns.includes(c.name))
    );

    // Scala temporale
    gantt.config.scales = [
      { unit: "month", step: 1, format: "%F %Y" },
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

    // Colori barre per priorità e fasi
    gantt.templates.task_class = function (start, end, task) {
      return `gantt-priority-${task.priority || 'medium'}`;
    };

    // Milestone
    gantt.templates.task_text = function (start, end, task) {
      if (task.type === 'milestone') return '';
      return task.text;
    };

    // Abilita l'ereditarietà della classe CSS su tutte le sottoscale dell'header
    gantt.config.inherit_scale_class = true;

    // Funzione helper per calcolare la fine esatta di una cella temporale (giorno, settimana, mese, trimestre, anno)
    function getCellEndDate(date, unit, step = 1) {
      if (unit === "quarter") return gantt.date.add(date, step * 3, "month");
      if (unit === "week") return gantt.date.add(date, step, "week");
      if (unit === "month") return gantt.date.add(date, step, "month");
      if (unit === "year") return gantt.date.add(date, step, "year");
      return gantt.date.add(date, step, "day");
    }

    // Evidenziazione della colonna verticale di oggi su tutte le viste (Giorni, Settimane, Mesi, Trimestri)
    gantt.templates.timeline_cell_class = function (task, date) {
      const today = new Date();
      const scales = gantt.config.scales || [];
      const bottomScale = scales.length > 0 ? scales[scales.length - 1] : { unit: "day", step: 1 };
      const unit = bottomScale.unit || "day";
      const step = bottomScale.step || 1;
      const cellEnd = getCellEndDate(date, unit, step);

      if (date <= today && today < cellEnd) {
        return "gantt_today_cell";
      }
      return "";
    };

    // Evidenziazione delle celle di intestazione della scala temporale che contengono oggi
    gantt.templates.scale_cell_class = function (date, scale) {
      const today = new Date();
      const scales = gantt.config.scales || [];
      const bottomScale = scales.length > 0 ? scales[scales.length - 1] : { unit: "day", step: 1 };
      const unit = (scale && scale.unit) ? scale.unit : (bottomScale.unit || "day");
      const step = (scale && scale.step) ? scale.step : (bottomScale.step || 1);
      const cellEnd = getCellEndDate(date, unit, step);

      if (date <= today && today < cellEnd) {
        return "gantt_today_scale_cell";
      }
      return "";
    };

    gantt.init(containerRef.current);



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

  // Ascolta i cambiamenti di visibleColumns per aggiornare la griglia
  useEffect(() => {
    if (!initialized.current) return;
    
    const baseColumns = [
      { name: "text", label: "Attività", tree: true, width: 210, resize: true },
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
      c.name === 'text' || c.name === 'add' || (visibleColumns && visibleColumns.includes(c.name))
    );
    gantt.render();
  }, [visibleColumns]);

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

    gantt.clearAll();
    gantt.parse({
      data: taskList.map(t => ({
        ...t,
        id: String(t.id),
        text: t.text,
        start_date: t.start_date,
        duration: t.duration,
        progress: t.progress,
        parent: t.parent === '0' || !t.parent ? 0 : String(t.parent),
        open: Boolean(t.open),
        type: t.type === 'milestone' ? gantt.config.types.milestone : gantt.config.types.task,
        color: getTaskColor(t),
      })),
      links: validLinks.map(l => ({
        id: String(l.id),
        source: String(l.source),
        target: String(l.target),
        type: String(l.type || '0'),
      })),
    });


  }, [tasks, links]);


  return <div ref={containerRef} className="gantt-container" />;
}
