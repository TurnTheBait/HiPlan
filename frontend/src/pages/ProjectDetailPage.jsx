import { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../api/client';
import { useToast } from '../context/ToastContext';
import { useAuth } from '../context/AuthContext';
import { gantt } from 'dhtmlx-gantt';
import GanttChart from '../components/gantt/GanttChart';
import './ProjectDetailPage.css';
import { STATUS_LABELS_IT, STATUS_OPTIONS } from '../utils/statusLabels';
import { PREDEFINED_PHASES, PHASE_DEFAULT_COLORS, getTaskColor } from '../utils/phaseColors';
import { calculateTaskEffHours, isTaskCompleted } from '../utils/taskCompletion';
import { addWorkingDays, subtractWorkingDays, countWorkingDays } from '../utils/workingDays';
import TaskComments from '../components/tasks/TaskComments';
import TaskChecklist from '../components/tasks/TaskChecklist';

const DEPT_OPTIONS = [
  { value: 'ufficio_tecnico', label: '🔧 Ufficio Tecnico', color: '#3b82f6' },
  { value: 'produzione', label: '🏭 Produzione', color: '#10b981' },
  { value: 'acquisti', label: '🛒 Acquisti', color: '#f59e0b' },
];
const ALL_DEPTS = DEPT_OPTIONS.map(d => d.value);

const PREDEFINED_WORKERS_DEFAULT = [];

export default function ProjectDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { user } = useAuth();
  const [project, setProject] = useState(null);
  const [ganttData, setGanttData] = useState({ tasks: [], links: [] });
  const [predefinedWorkers, setPredefinedWorkers] = useState(PREDEFINED_WORKERS_DEFAULT);
  const [usersList, setUsersList] = useState([]);
  const [loading, setLoading] = useState(true);

  const canManageProject = useMemo(() => {
    if (!user || !project) return false;
    if (user.role === 'admin' || user.role === 'editor') return true;
    if (user.id === project.owner_id || user.id === project.responsible_id) return true;
    if (project.responsible_username && project.responsible_username === user.username) return true;
    return false;
  }, [user, project]);

  // STATO PER COLONNE GANTT (leggiamo dal localStorage)
  const [visibleColumns, setVisibleColumns] = useState(() => {
    const saved = localStorage.getItem('ganttVisibleColumns');
    return saved ? JSON.parse(saved) : ['start_date', 'duration'];
  });
  const [showColumnsMenu, setShowColumnsMenu] = useState(false);

  // STATO PER COLONNE TABELLA FASI
  const [tableVisibleColumns, setTableVisibleColumns] = useState(() => {
    const saved = localStorage.getItem('tableVisibleColumns');
    return saved ? JSON.parse(saved) : ['reparto', 'addetti', 'date', 'ore', 'semaforo', 'azioni'];
  });
  const [showTableColumnsMenu, setShowTableColumnsMenu] = useState(false);

  // STATO PER MENU EXPORT
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [exportSections, setExportSections] = useState({
    tasks: true,
    hours: true,
    gantt: true,
  });
  const [exportFormat, setExportFormat] = useState('pdf');

  // STATO PER COLONNE TABELLA ORE
  const [oreVisibleColumns, setOreVisibleColumns] = useState(() => {
    const saved = localStorage.getItem('oreVisibleColumns');
    return saved ? JSON.parse(saved) : ['addetti', 'giorni', 'ore_giorno', 'totale', 'semaforo', 'azioni'];
  });
  const [showOreColumnsMenu, setShowOreColumnsMenu] = useState(false);

  function toggleTableColumn(col) {
    setTableVisibleColumns(prev => prev.includes(col) ? prev.filter(c => c !== col) : [...prev, col]);
  }

  function toggleOreColumn(col) {
    setOreVisibleColumns(prev => prev.includes(col) ? prev.filter(c => c !== col) : [...prev, col]);
  }

  const [showDeptMenu, setShowDeptMenu] = useState(false);
  const [activeDepartments, setActiveDepartments] = useState(ALL_DEPTS);
  const [viewMode, setViewMode] = useState('day');
  const [activeTab, setActiveTab] = useState('gantt');

  // Stato Modale Nuova / Modifica Fase
  const [showTaskModal, setShowTaskModal] = useState(false);
  const [taskModalTab, setTaskModalTab] = useState('generale');
  const [budgetMode, setBudgetMode] = useState('start_days'); // 'start_end', 'start_hours', 'end_hours', 'start_days', 'end_days', 'start_days_hours'
  const [editingTask, setEditingTask] = useState(null);
  const [phaseTemplates, setPhaseTemplates] = useState([]);
  const [showPhaseDropdown, setShowPhaseDropdown] = useState(false);
  const [taskForm, setTaskForm] = useState({
    faseSel: PREDEFINED_PHASES[0],
    customText: '',
    color: PHASE_DEFAULT_COLORS[PREDEFINED_PHASES[0]] || '#3b82f6',
    start_date: new Date().toISOString().split('T')[0],
    end_date: new Date().toISOString().split('T')[0],
    duration_days: 1,
    planned_hours: 8.0,
    workers: [],
    worker_hours: {},
    customWorker: '',
    department: null,
  });


  // Stato Modale Consuntivo Ore
  const [showOreModal, setShowOreModal] = useState(false);
  const [selectedTaskForHours, setSelectedTaskForHours] = useState(null);
  const [actualHoursMap, setActualHoursMap] = useState({});

  // Stato Modale Modifica Dati Commessa
  const [showEditProjectModal, setShowEditProjectModal] = useState(false);
  const [projectForm, setProjectForm] = useState({
    name: '',
    code: '',
    client: '',
    description: '',
    color: '#185FA5',
    start_date: '',
    end_date: '',
  });

  useEffect(() => { loadProject(); }, [id]);

  useEffect(() => {
    localStorage.setItem('tableVisibleColumns', JSON.stringify(tableVisibleColumns));
  }, [tableVisibleColumns]);

  useEffect(() => {
    localStorage.setItem('oreVisibleColumns', JSON.stringify(oreVisibleColumns));
  }, [oreVisibleColumns]);

  async function loadProject() {
    try {
      const [projRes, ganttRes, usersRes] = await Promise.all([
        api.get(`/projects/${id}`),
        api.get(`/projects/${id}/gantt`),
        api.get('/users').catch(() => ({ data: [] }))
      ]);
      setProject(projRes.data);
      const sortedTasks = Array.isArray(ganttRes.data?.tasks)
        ? [...ganttRes.data.tasks].sort((a, b) => {
          const da = new Date(a.start_date ? String(a.start_date).split(' ')[0] : '1970-01-01');
          const db = new Date(b.start_date ? String(b.start_date).split(' ')[0] : '1970-01-01');
          if (da < db) return -1;
          if (da > db) return 1;
          return (a.id || 0) - (b.id || 0);
        })
        : [];
      setGanttData({ ...ganttRes.data, tasks: sortedTasks });
      if (Array.isArray(usersRes.data)) {
        setPredefinedWorkers(usersRes.data.map(u => u.username));
        setUsersList(usersRes.data);
      }
      fetchPhaseTemplates();
    } catch {
      toast.error('Progetto non trovato');
      navigate('/projects');
    } finally {
      setLoading(false);
    }
  }

  async function fetchPhaseTemplates() {
    try {
      const dept = user?.role === 'admin' ? 'all' : (user?.department || 'ufficio_tecnico');
      const res = await api.get('/phase-templates', { params: { department: dept } });
      if (Array.isArray(res.data)) {
        setPhaseTemplates(res.data);
      }
    } catch (err) {
      console.error('Errore caricamento phase templates:', err);
    }
  }

  function getAvailableTemplates() {
    if (phaseTemplates && phaseTemplates.length > 0) {
      return phaseTemplates;
    }
    return PREDEFINED_PHASES.filter(p => p !== '__custom__').map(p => ({
      id: p,
      name: p,
      department: 'ufficio_tecnico',
      default_color: PHASE_DEFAULT_COLORS[p] || '#3b82f6',
    }));
  }

  async function handleDeleteTemplateFromDropdown(tpl) {
    if (!window.confirm(`Confermi l'eliminazione della fase "${tpl.name}" dall'elenco suggerito?`)) return;
    try {
      if (tpl.id && tpl.id !== tpl.name) {
        await api.delete(`/phase-templates/${tpl.id}`);
      }
      toast.success('Fase eliminata dall\'elenco');
      await fetchPhaseTemplates();
      if (taskForm.faseSel === tpl.name) {
        setTaskForm(prev => ({ ...prev, faseSel: '__custom__', customText: tpl.name }));
      }
    } catch {
      toast.error('Errore durante l\'eliminazione della fase');
    }
  }

  async function handleStatusChange(newStatus) {
    if (!project) return;
    try {
      const { data } = await api.put(`/projects/${project.id}`, {
        ...project,
        status: newStatus,
      });
      setProject(data);
      toast.success(`Stato commessa aggiornato a "${STATUS_LABELS_IT[newStatus] || newStatus}"`);
    } catch {
      toast.error("Errore nell'aggiornamento dello stato della commessa");
    }
  }

  function formatDateOnly(d) {
    if (!d) return '';
    if (typeof d === 'string') return d.split(' ')[0].split('T')[0];
    if (d instanceof Date && !isNaN(d)) return d.toISOString().split('T')[0];
    try {
      return String(d).split(' ')[0].split('T')[0];
    } catch {
      return '';
    }
  }

  // Calcolo stato semaforo e ore giornaliere previste (algoritmo prototipo Ufficio Tecnico)
  function computeStato(task) {
    if (!task || !task.start_date) return 'ok';
    if (isTaskCompleted(task)) return 'ok';
    const startStr = formatDateOnly(task.start_date);
    const endStr = task.end_date ? formatDateOnly(task.end_date) : startStr;
    if (!startStr) return 'ok';
    const start = new Date(startStr + 'T00:00:00');
    const end = new Date((endStr || startStr) + 'T00:00:00');
    if (isNaN(start) || isNaN(end)) return 'ok';
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let workDays = 0;
    let cur = new Date(start);
    while (cur <= end) {
      const dayOfWeek = cur.getDay();
      if (dayOfWeek !== 0 && dayOfWeek !== 6) workDays++;
      cur.setDate(cur.getDate() + 1);
    }
    if (workDays <= 0) workDays = 1;
    const oreGg = (Number(task.planned_hours) || 8.0) / workDays;

    let hasRitardo = false;
    let hasAttenzione = false;

    cur = new Date(start);
    while (cur <= end && cur <= today) {
      const dayOfWeek = cur.getDay();
      if (dayOfWeek !== 0 && dayOfWeek !== 6) {
        const y = cur.getFullYear();
        const m = String(cur.getMonth() + 1).padStart(2, '0');
        const d = String(cur.getDate()).padStart(2, '0');
        const dateStr = `${y}-${m}-${d}`;

        let totDayEff = 0;
        if (task.actual_hours && typeof task.actual_hours === 'object') {
          Object.values(task.actual_hours).forEach(dayMap => {
            if (dayMap && dayMap[dateStr]) totDayEff += Number(dayMap[dateStr]) || 0;
          });
        }
        if (totDayEff < oreGg * 0.5 || (totDayEff === 0 && oreGg > 0)) {
          hasRitardo = true;
        } else if (totDayEff < oreGg) {
          hasAttenzione = true;
        }
      }
      cur.setDate(cur.getDate() + 1);
    }

    if (hasRitardo) return 'ritardo';
    if (hasAttenzione) return 'attenzione';
    return 'ok';
  }

  // Helper giorni lavorativi tra due date per tabella ore
  function getWorkDatesBetween(startInput, endInput) {
    const dates = [];
    const startStr = formatDateOnly(startInput);
    const endStr = formatDateOnly(endInput || startInput);
    if (!startStr) return dates;
    const start = new Date(startStr + 'T00:00:00');
    const end = endStr ? new Date(endStr + 'T00:00:00') : new Date(startStr + 'T00:00:00');
    if (isNaN(start) || isNaN(end)) return dates;
    let cur = new Date(start);
    while (cur <= end) {
      const dayOfWeek = cur.getDay();
      if (dayOfWeek !== 0 && dayOfWeek !== 6) {
        const y = cur.getFullYear();
        const m = String(cur.getMonth() + 1).padStart(2, '0');
        const d = String(cur.getDate()).padStart(2, '0');
        dates.push(`${y}-${m}-${d}`);
      }
      cur.setDate(cur.getDate() + 1);
    }
    return dates;
  }

  // Calcolo totali di commessa e allerte
  const { totalPrev, totalEff, delaysList } = useMemo(() => {
    let prev = 0;
    let eff = 0;
    const delays = [];

    ganttData.tasks.forEach(t => {
      prev += Number(t.planned_hours) || 0;
      let tEff = 0;
      if (t.actual_hours && typeof t.actual_hours === 'object') {
        Object.values(t.actual_hours).forEach(dayMap => {
          if (dayMap && typeof dayMap === 'object') {
            Object.values(dayMap).forEach(h => { tEff += Number(h) || 0; });
          }
        });
      }
      eff += tEff;

      const st = computeStato(t);
      if (st === 'ritardo' || st === 'attenzione') {
        delays.push({ task: t, stato: st, tEff });
      }
    });

    return { totalPrev: prev, totalEff: eff, delaysList: delays };
  }, [ganttData.tasks]);

  // Gestione Task da Gantt e Form
  async function handleTaskUpdate(taskId, data) {
    try {
      await api.put(`/projects/${id}/tasks/${taskId}`, data);
      loadProject();
    } catch { toast.error('Errore aggiornamento fase'); }
  }

  async function handleTaskCreate(data, tempId) {
    try {
      const { data: created } = await api.post(`/projects/${id}/tasks`, data);
      if (tempId) gantt.changeTaskId(tempId, created.id);
      loadProject();
    } catch { toast.error('Errore creazione fase'); }
  }

  async function handleTaskDelete(taskId, skipConfirm = false) {
    if (!skipConfirm && !window.confirm("Confermi l'eliminazione di questa fase di lavorazione?")) return;
    try {
      await api.delete(`/projects/${id}/tasks/${taskId}`);
      loadProject();
    } catch { /* task già rimosso */ }
  }

  async function handleToggleTaskCompleted(task, currentIsCompleted) {
    if (!canManageProject) {
      toast.error('Solo proprietario, responsabile o editor possono segnare la fase come completata/in corso');
      return;
    }
    const newCompleted = currentIsCompleted ? -1 : 1;
    try {
      await api.put(`/projects/${id}/tasks/${task.id}`, {
        completed: newCompleted
      });
      toast.success(newCompleted === 1 ? 'Fase completata!' : 'Fase ripristinata in corso');
      loadProject();
    } catch {
      toast.error("Errore durante l'aggiornamento dello stato della fase");
    }
  }

  async function handleLinkCreate(data, tempId) {
    try {
      const { data: created } = await api.post(`/projects/${id}/links`, data);
      if (tempId && gantt.isLinkExists && gantt.isLinkExists(tempId)) {
        gantt.changeLinkId(tempId, created.id);
      }
      loadProject();
    } catch {
      toast.error('Errore creazione dipendenza');
      if (tempId && gantt.isLinkExists && gantt.isLinkExists(tempId)) {
        gantt.deleteLink(tempId);
      }
    }
  }

  async function handleLinkDelete(linkId, skipConfirm = false) {
    if (!skipConfirm && !window.confirm("Confermi l'eliminazione di questa dipendenza tra fasi?")) return;
    try {
      await api.delete(`/projects/${id}/links/${linkId}`);
      loadProject();
    } catch { /* già rimosso */ }
  }

  function openNewTaskModal() {
    fetchPhaseTemplates();
    const available = getAvailableTemplates();
    const initialFase = available.length > 0 ? available[0].name : PREDEFINED_PHASES[0];
    const initialColor = available.length > 0 ? (available[0].default_color || '#3b82f6') : (PHASE_DEFAULT_COLORS[PREDEFINED_PHASES[0]] || '#3b82f6');

    setEditingTask(null);
    setTaskModalTab('generale');
    setShowPhaseDropdown(false);
    setTaskForm({
      taskType: 'task',
      faseSel: initialFase,
      customText: '',
      color: initialColor,
      start_date: project?.start_date || new Date().toISOString().split('T')[0],
      end_date: project?.end_date || new Date().toISOString().split('T')[0],
      duration_days: 1,
      planned_hours: 8.0,
      budgetMode: 'start_days',
      workers: [],
      worker_hours: {},
      customWorker: '',
      department: user?.department && user.department !== 'admin' ? user.department : 'ufficio_tecnico',
      completed: 0,
    });
    setShowTaskModal(true);
  }

  function openEditTaskModal(task) {
    if (!canManageProject) {
      openOreModalForTask(task);
      return;
    }
    fetchPhaseTemplates();
    const available = getAvailableTemplates();
    const isPredefined = available.some(t => t.name === task.text) || PREDEFINED_PHASES.includes(task.text);

    setEditingTask(task);
    setTaskModalTab('generale');
    setShowPhaseDropdown(false);

    const safeDate = (d) => {
      if (!d) return new Date().toISOString().split('T')[0];
      if (d instanceof Date) {
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
      }
      return String(d).split(' ')[0].split('T')[0];
    };

    const s = safeDate(task.start_date);
    const e = safeDate(task.end_date);
    const diff = countWorkingDays(s, e);
    const taskDur = Number(task.duration) || diff;
    const taskPlan = Number(task.planned_hours) || (taskDur * 8.0);
    const mode = task.budgetMode || (Math.abs(taskPlan - taskDur * 8.0) > 0.1 ? 'start_days_hours' : 'start_days');
    setBudgetMode(mode);

    setTaskForm({
      taskType: task.type === 'milestone' || Number(task.duration) === 0 ? 'milestone' : 'task',
      faseSel: isPredefined ? task.text : '__custom__',
      customText: isPredefined ? '' : task.text,
      color: getTaskColor(task),
      start_date: s,
      end_date: e,
      duration_days: taskDur,
      planned_hours: taskPlan,
      budgetMode: mode,
      workers: Array.isArray(task.workers) ? task.workers : [],
      worker_hours: typeof task.worker_hours === 'object' ? task.worker_hours : {},
      customWorker: '',
      department: task.department || (user?.department && user.department !== 'admin' ? user.department : 'ufficio_tecnico'),
      completed: isTaskCompleted(task) ? 1 : (Number(task.completed) === -1 ? -1 : 0),
    });
    setShowTaskModal(true);
  }


  function handleBudgetModeChange(newMode) {
    setBudgetMode(newMode);
    setTaskForm(prev => {
      const updates = { budgetMode: newMode };
      if (newMode === 'start_end') {
        const days = countWorkingDays(prev.start_date, prev.end_date);
        updates.duration_days = days;
        updates.planned_hours = days * 8.0;
      } else if (newMode === 'start_hours') {
        const hours = Number(prev.planned_hours) || 8;
        const days = Math.max(1, Math.ceil(hours / 8.0));
        updates.duration_days = days;
        updates.end_date = addWorkingDays(prev.start_date || new Date(), days);
      } else if (newMode === 'end_hours') {
        const hours = Number(prev.planned_hours) || 8;
        const days = Math.max(1, Math.ceil(hours / 8.0));
        updates.duration_days = days;
        updates.start_date = subtractWorkingDays(prev.end_date || new Date(), days);
      } else if (newMode === 'start_days') {
        const days = Math.max(1, Number(prev.duration_days) || 1);
        updates.duration_days = days;
        updates.end_date = addWorkingDays(prev.start_date || new Date(), days);
        updates.planned_hours = days * 8.0;
      } else if (newMode === 'end_days') {
        const days = Math.max(1, Number(prev.duration_days) || 1);
        updates.duration_days = days;
        updates.start_date = subtractWorkingDays(prev.end_date || new Date(), days);
        updates.planned_hours = days * 8.0;
      } else if (newMode === 'start_days_hours') {
        const days = Math.max(1, Number(prev.duration_days) || 1);
        updates.duration_days = days;
        updates.end_date = addWorkingDays(prev.start_date || new Date(), days);
      } else if (newMode === 'end_days_hours') {
        const days = Math.max(1, Number(prev.duration_days) || 1);
        updates.duration_days = days;
        updates.start_date = subtractWorkingDays(prev.end_date || new Date(), days);
      }
      return { ...prev, ...updates };
    });
  }

  function handleStartDateChange(newStart) {
    setTaskForm(prev => {
      const updates = { start_date: newStart };
      if (budgetMode === 'start_end') {
        const days = countWorkingDays(newStart, prev.end_date);
        if (new Date(newStart) > new Date(prev.end_date)) {
          updates.end_date = newStart;
          updates.duration_days = 1;
          updates.planned_hours = 8.0;
        } else {
          updates.duration_days = days;
          updates.planned_hours = days * 8.0;
        }
      } else if (budgetMode === 'start_hours' || budgetMode === 'start_days' || budgetMode === 'start_days_hours') {
        const days = Math.max(1, Number(prev.duration_days) || 1);
        updates.end_date = addWorkingDays(newStart, days);
      }
      return { ...prev, ...updates };
    });
  }

  function handleEndDateChange(newEnd) {
    setTaskForm(prev => {
      const updates = { end_date: newEnd };
      if (budgetMode === 'start_end') {
        const days = countWorkingDays(prev.start_date, newEnd);
        if (new Date(newEnd) < new Date(prev.start_date)) {
          updates.start_date = newEnd;
          updates.duration_days = 1;
          updates.planned_hours = 8.0;
        } else {
          updates.duration_days = days;
          updates.planned_hours = days * 8.0;
        }
      } else if (budgetMode === 'end_hours' || budgetMode === 'end_days' || budgetMode === 'end_days_hours') {
        const days = Math.max(1, Number(prev.duration_days) || 1);
        updates.start_date = subtractWorkingDays(newEnd, days);
      }
      return { ...prev, ...updates };
    });
  }

  function handleDurationDaysChange(daysVal) {
    const days = Math.max(1, Number(daysVal) || 1);
    setTaskForm(prev => {
      const updates = { duration_days: daysVal };
      if (budgetMode === 'start_days') {
        updates.end_date = addWorkingDays(prev.start_date || new Date(), days);
        updates.planned_hours = days * 8.0;
      } else if (budgetMode === 'end_days' || budgetMode === 'end_days_hours') {
        updates.start_date = subtractWorkingDays(prev.end_date || new Date(), days);
        if (budgetMode === 'end_days') {
          updates.planned_hours = days * 8.0;
        }
      } else if (budgetMode === 'start_days_hours') {
        updates.end_date = addWorkingDays(prev.start_date || new Date(), days);
      }
      return { ...prev, ...updates };
    });
  }

  function handlePlannedHoursChange(hoursVal) {
    const hours = Number(hoursVal) || 0;
    setTaskForm(prev => {
      const updates = { planned_hours: hoursVal };
      if (budgetMode === 'start_hours') {
        const days = Math.max(1, Math.ceil(hours / 8.0));
        updates.duration_days = days;
        updates.end_date = addWorkingDays(prev.start_date || new Date(), days);
      } else if (budgetMode === 'end_hours') {
        const days = Math.max(1, Math.ceil(hours / 8.0));
        updates.duration_days = days;
        updates.start_date = subtractWorkingDays(prev.end_date || new Date(), days);
      }
      return { ...prev, ...updates };
    });
  }

  function applyDurationPreset(days, hours) {
    const sDate = taskForm.start_date || new Date().toISOString().split('T')[0];
    const newEnd = addWorkingDays(sDate, days);
    setTaskForm({
      ...taskForm,
      duration_days: days,
      planned_hours: hours,
      end_date: newEnd,
    });
  }

  async function handleSaveTaskForm(e) {
    e.preventDefault();
    const taskName = taskForm.faseSel === '__custom__' ? taskForm.customText : taskForm.faseSel;
    if (!taskName.trim()) {
      toast.error('Inserire il nome della fase');
      return;
    }
    const isMilestone = taskForm.taskType === 'milestone';
    const sDate = taskForm.start_date;
    const eDate = taskForm.end_date;
    const diffDays = countWorkingDays(sDate, eDate);
    const finalDays = Math.max(1, Number(taskForm.duration_days) || diffDays);

    const payload = {
      text: taskName.trim(),
      start_date: taskForm.start_date,
      end_date: isMilestone ? taskForm.start_date : taskForm.end_date,
      duration: isMilestone ? 0 : finalDays,
      planned_hours: isMilestone ? 0 : (Number(taskForm.planned_hours) || (finalDays * 8.0)),
      workers: isMilestone ? [] : taskForm.workers,
      worker_hours: isMilestone ? {} : taskForm.worker_hours,
      type: isMilestone ? 'milestone' : 'task',
      color: taskForm.color || (isMilestone ? '#f59e0b' : null),
      department: taskForm.department || null,
      completed: isMilestone ? 0 : (taskForm.completed !== undefined && taskForm.completed !== null ? Number(taskForm.completed) : 0),
    };


    try {
      if (editingTask) {
        await api.put(`/projects/${id}/tasks/${editingTask.id}`, payload);
        toast.success('Fase modificata con successo!');
      } else {
        await api.post(`/projects/${id}/tasks`, payload);
        toast.success('Nuova fase aggiunta!');
      }

      // Se l'utente ha inserito una fase personalizzata o nuova, aggiungiamola automaticamente alle fasi suggerite per quel reparto
      if (taskForm.faseSel === '__custom__' && taskName.trim()) {
        try {
          const targetDept = taskForm.department || (user?.role === 'admin' ? 'tutti' : (user?.department || 'ufficio_tecnico'));
          await api.post('/phase-templates', {
            name: taskName.trim(),
            department: targetDept,
            default_color: taskForm.color || '#3b82f6',
            is_custom: true,
          });
        } catch (e) {
          console.error('Errore auto-salvataggio template:', e);
        }
      }

      setShowTaskModal(false);
      loadProject();
    } catch {
      toast.error('Errore nel salvataggio della fase');
    }
  }

  // Modale Consuntivo Ore
  function openOreModalForTask(task) {
    setSelectedTaskForHours(task);
    const initialMap = task.actual_hours && typeof task.actual_hours === 'object'
      ? JSON.parse(JSON.stringify(task.actual_hours))
      : {};
    // Ensure extra_hours key exists
    if (!initialMap['__extra__']) {
      initialMap['__extra__'] = {};
    }
    setActualHoursMap(initialMap);
    setShowOreModal(true);
  }

  async function handleSaveOreModal() {
    if (!selectedTaskForHours) return;
    try {
      await api.put(`/projects/${id}/tasks/${selectedTaskForHours.id}`, {
        end_date: formatDateOnly(selectedTaskForHours.end_date || new Date()),
        duration: Number(selectedTaskForHours.duration || selectedTaskForHours.duration_days || 1),
        actual_hours: actualHoursMap,
      });
      toast.success('Ore consuntivate salvate!');
      setShowOreModal(false);
      loadProject();
    } catch (err) {
      console.error("Errore salvataggio ore:", err);
      const msg = err?.response?.data?.detail || "Errore durante il salvataggio ore";
      toast.error(typeof msg === 'string' ? msg : JSON.stringify(msg));
    }
  }

  function openEditProjectModal() {
    if (!project) return;
    setProjectForm({
      name: project.name || '',
      code: project.code || '',
      client: project.client || '',
      description: project.description || '',
      color: project.color || '#185FA5',
      start_date: project.start_date || '',
      end_date: project.end_date || '',
      status: project.status || 'planning',
      responsible_id: project.responsible_id || '',
      assigned_workers: Array.isArray(project.assigned_workers) ? [...project.assigned_workers] : [],
    });
    setShowEditProjectModal(true);
  }

  function toggleProjectWorkerSelection(username) {
    const current = projectForm.assigned_workers || [];
    const updated = current.includes(username) ? current.filter(w => w !== username) : [...current, username];
    setProjectForm({ ...projectForm, assigned_workers: updated });
  }

  async function handleSaveProject(e) {
    e.preventDefault();
    try {
      const { data } = await api.put(`/projects/${id}`, projectForm);
      setProject(prev => ({ ...prev, ...data }));
      setShowEditProjectModal(false);
      toast.success('Dati commessa aggiornati con successo!');
      loadProject();
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Errore durante la modifica della commessa');
    }
  }

  function toggleWorkerSelection(w, requireConfirm = false) {
    const isSelected = taskForm.workers.includes(w);
    if (isSelected && requireConfirm && !window.confirm(`Confermi la rimozione dell'addetto "${w}" da questa fase?`)) return;
    let newWorkers, newWorkerHours = { ...taskForm.worker_hours };
    if (isSelected) {
      newWorkers = taskForm.workers.filter(x => x !== w);
      delete newWorkerHours[w];
    } else {
      newWorkers = [...taskForm.workers, w];
      newWorkerHours[w] = 8.0;
    }
    setTaskForm({ ...taskForm, workers: newWorkers, worker_hours: newWorkerHours });
  }

  function handleZoom(mode) {
    setViewMode(mode);
    const mesiItaliani = ['Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno', 'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre'];
    const giorniItaliani = ['Dom', 'Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab'];

    switch (mode) {
      case 'day':
        gantt.config.scales = [
          { unit: "month", step: 1, format: function (date) { return `${mesiItaliani[date.getMonth()]} ${date.getFullYear()}`; } },
          { unit: "day", step: 1, format: function (date) { return giorniItaliani[date.getDay()]; } },
          { unit: "day", step: 1, format: "%d" },
        ];
        gantt.config.min_column_width = 38;
        gantt.config.scale_height = 66;
        break;
      case 'week':
        gantt.config.scales = [
          { unit: "month", step: 1, format: function (date) { return `${mesiItaliani[date.getMonth()]} ${date.getFullYear()}`; } },
          { unit: "week", step: 1, format: "Sett. %W" },
        ];
        gantt.config.min_column_width = 80;
        gantt.config.scale_height = 50;
        break;
      case 'month':
        gantt.config.scales = [
          { unit: "year", step: 1, format: "%Y" },
          { unit: "month", step: 1, format: function (date) { return mesiItaliani[date.getMonth()]; } },
        ];
        gantt.config.min_column_width = 60;
        gantt.config.scale_height = 50;
        break;
      case 'quarter':
        gantt.config.scales = [
          { unit: "year", step: 1, format: "%Y" },
          {
            unit: "quarter",
            step: 1,
            format: function (date) {
              const q = Math.floor(date.getMonth() / 3) + 1;
              return "Q" + q;
            }
          },
        ];
        gantt.config.min_column_width = 100;
        gantt.config.scale_height = 50;
        break;
    }
    gantt.render();
  }

  async function handleExport(type) {
    const selectedSections = Object.entries(exportSections)
      .filter(([_, v]) => v)
      .map(([k]) => k)
      .join(',');
    if (!selectedSections) {
      toast.error('Seleziona almeno una sezione da esportare');
      return;
    }
    try {
      const response = await api.get(`/projects/${id}/export/${type}`, {
        responseType: 'blob',
        params: { sections: selectedSections }
      });
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const a = document.createElement('a');
      a.href = url;
      a.download = `${project.code || project.name}.${type === 'excel' ? 'xlsx' : 'pdf'}`;
      a.click();
      window.URL.revokeObjectURL(url);
      toast.success(`Export ${type.toUpperCase()} completato (${selectedSections.replace(/,/g, ', ')})!`);
      setShowExportMenu(false);
    } catch {
      toast.error(`Errore export ${type}`);
    }
  }

  if (loading) return <div className="loading-screen"><div className="spinner" /></div>;

  return (
    <div className="project-detail animate-fadeIn">
      <div className="project-detail-header">
        <div className="project-detail-info">
          <button className="btn btn-secondary btn-sm" onClick={() => navigate('/projects')}>
            ← Commesse
          </button>
          <div className="commessa-meta" style={{ borderLeft: `4px solid ${project?.color || '#185FA5'}`, display: 'flex', alignItems: 'center', gap: 10 }}>
            <span className="commessa-code">{project?.code || 'UT-COMM'}</span>
            <span>—</span>
            <span className="commessa-client">🏢 {project?.client || 'Cliente'}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <h1 style={{ margin: 0 }}>{project?.name || project?.code || 'Senza Titolo'}</h1>
          </div>
        </div>
      </div>

      {/* 4 Tabs Interattive Ufficio Tecnico */}
      <div className="ut-tabs">
        <button
          className={`ut-tab-btn ${activeTab === 'gantt' ? 'active' : ''}`}
          onClick={() => setActiveTab('gantt')}
        >
          📊 Gantt Interattivo
        </button>
        <button
          className={`ut-tab-btn ${activeTab === 'commessa' ? 'active' : ''}`}
          onClick={() => setActiveTab('commessa')}
        >
          📋 Scheda & Fasi <span className="tab-badge">{ganttData.tasks.length}</span>
        </button>
        <button
          className={`ut-tab-btn ${activeTab === 'ore' ? 'active' : ''}`}
          onClick={() => setActiveTab('ore')}
        >
          ⏱️ Consuntivazione Ore <span className="tab-badge">{Math.round(totalEff)}h</span>
        </button>
        <button
          className={`ut-tab-btn ${activeTab === 'alert' ? 'active' : ''}`}
          onClick={() => setActiveTab('alert')}
        >
          ⚠️ Ritardi & Semaforo
          {delaysList.length > 0 && (
            <span className="tab-badge tab-badge-danger">{delaysList.length}</span>
          )}
        </button>
        {canManageProject && (
          <button
            type="button"
            className={`btn btn-sm badge-${project?.status || 'planning'}`}
            onClick={openEditProjectModal}
            title="Modifica commessa e cambia stato"
            style={{
              marginLeft: 'auto',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 14px',
              fontSize: '0.85rem',
              fontWeight: 700,
              borderRadius: '8px',
              border: '1px solid currentColor',
              cursor: 'pointer',
              transition: 'all 0.15s ease'
            }}
          >
            ✏️ Modifica
          </button>
        )}
      </div>

      {/* TOOLBAR DI AZIONE POSIZIONATA SOTTO ALLE TABS */}
      <div className="project-toolbar">
        <div className="toolbar-left" style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          {canManageProject && (
            <button className="btn btn-primary" onClick={openNewTaskModal}>
              + Nuova Fase
            </button>
          )}

          {activeTab === 'gantt' && (
            <div style={{ position: 'relative' }}>
              <button
                className="btn btn-secondary"
                onClick={() => setShowColumnsMenu(!showColumnsMenu)}
              >
                ⚙️ Colonne
              </button>

              {showColumnsMenu && (
                <div style={{
                  position: 'absolute', top: '100%', left: 0, marginTop: 4, background: 'var(--bg-card)', border: '1px solid var(--border-default)',
                  borderRadius: 8, padding: 10, zIndex: 100, minWidth: 200, boxShadow: 'var(--shadow-md)'
                }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 8 }}>MOSTRA/NASCONDI:</div>
                  {[
                    { id: 'start_date', label: 'Inizio' },
                    { id: 'duration', label: 'Durata' },
                    { id: 'progress', label: 'Progresso' },
                    { id: 'priority', label: 'Priorità' },
                    { id: 'workers', label: 'Addetti' }
                  ].map(col => (
                    <label key={col.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', cursor: 'pointer', fontSize: 13, color: 'var(--text-primary)' }}>
                      <input
                        type="checkbox"
                        checked={visibleColumns.includes(col.id)}
                        onChange={(e) => {
                          const newCols = e.target.checked
                            ? [...visibleColumns, col.id]
                            : visibleColumns.filter(c => c !== col.id);
                          setVisibleColumns(newCols);
                          localStorage.setItem('ganttVisibleColumns', JSON.stringify(newCols));
                        }}
                      />
                      {col.label}
                    </label>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeTab === 'gantt' && (
            <div style={{ position: 'relative' }}>
              <button
                className="btn btn-secondary"
                onClick={() => { setShowDeptMenu(!showDeptMenu); setShowColumnsMenu(false); }}
                style={{ display: 'flex', alignItems: 'center', gap: 6 }}
              >
                🏢 Reparto
                {activeDepartments.length < ALL_DEPTS.length && (
                  <span style={{ background: '#6366f1', color: '#fff', borderRadius: 10, fontSize: '0.65rem', fontWeight: 700, padding: '1px 6px' }}>
                    {activeDepartments.length}/{ALL_DEPTS.length}
                  </span>
                )}
              </button>
              {showDeptMenu && (
                <div style={{
                  position: 'absolute', top: '100%', left: 0, marginTop: 4,
                  background: 'var(--bg-card)', border: '1px solid var(--border-default)',
                  borderRadius: 10, padding: 12, zIndex: 200, minWidth: 200,
                  boxShadow: 'var(--shadow-md)'
                }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>FILTRA PER REPARTO:</div>
                  {DEPT_OPTIONS.map(dept => (
                    <label key={dept.value} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', cursor: 'pointer', fontSize: 13, color: 'var(--text-primary)' }}>
                      <input
                        type="checkbox"
                        checked={activeDepartments.includes(dept.value)}
                        onChange={(e) => {
                          setActiveDepartments(e.target.checked
                            ? [...activeDepartments, dept.value]
                            : activeDepartments.filter(d => d !== dept.value)
                          );
                        }}
                      />
                      <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: '50%', background: dept.color, flexShrink: 0 }} />
                      {dept.label}
                    </label>
                  ))}
                  <div style={{ borderTop: '1px solid var(--border-subtle)', marginTop: 8, paddingTop: 8, display: 'flex', gap: 8 }}>
                    <button className="btn btn-sm btn-secondary" onClick={() => setActiveDepartments(ALL_DEPTS)} style={{ flex: 1, fontSize: 11 }}>Tutti</button>
                    <button className="btn btn-sm btn-secondary" onClick={() => setActiveDepartments([])} style={{ flex: 1, fontSize: 11 }}>Nessuno</button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="toolbar-right">
          {activeTab === 'gantt' && (
            <div className="zoom-controls">
              {['day', 'week', 'month', 'quarter'].map((z) => (
                <button
                  key={z}
                  className={`zoom-chip ${viewMode === z ? 'active' : ''}`}
                  onClick={() => handleZoom(z)}
                >
                  {z === 'day' ? 'Giorno' : z === 'week' ? 'Settimana' : z === 'month' ? 'Mese' : 'Trimestre'}
                </button>
              ))}
            </div>
          )}
          <div className="export-buttons" style={{ position: 'relative' }}>
            <button
              className="btn btn-primary"
              onClick={() => setShowExportMenu(!showExportMenu)}
              title="Esporta commessa"
              style={{ display: 'flex', alignItems: 'center', gap: 6 }}
            >
              📥 Stampa / Export ▾
            </button>

            {showExportMenu && (
              <div style={{
                position: 'absolute', top: '100%', right: 0, marginTop: 6,
                background: 'var(--bg-card)', border: '1px solid var(--border-default)',
                borderRadius: 10, padding: 16, zIndex: 300, minWidth: 280,
                boxShadow: '0 8px 32px rgba(0,0,0,0.2)', textAlign: 'left'
              }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Sezioni da esportare:
                </div>
                {[
                  { id: 'tasks', label: '📋 Fasi', desc: 'Tabella fasi, date, addetti, budget ore' },
                  { id: 'hours', label: '⏱ Consuntivazione Ore', desc: 'Ore previste vs effettive, saldo' },
                  { id: 'gantt', label: '📊 Diagramma Gantt', desc: 'Timeline visiva delle fasi' },
                ].map(sec => (
                  <label key={sec.id} style={{
                    display: 'flex', alignItems: 'flex-start', gap: 10,
                    padding: '8px 0', cursor: 'pointer', fontSize: 13,
                    color: 'var(--text-primary)', borderBottom: '1px solid var(--border-subtle)'
                  }}>
                    <input
                      type="checkbox"
                      checked={exportSections[sec.id]}
                      onChange={(e) => setExportSections(prev => ({ ...prev, [sec.id]: e.target.checked }))}
                      style={{ marginTop: 2, cursor: 'pointer' }}
                    />
                    <div>
                      <div style={{ fontWeight: 600 }}>{sec.label}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{sec.desc}</div>
                    </div>
                  </label>
                ))}

                <div style={{ borderTop: '1px solid var(--border-default)', marginTop: 10, paddingTop: 12 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    Formato:
                  </div>
                  <div style={{ display: 'flex', gap: 10 }}>
                    <label style={{
                      flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                      padding: '8px 12px', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: 600,
                      background: exportFormat === 'pdf' ? 'rgba(239, 68, 68, 0.15)' : 'var(--bg-tertiary)',
                      border: exportFormat === 'pdf' ? '2px solid #ef4444' : '1px solid var(--border-default)',
                      color: exportFormat === 'pdf' ? '#ef4444' : 'var(--text-secondary)',
                    }}>
                      <input
                        type="radio"
                        name="exportFormat"
                        value="pdf"
                        checked={exportFormat === 'pdf'}
                        onChange={() => setExportFormat('pdf')}
                        style={{ display: 'none' }}
                      />
                      📄 PDF
                    </label>
                    <label style={{
                      flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                      padding: '8px 12px', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: 600,
                      background: exportFormat === 'excel' ? 'rgba(16, 185, 129, 0.15)' : 'var(--bg-tertiary)',
                      border: exportFormat === 'excel' ? '2px solid #10b981' : '1px solid var(--border-default)',
                      color: exportFormat === 'excel' ? '#10b981' : 'var(--text-secondary)',
                    }}>
                      <input
                        type="radio"
                        name="exportFormat"
                        value="excel"
                        checked={exportFormat === 'excel'}
                        onChange={() => setExportFormat('excel')}
                        style={{ display: 'none' }}
                      />
                      📊 Excel
                    </label>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
                  <button
                    className="btn btn-secondary"
                    style={{ flex: 1 }}
                    onClick={() => setShowExportMenu(false)}
                  >
                    Annulla
                  </button>
                  <button
                    className="btn btn-primary"
                    style={{ flex: 1 }}
                    onClick={() => handleExport(exportFormat)}
                    disabled={!Object.values(exportSections).some(v => v)}
                  >
                    Export {exportFormat.toUpperCase()}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* TAB 1: GANTT */}
      {activeTab === 'gantt' && (
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0, width: '100%', maxWidth: '100%' }}>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 8, display: 'flex', justifyContent: 'space-between' }}>
            <span>
              {canManageProject
                ? '💡 Clicca e trascina per modificare le fasi. Per registrare le ore effettive di lavoro o consuntivare per singolo addetto, passa alla tab Consuntivazione Ore o clicca sul pulsante + Nuova Fase.'
                : '🔒 Gantt in Sola Lettura: Fai doppio click su una fase per aprire il Giornale Ore Consuntivate e inserire le ore realmente svolte per le attività a te assegnate.'}
            </span>
          </div>
          <div className="gantt-wrapper">
            <GanttChart
              tasks={ganttData.tasks.filter(t => !t.department || activeDepartments.includes(t.department))}
              links={ganttData.links}
              visibleColumns={visibleColumns}
              readOnly={!canManageProject}
              projectStartDate={project?.start_date}
              projectEndDate={project?.end_date}
              onTaskUpdate={handleTaskUpdate}
              onTaskCreate={handleTaskCreate}
              onTaskDelete={handleTaskDelete}
              onLinkCreate={handleLinkCreate}
              onLinkDelete={handleLinkDelete}
              onEditTask={openEditTaskModal}
              onNewTask={() => openNewTaskModal()}
            />
          </div>
        </div>
      )}

      {/* TAB 2: SCHEDA & FASI */}
      {activeTab === 'commessa' && (
        <div className="animate-fadeIn">
          <div className="commessa-summary-card">
            <h3 style={{ margin: 0, color: 'var(--text-primary)' }}>Riepilogo Generale Commessa</h3>
            {project?.description && (
              <p style={{ color: 'var(--text-secondary)', fontSize: 14, marginTop: 8 }}>{project.description}</p>
            )}
            <div className="commessa-stats-grid">
              <div className="stat-box">
                <div className="stat-box-label">Codice Commessa</div>
                <div className="stat-box-value" style={{ color: 'var(--accent-500)' }}>{project?.code || 'N/D'}</div>
              </div>
              <div className="stat-box">
                <div className="stat-box-label">Cliente</div>
                <div className="stat-box-value">{project?.client || 'N/D'}</div>
              </div>
              <div className="stat-box">
                <div className="stat-box-label">Data Avvio / Fine</div>
                <div className="stat-box-value" style={{ fontSize: '0.95rem' }}>
                  {project?.start_date || 'N/D'} → {project?.end_date || 'N/D'}
                </div>
              </div>
              <div className="stat-box">
                <div className="stat-box-label">Ore Previste Totali</div>
                <div className="stat-box-value">{totalPrev} h</div>
              </div>
              <div className="stat-box">
                <div className="stat-box-label">Ore Consuntivate Effettive</div>
                <div className="stat-box-value" style={{ color: totalEff >= totalPrev ? 'var(--success)' : 'var(--text-primary)' }}>
                  {totalEff} h
                </div>
              </div>
              <div className="stat-box">
                <div className="stat-box-label">Stato Avanzamento</div>
                <div className="stat-box-value">
                  {delaysList.length > 0 ? (
                    <span className="semaforo-ritardo">🔴 {delaysList.length} Fasi in Allarme</span>
                  ) : (
                    <span className="semaforo-ok">🟢 In Linea</span>
                  )}
                </div>
              </div>
              <div className="stat-box">
                <div className="stat-box-label">Responsabile Commessa</div>
                <div className="stat-box-value" style={{ fontSize: '0.95rem' }}>
                  {project?.responsible?.full_name || project?.responsible?.username || 'N/D'}
                </div>
              </div>
              <div className="stat-box">
                <div className="stat-box-label">Addetti Commessa</div>
                <div className="stat-box-value" style={{ fontSize: '0.9rem', whiteSpace: 'normal', lineHeight: '1.3' }}>
                  {Array.isArray(project?.assigned_workers) && project.assigned_workers.length > 0
                    ? project.assigned_workers.join(', ')
                    : 'Nessuno specifico'}
                </div>
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 10, position: 'relative' }}>
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => setShowTableColumnsMenu(!showTableColumnsMenu)}
            >
              ⚙️ Colonne ▾
            </button>
            {showTableColumnsMenu && (
              <div style={{
                position: 'absolute', top: '100%', right: 0, marginTop: 4, background: 'var(--bg-card)', border: '1px solid var(--border-default)',
                borderRadius: 8, padding: 10, zIndex: 100, minWidth: 200, boxShadow: 'var(--shadow-md)', textAlign: 'left'
              }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 8 }}>MOSTRA/NASCONDI:</div>
                {[{ id: 'reparto', label: 'Reparto' }, { id: 'addetti', label: 'Addetti Assegnati' }, { id: 'date', label: 'Inizio / Fine' }, { id: 'ore', label: 'Ore Prev vs Eff' }, { id: 'semaforo', label: 'Semaforo Avanzamento' }, { id: 'azioni', label: 'Azioni' }].map(col => (
                  <label key={col.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', cursor: 'pointer', fontSize: 13, color: 'var(--text-primary)' }}>
                    <input
                      type="checkbox"
                      checked={tableVisibleColumns.includes(col.id)}
                      onChange={() => toggleTableColumn(col.id)}
                    />
                    {col.label}
                  </label>
                ))}
              </div>
            )}
          </div>

          <div className="phases-table-container">
            <table className="phases-table">
              <thead>
                <tr>
                  <th>Fase Lavorazione</th>
                  {tableVisibleColumns.includes('reparto') && <th>Reparto</th>}
                  {tableVisibleColumns.includes('addetti') && <th>Addetti Assegnati</th>}
                  {tableVisibleColumns.includes('date') && <th>Inizio / Fine</th>}
                  {tableVisibleColumns.includes('ore') && <th>Ore Prev vs Eff</th>}
                  {tableVisibleColumns.includes('semaforo') && <th>Semaforo Avanzamento</th>}
                  {tableVisibleColumns.includes('azioni') && <th style={{ textAlign: 'right' }}>Azioni</th>}
                </tr>
              </thead>
              <tbody>
                {ganttData.tasks.length === 0 ? (
                  <tr>
                    <td colSpan={1 + tableVisibleColumns.length} style={{ textAlign: 'center', color: 'var(--text-tertiary)', padding: 32 }}>
                      Nessuna fase aggiunta. Clicca <strong>+ Nuova Fase Lavorazione</strong> in alto.
                    </td>
                  </tr>
                ) : (
                  ganttData.tasks.map((task) => {
                    const st = computeStato(task);
                    const tEff = calculateTaskEffHours(task);
                    const tColor = getTaskColor(task);
                    const isCompleted = isTaskCompleted(task);
                    return (

                      <tr key={task.id} style={{ backgroundColor: isCompleted ? 'rgba(16, 185, 129, 0.18)' : undefined }}>
                        <td style={{ fontWeight: 600 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <input
                              type="checkbox"
                              checked={isCompleted}
                              onChange={() => handleToggleTaskCompleted(task, isCompleted)}
                              title="Clicca per spuntare/rimuovere completamento fase"
                              style={{ cursor: 'pointer', width: 16, height: 16, accentColor: '#10b981' }}
                            />
                            <span style={{ width: 12, height: 12, borderRadius: '50%', backgroundColor: tColor, flexShrink: 0, display: 'inline-block', border: '1px solid rgba(255,255,255,0.2)' }} title={`Colore fase: ${tColor}`} />
                            <span>
                              {task.text}
                            </span>
                          </div>
                        </td>
                        {tableVisibleColumns.includes('reparto') && (
                          <td>
                            {task.department ? (() => {
                              const dept = DEPT_OPTIONS.find(d => d.value === task.department);
                              return (
                                <span style={{
                                  display: 'inline-block', padding: '3px 10px', borderRadius: 20, fontSize: '0.75rem', fontWeight: 600,
                                  background: (dept?.color || '#6b7280') + '22', color: dept?.color || '#6b7280',
                                  border: `1px solid ${(dept?.color || '#6b7280')}44`, whiteSpace: 'nowrap'
                                }}>
                                  {dept?.label || task.department}
                                </span>
                              );
                            })() : <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>—</span>}
                          </td>
                        )}
                        {tableVisibleColumns.includes('addetti') && (
                          <td>

                            {Array.isArray(task.workers) && task.workers.length > 0 ? (
                              task.workers.map(w => (
                                <span key={w} className="worker-chip">👤 {w}</span>
                              ))
                            ) : (
                              <span style={{ color: 'var(--text-tertiary)', fontSize: 12 }}>Nessun addetto</span>
                            )}
                          </td>
                        )}
                        {tableVisibleColumns.includes('date') && (
                          <td style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                            <div>{formatDateOnly(task.start_date)} → {formatDateOnly(task.end_date)}</div>
                            <div style={{ fontSize: 11, color: 'var(--accent-500)', fontWeight: 600, marginTop: 2 }}>
                              🗓️ Durata: {task.duration || 1} {task.duration === 1 ? 'giorno' : 'giorni'}
                            </div>
                          </td>
                        )}
                        {tableVisibleColumns.includes('ore') && (
                          <td>
                            <strong>{task.planned_hours || 8}h</strong> prev /{' '}
                            <span style={{ color: tEff < (task.planned_hours * 0.5) ? 'var(--danger)' : 'var(--success)', fontWeight: 700 }}>
                              {tEff}h eff
                            </span>
                          </td>
                        )}
                        {tableVisibleColumns.includes('semaforo') && (
                          <td>
                            {st === 'ok' && <span className="semaforo-ok">🟢 OK (Regolare)</span>}
                            {st === 'attenzione' && <span className="semaforo-attenzione">🟡 Attenzione</span>}
                            {st === 'ritardo' && <span className="semaforo-ritardo">🔴 Ritardo Lavorazione</span>}
                          </td>
                        )}
                        {tableVisibleColumns.includes('azioni') && (
                          <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                            <button
                              className="btn btn-secondary btn-sm"
                              style={{ marginRight: 6 }}
                              onClick={() => openOreModalForTask(task)}
                              title="Inserisci ore lavorate (Giornale ore)"
                            >
                              ⏱️ Consuntiva
                            </button>
                            {canManageProject && (
                              <>
                                <button
                                  className="btn btn-secondary btn-sm"
                                  style={{ marginRight: 6 }}
                                  onClick={() => openEditTaskModal(task)}
                                  title="Modifica fase"
                                >
                                  ✏️
                                </button>
                                <button
                                  className="btn-ghost btn-sm project-delete"
                                  onClick={() => handleTaskDelete(task.id)}
                                  title="Elimina fase"
                                >
                                  🗑️
                                </button>
                              </>
                            )}
                          </td>
                        )}
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 3: CONSUNTIVAZIONE ORE */}
      {activeTab === 'ore' && (
        <div className="animate-fadeIn">
          <div className="commessa-summary-card">
            <h3 style={{ margin: 0, color: 'var(--text-primary)' }}>Consuntivazione Ore Effettive per Fase e Addetto</h3>
            <p style={{ color: 'var(--text-secondary)', fontSize: 14, marginTop: 6, marginBottom: 0 }}>
              Monitoraggio delle ore di lavoro effettivamente svolte da ciascun membro del team nei giorni lavorativi di calendario. Clicca su <strong>Consuntiva Ore</strong> per compilare la scheda consuntivo di una fase.
            </p>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 10, position: 'relative' }}>
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => setShowOreColumnsMenu(!showOreColumnsMenu)}
            >
              ⚙️ Colonne ▾
            </button>
            {showOreColumnsMenu && (
              <div style={{
                position: 'absolute', top: '100%', right: 0, marginTop: 4, background: 'var(--bg-card)', border: '1px solid var(--border-default)',
                borderRadius: 8, padding: 10, zIndex: 100, minWidth: 200, boxShadow: 'var(--shadow-md)', textAlign: 'left'
              }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 8 }}>MOSTRA/NASCONDI:</div>
                {[{ id: 'addetti', label: 'Addetti e Spaccato Ore' }, { id: 'giorni', label: 'Giorni Lavorativi Previsti' }, { id: 'ore_giorno', label: 'Ore Previste / Giorno' }, { id: 'totale', label: 'Totale Consuntivato' }, { id: 'semaforo', label: 'Semaforo' }, { id: 'azioni', label: 'Azione' }].map(col => (
                  <label key={col.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', cursor: 'pointer', fontSize: 13, color: 'var(--text-primary)' }}>
                    <input
                      type="checkbox"
                      checked={oreVisibleColumns.includes(col.id)}
                      onChange={() => toggleOreColumn(col.id)}
                    />
                    {col.label}
                  </label>
                ))}
              </div>
            )}
          </div>

          <div className="phases-table-container">
            <table className="phases-table">
              <thead>
                <tr>
                  <th>Fase Lavorazione</th>
                  {oreVisibleColumns.includes('addetti') && <th>Addetti e Spaccato Ore</th>}
                  {oreVisibleColumns.includes('giorni') && <th>Giorni Lavorativi Previsti</th>}
                  {oreVisibleColumns.includes('ore_giorno') && <th>Ore Previste / Giorno</th>}
                  {oreVisibleColumns.includes('totale') && <th>Totale Consuntivato</th>}
                  {oreVisibleColumns.includes('semaforo') && <th>Semaforo</th>}
                  {oreVisibleColumns.includes('azioni') && <th style={{ textAlign: 'right' }}>Azione</th>}
                </tr>
              </thead>
              <tbody>
                {ganttData.tasks.length === 0 ? (
                  <tr>
                    <td colSpan={1 + oreVisibleColumns.length} style={{ textAlign: 'center', color: 'var(--text-tertiary)', padding: 32 }}>
                      Nessuna fase disponibile. Aggiungi fasi per registrare le ore.
                    </td>
                  </tr>
                ) : (
                  ganttData.tasks.map(task => {
                    const st = computeStato(task);
                    const dates = getWorkDatesBetween(
                      formatDateOnly(task.start_date),
                      formatDateOnly(task.end_date)
                    );
                    const oreGg = dates.length > 0 ? ((task.planned_hours || 8) / dates.length).toFixed(1) : (task.planned_hours || 8);

                    const workersList = Array.isArray(task.workers) && task.workers.length > 0 ? task.workers : ['Addetto Generico'];
                    const workerTotals = {};
                    let totalTaskEff = 0;

                    workersList.forEach(w => {
                      workerTotals[w] = 0;
                      if (task.actual_hours && task.actual_hours[w]) {
                        Object.values(task.actual_hours[w]).forEach(h => {
                          workerTotals[w] += Number(h) || 0;
                        });
                      }
                      totalTaskEff += workerTotals[w];
                    });

                    const tColor = getTaskColor(task);
                    const isCompleted = isTaskCompleted(task);
                    return (
                      <tr key={task.id} style={{ backgroundColor: isCompleted ? 'rgba(16, 185, 129, 0.18)' : undefined }}>
                        <td style={{ fontWeight: 600 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <input
                              type="checkbox"
                              checked={isCompleted}
                              onChange={() => handleToggleTaskCompleted(task, isCompleted)}
                              title="Clicca per spuntare/rimuovere completamento fase"
                              style={{ cursor: 'pointer', width: 16, height: 16, accentColor: '#10b981' }}
                            />
                            <span style={{ width: 12, height: 12, borderRadius: '50%', backgroundColor: tColor, flexShrink: 0, display: 'inline-block', border: '1px solid rgba(255,255,255,0.2)' }} title={`Colore fase: ${tColor}`} />
                            <span>
                              {task.text}
                            </span>
                          </div>
                        </td>
                        {oreVisibleColumns.includes('addetti') && (
                          <td>

                            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                              {workersList.map(w => (
                                <div key={w} style={{ fontSize: 13 }}>
                                  <span className="worker-chip">👤 {w}</span>: <strong>{workerTotals[w]}h</strong> fatte
                                </div>
                              ))}
                            </div>
                          </td>
                        )}
                        {oreVisibleColumns.includes('giorni') && <td>{dates.length} giorni lavorativi</td>}
                        {oreVisibleColumns.includes('ore_giorno') && <td>~{oreGg} h/giorno</td>}
                        {oreVisibleColumns.includes('totale') && (
                          <td>
                            <span style={{ fontSize: 15, fontWeight: 700, color: totalTaskEff >= task.planned_hours ? 'var(--success)' : 'var(--accent-500)' }}>
                              {totalTaskEff} h
                            </span> / {task.planned_hours || 8} h prev
                          </td>
                        )}
                        {oreVisibleColumns.includes('semaforo') && (
                          <td>
                            {st === 'ok' && <span className="semaforo-ok">🟢 Regolare</span>}
                            {st === 'attenzione' && <span className="semaforo-attenzione">🟡 Attenzione</span>}
                            {st === 'ritardo' && <span className="semaforo-ritardo">🔴 Ritardo</span>}
                          </td>
                        )}
                        {oreVisibleColumns.includes('azioni') && (
                          <td style={{ textAlign: 'right' }}>
                            <button
                              className="btn btn-primary btn-sm"
                              onClick={() => openOreModalForTask(task)}
                            >
                              ⏱️ Consuntiva Ore
                            </button>
                          </td>
                        )}
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 4: RITARDI & ALLARMI */}
      {activeTab === 'alert' && (
        <div className="animate-fadeIn">
          <div className="commessa-summary-card">
            <h3 style={{ margin: 0, color: 'var(--text-primary)' }}>Motore Semafori & Allarmi Lavorazioni</h3>
            <p style={{ color: 'var(--text-secondary)', fontSize: 14, marginTop: 6, marginBottom: 0 }}>
              Questo pannello identifica automaticamente tutte le lavorazioni e commesse che non stanno rispettando la consuntivazione oraria attesa (meno del 50% delle ore previste o giorni lavorativi trascorsi con 0 ore registrate).
            </p>
          </div>

          {delaysList.length === 0 ? (
            <div className="commessa-summary-card" style={{ textAlign: 'center', padding: 48, borderColor: 'rgba(16, 185, 129, 0.4)' }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>🎉</div>
              <h3 style={{ color: 'var(--success)', margin: 0 }}>Nessuna Allerta di Ritardo!</h3>
              <p style={{ color: 'var(--text-secondary)', marginTop: 8 }}>
                Tutte le {ganttData.tasks.length} fasi di lavorazione della commessa sono regolarmente coperte dalla consuntivazione oraria degli addetti.
              </p>
            </div>
          ) : (
            delaysList.map(item => (
              <div key={item.task.id} className={`alert-card ${item.stato}`}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                    <span style={{ fontWeight: 700, fontSize: 16, color: 'var(--text-primary)' }}>
                      {item.task.text}
                    </span>
                    {item.stato === 'ritardo' ? (
                      <span className="semaforo-ritardo">🔴 RITARDO CRITICO (&lt; 50% ORE / 0 ORE IN GIORNI TRASCORSI)</span>
                    ) : (
                      <span className="semaforo-attenzione">🟡 ATTENZIONE (&lt; ORE ATTESE GIORNALIERE)</span>
                    )}
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                    📅 Inizio/Fine: <strong>{formatDateOnly(item.task.start_date)} → {formatDateOnly(item.task.end_date)}</strong> |{' '}
                    Addetti: <strong>{Array.isArray(item.task.workers) ? item.task.workers.join(', ') : 'Nessuno'}</strong>
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--text-tertiary)', marginTop: 4 }}>
                    📊 Ore Previste: <strong>{item.task.planned_hours || 8}h</strong> | Consuntivate finora: <strong>{item.tEff}h</strong>
                  </div>
                </div>
                <button
                  className="btn btn-primary"
                  onClick={() => openOreModalForTask(item.task)}
                >
                  ⏱️ Intervieni e Registra Ore
                </button>
              </div>
            ))
          )}
        </div>
      )}

      {/* MODALE NUOVA / MODIFICA FASE (TASK MODAL) */}
      {showTaskModal && (
        <div className="modal-overlay" onClick={() => setShowTaskModal(false)}>
          <div className="modal" style={{ maxWidth: 620 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{editingTask ? 'Dettagli Fase Lavorazione' : 'Nuova Fase Lavorazione (Ufficio Tecnico)'}</h2>
              <button className="btn-ghost btn-icon" onClick={() => setShowTaskModal(false)}>✕</button>
            </div>

            {editingTask && (
              <div className="ut-tabs" style={{ marginBottom: 16, paddingBottom: 0 }}>
                <button className={`ut-tab-btn ${taskModalTab === 'generale' ? 'active' : ''}`} onClick={() => setTaskModalTab('generale')}>
                  Generale
                </button>
                <button className={`ut-tab-btn ${taskModalTab === 'checklist' ? 'active' : ''}`} onClick={() => setTaskModalTab('checklist')}>
                  Checklist
                </button>
                <button className={`ut-tab-btn ${taskModalTab === 'commenti' ? 'active' : ''}`} onClick={() => setTaskModalTab('commenti')}>
                  Commenti
                </button>
              </div>
            )}

            {taskModalTab === 'generale' && (
              <form onSubmit={handleSaveTaskForm}>
                {/* Scelta Tipo Fase: Normale o Milestone (Linea Verticale / Evento) */}
                <div style={{ marginBottom: 16, padding: '12px', background: 'var(--bg-tertiary)', borderRadius: '8px', border: '1px solid var(--border-default)' }}>
                  <label style={{ display: 'block', marginBottom: '8px', fontWeight: 600, fontSize: '0.9rem', color: 'var(--text-primary)' }}>Tipo di Voce:</label>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '0.9rem', color: 'var(--text-primary)', fontWeight: taskForm.taskType !== 'milestone' ? 600 : 400 }}>
                      <input
                        type="radio"
                        name="taskType"
                        value="task"
                        checked={taskForm.taskType !== 'milestone'}
                        onChange={() => setTaskForm({ ...taskForm, taskType: 'task' })}
                      />
                      📋 Fase di Lavorazione (con durata e ore)
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '0.9rem', color: 'var(--text-primary)', fontWeight: taskForm.taskType === 'milestone' ? 600 : 400 }}>
                      <input
                        type="radio"
                        name="taskType"
                        value="milestone"
                        checked={taskForm.taskType === 'milestone'}
                        onChange={() => setTaskForm({ ...taskForm, taskType: 'milestone', color: taskForm.color === PHASE_DEFAULT_COLORS[PREDEFINED_PHASES[0]] ? '#f59e0b' : taskForm.color })}
                      />
                      📍 Evento / Scadenza
                    </label>
                  </div>
                </div>

                {taskForm.taskType !== 'milestone' && (
                  <div style={{ marginBottom: 16, padding: '10px 14px', background: 'var(--bg-tertiary)', borderRadius: '8px', border: '1px solid var(--border-default)', display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <input
                      type="checkbox"
                      id="taskCompleted"
                      checked={Number(taskForm.completed) === 1}
                      onChange={(e) => setTaskForm({ ...taskForm, completed: e.target.checked ? 1 : -1 })}
                      style={{ width: '18px', height: '18px', cursor: 'pointer' }}
                    />
                    <label htmlFor="taskCompleted" style={{ cursor: 'pointer', fontWeight: 600, fontSize: '0.9rem', color: 'var(--text-primary)', margin: 0 }}>
                      ✅ Fase Completata
                    </label>
                  </div>
                )}

                <div className="input-group" style={{ position: 'relative' }}>
                  <label>{taskForm.taskType === 'milestone' ? 'Nome Evento / Scadenza *' : 'Fase di Lavorazione *'}</label>
                  <div
                    className="input"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      cursor: 'pointer',
                      background: 'var(--bg-secondary)',
                      userSelect: 'none',
                    }}
                    onClick={() => setShowPhaseDropdown(!showPhaseDropdown)}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, overflow: 'hidden' }}>
                      {taskForm.faseSel !== '__custom__' && (
                        <span style={{ width: 14, height: 14, borderRadius: '50%', background: taskForm.color || '#3b82f6', border: '1px solid var(--border-default)', flexShrink: 0 }} />
                      )}
                      <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontWeight: 600 }}>
                        {taskForm.faseSel === '__custom__' ? '✏️ Altra lavorazione personalizzata...' : taskForm.faseSel}
                      </span>
                    </div>
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{showPhaseDropdown ? '▲' : '▼'}</span>
                  </div>

                  {showPhaseDropdown && (
                    <div
                      className="dropdown-menu"
                      style={{
                        position: 'absolute',
                        top: '100%',
                        left: 0,
                        right: 0,
                        marginTop: 4,
                        maxHeight: 320,
                        overflowY: 'auto',
                        zIndex: 100,
                        background: 'var(--bg-secondary)',
                        border: '1px solid var(--border-default)',
                        borderRadius: 'var(--radius-md)',
                        boxShadow: 'var(--shadow-xl)',
                      }}
                    >
                      {(() => {
                        const available = getAvailableTemplates();
                        if (user?.role === 'admin') {
                          const depts = ['ufficio_tecnico', 'produzione', 'acquisti', 'tutti'];
                          const deptLabels = {
                            ufficio_tecnico: '🔧 Ufficio Tecnico',
                            produzione: '🏭 Produzione',
                            acquisti: '🛒 Acquisti',
                            tutti: '⚙️ Condivise / Tutti',
                          };
                          return depts.map(dKey => {
                            const dItems = available.filter(t => t.department === dKey);
                            if (dItems.length === 0) return null;
                            return (
                              <div key={dKey}>
                                <div style={{ padding: '6px 12px', fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-secondary)', background: 'var(--bg-tertiary)', borderBottom: '1px solid var(--border-default)', borderTop: '1px solid var(--border-default)', textTransform: 'uppercase' }}>
                                  {deptLabels[dKey] || dKey}
                                </div>
                                {dItems.map(tpl => (
                                  <div
                                    key={tpl.id || tpl.name}
                                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', cursor: 'pointer', background: taskForm.faseSel === tpl.name ? 'var(--primary-subtle, rgba(59,130,246,0.15))' : 'transparent', borderBottom: '1px solid var(--border-default)' }}
                                    onClick={() => {
                                      setTaskForm({
                                        ...taskForm,
                                        faseSel: tpl.name,
                                        color: tpl.default_color || PHASE_DEFAULT_COLORS[tpl.name] || taskForm.color,
                                      });
                                      setShowPhaseDropdown(false);
                                    }}
                                  >
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                      <span style={{ width: 12, height: 12, borderRadius: '50%', background: tpl.default_color || PHASE_DEFAULT_COLORS[tpl.name] || '#3b82f6', border: '1px solid var(--border-default)' }} />
                                      <span style={{ fontWeight: taskForm.faseSel === tpl.name ? 600 : 400, color: 'var(--text-primary)' }}>{tpl.name}</span>
                                    </div>
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleDeleteTemplateFromDropdown(tpl);
                                      }}
                                      className="btn-ghost btn-sm"
                                      style={{ padding: '2px 6px', color: 'var(--danger)', fontSize: '0.9rem' }}
                                      title="Elimina dall'elenco a tendina"
                                    >
                                      🗑️
                                    </button>
                                  </div>
                                ))}
                              </div>
                            );
                          });
                        } else {
                          return available.map(tpl => (
                            <div
                              key={tpl.id || tpl.name}
                              style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', cursor: 'pointer', background: taskForm.faseSel === tpl.name ? 'var(--primary-subtle, rgba(59,130,246,0.15))' : 'transparent', borderBottom: '1px solid var(--border-default)' }}
                              onClick={() => {
                                setTaskForm({
                                  ...taskForm,
                                  faseSel: tpl.name,
                                  color: tpl.default_color || PHASE_DEFAULT_COLORS[tpl.name] || taskForm.color,
                                });
                                setShowPhaseDropdown(false);
                              }}
                            >
                              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                <span style={{ width: 12, height: 12, borderRadius: '50%', background: tpl.default_color || PHASE_DEFAULT_COLORS[tpl.name] || '#3b82f6', border: '1px solid var(--border-default)' }} />
                                <span style={{ fontWeight: taskForm.faseSel === tpl.name ? 600 : 400, color: 'var(--text-primary)' }}>{tpl.name}</span>
                              </div>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleDeleteTemplateFromDropdown(tpl);
                                }}
                                className="btn-ghost btn-sm"
                                style={{ padding: '2px 6px', color: 'var(--danger)', fontSize: '0.9rem' }}
                                title="Elimina dall'elenco a tendina"
                              >
                                🗑️
                              </button>
                            </div>
                          ));
                        }
                      })()}

                      <div
                        onClick={() => {
                          setTaskForm({ ...taskForm, faseSel: '__custom__' });
                          setShowPhaseDropdown(false);
                        }}
                        style={{ padding: '10px 12px', cursor: 'pointer', fontWeight: 600, color: 'var(--primary)', borderTop: '2px solid var(--border-default)', display: 'flex', alignItems: 'center', gap: 8, background: taskForm.faseSel === '__custom__' ? 'var(--primary-subtle, rgba(59,130,246,0.15))' : 'transparent' }}
                      >
                        <span>✏️</span>
                        <span>Altra lavorazione personalizzata...</span>
                      </div>
                    </div>
                  )}
                </div>

                {taskForm.faseSel === '__custom__' && (
                  <div className="input-group" style={{ marginTop: 12 }}>
                    <label>Nome Lavorazione Personalizzata *</label>
                    <input
                      className="input"
                      value={taskForm.customText}
                      onChange={(e) => setTaskForm({ ...taskForm, customText: e.target.value })}
                      required
                      placeholder="es. Verifica requisiti speciali con fornitore"
                    />
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 4, display: 'block' }}>
                      💡 Questa nuova fase verrà automaticamente aggiunta all'elenco suggerito per il reparto {user?.role === 'admin' ? 'di competenza' : (user?.department ? user.department.replace('_', ' ') : 'ufficio tecnico')}.
                    </span>
                  </div>
                )}

                {/* Colore personalizzato della fase */}
                <div className="input-group" style={{ marginTop: 14 }}>
                  <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span>Colore Fase (Gantt & Timeline)</span>
                    <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', fontWeight: 'normal' }}>Personalizzabile</span>
                  </label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginTop: 4 }}>
                    <input
                      type="color"
                      value={taskForm.color || '#3b82f6'}
                      onChange={(e) => setTaskForm({ ...taskForm, color: e.target.value })}
                      style={{ width: 44, height: 38, padding: 2, border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)', cursor: 'pointer', background: 'var(--bg-tertiary)' }}
                    />
                    <input
                      type="text"
                      className="input"
                      value={(taskForm.color || '#3b82f6').toUpperCase()}
                      onChange={(e) => setTaskForm({ ...taskForm, color: e.target.value })}
                      style={{ width: 100, fontFamily: 'monospace' }}
                      maxLength={7}
                    />
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {Object.values(PHASE_DEFAULT_COLORS).slice(0, 8).map((c) => (
                        <button
                          key={c}
                          type="button"
                          onClick={() => setTaskForm({ ...taskForm, color: c })}
                          style={{
                            width: 24,
                            height: 24,
                            borderRadius: '50%',
                            backgroundColor: c,
                            border: taskForm.color === c ? '2px solid #fff' : '1px solid var(--border-subtle)',
                            boxShadow: taskForm.color === c ? '0 0 0 2px var(--accent-500)' : 'none',
                            cursor: 'pointer',
                            padding: 0
                          }}
                          title={`Colore preset: ${c}`}
                        />
                      ))}
                    </div>
                  </div>
                </div>


                {/* Sezione Pianificazione Temporale e Durate / Data Evento */}
                {taskForm.taskType === 'milestone' ? (
                  <div style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-lg)', padding: 14, marginTop: 16 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: '#f59e0b', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 12 }}>
                      📍 Data Evento / Milestone (Linea Verticale e Diamante nel Gantt)
                    </div>
                    <div className="input-group" style={{ maxWidth: 260 }}>
                      <label>Data Evento</label>
                      <input
                        type="date"
                        className="input"
                        value={taskForm.start_date}
                        onChange={(e) => setTaskForm({ ...taskForm, start_date: e.target.value, end_date: e.target.value })}
                      />
                    </div>
                  </div>
                ) : (
                  <>
                    <div style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-lg)', padding: 14, marginTop: 16 }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent-500)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 12 }}>
                        🗓️ Pianificazione e Durata (Impostabile in Giorni e in Ore)
                      </div>

                      {/* Scelta Modalità Budget e Pianificazione Date */}
                      <div style={{ marginTop: 8, marginBottom: 16, padding: '12px', background: 'var(--bg-tertiary)', borderRadius: '8px', border: '1px solid var(--border-default)' }}>
                        <label style={{ display: 'block', marginBottom: '8px', fontWeight: 600, fontSize: '0.9rem', color: 'var(--text-primary)' }}>
                          Modalità calcolo budget e pianificazione date:
                        </label>
                        <select
                          className="input"
                          style={{ width: '100%', fontWeight: 600, background: 'var(--bg-primary)', borderColor: 'var(--accent-500)', color: 'var(--text-primary)' }}
                          value={budgetMode}
                          onChange={(e) => handleBudgetModeChange(e.target.value)}
                        >
                          <option value="start_end">📅 Data Inizio / Data Fine (calcola giorni lavorativi ed ore escludendo sab/dom e festivi)</option>
                          <option value="start_hours">⏳ Data Inizio / Ore (calcola data fine escludendo sab/dom e festivi, giorni = ore/8)</option>
                          <option value="end_hours">⏳ Data Fine / Ore (calcola data inizio a ritroso escludendo sab/dom e festivi)</option>
                          <option value="start_days">📆 Data Inizio / Giorni (calcola data fine escludendo sab/dom e festivi, ore = giorni×8)</option>
                          <option value="end_days">📆 Data Fine / Giorni (calcola data inizio a ritroso escludendo sab/dom e festivi)</option>
                          <option value="start_days_hours">⚡ Data Inizio / Giorni / Ore (es. 24h spalmate su 10 gg escludendo sab/dom e festivi)</option>
                          <option value="end_days_hours">⚡ Data Fine / Giorni / Ore (es. 24h spalmate a ritroso su 10 gg escludendo sab/dom e festivi)</option>
                        </select>
                      </div>

                      <div style={{ display: 'flex', gap: 12 }}>
                        <div className="input-group" style={{ flex: 1 }}>
                          <label>Data Avvio Lavorazione</label>
                          <input
                            type="date"
                            className="input"
                            value={taskForm.start_date}
                            onChange={(e) => handleStartDateChange(e.target.value)}
                            disabled={budgetMode === 'end_hours' || budgetMode === 'end_days' || budgetMode === 'end_days_hours'}
                            style={{ opacity: (budgetMode === 'end_hours' || budgetMode === 'end_days' || budgetMode === 'end_days_hours') ? 0.6 : 1 }}
                            title={(budgetMode === 'end_hours' || budgetMode === 'end_days' || budgetMode === 'end_days_hours') ? "Data inizio calcolata automaticamente a ritroso" : ""}
                          />
                        </div>
                        <div className="input-group" style={{ flex: 1 }}>
                          <label>Data Fine Lavorazione</label>
                          <input
                            type="date"
                            className="input"
                            value={taskForm.end_date}
                            onChange={(e) => handleEndDateChange(e.target.value)}
                            disabled={budgetMode === 'start_hours' || budgetMode === 'start_days' || budgetMode === 'start_days_hours'}
                            style={{ opacity: (budgetMode === 'start_hours' || budgetMode === 'start_days' || budgetMode === 'start_days_hours') ? 0.6 : 1 }}
                            title={(budgetMode === 'start_hours' || budgetMode === 'start_days' || budgetMode === 'start_days_hours') ? "Data fine calcolata automaticamente escludendo sab e dom" : ""}
                          />
                        </div>
                      </div>

                      <div style={{ display: 'flex', gap: 12, marginTop: 12 }}>
                        <div className="input-group" style={{ flex: 1 }}>
                          <label>Durata in Giorni (Lavorativi: Lun-Ven)</label>
                          <div style={{ position: 'relative' }}>
                            <input
                              type="number"
                              min="1"
                              step="1"
                              className="input"
                              style={{ fontWeight: 600, color: 'var(--accent-500)', paddingRight: '70px', opacity: (budgetMode === 'start_end' || budgetMode === 'start_hours' || budgetMode === 'end_hours') ? 0.6 : 1 }}
                              value={taskForm.duration_days}
                              onChange={(e) => handleDurationDaysChange(e.target.value)}
                              disabled={budgetMode === 'start_end' || budgetMode === 'start_hours' || budgetMode === 'end_hours'}
                            />
                            <span style={{ position: 'absolute', right: 40, top: 9, fontSize: 12, color: 'var(--text-tertiary)', pointerEvents: 'none' }}>giorni</span>
                          </div>
                        </div>
                        <div className="input-group" style={{ flex: 1 }}>
                          <label>Durata in Ore (Budget Lavoro)</label>
                          <div style={{ position: 'relative' }}>
                            <input
                              type="number"
                              min="0.5"
                              step="0.5"
                              className="input"
                              style={{ fontWeight: 600, color: 'var(--success)', paddingRight: '60px', opacity: (budgetMode === 'start_days' || budgetMode === 'end_days') ? 0.6 : 1 }}
                              value={taskForm.planned_hours}
                              onChange={(e) => handlePlannedHoursChange(e.target.value)}
                              disabled={budgetMode === 'start_days' || budgetMode === 'end_days'}
                            />
                            <span style={{ position: 'absolute', right: 40, top: 9, fontSize: 12, color: 'var(--text-tertiary)', pointerEvents: 'none' }}>ore</span>
                          </div>
                        </div>
                      </div>

                      {/* Reparto */}
                      <div className="input-group" style={{ marginTop: 12 }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          🏢 Reparto
                          {user?.role !== 'admin' && (
                            <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 400 }}>(assegnato automaticamente)</span>
                          )}
                        </label>
                        {user?.role === 'admin' ? (
                          <select
                            className="input"
                            value={taskForm.department || ''}
                            onChange={(e) => setTaskForm({ ...taskForm, department: e.target.value || null })}
                          >
                            <option value="">— Nessun reparto —</option>
                            {DEPT_OPTIONS.map(d => (
                              <option key={d.value} value={d.value}>{d.label}</option>
                            ))}
                          </select>
                        ) : (
                          <div style={{
                            padding: '8px 14px', borderRadius: 8, fontSize: 13, fontWeight: 600,
                            background: taskForm.department ? (DEPT_OPTIONS.find(d => d.value === taskForm.department)?.color || '#6b7280') + '18' : 'var(--bg-secondary)',
                            color: taskForm.department ? (DEPT_OPTIONS.find(d => d.value === taskForm.department)?.color || '#6b7280') : 'var(--text-muted)',
                            border: `1px solid ${taskForm.department ? (DEPT_OPTIONS.find(d => d.value === taskForm.department)?.color || '#6b7280') + '44' : 'var(--border-subtle)'}`,
                            display: 'flex', alignItems: 'center', gap: 8
                          }}>
                            {taskForm.department ? DEPT_OPTIONS.find(d => d.value === taskForm.department)?.label || taskForm.department : '— Nessun reparto —'}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="input-group" style={{ marginTop: 16 }}>
                      <label>Addetti Assegnati (Multi-selezione)</label>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
                        {predefinedWorkers.map(w => {
                          const sel = taskForm.workers.includes(w);
                          return (
                            <button
                              type="button"
                              key={w}
                              onClick={() => toggleWorkerSelection(w)}
                              style={{
                                background: sel ? 'var(--accent-600)' : 'var(--bg-primary)',
                                color: sel ? '#fff' : 'var(--text-secondary)',
                                border: `1px solid ${sel ? 'var(--accent-500)' : 'var(--border-default)'}`,
                                padding: '6px 12px',
                                borderRadius: '16px',
                                cursor: 'pointer',
                                fontSize: '0.85rem',
                                fontWeight: sel ? 600 : 400
                              }}
                            >
                              {sel ? '✓ ' : '+ '}{w}
                            </button>
                          );
                        })}
                      </div>


                      {/* Sezione addetti attualmente assegnati (sotto al campo aggiungi altro addetto) */}
                      <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px dashed var(--border-default)' }}>
                        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent-500)', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span>✅ Addetti Assegnati a questa fase ({taskForm.workers.length}):</span>
                        </div>
                        {taskForm.workers.length === 0 ? (
                          <span style={{ fontSize: '0.8125rem', color: 'var(--text-tertiary)', fontStyle: 'italic' }}>Nessun addetto ancora selezionato. Scegline uno qui sopra.</span>
                        ) : (
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                            {taskForm.workers.map(w => (
                              <div key={w} style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'var(--bg-tertiary)', border: '1px solid var(--border-default)', padding: '6px 12px', borderRadius: 8 }}>
                                <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--accent-500)' }}>{w}</span>
                                <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginLeft: 4 }}>Ore:</span>
                                <input
                                  type="number"
                                  min="0.5"
                                  step="0.5"
                                  style={{
                                    width: 60,
                                    height: 24,
                                    background: 'var(--bg-secondary)',
                                    border: '1px solid var(--border-color)',
                                    borderRadius: 4,
                                    color: 'var(--text-primary)',
                                    padding: '0 4px',
                                    fontSize: '0.8rem',
                                    textAlign: 'center'
                                  }}
                                  value={taskForm.worker_hours?.[w] || ''}
                                  onChange={(e) => {
                                    const val = parseFloat(e.target.value) || 0;
                                    setTaskForm({
                                      ...taskForm,
                                      worker_hours: { ...taskForm.worker_hours, [w]: val }
                                    });
                                  }}
                                />
                                <button
                                  type="button"
                                  onClick={() => toggleWorkerSelection(w, true)}
                                  style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: '0.9rem', marginLeft: 4 }}
                                >
                                  ×
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </>
                )}

                <div className="modal-footer" style={{ marginTop: 24 }}>
                  <button type="button" className="btn btn-secondary" onClick={() => setShowTaskModal(false)}>
                    Annulla
                  </button>
                  <button type="submit" className="btn btn-primary">
                    {editingTask ? 'Salva Modifiche' : 'Aggiungi Fase'}
                  </button>
                </div>
              </form>
            )}

            {taskModalTab === 'checklist' && editingTask && (
              <div style={{ height: 400 }}>
                <TaskChecklist projectId={id} taskId={editingTask.id} />
              </div>
            )}

            {taskModalTab === 'commenti' && editingTask && (
              <div style={{ height: 400 }}>
                <TaskComments projectId={id} taskId={editingTask.id} currentUser={user} />
              </div>
            )}
          </div>
        </div>
      )}

      {/* MODALE CONSUNTIVO ORE EFFETTIVE (ORE MODAL) */}
      {showOreModal && selectedTaskForHours && (
        <div className="modal-overlay" onClick={() => setShowOreModal(false)}>
          <div className="modal" style={{ maxWidth: 840 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h2 style={{ margin: 0 }}>⏱️ Giornale Ore Consuntivate</h2>
                <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 4 }}>
                  Fase: <strong style={{ color: 'var(--accent-500)' }}>{selectedTaskForHours.text}</strong> |{' '}
                  Ore previste: <strong>{selectedTaskForHours.planned_hours || 8}h</strong>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <button className="btn-ghost btn-icon" onClick={() => setShowOreModal(false)}>✕</button>
              </div>
            </div>

            {(() => {
              const dates = getWorkDatesBetween(
                selectedTaskForHours.start_date ? selectedTaskForHours.start_date.split(' ')[0] : '',
                selectedTaskForHours.end_date ? selectedTaskForHours.end_date.split(' ')[0] : ''
              );
              const workers = Array.isArray(selectedTaskForHours.workers) && selectedTaskForHours.workers.length > 0
                ? selectedTaskForHours.workers
                : ['Addetto Generico'];
              const oreGgTotale = dates.length > 0 ? workers.reduce((acc, w) => {
                const wAssigned = (selectedTaskForHours.worker_hours && selectedTaskForHours.worker_hours[w] !== undefined && selectedTaskForHours.worker_hours[w] !== '')
                  ? Number(selectedTaskForHours.worker_hours[w])
                  : (Number(selectedTaskForHours.planned_hours || 8) / workers.length);
                return acc + (wAssigned / dates.length);
              }, 0) : (Number(selectedTaskForHours.planned_hours || 8));

              return (
                <div style={{ marginTop: 16 }}>
                  <div style={{ overflowX: 'auto', maxHeight: 380 }}>
                    <table className="ore-grid-table">
                      <thead>
                        <tr>
                          <th style={{ minWidth: 130, textAlign: 'left' }}>Addetto / Giorno</th>
                          {dates.map(d => (
                            <th key={d} style={{ minWidth: 85 }}>
                              {d.split('-')[2]}/{d.split('-')[1]}<br />
                              <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--text-tertiary)' }}>({oreGgTotale.toFixed(1)}h prev)</span>
                            </th>
                          ))}
                          <th style={{ minWidth: 90, background: 'rgba(245, 158, 11, 0.1)' }}>
                            ⭐ Ore extra<br />
                            <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--text-tertiary)' }}>(ritardo/straord.)</span>
                          </th>
                          <th style={{ minWidth: 135 }}>Totale Addetto</th>
                        </tr>
                      </thead>
                      <tbody>
                        {workers.map(w => {
                          let totW = 0;
                          let extraW = 0;
                          const assignedH = (selectedTaskForHours.worker_hours && selectedTaskForHours.worker_hours[w] !== undefined && selectedTaskForHours.worker_hours[w] !== '')
                            ? Number(selectedTaskForHours.worker_hours[w])
                            : null;
                          const targetH = assignedH !== null ? assignedH : Number((Number(selectedTaskForHours.planned_hours || 8) / workers.length).toFixed(1));
                          const workerDailyTarget = dates.length > 0 ? (targetH / dates.length) : targetH;

                          return (
                            <tr key={w}>
                              <td style={{ textAlign: 'left', fontWeight: 600 }}>👤 {w}</td>
                              {dates.map(d => {
                                const val = (actualHoursMap[w] && actualHoursMap[w][d]) || '';
                                totW += Number(val) || 0;
                                return (
                                  <td key={d}>
                                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                                      <input
                                        type="number"
                                        step="0.5"
                                        min="0"
                                        max="24"
                                        className="ore-input"
                                        disabled={!canManageProject && w !== user?.username && w !== (user?.full_name || user?.username)}
                                        value={val}
                                        placeholder={`${workerDailyTarget.toFixed(1)}h`}
                                        onChange={(e) => {
                                          const newVal = e.target.value;
                                          setActualHoursMap(prev => {
                                            const next = { ...prev };
                                            next[w] = { ...(next[w] || {}), [d]: newVal };
                                            return next;
                                          });
                                        }}
                                      />
                                      <span style={{ fontSize: 11, fontWeight: 500, color: 'var(--text-tertiary)' }}>
                                        ({workerDailyTarget.toFixed(1)}h prev)
                                      </span>
                                    </div>
                                  </td>
                                );
                              })}
                              <td style={{ background: 'rgba(245, 158, 11, 0.05)' }}>
                                <input
                                  type="number"
                                  step="0.5"
                                  min="0"
                                  max="24"
                                  className="ore-input"
                                  value={(actualHoursMap[w] && actualHoursMap[w]['__extra__']) || ''}
                                  placeholder="0h"
                                  onChange={(e) => {
                                    const newVal = e.target.value;
                                    setActualHoursMap(prev => {
                                      const next = { ...prev };
                                      next[w] = { ...(next[w] || {}), '__extra__': newVal };
                                      return next;
                                    });
                                  }}
                                />
                              </td>
                              <td style={{ fontWeight: 700 }}>
                                {(() => {
                                  const extraVal = (actualHoursMap[w] && actualHoursMap[w]['__extra__']) ? Number(actualHoursMap[w]['__extra__']) : 0;
                                  extraW = extraVal;
                                  return (
                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
                                      <span style={{ color: 'var(--accent-500)' }}>{totW + extraW} h</span>
                                      <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-secondary)' }}>/ {targetH} h prev</span>
                                    </div>
                                  );
                                })()}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 20, background: 'var(--bg-primary)', padding: 12, borderRadius: 6, border: '1px solid var(--border-color)' }}>
                    <div>
                      {(() => {
                        let totAll = 0;
                        workers.forEach(w => {
                          if (actualHoursMap[w]) {
                            Object.values(actualHoursMap[w]).forEach(h => { totAll += Number(h) || 0; });
                          }
                        });
                        const tempTask = {
                          ...selectedTaskForHours,
                          actual_hours: actualHoursMap
                        };
                        const st = computeStato(tempTask);
                        const plannedH = Number(selectedTaskForHours.planned_hours || 8);
                        const isModalCompleted = isTaskCompleted(tempTask);
                        return (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                            <span style={{ fontSize: 15, color: 'var(--text-primary)' }}>
                              Totale consuntivato finora: <strong style={{ color: 'var(--accent-500)' }}>{totAll} h</strong> / {plannedH} h prev
                            </span>
                            {st === 'ok' && <span className="semaforo-ok">🟢 Stato OK (Regolare)</span>}
                            {st === 'attenzione' && <span className="semaforo-attenzione">🟡 Stato Attenzione</span>}
                            {st === 'ritardo' && <span className="semaforo-ritardo">🔴 Stato Ritardo</span>}
                            {isModalCompleted && (
                              <span style={{ background: 'rgba(16, 185, 129, 0.18)', color: '#10b981', padding: '3px 10px', borderRadius: '12px', fontWeight: 600, fontSize: '0.82rem', border: '1px solid #059669' }}>
                                ✓ Fase Completata (100% Ore / Flaggata)
                              </span>
                            )}
                          </div>
                        );
                      })()}
                    </div>
                    <div style={{ display: 'flex', gap: 10 }}>
                      <button type="button" className="btn btn-secondary" onClick={() => setShowOreModal(false)}>
                        Annulla
                      </button>
                      <button type="button" className="btn btn-primary" onClick={handleSaveOreModal}>
                        Salva Consuntivo Ore
                      </button>
                    </div>
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {/* Modale Modifica Dati Commessa */}
      {showEditProjectModal && (
        <div className="modal-overlay" onClick={() => setShowEditProjectModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 520 }}>
            <div className="modal-header">
              <h2>Modifica Dati Commessa</h2>
              <button className="btn-ghost btn-icon" onClick={() => setShowEditProjectModal(false)}>✕</button>
            </div>
            <form onSubmit={handleSaveProject}>
              <div style={{ display: 'flex', gap: 12 }}>
                <div className="input-group" style={{ flex: 1, minWidth: 0 }}>
                  <label htmlFor="edit-proj-code">Codice Commessa *</label>
                  <input
                    id="edit-proj-code"
                    className="input"
                    value={projectForm.code}
                    onChange={(e) => setProjectForm({ ...projectForm, code: e.target.value })}
                    required
                    placeholder="es. UT-COMM"
                  />
                </div>
                <div className="input-group" style={{ flex: 1, minWidth: 0 }}>
                  <label htmlFor="edit-proj-client">Cliente</label>
                  <input
                    id="edit-proj-client"
                    className="input"
                    value={projectForm.client}
                    onChange={(e) => setProjectForm({ ...projectForm, client: e.target.value })}
                    placeholder="es. HiWay s.r.l."
                  />
                </div>
              </div>

              <div className="input-group">
                <label htmlFor="edit-proj-name">Titolo Commessa *</label>
                <input
                  id="edit-proj-name"
                  className="input"
                  value={projectForm.name}
                  onChange={(e) => setProjectForm({ ...projectForm, name: e.target.value })}
                  required
                  placeholder="es. Lancio ERP e HiPlan Q3"
                />
              </div>

              <div style={{ display: 'flex', gap: 12 }}>
                <div className="input-group" style={{ flex: 1, minWidth: 0 }}>
                  <label htmlFor="edit-proj-start">Data di Inizio</label>
                  <input
                    id="edit-proj-start"
                    type="date"
                    className="input"
                    value={projectForm.start_date}
                    onChange={(e) => setProjectForm({ ...projectForm, start_date: e.target.value })}
                  />
                </div>
                <div className="input-group" style={{ flex: 1, minWidth: 0 }}>
                  <label htmlFor="edit-proj-end">Data di Fine</label>
                  <input
                    id="edit-proj-end"
                    type="date"
                    className="input"
                    value={projectForm.end_date}
                    onChange={(e) => setProjectForm({ ...projectForm, end_date: e.target.value })}
                  />
                </div>
              </div>

              <div style={{ display: 'flex', gap: 12 }}>
                <div className="input-group" style={{ flex: 1, minWidth: 0 }}>
                  <label htmlFor="edit-proj-color">Colore Identificativo</label>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <input
                      id="edit-proj-color"
                      type="color"
                      value={projectForm.color}
                      onChange={(e) => setProjectForm({ ...projectForm, color: e.target.value })}
                      style={{ width: 44, height: 38, padding: 2, borderRadius: 6, border: '1px solid var(--border-color)', background: 'var(--bg-primary)', cursor: 'pointer', flexShrink: 0 }}
                    />
                    <input
                      className="input"
                      value={projectForm.color}
                      onChange={(e) => setProjectForm({ ...projectForm, color: e.target.value })}
                      placeholder="#185FA5"
                      style={{ flex: 1, minWidth: 0 }}
                    />
                  </div>
                </div>
                <div className="input-group" style={{ flex: 1, minWidth: 0 }}>
                  <label htmlFor="edit-proj-status">Stato Commessa</label>
                  <select
                    id="edit-proj-status"
                    className="input"
                    value={projectForm.status}
                    onChange={(e) => setProjectForm({ ...projectForm, status: e.target.value })}
                  >
                    {STATUS_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="input-group">
                <label htmlFor="edit-proj-responsible">Responsabile di Commessa</label>
                <select
                  id="edit-proj-responsible"
                  className="input"
                  value={projectForm.responsible_id || ''}
                  onChange={(e) => setProjectForm({ ...projectForm, responsible_id: e.target.value })}
                >
                  <option value="">-- Nessuno / Predefinito --</option>
                  {usersList.map(u => (
                    <option key={u.id} value={u.id}>{u.full_name || u.username} ({u.username})</option>
                  ))}
                </select>
              </div>

              <div className="input-group">
                <label>Addetti della Commessa (Multi-selezione)</label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 6 }}>
                  {usersList.map(u => {
                    const selected = (projectForm.assigned_workers || []).includes(u.username);
                    return (
                      <button
                        key={u.id}
                        type="button"
                        onClick={() => toggleProjectWorkerSelection(u.username)}
                        style={{
                          padding: '6px 12px',
                          borderRadius: 20,
                          border: selected ? '2px solid #3b82f6' : '1px solid var(--border-color)',
                          background: selected ? 'rgba(59, 130, 246, 0.15)' : 'var(--bg-tertiary)',
                          color: selected ? '#60a5fa' : 'var(--text-secondary)',
                          fontSize: 13,
                          cursor: 'pointer',
                          fontWeight: selected ? 600 : 400
                        }}
                      >
                        {selected ? '✓ ' : '+ '}{u.full_name || u.username}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="input-group">
                <label htmlFor="edit-proj-desc">Descrizione / Note</label>
                <textarea
                  id="edit-proj-desc"
                  className="input"
                  rows={3}
                  value={projectForm.description}
                  onChange={(e) => setProjectForm({ ...projectForm, description: e.target.value })}
                  placeholder="Dettagli e obiettivo della commessa..."
                  style={{ resize: 'vertical' }}
                />
              </div>

              <div className="modal-actions" style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 20 }}>
                <button type="button" className="btn btn-secondary" onClick={() => setShowEditProjectModal(false)}>
                  Annulla
                </button>
                <button type="submit" className="btn btn-primary">
                  Salva Modifiche
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

