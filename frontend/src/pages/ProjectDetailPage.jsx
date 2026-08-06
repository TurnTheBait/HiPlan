import { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import api from '../api/client';
import { useToast } from '../context/ToastContext';
import { useAuth } from '../context/AuthContext';
import { gantt } from 'dhtmlx-gantt';
import GanttChart from '../components/gantt/GanttChart';
import './ProjectDetailPage.css';
import { STATUS_LABELS_IT, STATUS_OPTIONS } from '../utils/statusLabels';
import { PREDEFINED_PHASES, PHASE_DEFAULT_COLORS, getTaskColor } from '../utils/phaseColors';
import { calculateTaskEffHours, isTaskCompleted } from '../utils/taskCompletion';
import { addWorkingDays, subtractWorkingDays, countWorkingDays, isWeekendOrHoliday } from '../utils/workingDays';
import TaskComments from '../components/tasks/TaskComments';
import TaskChecklist from '../components/tasks/TaskChecklist';
import ActivityLogPanel from '../components/projects/ActivityLogModal';
import AppIcon from '../components/ui/AppIcon';
import SearchableCombobox from '../components/ui/SearchableCombobox';
import useWebSocket from '../hooks/useWebSocket';

const DEPT_OPTIONS = [
  { value: 'ufficio_tecnico', label: 'Ufficio Tecnico', color: '#3b82f6' },
  { value: 'produzione', label: 'Produzione', color: '#10b981' },
  { value: 'acquisti', label: 'Acquisti', color: '#f59e0b' },
];

const BACKEND_URL = import.meta.env.VITE_API_URL
  ? import.meta.env.VITE_API_URL.replace(/\/api\/?$/, '')
  : `http://${window.location.hostname}:8000`;
const ALL_DEPTS = DEPT_OPTIONS.map(d => d.value);

const PREDEFINED_WORKERS_DEFAULT = [];

export default function ProjectDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { user } = useAuth();
  const [project, setProject] = useState(null);
  const [notesText, setNotesText] = useState('');
  const [ganttData, setGanttData] = useState({ tasks: [], links: [] });
  const [predefinedWorkers, setPredefinedWorkers] = useState(PREDEFINED_WORKERS_DEFAULT);
  const [usersList, setUsersList] = useState([]);
  const [loading, setLoading] = useState(true);

  // Calcolo WebSocket URL
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsHost = import.meta.env.VITE_API_URL
    ? new URL(import.meta.env.VITE_API_URL).host
    : `${window.location.hostname}:8000`;
  const wsUrl = `${protocol}//${wsHost}/api/ws/projects/${id}`;

  const { isConnected: wsConnected } = useWebSocket(wsUrl, (msg) => {
    if (['task_created', 'task_updated', 'task_deleted', 'link_created', 'link_deleted', 'project_updated'].includes(msg.action)) {
      loadGanttDataOnly();
    }
  });

  async function loadGanttDataOnly() {
    try {
      const ganttRes = await api.get(`/projects/${id}/gantt?_t=${Date.now()}`);
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
    } catch (err) {
      console.error("Errore ricaricamento dati Gantt:", err);
    }
  }

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
    return saved ? JSON.parse(saved) : ['start_date', 'end_date', 'event_date', 'duration'];
  });
  const [showColumnsMenu, setShowColumnsMenu] = useState(false);

  // STATO PER FILTRO TIPO FASE
  const [phaseFilter, setPhaseFilter] = useState('all'); // 'all', 'task', 'milestone'
  const [showPhaseFilterMenu, setShowPhaseFilterMenu] = useState(false);

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
  const [showWorkerMenu, setShowWorkerMenu] = useState(false);
  const [activeWorkers, setActiveWorkers] = useState([]); // empty means all
  const [viewMode, setViewMode] = useState('day');
  const [activeTab, setActiveTab] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('tab') || 'gantt';
  });

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
  const [modalExtraDates, setModalExtraDates] = useState([]);
  const [specificExtraDate, setSpecificExtraDate] = useState('');
  const [allVacations, setAllVacations] = useState([]);
  const [openTicketsCount, setOpenTicketsCount] = useState(0);
  const [isAlertsExpanded, setIsAlertsExpanded] = useState(false);

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

  useEffect(() => {
    loadProject();
  }, [id]);

  const location = useLocation();

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const openTask = params.get('open_task');
    if (openTask && ganttData.tasks && ganttData.tasks.length > 0) {
      const t = ganttData.tasks.find(t => String(t.id) === openTask);
      if (t && !showTaskModal) {
        openEditTaskModal(t, 'commenti');
        // Remove from url
        params.delete('open_task');
        navigate({ search: params.toString() }, { replace: true });
      }
    }
  }, [location.search, ganttData.tasks]);

  async function handleUploadAttachment(e) {
    if (!e.target.files || e.target.files.length === 0) return;
    await uploadFiles(e.target.files);
  }

  async function handleDropAttachment(e) {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      await uploadFiles(e.dataTransfer.files);
    }
  }

  async function uploadFiles(files) {
    try {
      for (const file of files) {
        const fd = new FormData();
        fd.append('file', file);
        await api.post(`/projects/${id}/attachments`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      }
      toast.success('Allegati caricati!');
      loadProject();
    } catch (err) {
      toast.error('Errore durante il caricamento');
    }
  }

  async function handleDeleteAttachment(filename) {
    if (!window.confirm('Eliminare questo allegato?')) return;
    try {
      await api.delete(`/projects/${id}/attachments/${encodeURIComponent(filename)}`);
      toast.success('Allegato eliminato');
      loadProject();
    } catch (err) {
      toast.error('Errore durante l\'eliminazione');
    }
  }

  useEffect(() => {
    localStorage.setItem('tableVisibleColumns', JSON.stringify(tableVisibleColumns));
  }, [tableVisibleColumns]);

  useEffect(() => {
    localStorage.setItem('oreVisibleColumns', JSON.stringify(oreVisibleColumns));
  }, [oreVisibleColumns]);

  async function loadProject() {
    try {
      const [projRes, ganttRes, usersRes, vacRes, ticketsRes] = await Promise.all([
        api.get(`/projects/${id}`),
        api.get(`/projects/${id}/gantt?_t=${Date.now()}`),
        api.get('/users').catch(() => ({ data: [] })),
        api.get('/vacations/all').catch(() => ({ data: [] })),
        api.get('/tickets', { params: { project_id: id } }).catch(() => ({ data: [] }))
      ]);
      setProject(projRes.data);
      setNotesText(projRes.data.notes || '');
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
      if (Array.isArray(vacRes.data)) {
        setAllVacations(vacRes.data);
      }
      if (Array.isArray(ticketsRes.data)) {
        const openTkts = ticketsRes.data.filter(t => t.status !== 'Completato');
        setOpenTicketsCount(openTkts.length);
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

  function formatDateItalian(d) {
    const str = formatDateOnly(d);
    if (!str) return '';
    const parts = str.split('-');
    if (parts.length === 3) return `${parts[2]}/${parts[1]}/${parts[0]}`;
    return str;
  }

  // Calcolo stato semaforo e ore giornaliere previste (algoritmo prototipo Ufficio Tecnico)
  function computeStato(task) {
    if (!task) return 'ok';
    const totEff = calculateTaskEffHours(task);
    const plannedH = Number(task.planned_hours || 8.0);
    if (plannedH > 0 && totEff > plannedH) {
      return 'sforamento';
    }
    if (plannedH > 0 && totEff === plannedH) {
      return 'ok';
    }
    if (task.has_vacation_conflict) return 'ritardo_ferie';
    if (!task.start_date) return 'ok';
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
      if (st === 'ritardo' || st === 'attenzione' || st === 'ritardo_ferie') {
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

  async function handleSaveNotes() {
    try {
      await api.put(`/projects/${id}`, { notes: notesText });
      // aggiorna solo il campo notes nel project locale senza ricaricare tutto
      setProject(prev => prev ? { ...prev, notes: notesText } : prev);
    } catch (err) {
      toast.error('Errore durante il salvataggio delle note');
    }
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
      const newLinkId = created?.id || tempId;
      if (tempId && gantt.isLinkExists && gantt.isLinkExists(tempId)) {
        gantt.changeLinkId(tempId, newLinkId);
      }
      setGanttData(prev => {
        const newLink = {
          id: String(newLinkId),
          source: String(data.source),
          target: String(data.target),
          type: String(data.type || '0')
        };
        if (prev.links.some(l => String(l.id) === String(newLinkId))) return prev;
        return { ...prev, links: [...prev.links, newLink] };
      });
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
      setGanttData(prev => ({
        ...prev,
        links: prev.links.filter(l => String(l.id) !== String(linkId))
      }));
    } catch (e) {
      toast.error('Errore eliminazione dipendenza');
      console.error(e);
    }
  }

  function openNewTaskModal() {
    fetchPhaseTemplates();
    const available = getAvailableTemplates();
    const initialFase = '__custom__';
    const initialColor = '#3b82f6';

    setEditingTask(null);
    setTaskModalTab('generale');
    setShowPhaseDropdown(false);
    setTaskForm({
      taskType: 'task',
      faseSel: initialFase,
      customText: '',
      color: initialColor,
      start_date: new Date().toISOString().split('T')[0],
      end_date: new Date().toISOString().split('T')[0],
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

  function openEditTaskModal(task, initialTab = 'generale') {
    if (!canManageProject && initialTab === 'generale') {
      openOreModalForTask(task);
      return;
    }
    const realTask = (ganttData && Array.isArray(ganttData.tasks) ? ganttData.tasks.find(t => String(t.id) === String(task.id)) : null) || task;

    fetchPhaseTemplates();
    const available = getAvailableTemplates();
    const isPredefined = available.some(t => t.name === realTask.text) || PREDEFINED_PHASES.includes(realTask.text);

    setEditingTask(realTask);
    setTaskModalTab(initialTab);
    setShowPhaseDropdown(false);

    const safeDate = (d) => {
      if (!d) return new Date().toISOString().split('T')[0];
      if (d instanceof Date) {
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
      }
      return String(d).split(' ')[0].split('T')[0];
    };

    const s = safeDate(realTask.start_date);
    const e = safeDate(realTask.end_date);
    const diff = countWorkingDays(s, e);
    const taskDur = Number(realTask.duration) || diff;
    const taskPlan = Number(realTask.planned_hours) || (taskDur * 8.0);
    const mode = realTask.budget_mode || realTask.budgetMode || (Math.abs(taskPlan - taskDur * 8.0) > 0.1 ? 'start_days_hours' : 'start_days');
    setBudgetMode(mode);

    const isComp = Number(realTask.completed) === 1 || Number(task.completed) === 1 || isTaskCompleted(realTask) || isTaskCompleted(task);
    const compVal = isComp ? 1 : (Number(realTask.completed) === -1 || Number(task.completed) === -1 ? -1 : 0);

    setTaskForm({
      taskType: realTask.type === 'milestone' || Number(realTask.duration) === 0 ? 'milestone' : 'task',
      faseSel: isPredefined ? realTask.text : '__custom__',
      customText: isPredefined ? '' : realTask.text,
      color: getTaskColor(realTask),
      start_date: s,
      end_date: e,
      duration_days: taskDur,
      planned_hours: taskPlan,
      budgetMode: mode,
      workers: Array.isArray(realTask.workers) ? realTask.workers : [],
      worker_hours: typeof realTask.worker_hours === 'object' ? realTask.worker_hours : {},
      customWorker: '',
      department: realTask.department || (user?.department && user.department !== 'admin' ? user.department : 'ufficio_tecnico'),
      completed: compVal,
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
    const plannedHours = isMilestone ? 0 : (Number(taskForm.planned_hours) || (finalDays * 8.0));

    if (!isMilestone && taskForm.workers && taskForm.workers.length > 0) {
      const sumWorkerHours = taskForm.workers.reduce((sum, w) => sum + (Number(taskForm.worker_hours?.[w]) || 0), 0);
      const roundedSum = Math.round(sumWorkerHours * 10) / 10;
      const roundedPlanned = Math.round(plannedHours * 10) / 10;
      if (roundedSum > roundedPlanned) {
        toast.error(`Le ore assegnate agli addetti (${roundedSum}h) superano il budget totale della fase (${roundedPlanned}h).`);
        return;
      }
    }

    const payload = {
      text: taskName.trim(),
      start_date: taskForm.start_date,
      end_date: isMilestone ? taskForm.start_date : taskForm.end_date,
      duration: isMilestone ? 0 : finalDays,
      planned_hours: isMilestone ? 0 : (Number(taskForm.planned_hours) || (finalDays * 8.0)),
      workers: taskForm.workers,
      worker_hours: taskForm.worker_hours,
      type: isMilestone ? 'milestone' : 'task',
      color: taskForm.color || (isMilestone ? '#f59e0b' : null),
      department: taskForm.department || null,
      budget_mode: taskForm.budgetMode || budgetMode || 'start_days',
      completed: isMilestone ? 0 : (taskForm.completed !== undefined && taskForm.completed !== null ? Number(taskForm.completed) : 0),
    };


    try {
      if (editingTask) {
        const res = await api.put(`/projects/${id}/tasks/${editingTask.id}`, payload);
        toast.success('Fase modificata con successo!');
        if (res.data && ganttData && Array.isArray(ganttData.tasks)) {
          const updatedTasks = ganttData.tasks.map(t => String(t.id) === String(editingTask.id) ? res.data : t);
          setGanttData({ ...ganttData, tasks: updatedTasks });
        }
      } else {
        const res = await api.post(`/projects/${id}/tasks`, payload);
        toast.success('Nuova fase aggiunta!');
        if (res.data && ganttData && Array.isArray(ganttData.tasks)) {
          setGanttData({ ...ganttData, tasks: [...ganttData.tasks, res.data] });
        }
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
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Errore nel salvataggio della fase');
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

    const plannedDates = getWorkDatesBetween(
      task.start_date ? task.start_date.split(' ')[0] : '',
      task.end_date ? task.end_date.split(' ')[0] : ''
    );
    const plannedSet = new Set(plannedDates);
    const existingExtraDates = [];

    Object.values(initialMap).forEach(workerMap => {
      if (workerMap && typeof workerMap === 'object') {
        Object.keys(workerMap).forEach(dKey => {
          if (dKey !== '__extra__' && !plannedSet.has(dKey) && /^\d{4}-\d{2}-\d{2}$/.test(dKey)) {
            if (!existingExtraDates.includes(dKey)) {
              existingExtraDates.push(dKey);
            }
          }
        });
      }
    });

    existingExtraDates.sort();
    setModalExtraDates(existingExtraDates);
    setShowOreModal(true);
  }

  function handleSpecificDateChange(dateStr) {
    if (!dateStr || !selectedTaskForHours) return;
    const plannedDates = getWorkDatesBetween(
      selectedTaskForHours.start_date ? selectedTaskForHours.start_date.split(' ')[0] : '',
      selectedTaskForHours.end_date ? selectedTaskForHours.end_date.split(' ')[0] : ''
    );
    const allCurrentDates = Array.from(new Set([...plannedDates, ...modalExtraDates]));
    if (allCurrentDates.includes(dateStr)) {
      toast.error('La data selezionata è già presente nella tabella.');
      setSpecificExtraDate('');
      return;
    }
    setModalExtraDates(prev => [...prev, dateStr].sort());
    toast.success(`Aggiunta colonna: ${dateStr.split('-').reverse().join('/')}`);
    setSpecificExtraDate('');
  }

  function handleAddExtraDayToModal() {
    if (!selectedTaskForHours) return;
    // Aggiunge sempre il prossimo giorno lavorativo dopo l'ultimo presente
    const plannedDates = getWorkDatesBetween(
      selectedTaskForHours.start_date ? selectedTaskForHours.start_date.split(' ')[0] : '',
      selectedTaskForHours.end_date ? selectedTaskForHours.end_date.split(' ')[0] : ''
    );
    const allCurrentDates = Array.from(new Set([...plannedDates, ...modalExtraDates])).sort();
    let baseDateStr = allCurrentDates.length > 0
      ? allCurrentDates[allCurrentDates.length - 1]
      : (selectedTaskForHours.end_date ? selectedTaskForHours.end_date.split(' ')[0] : new Date().toISOString().split('T')[0]);

    const baseDate = new Date(baseDateStr + 'T00:00:00');
    baseDate.setDate(baseDate.getDate() + 1);
    const y = baseDate.getFullYear();
    const m = String(baseDate.getMonth() + 1).padStart(2, '0');
    const d = String(baseDate.getDate()).padStart(2, '0');
    const nextWorkDateStr = addWorkingDays(`${y}-${m}-${d}`, 1);

    if (nextWorkDateStr && !allCurrentDates.includes(nextWorkDateStr)) {
      setModalExtraDates(prev => [...prev, nextWorkDateStr].sort());
      toast.success(`Aggiunta colonna giorno extra: ${nextWorkDateStr.split('-').reverse().join('/')}`);
    }
  }

  function handleRemoveLastExtraDay() {
    if (modalExtraDates.length === 0) {
      toast.error("Nessun giorno extra presente da rimuovere!");
      return;
    }
    const lastDate = modalExtraDates[modalExtraDates.length - 1];
    setModalExtraDates(prev => prev.slice(0, -1));
    toast.success(`Rimosso giorno: ${lastDate.split('-').reverse().join('/')}`);
  }

  async function handleSaveOreModal() {
    if (!selectedTaskForHours) return;
    try {
      await api.put(`/projects/${id}/tasks/${selectedTaskForHours.id}`, {
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

    let newWorkers;
    if (isSelected) {
      newWorkers = taskForm.workers.filter(x => x !== w);
    } else {
      newWorkers = [...taskForm.workers, w];
    }

    const totalHours = Number(taskForm.planned_hours) || (Number(taskForm.duration_days) * 8.0) || 8.0;

    let newWorkerHours = {};
    if (newWorkers.length > 0) {
      const baseHours = Math.floor((totalHours / newWorkers.length) * 10) / 10;
      newWorkers.forEach(worker => {
        newWorkerHours[worker] = baseHours;
      });

      let currentSum = baseHours * newWorkers.length;
      let diff = Math.round((totalHours - currentSum) * 10) / 10;

      let i = 0;
      while (diff >= 0.1 || diff <= -0.1) {
        if (diff > 0) {
          newWorkerHours[newWorkers[i % newWorkers.length]] += 0.1;
          diff = Math.round((diff - 0.1) * 10) / 10;
        } else {
          newWorkerHours[newWorkers[i % newWorkers.length]] -= 0.1;
          diff = Math.round((diff + 0.1) * 10) / 10;
        }
        i++;
      }

      newWorkers.forEach(worker => {
        newWorkerHours[worker] = Math.round(newWorkerHours[worker] * 10) / 10;
      });
    }

    setTaskForm({ ...taskForm, workers: newWorkers, worker_hours: newWorkerHours });
  }

  function handleZoom(mode) {
    setViewMode(mode);
    const mesiItaliani = ['Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno', 'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre'];
    const giorniItaliani = ['Dom', 'Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab'];
    const dayCssFunc = function (date) {
      if (isWeekendOrHoliday(date)) return "gantt_weekend_scale_cell";
      return "";
    };

    switch (mode) {
      case 'day':
        gantt.config.scales = [
          { unit: "month", step: 1, format: function (date) { return `${mesiItaliani[date.getMonth()]} ${date.getFullYear()}`; } },
          { unit: "day", step: 1, css: dayCssFunc, format: function (date) { return giorniItaliani[date.getDay()]; } },
          { unit: "day", step: 1, css: dayCssFunc, format: "%d" },
        ];
        gantt.config.min_column_width = 38;
        gantt.config.scale_height = 66;
        break;
      case 'week':
        gantt.config.scales = [
          { unit: "month", step: 1, format: function (date) { return `${mesiItaliani[date.getMonth()]} ${date.getFullYear()}`; } },
          {
            unit: "week",
            step: 1,
            format: function (date) {
              const weekNum = gantt.date.date_to_str("%W")(date);
              const endDate = gantt.date.add(date, 6, "day");
              return `<div style="line-height: 1.2; padding-top: 4px;">Sett. ${weekNum}<br/><span style="font-size: 11px; font-weight: normal; color: var(--text-secondary);">${date.getDate()} - ${endDate.getDate()} ${mesiItaliani[endDate.getMonth()].substring(0, 3).toLowerCase()}</span></div>`;
            }
          },
        ];
        gantt.config.min_column_width = 80;
        gantt.config.scale_height = 66;
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

  function handleChatGPTAnalysis() {
    const promptLines = [
      "Comportati da Project Manager esperto e analizza i dati di questa commessa riportati di seguito (e nell'eventuale file allegato).",
      "",
      `COMMESSA: ${project.name} (Codice: ${project.code || 'N/A'})`,
      `Descrizione: ${project.description || 'Nessuna descrizione'}`,
      `Inizio: ${new Date(project.start_date).toLocaleDateString()}`,
      `Fine: ${new Date(project.end_date).toLocaleDateString()}`,
      `Stato: ${project.status}`,
      "",
      "FASI DELLA COMMESSA:"
    ];

    const sortedTasks = [...(ganttData?.tasks || [])].sort((a, b) => new Date(a.start_date) - new Date(b.start_date));
    sortedTasks.forEach(t => {
      const dept = t.department ? t.department.toUpperCase() : 'N/A';
      const taskName = t.text || 'Fase senza nome';
      const startDate = new Date(t.start_date).toLocaleDateString();
      const endDate = new Date(t.end_date).toLocaleDateString();
      const progress = t.completed || 0;

      const workers = Array.isArray(t.workers) ? t.workers : [];

      promptLines.push(`- [${dept}] ${taskName}`);
      promptLines.push(`  Date: dal ${startDate} al ${endDate} (${t.duration || 0} giorni) | Stato: ${progress}% completata`);

      if (workers.length > 0) {
        promptLines.push(`  Addetti:`);
        workers.forEach(w => {
          const wAssigned = (t.worker_hours && t.worker_hours[w] !== undefined && t.worker_hours[w] !== '')
            ? Number(t.worker_hours[w])
            : (Number(t.planned_hours || 8) / workers.length);
          const wActual = (t.actual_hours && t.actual_hours[w]) ? Number(t.actual_hours[w]) : 0;
          promptLines.push(`    - ${w}: ${wActual}h fatte / ${Number(wAssigned.toFixed(1))}h assegnate`);
        });
      } else {
        promptLines.push(`  Addetti: Nessuno`);
      }

      let totOreReg = 0;
      if (t.actual_hours && typeof t.actual_hours === 'object') {
        totOreReg = Object.values(t.actual_hours).reduce((acc, v) => acc + (Number(v) || 0), 0);
      }
      promptLines.push(`  Totale Fase: ${totOreReg}h fatte su ${t.planned_hours || 0}h previste`);
    });

    const fullPrompt = promptLines.join('\n');
    window.open('https://chatgpt.com/?q=' + encodeURIComponent(fullPrompt), '_blank');
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
          <button className="btn btn-secondary btn-icon" onClick={() => navigate('/projects')} title="Torna alle commesse" aria-label="Torna alle commesse">
            <AppIcon name="arrowLeft" />
          </button>
          <div className="commessa-meta" style={{
            display: 'flex',
            alignItems: 'center',
            gap: 16,
            padding: '12px 24px',
            background: 'var(--bg-card)',
            border: '1px solid var(--border-subtle)',
            borderLeft: `6px solid ${project?.color || '#185FA5'}`,
            borderRadius: '12px',
            fontSize: '1.15rem',
            boxShadow: 'var(--shadow-sm)'
          }}>
            <span className="commessa-code" style={{ color: 'var(--text-primary)', fontWeight: 800, fontSize: '1.25rem' }}>{project?.code || 'UT-COMM'}</span>
            {project?.client && (
              <>
                <span style={{ color: 'var(--border-subtle)', fontSize: '1.2rem' }}>—</span>
                <span className="commessa-client" style={{ color: 'var(--text-secondary)' }}><AppIcon name="building" size={15} />{project.client}</span>
              </>
            )}
            {project?.responsible_name && (
              <>
                <span style={{ color: 'var(--border-subtle)', fontSize: '1.2rem' }}>—</span>
                <span className="commessa-client commessa-responsible" style={{ color: 'var(--text-secondary)' }}><AppIcon name="user" size={15} />{project.responsible_name}</span>
              </>
            )}
            {project?.name && project.name !== project.code && (
              <>
                <span style={{ color: 'var(--border-subtle)', fontSize: '1.2rem' }}>|</span>
                <span className="commessa-title-in-box" style={{ fontWeight: 800, color: 'var(--text-primary)', fontSize: '1.25rem' }}>{project.name}</span>
              </>
            )}
          </div>
        </div>
      </div>

      {/* 4 Tabs Interattive Ufficio Tecnico */}
      <div className="ut-tabs" style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        {canManageProject && (
          <button className="btn btn-primary" onClick={openNewTaskModal} style={{ padding: '9px 14px', fontSize: '0.85 rem' }}>
            <AppIcon name="plus" />
            Nuova fase
          </button>
        )}
        <button
          className={`ut-tab-btn ${activeTab === 'gantt' ? 'active' : ''}`}
          onClick={() => setActiveTab('gantt')}
        >
          <AppIcon name="gantt" />
          Gantt
        </button>
        <button
          className={`ut-tab-btn ${activeTab === 'commessa' ? 'active' : ''}`}
          onClick={() => setActiveTab('commessa')}
        >
          <AppIcon name="list" />
          Fasi <span className="tab-badge">{ganttData.tasks.length}</span>
        </button>
        <button
          className={`ut-tab-btn ${activeTab === 'note' ? 'active' : ''}`}
          onClick={() => setActiveTab('note')}
          style={{
            borderColor: openTicketsCount > 0 && activeTab !== 'note' ? 'var(--warning)' : undefined,
            color: openTicketsCount > 0 && activeTab !== 'note' ? 'var(--warning)' : undefined,
            backgroundColor: openTicketsCount > 0 && activeTab !== 'note' ? 'rgba(245, 158, 11, 0.1)' : undefined
          }}
        >
          <AppIcon name="notes" />
          Note
        </button>
        {delaysList.length > 0 && (
          <button
            className={`ut-tab-btn ${activeTab === 'alert' ? 'active' : ''}`}
            onClick={() => setActiveTab('alert')}
          >
            <AppIcon name="alert" />
            Ritardi
            <span className="tab-badge tab-badge-danger">{delaysList.length}</span>
          </button>
        )}

        {user?.role === 'admin' && (
          <button
            className={`ut-tab-btn ${activeTab === 'activity_log' ? 'active' : ''}`}
            onClick={() => setActiveTab('activity_log')}
            title="Visualizza la cronologia delle modifiche e delle ore"
            style={{ display: 'flex', alignItems: 'center', gap: 6 }}
          >
            <AppIcon name="clock" />
            Cronologia
          </button>
        )}

        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
          {canManageProject && (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={openEditProjectModal}
              title="Modifica commessa e cambia stato"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 38,
                height: 38,
                padding: 0,
                fontSize: '1.2rem',
                borderRadius: '10px'
              }}
            >
              <AppIcon name="edit" />
            </button>
          )}

          <div style={{ position: 'relative' }}>
            <button
              className="btn btn-primary"
              onClick={() => setShowExportMenu(!showExportMenu)}
              title="Esporta commessa"
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 38, height: 38, padding: 0, fontSize: '1.3rem', borderRadius: '10px' }}
            >
              <AppIcon name="download" />
            </button>
            {showExportMenu && (
              <div className="action-popover" style={{
                position: 'absolute', top: '100%', right: 0, marginTop: 6,
                background: 'var(--bg-card)', border: '1px solid var(--border-default)',
                borderRadius: 10, padding: 16, zIndex: 300, minWidth: 280,
                boxShadow: '0 8px 32px rgba(0,0,0,0.2)', textAlign: 'left'
              }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Sezioni da esportare:
                </div>
                {[
                  { id: 'tasks', icon: 'list', label: 'Fasi', desc: 'Tabella fasi, date, addetti, budget ore' },
                  { id: 'hours', icon: 'clock', label: 'Consuntivazione Ore', desc: 'Ore previste vs effettive, saldo' },
                  { id: 'gantt', icon: 'gantt', label: 'Diagramma Gantt', desc: 'Timeline visiva delle fasi' },
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
                      <div className="inline-detail-row" style={{ fontWeight: 600 }}><AppIcon name={sec.icon} size={14} />{sec.label}</div>
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
                      <AppIcon name="download" size={14} /> PDF
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
                      <AppIcon name="download" size={14} /> Excel
                    </label>
                  </div>
                </div>

                <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--border-subtle)' }}>
                  <button
                    className="btn btn-secondary"
                    style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, background: '#10a37f', color: '#fff', borderColor: '#10a37f' }}
                    onClick={() => { setShowExportMenu(false); handleChatGPTAnalysis(); }}
                  >
                    <img src="/chatgpt-logo.png" style={{ width: 16, height: 16, filter: 'brightness(0) invert(1)' }} alt="ChatGPT" />
                    Analizza con ChatGPT
                  </button>
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

      {/* TOOLBAR DI AZIONE POSIZIONATA SOTTO ALLE TABS */}
      {activeTab === 'gantt' && <div className="project-toolbar">
        <div className="toolbar-left" style={{ display: 'flex', gap: 10, alignItems: 'center' }}>


          {activeTab === 'gantt' && (
            <div style={{ position: 'relative' }}>
              <button
                className="btn btn-secondary"
                style={{ fontSize: '12px' }}
                onClick={() => setShowColumnsMenu(!showColumnsMenu)}
              >
                <AppIcon name="columns" />
                Colonne
              </button>

              {showColumnsMenu && (
                <div className="action-popover" style={{
                  position: 'absolute', top: '100%', left: 0, marginTop: 4, background: 'var(--bg-card)', border: '1px solid var(--border-default)',
                  borderRadius: 8, padding: 10, zIndex: 100, minWidth: 200, boxShadow: 'var(--shadow-md)'
                }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 8 }}>MOSTRA/NASCONDI:</div>
                  {[
                    { id: 'start_date', label: 'Inizio' },
                    { id: 'end_date', label: 'Fine' },
                    { id: 'event_date', label: 'Data Evento' },
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
                onClick={() => { setShowPhaseFilterMenu(!showPhaseFilterMenu); setShowColumnsMenu(false); setShowDeptMenu(false); setShowWorkerMenu(false); }}
                style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '12px' }}
              >
                <AppIcon name="filter" />
                Tipo Fase
                {phaseFilter !== 'all' && (
                  <span style={{ background: '#6366f1', color: '#fff', borderRadius: 10, fontSize: '0.65rem', fontWeight: 700, padding: '1px 6px' }}>
                    1
                  </span>
                )}
              </button>
              {showPhaseFilterMenu && (
                <div className="action-popover" style={{
                  position: 'absolute', top: '100%', left: 0, marginTop: 4,
                  background: 'var(--bg-card)', border: '1px solid var(--border-default)',
                  borderRadius: 10, padding: 12, zIndex: 200, minWidth: 200,
                  boxShadow: 'var(--shadow-md)'
                }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>MOSTRA:</div>
                  {[
                    { value: 'all', label: 'Tutte le fasi' },
                    { value: 'task', label: 'Solo Lavorazioni' },
                    { value: 'milestone', label: 'Solo Eventi (Milestone)' }
                  ].map(opt => (
                    <label key={opt.value} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', cursor: 'pointer', fontSize: 13, color: 'var(--text-primary)' }}>
                      <input
                        type="radio"
                        name="phaseFilter"
                        checked={phaseFilter === opt.value}
                        onChange={() => setPhaseFilter(opt.value)}
                      />
                      {opt.label}
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
                onClick={() => { setShowWorkerMenu(!showWorkerMenu); setShowColumnsMenu(false); setShowPhaseFilterMenu(false); setShowDeptMenu(false); }}
                style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '12px' }}
              >
                <AppIcon name="users" />
                Addetto
                {activeWorkers.length > 0 && (
                  <span style={{ background: '#6366f1', color: '#fff', borderRadius: 10, fontSize: '0.65rem', fontWeight: 700, padding: '1px 6px' }}>
                    {activeWorkers.length}
                  </span>
                )}
              </button>
              {showWorkerMenu && (
                <div className="action-popover" style={{
                  position: 'absolute', top: '100%', left: 0, marginTop: 4,
                  background: 'var(--bg-card)', border: '1px solid var(--border-default)',
                  borderRadius: 10, padding: 12, zIndex: 200, minWidth: 200,
                  boxShadow: 'var(--shadow-md)'
                }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>FILTRA PER ADDETTO:</div>
                  <div style={{ maxHeight: '300px', overflowY: 'auto' }}>
                    {[...predefinedWorkers].sort((a, b) => a === user?.username ? -1 : b === user?.username ? 1 : a.localeCompare(b)).map(w => (
                      <label key={w} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', cursor: 'pointer', fontSize: 13, color: 'var(--text-primary)' }}>
                        <input
                          type="checkbox"
                          checked={activeWorkers.includes(w)}
                          onChange={(e) => {
                            setActiveWorkers(e.target.checked
                              ? [...activeWorkers, w]
                              : activeWorkers.filter(x => x !== w)
                            );
                          }}
                        />
                        {w}
                      </label>
                    ))}
                  </div>
                  <div style={{ borderTop: '1px solid var(--border-subtle)', marginTop: 8, paddingTop: 8, display: 'flex', gap: 8 }}>
                    <button className="btn btn-sm btn-secondary" onClick={() => setActiveWorkers([])} style={{ flex: 1, fontSize: 11 }}>Tutti</button>
                  </div>
                </div>
              )}
            </div>
          )}

          {activeTab === 'gantt' && (
            <div style={{ position: 'relative' }}>
              <button
                className="btn btn-secondary"
                onClick={() => {
                  setShowDeptMenu(!showDeptMenu);
                  setShowColumnsMenu(false); setShowPhaseFilterMenu(false); setShowWorkerMenu(false);
                }}
                style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '12px' }}
              >
                <AppIcon name="building" />
                Reparto
                {activeDepartments.length < ALL_DEPTS.length && (
                  <span style={{ background: '#6366f1', color: '#fff', borderRadius: 10, fontSize: '0.65rem', fontWeight: 700, padding: '1px 6px' }}>
                    {activeDepartments.length}/{ALL_DEPTS.length}
                  </span>
                )}
              </button>
              {showDeptMenu && (
                <div className="action-popover" style={{
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

        </div>
      </div>}

      {/* TAB 1: GANTT */}
      {activeTab === 'gantt' && (
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0, width: '100%', maxWidth: '100%' }}>
          <div className="gantt-wrapper">
            <GanttChart
              tasks={ganttData.tasks.filter(t => {
                if (t.department && !activeDepartments.includes(t.department)) return false;
                if (phaseFilter === 'task' && t.type === 'milestone') return false;
                if (phaseFilter === 'milestone' && t.type !== 'milestone') return false;
                if (activeWorkers.length > 0) {
                  if (!t.workers || !t.workers.some(w => activeWorkers.includes(w))) return false;
                }
                return true;
              })}
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
                  {project?.start_date ? formatDateItalian(project.start_date) : 'N/D'} → {project?.end_date ? formatDateItalian(project.end_date) : 'N/D'}
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
                    <span className="semaforo-ritardo"><span className="status-dot danger" />{delaysList.length} Fasi in allarme</span>
                  ) : (
                    <span className="semaforo-ok"><span className="status-dot completed" />In linea</span>
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
              <AppIcon name="columns" size={15} />
              Colonne
              <AppIcon name="chevronDown" size={13} />
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

                      <tr key={task.id} style={{ backgroundColor: isCompleted ? 'rgba(16, 185, 129, 0.18)' : (task.type === 'milestone' ? 'rgba(245, 158, 11, 0.15)' : undefined) }}>
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
                                <span key={w} className="worker-chip"><AppIcon name="user" size={12} />{w}</span>
                              ))
                            ) : (
                              <span style={{ color: 'var(--text-tertiary)', fontSize: 12 }}>Nessun addetto</span>
                            )}
                          </td>
                        )}
                        {tableVisibleColumns.includes('date') && (
                          <td style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                            {task.type === 'milestone' ? (
                              <div style={{ fontWeight: 600, color: '#d97706', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 4 }}>
                                <AppIcon name="calendar" size={13} /> {formatDateItalian(task.start_date)}
                              </div>
                            ) : (
                              <>
                                <div style={{ whiteSpace: 'nowrap' }}>{formatDateItalian(task.start_date)} → {formatDateItalian(task.end_date)}</div>
                                <div style={{ fontSize: 11, color: 'var(--accent-500)', fontWeight: 600, marginTop: 2, whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 4 }}>
                                  <AppIcon name="calendar" size={12} />Durata: {task.duration || 1} {task.duration === 1 ? 'giorno' : 'giorni'}
                                </div>
                              </>
                            )}
                          </td>
                        )}
                        {tableVisibleColumns.includes('ore') && (
                          <td>
                            {task.type !== 'milestone' ? (
                              <>
                                <strong>{task.planned_hours || 8}h</strong> prev /{' '}
                                <span style={{ color: tEff < ((task.planned_hours || 8) * 0.5) ? 'var(--danger)' : 'var(--success)', fontWeight: 700 }}>
                                  {tEff}h eff
                                </span>
                              </>
                            ) : (
                              <span style={{ color: 'var(--text-tertiary)', fontSize: 12 }}>-</span>
                            )}
                          </td>
                        )}
                        {tableVisibleColumns.includes('semaforo') && (
                          <td>
                            {st === 'ok' && <span className="semaforo-ok"><span className="status-dot completed" />Regolare</span>}
                            {st === 'attenzione' && <span className="semaforo-attenzione"><span className="status-dot open" />Attenzione</span>}
                            {st === 'ritardo_ferie' && <span className="semaforo-ritardo"><span className="status-dot danger" />Rischio ritardo ferie</span>}
                            {st === 'ritardo' && <span className="semaforo-ritardo"><span className="status-dot danger" />Ritardo lavorazione</span>}
                            {st === 'sforamento' && <span className="semaforo-ritardo"><span className="status-dot danger" />Sforamento ore</span>}
                          </td>
                        )}
                        {tableVisibleColumns.includes('azioni') && (
                          <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                            {task.type !== 'milestone' && Number(task.duration) !== 0 && (
                              <button
                                className="btn btn-secondary btn-sm"
                                style={{ marginRight: 6 }}
                                onClick={() => openOreModalForTask(task)}
                                title="Inserisci ore lavorate (Giornale ore)"
                              >
                                <AppIcon name="clock" size={15} />
                                Consuntiva
                              </button>
                            )}
                            {canManageProject && (
                              <>
                                <button
                                  className="btn btn-secondary btn-icon"
                                  style={{ marginRight: 6 }}
                                  onClick={() => openEditTaskModal(task)}
                                  title="Modifica fase"
                                >
                                  <AppIcon name="edit" size={15} />
                                </button>
                                <button
                                  className="btn-ghost btn-icon project-delete"
                                  onClick={() => handleTaskDelete(task.id)}
                                  title="Elimina fase"
                                >
                                  <AppIcon name="trash" size={15} />
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

      {/* TAB 3: NOTE ED ALLEGATI */}
      {activeTab === 'note' && (
        <div className="animate-fadeIn">
          <div className="commessa-summary-card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <h3 style={{ margin: 0, color: 'var(--text-primary)' }}>Note ed Allegati</h3>
                <p style={{ color: 'var(--text-secondary)', fontSize: 14, marginTop: 6, marginBottom: 0 }}>
                  Area dedicata a note generali della commessa, caricamento di file allegati e accesso diretto ai ticket di assistenza.
                </p>
              </div>
              <button
                className="btn btn-secondary"
                style={{ borderColor: openTicketsCount > 0 ? 'var(--warning)' : 'var(--border-default)', color: openTicketsCount > 0 ? 'var(--warning)' : 'inherit' }}
                onClick={() => navigate('/tickets', { state: { projectId: id } })}
              >
                <AppIcon name="ticket" size={16} />Gestione ticket
                {openTicketsCount > 0 && (
                  <span className="tab-badge" style={{ backgroundColor: 'var(--warning)', color: '#fff', marginLeft: 8 }}>{openTicketsCount} Aperti</span>
                )}
              </button>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 24 }}>
            {/* AREA NOTE */}
            <div className="commessa-summary-card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <h4 style={{ margin: 0, fontSize: 16, color: 'var(--text-primary)' }}>Note Commessa</h4>
              </div>
              <textarea
                value={notesText}
                onChange={e => setNotesText(e.target.value)}
                onBlur={handleSaveNotes}
                placeholder="Scrivi qui eventuali note, dettagli tecnici o considerazioni per questa commessa..."
                style={{
                  width: '100%',
                  height: 300,
                  padding: 12,
                  borderRadius: 8,
                  border: '1px solid var(--border-default)',
                  background: 'var(--bg-secondary)',
                  color: 'var(--text-primary)',
                  fontSize: 14,
                  resize: 'vertical',
                  fontFamily: 'inherit'
                }}
              />
            </div>

            {/* AREA ALLEGATI */}
            <div className="commessa-summary-card"
              onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
              onDrop={handleDropAttachment}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <h4 style={{ margin: 0, fontSize: 16, color: 'var(--text-primary)' }}>Allegati</h4>

                <div>
                  <input
                    type="file"
                    id="project-attachment-upload-note"
                    multiple
                    style={{ display: 'none' }}
                    onChange={handleUploadAttachment}
                  />
                  <label htmlFor="project-attachment-upload-note" className="btn btn-secondary btn-sm" style={{ cursor: 'pointer' }}>
                    + Aggiungi
                  </label>
                </div>
              </div>

              <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 16 }}>
                {Array.isArray(project?.attachments) && project.attachments.length > 0 ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {project.attachments.map((att, idx) => (
                      <div key={idx} style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        padding: '8px 12px', background: 'var(--bg-card)',
                        border: '1px solid var(--border-subtle)', borderRadius: 8, fontSize: 13
                      }}>
                        <a href={`${BACKEND_URL}/${att.path}`} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent-500)', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          <AppIcon name="paperclip" size={14} /> {att.name}
                        </a>
                        <button
                          onClick={() => handleDeleteAttachment(att.name)}
                          style={{ background: 'var(--danger-light)', border: 'none', cursor: 'pointer', color: 'var(--danger)', padding: '4px 8px', borderRadius: 4, fontSize: 12 }}
                          title="Elimina allegato"
                        >
                          Elimina
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={{ fontSize: 13, color: 'var(--text-muted)', fontStyle: 'italic', textAlign: 'center', padding: '24px 0', border: '1px dashed var(--border-default)', borderRadius: 8 }}>
                    Nessun allegato presente.<br />Trascina qui i file o usa il pulsante Aggiungi.
                  </div>
                )}
              </div>
            </div>
          </div>
          {wsConnected && (
            <div style={{ marginLeft: 16, display: 'flex', alignItems: 'center', gap: 6, color: '#10b981', fontSize: '0.9rem' }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: '#10b981', display: 'inline-block' }}></span>
              Sincronizzato
            </div>
          )}
        </div>
      )}

      {/* TAB 4: RITARDI & ALLARMI */}
      {activeTab === 'alert' && (
        <div className="animate-fadeIn">
          <div
            className="commessa-summary-card"
            style={{ cursor: 'pointer', display: 'flex', flexDirection: 'column' }}
            onClick={() => setIsAlertsExpanded(!isAlertsExpanded)}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <h3 style={{ margin: 0, color: 'var(--text-primary)' }}>Motore Semafori ed Allarmi Lavorazioni</h3>
                <p style={{ color: 'var(--text-secondary)', fontSize: 14, marginTop: 6, marginBottom: 0 }}>
                  Questo pannello identifica automaticamente tutte le lavorazioni e commesse che non stanno rispettando la consuntivazione oraria attesa (meno del 50% delle ore previste o giorni lavorativi trascorsi con 0 ore registrate).
                </p>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginLeft: 16, marginTop: 25 }}>
                {delaysList.length > 0 && (
                  <span style={{
                    background: '#dd3333', color: '#fff',
                    padding: '4px 10px', borderRadius: 12, fontSize: 13, fontWeight: 600,
                    whiteSpace: 'nowrap'
                  }}>
                    {delaysList.length} {delaysList.length === 1 ? 'allerta' : 'allerte'}
                  </span>
                )}
                <AppIcon name={isAlertsExpanded ? "chevronUp" : "chevronDown"} size={20} color="var(--text-secondary)" />
              </div>
            </div>

            {isAlertsExpanded && (
              <div style={{ marginTop: 24, borderTop: '1px solid var(--border-subtle)', paddingTop: 24 }}>
                {delaysList.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: 24 }}>
                    <div className="empty-state-icon" style={{ margin: '0 auto 12px' }}><AppIcon name="check" size={26} /></div>
                    <h4 style={{ color: 'var(--success)', margin: 0 }}>Nessuna Allerta di Ritardo!</h4>
                    <p style={{ color: 'var(--text-secondary)', marginTop: 8, fontSize: 14 }}>
                      Tutte le {ganttData.tasks.length} fasi di lavorazione della commessa sono regolarmente coperte dalla consuntivazione oraria degli addetti.
                    </p>
                  </div>
                ) : (
                  delaysList.map(item => (
                    <div
                      key={item.task.id}
                      className={`alert-card ${item.stato}`}
                      style={{ marginBottom: 12, cursor: 'default' }}
                      onClick={e => e.stopPropagation()}
                    >
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                          <span style={{ fontWeight: 700, fontSize: 16, color: 'var(--text-primary)' }}>
                            {item.task.text}
                          </span>
                          {item.stato === 'ritardo' ? (
                            <span className="semaforo-ritardo"><span className="status-dot danger" />Ritardo critico</span>
                          ) : item.stato === 'ritardo_ferie' ? (
                            <span className="semaforo-ritardo"><span className="status-dot danger" />Rischio ritardo ferie</span>
                          ) : item.stato === 'sforamento' ? (
                            <span className="semaforo-ritardo"><span className="status-dot danger" />Sforamento ore</span>
                          ) : (
                            <span className="semaforo-attenzione"><span className="status-dot open" />Attenzione</span>
                          )}
                        </div>
                        <div className="inline-detail-row" style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                          <AppIcon name="calendar" size={14} /> Inizio/Fine: <strong>{formatDateItalian(item.task.start_date)} → {formatDateItalian(item.task.end_date)}</strong> |{' '}
                          Addetti: <strong>{Array.isArray(item.task.workers) ? item.task.workers.join(', ') : 'Nessuno'}</strong>
                        </div>
                        <div className="inline-detail-row" style={{ fontSize: 13, color: 'var(--text-tertiary)', marginTop: 4 }}>
                          <AppIcon name="clock" size={13} />Ore previste: <strong>{item.task.planned_hours || 8}h</strong> | Consuntivate finora: <strong>{item.tEff}h</strong>
                        </div>
                      </div>
                      <button
                        className="btn btn-primary"
                        onClick={(e) => {
                          e.stopPropagation();
                          openOreModalForTask(item.task);
                        }}
                      >
                        <AppIcon name="clock" />
                        Registra ore
                      </button>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* MODALE NUOVA / MODIFICA FASE (TASK MODAL) */}
      {showTaskModal && (
        <div className="modal-overlay">
          <div className="modal task-editor-modal" style={{ maxWidth: 900 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{editingTask ? 'Dettagli Fase Lavorazione' : 'Nuova Fase Lavorazione'}</h2>
              <button className="btn-ghost btn-icon" onClick={() => setShowTaskModal(false)} aria-label="Chiudi" style={{ marginRight: '-45px' }}>
                <AppIcon name="close" />
              </button>
            </div>

            {editingTask && (
              <div className="ut-tabs" style={{ marginBottom: 16, paddingBottom: 5 }}>
                {canManageProject && (
                  <button className={`ut-tab-btn ${taskModalTab === 'generale' ? 'active' : ''}`} onClick={() => setTaskModalTab('generale')}>
                    Generale
                  </button>
                )}
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
                <div className="task-type-selector">
                  <label style={{ display: 'block', marginBottom: '8px', fontWeight: 600, fontSize: '0.9rem', color: 'var(--text-primary)' }}>Tipo di Voce:</label>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    <label className={`task-type-option ${taskForm.taskType !== 'milestone' ? 'selected' : ''}`}>
                      <input
                        type="radio"
                        name="taskType"
                        value="task"
                        checked={taskForm.taskType !== 'milestone'}
                        onChange={() => setTaskForm({ ...taskForm, taskType: 'task' })}
                      />
                      <AppIcon name="list" />
                      Fase di lavorazione
                      <small>Con durata e budget ore</small>
                    </label>
                    <label className={`task-type-option ${taskForm.taskType === 'milestone' ? 'selected' : ''}`}>
                      <input
                        type="radio"
                        name="taskType"
                        value="milestone"
                        checked={taskForm.taskType === 'milestone'}
                        onChange={() => setTaskForm({ ...taskForm, taskType: 'milestone', color: taskForm.color === PHASE_DEFAULT_COLORS[PREDEFINED_PHASES[0]] ? '#f59e0b' : taskForm.color })}
                      />
                      <AppIcon name="calendar" />
                      Evento o scadenza
                      <small>Milestone nel Gantt</small>
                    </label>
                  </div>
                </div>

                {taskForm.taskType !== 'milestone' && (
                  <div style={{ marginBottom: 16, padding: '10px 14px', background: 'var(--bg-tertiary)', borderRadius: '8px', border: '1px solid var(--border-default)', display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <input
                      type="checkbox"
                      id="taskCompleted"
                      checked={Number(taskForm.completed) === 1}
                      onChange={(e) => {
                        const isChecked = e.target.checked;
                        const newCompleted = isChecked ? 1 : -1;
                        const resetColor = getTaskColor({ ...taskForm, completed: newCompleted });
                        setTaskForm({
                          ...taskForm,
                          completed: newCompleted,
                          color: !isChecked && taskForm.color === '#10b981' ? resetColor : taskForm.color,
                        });
                      }}
                      style={{ width: '18px', height: '18px', cursor: 'pointer' }}
                    />
                    <label htmlFor="taskCompleted" style={{ cursor: 'pointer', fontWeight: 600, fontSize: '0.9rem', color: 'var(--text-primary)', margin: 0 }}>
                      Fase completata
                    </label>
                  </div>
                )}

                <div className="input-group" style={{ position: 'relative' }}>
                  <label>{taskForm.taskType === 'milestone' ? 'Nome Evento / Scadenza *' : 'Fase di Lavorazione *'}</label>
                  <SearchableCombobox
                    options={getAvailableTemplates().map(tpl => ({
                      value: tpl.name,
                      label: tpl.name,
                      department: tpl.department || 'tutti',
                      ...tpl
                    }))}
                    value={taskForm.faseSel === '__custom__' ? taskForm.customText : taskForm.faseSel}
                    onChange={(val, opt) => {
                      if (opt) {
                        const newDays = opt.default_days != null ? opt.default_days : taskForm.duration_days;
                        const newHours = opt.default_hours != null ? opt.default_hours : taskForm.planned_hours;
                        const sDate = taskForm.start_date || new Date().toISOString().split('T')[0];
                        const newEnd = addWorkingDays(sDate, newDays);
                        setTaskForm({
                          ...taskForm,
                          faseSel: opt.name,
                          customText: '',
                          color: opt.default_color || PHASE_DEFAULT_COLORS[opt.name] || taskForm.color,
                          duration_days: newDays,
                          planned_hours: newHours,
                          end_date: newEnd,
                        });
                      } else {
                        setTaskForm({
                          ...taskForm,
                          faseSel: '__custom__',
                          customText: val
                        });
                      }
                    }}
                    placeholder="Seleziona o digita una nuova fase..."
                    allowCustom={true}
                    groupBy={user?.role === 'admin' ? 'department' : undefined}
                    groupLabels={{
                      ufficio_tecnico: 'Ufficio Tecnico',
                      produzione: 'Produzione',
                      acquisti: 'Acquisti',
                      tutti: 'Condivise / Tutti'
                    }}
                    renderOption={(opt, searchStr) => (
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <span style={{ width: 12, height: 12, borderRadius: '50%', background: opt.default_color || PHASE_DEFAULT_COLORS[opt.name] || '#3b82f6', border: '1px solid var(--border-default)', flexShrink: 0 }} />
                          <span style={{ fontWeight: (taskForm.faseSel === opt.name || taskForm.customText === opt.name) ? 600 : 400, color: 'var(--text-primary)' }}>{opt.name}</span>
                        </div>
                        <button
                          type="button"
                          onMouseDown={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            handleDeleteTemplateFromDropdown(opt);
                          }}
                          className="btn-ghost btn-icon"
                          style={{ padding: '2px 6px', color: 'var(--danger)', fontSize: '0.9rem' }}
                          title="Elimina dall'elenco a tendina"
                        >
                          <AppIcon name="trash" size={14} />
                        </button>
                      </div>
                    )}
                  />
                  {taskForm.faseSel === '__custom__' && taskForm.customText && (
                    <div style={{ marginTop: 12, padding: '10px 12px', background: 'var(--bg-tertiary)', borderRadius: 6, border: '1px solid var(--border-subtle)', display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 4 }}>
                        <AppIcon name="alert" size={14} style={{ color: 'var(--accent-500)' }} /> Questa nuova fase verrà automaticamente aggiunta all'elenco suggerito per il reparto selezionato:
                      </span>
                      <select
                        className="input"
                        style={{ padding: '6px 10px', fontSize: '0.85rem' }}
                        value={taskForm.department || user?.department || 'ufficio_tecnico'}
                        onChange={(e) => setTaskForm({ ...taskForm, department: e.target.value })}
                      >
                        <option value="tutti">Condivisa tra tutti i reparti</option>
                        <option value="ufficio_tecnico">Ufficio Tecnico</option>
                        <option value="acquisti">Acquisti</option>
                        <option value="produzione">Produzione</option>
                      </select>
                    </div>
                  )}
                </div>

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


                {/* Data di Fine Commessa visibile sopra la pianificazione */}
                <div style={{ marginTop: 24, marginBottom: 8, padding: '10px 14px', background: 'var(--bg-tertiary)', borderRadius: '6px', borderLeft: '3px solid var(--accent-500)', display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.9rem' }}>
                  <AppIcon name="calendar" size={16} style={{ color: 'var(--accent-500)' }} />
                  <strong>Scadenza / Fine Commessa:</strong>
                  <span style={{ color: 'var(--text-primary)' }}>{project?.end_date ? formatDateItalian(project.end_date) : 'Non impostata'}</span>
                </div>

                {/* Sezione Pianificazione Temporale e Durate / Data Evento */}
                {taskForm.taskType === 'milestone' ? (
                  <div className="task-form-section milestone-section">
                    <div className="task-form-section-title">
                      <AppIcon name="calendar" />
                      Data evento o milestone
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
                    <div className="task-form-section">
                      <div className="task-form-section-title">
                        <AppIcon name="calendar" />
                        Pianificazione e durata
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
                          <option value="start_end">Data Inizio / Data Fine (calcola giorni lavorativi ed ore escludendo sab/dom e festivi)</option>
                          <option value="start_hours">Data Inizio / Ore (calcola data fine escludendo sab/dom e festivi, giorni = ore/8)</option>
                          <option value="end_hours">Data Fine / Ore (calcola data inizio a ritroso escludendo sab/dom e festivi)</option>
                          <option value="start_days">Data Inizio / Giorni (calcola data fine escludendo sab/dom e festivi, ore = giorni×8)</option>
                          <option value="end_days">Data Fine / Giorni (calcola data inizio a ritroso escludendo sab/dom e festivi)</option>
                          <option value="start_days_hours">Data Inizio / Giorni / Ore (es. 24h spalmate su 10 gg escludendo sab/dom e festivi)</option>
                          <option value="end_days_hours">Data Fine / Giorni / Ore (es. 24h spalmate a ritroso su 10 gg escludendo sab/dom e festivi)</option>
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

                    </div>
                  </>
                )}

                {/* Reparto */}
                <div className="input-group" style={{ marginTop: 16 }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <AppIcon name="building" size={15} />
                    Reparto
                    {user?.role !== 'admin' && taskForm.faseSel !== '__custom__' && (
                      <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 400 }}>(assegnato automaticamente)</span>
                    )}
                  </label>
                  {user?.role === 'admin' || taskForm.faseSel === '__custom__' ? (
                    <select
                      className="input"
                      value={taskForm.department || ''}
                      onChange={(e) => setTaskForm({ ...taskForm, department: e.target.value || null })}
                    >
                      <option value="">— Seleziona reparto —</option>
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

                {(() => {
                  const isMilestone = taskForm.taskType === 'milestone';
                  const currentAssignedTotal = taskForm.workers.reduce((sum, w) => sum + (Number(taskForm.worker_hours?.[w]) || 0), 0);
                  const sDateForBudget = taskForm.start_date;
                  const eDateForBudget = taskForm.end_date;
                  const diffDaysForBudget = sDateForBudget && eDateForBudget ? countWorkingDays(sDateForBudget, eDateForBudget) : 1;
                  const finalDaysForBudget = Math.max(1, Number(taskForm.duration_days) || diffDaysForBudget);
                  const currentBudgetTotal = isMilestone ? 0 : (Number(taskForm.planned_hours) || (finalDaysForBudget * 8.0));

                  const roundedAssigned = Math.round(currentAssignedTotal * 10) / 10;
                  const roundedBudget = Math.round(currentBudgetTotal * 10) / 10;
                  const isOverBudget = !isMilestone && roundedAssigned > roundedBudget;

                  let totalColor = 'var(--text-secondary)';
                  if (!isMilestone) {
                    if (roundedAssigned < roundedBudget) totalColor = '#f59e0b';
                    else if (roundedAssigned === roundedBudget) totalColor = '#10b981';
                    else totalColor = '#ef4444';
                  }

                  return (
                    <>
                      <div className="input-group" style={{ marginTop: 16 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <label style={{ margin: 0 }}>Addetti Assegnati (Multi-selezione)</label>
                          {!isMilestone && (
                            <span style={{ fontSize: '0.85rem', fontWeight: 600, color: totalColor }}>
                              Totale assegnato: {roundedAssigned}h / {roundedBudget}h
                            </span>
                          )}
                        </div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
                          {[...predefinedWorkers].sort((a, b) => a === user?.username ? -1 : b === user?.username ? 1 : a.localeCompare(b)).map(w => {
                            const sel = taskForm.workers.includes(w);
                            return (
                              <div
                                key={w}
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  background: sel ? 'var(--accent-600)' : 'var(--bg-primary)',
                                  color: sel ? '#fff' : 'var(--text-secondary)',
                                  border: `1px solid ${sel ? 'var(--accent-500)' : 'var(--border-default)'}`,
                                  padding: '6px 12px',
                                  borderRadius: '16px',
                                  cursor: 'pointer',
                                  fontSize: '0.85rem',
                                  fontWeight: sel ? 600 : 400
                                }}
                                onClick={() => toggleWorkerSelection(w)}
                              >
                                <span>{sel ? '✓ ' : '+ '}{w}</span>
                                {sel && taskForm.taskType !== 'milestone' && (
                                  <span style={{ marginLeft: 6, display: 'flex', alignItems: 'center' }}>
                                    (<input
                                      type="number"
                                      min="0.1"
                                      step="0.1"
                                      style={{
                                        width: 46,
                                        background: '#fff',
                                        border: '1px solid #ccc',
                                        borderRadius: 4,
                                        color: '#000',
                                        fontSize: '0.8rem',
                                        textAlign: 'center',
                                        padding: '2px',
                                        margin: '0 4px',
                                        outline: 'none'
                                      }}
                                      value={taskForm.worker_hours?.[w] !== undefined ? taskForm.worker_hours[w] : ''}
                                      onClick={(e) => e.stopPropagation()}
                                      onChange={(e) => {
                                        const val = e.target.value === '' ? '' : parseFloat(e.target.value);
                                        setTaskForm({
                                          ...taskForm,
                                          worker_hours: { ...taskForm.worker_hours, [w]: val }
                                        });
                                      }}
                                    />h)
                                  </span>
                                )}
                              </div>
                            );
                          })}
                        </div>


                        {/* Sezione addetti rimossa e unificata nel blocco superiore */}
                      </div>

                      <div className="modal-footer" style={{ marginTop: 24 }}>
                        <button type="button" className="btn btn-secondary" onClick={() => setShowTaskModal(false)}>
                          Annulla
                        </button>
                        <button type="submit" className="btn btn-primary" disabled={isOverBudget}>
                          {editingTask ? 'Salva Modifiche' : 'Aggiungi Fase'}
                        </button>
                      </div>
                    </>
                  );
                })()}
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
        <div className="modal-overlay">
          <div className="modal" style={{ maxWidth: 1200, width: '95vw' }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header" style={{ flexWrap: 'wrap', gap: 12 }}>
              <div style={{ flex: 1, minWidth: 240 }}>
                <h2 className="inline-heading"><AppIcon name="clock" size={18} />Giornale ore consuntivate</h2>
                <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 4 }}>
                  Fase: <strong style={{ color: 'var(--accent-500)' }}>{selectedTaskForHours.text}</strong> |{' '}
                  Ore previste: <strong>{selectedTaskForHours.planned_hours || 8}h</strong>
                  {user?.role !== 'admin' && (
                    <span style={{ marginLeft: 10, fontSize: 11, color: 'var(--text-tertiary)', background: 'var(--bg-tertiary)', padding: '2px 8px', borderRadius: 6 }}>
                      Puoi modificare solo le tue ore
                    </span>
                  )}
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                {/* Date picker per data specifica — auto-aggiunge al cambio data */}
                <div
                  title="Clicca per scegliere una data specifica da aggiungere"
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    background: specificExtraDate ? 'var(--bg-tertiary)' : 'transparent',
                    border: `1px solid ${specificExtraDate ? 'var(--border-default)' : 'transparent'}`,
                    borderRadius: 8, padding: '4px 10px',
                    opacity: specificExtraDate ? 1 : 0.45,
                    transition: 'opacity 0.2s, background 0.2s, border-color 0.2s',
                    cursor: 'pointer',
                  }}
                  onMouseEnter={e => { if (!specificExtraDate) e.currentTarget.style.opacity = '0.8'; }}
                  onMouseLeave={e => { if (!specificExtraDate) e.currentTarget.style.opacity = '0.45'; }}
                >
                  <AppIcon name="calendar" size={14} style={{ color: specificExtraDate ? 'var(--accent-500)' : 'var(--text-muted)', flexShrink: 0 }} />
                  <input
                    type="date"
                    value={specificExtraDate}
                    onChange={e => handleSpecificDateChange(e.target.value)}
                    style={{ border: 'none', background: 'transparent', fontSize: '0.82rem', color: 'var(--text-primary)', outline: 'none', cursor: 'pointer', width: specificExtraDate ? 'auto' : 100 }}
                    title="Scegli una data specifica da aggiungere — si inserisce subito"
                  />
                  {!specificExtraDate && <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>Aggiungi giorno con data specifica</span>}
                </div>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={handleAddExtraDayToModal}
                  style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.82rem', fontWeight: 600 }}
                  title="Aggiungi il prossimo giorno lavorativo dopo l'ultimo presente"
                >
                  <AppIcon name="plus" size={14} />Aggiungi giorno extra in coda
                </button>
                {modalExtraDates.length > 0 && (
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={handleRemoveLastExtraDay}
                    style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.82rem', fontWeight: 600, color: '#ef4444' }}
                    title="Rimuovi l'ultimo giorno extra aggiunto"
                  >
                    <AppIcon name="trash" size={14} />Rimuovi giorno
                  </button>
                )}
                <button className="btn-ghost btn-icon" onClick={() => setShowOreModal(false)} aria-label="Chiudi">
                  <AppIcon name="close" />
                </button>
              </div>
            </div>

            {(() => {
              const plannedDates = getWorkDatesBetween(
                selectedTaskForHours.start_date ? selectedTaskForHours.start_date.split(' ')[0] : '',
                selectedTaskForHours.end_date ? selectedTaskForHours.end_date.split(' ')[0] : ''
              );
              const datesSet = new Set([...plannedDates, ...modalExtraDates]);
              const dates = Array.from(datesSet).sort();
              const plannedSet = new Set(plannedDates);

              const workers = Array.isArray(selectedTaskForHours.workers) && selectedTaskForHours.workers.length > 0
                ? selectedTaskForHours.workers
                : ['Addetto Generico'];
              const oreGgTotale = plannedDates.length > 0 ? workers.reduce((acc, w) => {
                const wAssigned = (selectedTaskForHours.worker_hours && selectedTaskForHours.worker_hours[w] !== undefined && selectedTaskForHours.worker_hours[w] !== '')
                  ? Number(selectedTaskForHours.worker_hours[w])
                  : (Number(selectedTaskForHours.planned_hours || 8) / workers.length);
                return acc + (wAssigned / plannedDates.length);
              }, 0) : (Number(selectedTaskForHours.planned_hours || 8));

              return (
                <div style={{ marginTop: 16 }}>
                  <div style={{ overflowX: 'auto', maxHeight: 520 }}>
                    <table className="ore-grid-table">
                      <thead>
                        <tr>
                          <th style={{ minWidth: 130, textAlign: 'left' }}>Addetto / Giorno</th>
                          {dates.map(d => (
                            <th key={d} style={{ minWidth: 85, background: !plannedSet.has(d) ? 'rgba(239, 68, 68, 0.08)' : undefined }}>
                              {d.split('-')[2]}/{d.split('-')[1]}<br />
                              <span style={{ fontSize: 11, fontWeight: 400, color: !plannedSet.has(d) ? '#ef4444' : 'var(--text-tertiary)' }}>
                                {plannedSet.has(d) ? `(${oreGgTotale.toFixed(1)}h prev)` : '(extra)'}
                              </span>
                            </th>
                          ))}
                          <th style={{ minWidth: 90, background: 'rgba(245, 158, 11, 0.1)' }}>
                            Ore extra<br />
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

                          const isCurrentUser = (w === user?.username || w === (user?.full_name || user?.username));
                          return (
                            <tr key={w} style={isCurrentUser ? { background: 'rgba(59,130,246,0.10)', outline: '2px solid rgba(59,130,246,0.35)', outlineOffset: '-2px', borderRadius: 8 } : {}}>
                              <td style={{ textAlign: 'left', fontWeight: isCurrentUser ? 800 : 600, color: isCurrentUser ? 'var(--accent-400)' : undefined }}>
                                <span className="inline-detail-row"><AppIcon name="user" size={13} />{w}{isCurrentUser ? ' (tu)' : ''}</span>
                              </td>
                              {dates.map(d => {
                                const val = (actualHoursMap[w] && actualHoursMap[w][d]) || '';
                                totW += Number(val) || 0;
                                const isHoliday = allVacations.some(v => v.username === w && d >= v.start_date && d <= v.end_date);
                                return (
                                  <td key={d}>
                                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                                      <input
                                        type="number"
                                        step="0.5"
                                        min="0"
                                        max="24"
                                        className="ore-input"
                                        style={isHoliday ? { backgroundColor: '#fef08a' } : {}}
                                        disabled={user?.role !== 'admin' && w !== user?.username && w !== (user?.full_name || user?.username)}
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
                                      {isHoliday && <span style={{ fontSize: '0.65rem', color: '#b45309', fontWeight: 'bold' }}>Ferie</span>}
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
                                  disabled={user?.role !== 'admin' && w !== user?.username && w !== (user?.full_name || user?.username)}
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
                            {st === 'ok' && <span className="semaforo-ok"><span className="status-dot completed" />Stato regolare</span>}
                            {st === 'attenzione' && <span className="semaforo-attenzione"><span className="status-dot open" />Stato attenzione</span>}
                            {st === 'ritardo_ferie' && <span className="semaforo-ritardo"><span className="status-dot danger" />Rischio ritardo (ferie)</span>}
                            {st === 'ritardo' && <span className="semaforo-ritardo"><span className="status-dot danger" />Stato ritardo</span>}
                            {st === 'sforamento' && <span className="semaforo-ritardo" style={{ background: 'rgba(239, 68, 68, 0.18)', color: '#ef4444', border: '1px solid #dc2626', padding: '3px 10px', borderRadius: '12px', fontWeight: 700 }}><span className="status-dot danger" />Sforamento ore</span>}
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
        <div className="modal-overlay">
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Modifica Dati Commessa</h2>
              <button className="btn-ghost btn-icon" onClick={() => setShowEditProjectModal(false)} aria-label="Chiudi">
                <AppIcon name="close" />
              </button>
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

      {activeTab === 'activity_log' && (
        <ActivityLogPanel projectId={id} />
      )}
    </div>
  );
}
