import { useEffect, useRef, useCallback } from 'react';
import { gantt } from 'dhtmlx-gantt';
import 'dhtmlx-gantt/codebase/dhtmlxgantt.css';
import './GanttChart.css';

export default function GanttChart({ tasks, links, onTaskUpdate, onTaskCreate, onTaskDelete, onLinkCreate, onLinkDelete, onEditTask, onNewTask, visibleColumns }) {
  const containerRef = useRef(null);
  const initialized = useRef(false);

  const handleTaskUpdate = useCallback(onTaskUpdate, [onTaskUpdate]);
  const handleTaskCreate = useCallback(onTaskCreate, [onTaskCreate]);
  const handleTaskDelete = useCallback(onTaskDelete, [onTaskDelete]);
  const handleLinkCreate = useCallback(onLinkCreate, [onLinkCreate]);
  const handleLinkDelete = useCallback(onLinkDelete, [onLinkDelete]);
  const handleEditTask = useCallback((t) => onEditTask && onEditTask(t), [onEditTask]);
  const handleNewTask = useCallback((p) => onNewTask && onNewTask(p), [onNewTask]);

  useEffect(() => {
    if (!containerRef.current || initialized.current) return;
    initialized.current = true;

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

    // Tooltip
    gantt.plugins({ tooltip: true });
    gantt.templates.tooltip_text = function (start, end, task) {
      return `<b>${task.text}</b><br/>
        Inizio: ${gantt.templates.tooltip_date_format(start)}<br/>
        Fine: ${gantt.templates.tooltip_date_format(end)}<br/>
        Durata: <b>${task.duration || 1} giorni</b> (${task.planned_hours || (task.duration ? task.duration * 8 : 8)} ore previste)<br/>
        Progresso: ${Math.round((task.progress || 0) * 100)}%`;
    };

    // Colori barre per priorità
    gantt.templates.task_class = function (start, end, task) {
      return `gantt-priority-${task.priority || 'medium'}`;
    };

    // Milestone
    gantt.templates.task_text = function (start, end, task) {
      if (task.type === 'milestone') return '';
      return task.text;
    };

    gantt.init(containerRef.current);

    // Intercettazione doppio click e tasto "+" per aprire il modal React in italiano (con giorni, ore e addetti)
    gantt.attachEvent("onTaskDblClick", (id, e) => {
      const task = gantt.getTask(id);
      if (task && handleEditTask) {
        handleEditTask(task);
        return false;
      }
      return true;
    });

    gantt.attachEvent("onBeforeLightbox", (id) => {
      const task = gantt.getTask(id);
      if (task && task.$new) {
        gantt.deleteTask(id);
        if (handleNewTask) {
          handleNewTask(task.parent && task.parent !== 0 ? String(task.parent) : null);
        }
      } else if (task && handleEditTask) {
        handleEditTask(task);
      }
      return false; // Blocca 100% la lightbox inglese di DHTMLX
    });

    // Event handlers
    gantt.attachEvent("onAfterTaskDrag", (id, mode) => {
      const task = gantt.getTask(id);
      handleTaskUpdate(id, {
        start_date: gantt.date.date_to_str("%Y-%m-%d")(task.start_date),
        duration: task.duration,
        progress: task.progress,
      });
    });

    gantt.attachEvent("onAfterTaskAdd", (id, item) => {
      handleTaskCreate({
        text: item.text,
        start_date: gantt.date.date_to_str("%Y-%m-%d")(item.start_date),
        duration: item.duration || 1,
        parent_id: item.parent && item.parent !== 0 ? String(item.parent) : null,
      }, id);
    });

    gantt.attachEvent("onAfterTaskDelete", (id) => {
      handleTaskDelete(id);
    });

    gantt.attachEvent("onAfterLinkAdd", (id, item) => {
      handleLinkCreate({
        source: String(item.source),
        target: String(item.target),
        type: String(item.type),
      }, id);
    });

    gantt.attachEvent("onAfterLinkDelete", (id) => {
      handleLinkDelete(id);
    });

    const handleResize = () => {
      if (initialized.current) gantt.setSizes();
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
    };
  }, [handleTaskUpdate, handleTaskCreate, handleTaskDelete, handleLinkCreate, handleLinkDelete, handleEditTask, handleNewTask]);

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
    gantt.clearAll();
    gantt.parse({
      data: tasks.map(t => ({
        ...t,
        id: t.id,
        text: t.text,
        start_date: t.start_date,
        duration: t.duration,
        progress: t.progress,
        parent: t.parent === '0' ? 0 : t.parent,
        open: Boolean(t.open),
        type: t.type === 'milestone' ? gantt.config.types.milestone : gantt.config.types.task,
      })),
      links: links.map(l => ({
        id: l.id,
        source: l.source,
        target: l.target,
        type: l.type,
      })),
    });
  }, [tasks, links]);

  return <div ref={containerRef} className="gantt-container" />;
}
