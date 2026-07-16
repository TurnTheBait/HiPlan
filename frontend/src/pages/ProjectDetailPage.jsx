import { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../api/client';
import { useToast } from '../context/ToastContext';
import { gantt } from 'dhtmlx-gantt';
import GanttChart from '../components/gantt/GanttChart';
import './ProjectDetailPage.css';
import { STATUS_LABELS_IT, STATUS_OPTIONS } from '../utils/statusLabels';
import { PREDEFINED_PHASES, PHASE_DEFAULT_COLORS, getTaskColor } from '../utils/phaseColors';


const PREDEFINED_WORKERS_DEFAULT = [];

export default function ProjectDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const [project, setProject] = useState(null);
  const [ganttData, setGanttData] = useState({ tasks: [], links: [] });
  const [predefinedWorkers, setPredefinedWorkers] = useState(PREDEFINED_WORKERS_DEFAULT);
  const [loading, setLoading] = useState(true);
  
  // STATO PER COLONNE GANTT (leggiamo dal localStorage)
  const [visibleColumns, setVisibleColumns] = useState(() => {
    const saved = localStorage.getItem('ganttVisibleColumns');
    return saved ? JSON.parse(saved) : ['start_date', 'duration'];
  });
  const [showColumnsMenu, setShowColumnsMenu] = useState(false);
  const [viewMode, setViewMode] = useState('day');
  const [activeTab, setActiveTab] = useState('gantt');

  // Stato Modale Nuova / Modifica Fase
  const [showTaskModal, setShowTaskModal] = useState(false);
  const [editingTask, setEditingTask] = useState(null);
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
    customWorker: ''
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

  async function loadProject() {
    try {
      const [projRes, ganttRes, workersRes] = await Promise.all([
        api.get(`/projects/${id}`),
        api.get(`/projects/${id}/gantt`),
        api.get('/workers').catch(() => ({ data: [] }))
      ]);
      setProject(projRes.data);
      setGanttData(ganttRes.data);
      if (Array.isArray(workersRes.data)) {
        setPredefinedWorkers(workersRes.data.map(w => w.name));
      }
    } catch {
      toast.error('Progetto non trovato');
      navigate('/projects');
    } finally {
      setLoading(false);
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

  // Calcolo stato semaforo e ore giornaliere previste (algoritmo prototipo Ufficio Tecnico)
  function computeStato(task) {
    if (!task || !task.start_date) return 'ok';
    const start = new Date(task.start_date);
    const end = task.end_date ? new Date(task.end_date) : start;
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
        const dateStr = cur.toISOString().split('T')[0];
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
  function getWorkDatesBetween(startStr, endStr) {
    const dates = [];
    if (!startStr) return dates;
    const start = new Date(startStr);
    const end = endStr ? new Date(endStr) : new Date(startStr);
    let cur = new Date(start);
    while (cur <= end) {
      const dayOfWeek = cur.getDay();
      if (dayOfWeek !== 0 && dayOfWeek !== 6) {
        dates.push(cur.toISOString().split('T')[0]);
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

  async function handleTaskDelete(taskId) {
    try {
      await api.delete(`/projects/${id}/tasks/${taskId}`);
      loadProject();
    } catch { /* task già rimosso */ }
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

  async function handleLinkDelete(linkId) {
    try {
      await api.delete(`/projects/${id}/links/${linkId}`);
      loadProject();
    } catch { /* già rimosso */ }
  }

  function openNewTaskModal() {
    setEditingTask(null);
    setTaskForm({
      faseSel: PREDEFINED_PHASES[0],
      customText: '',
      color: PHASE_DEFAULT_COLORS[PREDEFINED_PHASES[0]] || '#3b82f6',
      start_date: project?.start_date || new Date().toISOString().split('T')[0],
      end_date: project?.end_date || new Date().toISOString().split('T')[0],
      duration_days: 1,
      planned_hours: 8.0,
      workers: [],
      worker_hours: {},
      customWorker: '',
    });
    setShowTaskModal(true);
  }

  function openEditTaskModal(task) {
    setEditingTask(task);
    const isPredefined = PREDEFINED_PHASES.includes(task.text);
    const s = task.start_date ? task.start_date.split(' ')[0] : new Date().toISOString().split('T')[0];
    const e = task.end_date ? task.end_date.split(' ')[0] : new Date().toISOString().split('T')[0];
    const diff = Math.max(1, Math.ceil((new Date(e) - new Date(s)) / (1000 * 60 * 60 * 24)) + 1);
    setTaskForm({
      faseSel: isPredefined ? task.text : '__custom__',
      customText: isPredefined ? '' : task.text,
      color: getTaskColor(task),
      start_date: s,
      end_date: e,
      duration_days: task.duration || diff,
      planned_hours: task.planned_hours || 8.0,
      workers: Array.isArray(task.workers) ? task.workers : [],
      worker_hours: typeof task.worker_hours === 'object' ? task.worker_hours : {},
      customWorker: '',
    });
    setShowTaskModal(true);
  }


  function handleStartDateChange(newStart) {
    const sDate = new Date(newStart);
    let days = Math.max(1, Number(taskForm.duration_days) || 1);
    const eDate = new Date(sDate);
    eDate.setDate(sDate.getDate() + (days - 1));
    const newEnd = eDate.toISOString().split('T')[0];
    setTaskForm({ ...taskForm, start_date: newStart, end_date: newEnd });
  }

  function handleEndDateChange(newEnd) {
    const sDate = new Date(taskForm.start_date);
    const eDate = new Date(newEnd);
    const diffDays = Math.max(1, Math.ceil((eDate - sDate) / (1000 * 60 * 60 * 24)) + 1);
    setTaskForm({
      ...taskForm,
      end_date: newEnd,
      duration_days: diffDays,
      planned_hours: diffDays * 8.0,
    });
  }

  function handleDurationDaysChange(daysVal) {
    const days = Math.max(1, Number(daysVal) || 1);
    const sDate = new Date(taskForm.start_date || new Date());
    const eDate = new Date(sDate);
    eDate.setDate(sDate.getDate() + (days - 1));
    const newEnd = eDate.toISOString().split('T')[0];
    setTaskForm({
      ...taskForm,
      duration_days: daysVal,
      end_date: newEnd,
      planned_hours: days * 8.0,
    });
  }

  function handlePlannedHoursChange(hoursVal) {
    const hours = Number(hoursVal) || 0;
    const days = Math.max(1, Math.ceil(hours / 8.0));
    const sDate = new Date(taskForm.start_date || new Date());
    const eDate = new Date(sDate);
    eDate.setDate(sDate.getDate() + (days - 1));
    const newEnd = eDate.toISOString().split('T')[0];
    setTaskForm({
      ...taskForm,
      planned_hours: hoursVal,
      duration_days: days,
      end_date: newEnd,
    });
  }

  function applyDurationPreset(days, hours) {
    const sDate = new Date(taskForm.start_date || new Date());
    const eDate = new Date(sDate);
    eDate.setDate(sDate.getDate() + (days - 1));
    const newEnd = eDate.toISOString().split('T')[0];
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
    const sDate = new Date(taskForm.start_date);
    const eDate = new Date(taskForm.end_date);
    const diffDays = Math.max(1, Math.ceil((eDate - sDate) / (1000 * 60 * 60 * 24)) + 1);
    const finalDays = Math.max(1, Number(taskForm.duration_days) || diffDays);

    const payload = {
      text: taskName.trim(),
      start_date: taskForm.start_date,
      end_date: taskForm.end_date,
      duration: finalDays,
      planned_hours: Number(taskForm.planned_hours) || (finalDays * 8.0),
      workers: taskForm.workers,
      worker_hours: taskForm.worker_hours,
      type: editingTask ? editingTask.type : 'task',
      color: taskForm.color,
    };


    try {
      if (editingTask) {
        await api.put(`/projects/${id}/tasks/${editingTask.id}`, payload);
        toast.success('Fase modificata con successo!');
      } else {
        await api.post(`/projects/${id}/tasks`, payload);
        toast.success('Nuova fase aggiunta!');
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
    setActualHoursMap(initialMap);
    setShowOreModal(true);
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
    } catch {
      toast.error('Errore durante il salvataggio ore');
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
    });
    setShowEditProjectModal(true);
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

  function toggleWorkerSelection(w) {
    const isSelected = taskForm.workers.includes(w);
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

  function addCustomWorker() {
    const w = taskForm.customWorker.trim();
    if (w && !taskForm.workers.includes(w)) {
      setTaskForm({ 
        ...taskForm, 
        workers: [...taskForm.workers, w], 
        worker_hours: { ...taskForm.worker_hours, [w]: 8.0 },
        customWorker: '' 
      });
    }
  }

  function handleZoom(mode) {
    setViewMode(mode);
    switch (mode) {
      case 'day':
        gantt.config.scales = [
          { unit: "month", step: 1, format: "%F %Y" },
          { unit: "day", step: 1, format: "%d" },
        ];
        gantt.config.min_column_width = 40;
        break;
      case 'week':
        gantt.config.scales = [
          { unit: "month", step: 1, format: "%F %Y" },
          { unit: "week", step: 1, format: "Sett. %W" },
        ];
        gantt.config.min_column_width = 80;
        break;
      case 'month':
        gantt.config.scales = [
          { unit: "year", step: 1, format: "%Y" },
          { unit: "month", step: 1, format: "%M" },
        ];
        gantt.config.min_column_width = 60;
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
        break;
    }
    gantt.render();
  }

  async function handleExport(type) {
    try {
      const response = await api.get(`/projects/${id}/export/${type}`, { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const a = document.createElement('a');
      a.href = url;
      a.download = `${project.code || project.name}.${type === 'excel' ? 'xlsx' : 'pdf'}`;
      a.click();
      window.URL.revokeObjectURL(url);
      toast.success(`Export ${type.toUpperCase()} completato!`);
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
            <h1 style={{ margin: 0 }}>{project?.name}</h1>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={openEditProjectModal}
              title="Modifica Titolo, Codice, Cliente, Colore e Descrizione della commessa"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '5px 12px',
                fontSize: '0.8rem',
                fontWeight: 600,
                borderRadius: '8px',
                background: 'var(--bg-tertiary)',
                border: '1px solid var(--border-default)',
                color: 'var(--text-primary)',
                cursor: 'pointer',
                transition: 'all 0.15s ease'
              }}
            >
              ✏️ Modifica
            </button>
          </div>
          <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
            <select
              className={`badge badge-${project?.status}`}
              style={{
                cursor: 'pointer',
                border: '1px solid rgba(255, 255, 255, 0.2)',
                paddingTop: 5,
                paddingBottom: 5,
                paddingLeft: 12,
                paddingRight: 28,
                borderRadius: '16px',
                appearance: 'none',
                WebkitAppearance: 'none',
                fontFamily: 'inherit',
                fontSize: '0.75rem',
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                transition: 'all 0.15s ease',
              }}
              value={project?.status || 'planning'}
              onChange={(e) => handleStatusChange(e.target.value)}
              title="Clicca per cambiare lo stato della commessa"
            >
              {STATUS_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value} style={{ background: 'var(--bg-card)', color: 'var(--text-primary)', textTransform: 'none', fontWeight: 500 }}>
                  {opt.label}
                </option>
              ))}
            </select>
            <span style={{ position: 'absolute', right: 10, pointerEvents: 'none', fontSize: '0.6rem', opacity: 0.8, color: 'inherit' }}>▼</span>
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
      </div>

      {/* TOOLBAR DI AZIONE POSIZIONATA SOTTO ALLE TABS */}
      <div className="project-toolbar">
        <div className="toolbar-left" style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <button className="btn btn-primary" onClick={openNewTaskModal}>
            + Nuova Fase
          </button>
          
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
          <div className="export-buttons">
            <button className="btn btn-secondary" onClick={() => handleExport('pdf')} title="Esporta PDF">
              📄 PDF
            </button>
            <button className="btn btn-secondary" onClick={() => handleExport('excel')} title="Esporta Excel">
              📊 Excel
            </button>
          </div>
        </div>
      </div>

      {/* TAB 1: GANTT */}
      {activeTab === 'gantt' && (
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0, width: '100%', maxWidth: '100%' }}>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 8, display: 'flex', justifyContent: 'space-between' }}>
            <span>💡 Clicca e trascina per modificare le fasi. Per registrare le ore effettive di lavoro o consuntivare per singolo addetto, passa alla tab <strong>Consuntivazione Ore</strong> o clicca sul pulsante <code>+ Nuova Fase</code> per aggiungere un task normato.</span>
          </div>
          <div className="gantt-wrapper">
            <GanttChart
              tasks={ganttData.tasks}
              links={ganttData.links}
              visibleColumns={visibleColumns}
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
            </div>
          </div>

          <div className="phases-table-container">
            <table className="phases-table">
              <thead>
                <tr>
                  <th>Fase Lavorazione</th>
                  <th>Addetti Assegnati</th>
                  <th>Inizio / Fine</th>
                  <th>Ore Prev vs Eff</th>
                  <th>Semaforo Avanzamento</th>
                  <th style={{ textAlign: 'right' }}>Azioni</th>
                </tr>
              </thead>
              <tbody>
                {ganttData.tasks.length === 0 ? (
                  <tr>
                    <td colSpan="6" style={{ textAlign: 'center', color: 'var(--text-tertiary)', padding: 32 }}>
                      Nessuna fase aggiunta. Clicca <strong>+ Nuova Fase Lavorazione</strong> in alto.
                    </td>
                  </tr>
                ) : (
                  ganttData.tasks.map((task) => {
                    const st = computeStato(task);
                    let tEff = 0;
                    if (task.actual_hours && typeof task.actual_hours === 'object') {
                      Object.values(task.actual_hours).forEach(dayMap => {
                        if (dayMap && typeof dayMap === 'object') {
                          Object.values(dayMap).forEach(h => { tEff += Number(h) || 0; });
                        }
                      });
                    }
                    const tColor = getTaskColor(task);
                    return (

                      <tr key={task.id}>
                        <td style={{ fontWeight: 600 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ width: 12, height: 12, borderRadius: '50%', backgroundColor: tColor, flexShrink: 0, display: 'inline-block', border: '1px solid rgba(255,255,255,0.2)' }} title={`Colore fase: ${tColor}`} />
                            <span>{task.text}</span>
                          </div>
                        </td>
                        <td>

                          {Array.isArray(task.workers) && task.workers.length > 0 ? (
                            task.workers.map(w => (
                              <span key={w} className="worker-chip">👤 {w}</span>
                            ))
                          ) : (
                            <span style={{ color: 'var(--text-tertiary)', fontSize: 12 }}>Nessun addetto</span>
                          )}
                        </td>
                        <td style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                          <div>{task.start_date ? task.start_date.split(' ')[0] : ''} → {task.end_date ? task.end_date.split(' ')[0] : ''}</div>
                          <div style={{ fontSize: 11, color: 'var(--accent-500)', fontWeight: 600, marginTop: 2 }}>
                            🗓️ Durata: {task.duration || 1} {task.duration === 1 ? 'giorno' : 'giorni'}
                          </div>
                        </td>
                        <td>
                          <strong>{task.planned_hours || 8}h</strong> prev /{' '}
                          <span style={{ color: tEff < (task.planned_hours * 0.5) ? 'var(--danger)' : 'var(--success)', fontWeight: 700 }}>
                            {tEff}h eff
                          </span>
                        </td>
                        <td>
                          {st === 'ok' && <span className="semaforo-ok">🟢 OK (Regolare)</span>}
                          {st === 'attenzione' && <span className="semaforo-attenzione">🟡 Attenzione</span>}
                          {st === 'ritardo' && <span className="semaforo-ritardo">🔴 Ritardo Lavorazione</span>}
                        </td>
                        <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                          <button
                            className="btn btn-secondary btn-sm"
                            style={{ marginRight: 6 }}
                            onClick={() => openOreModalForTask(task)}
                            title="Inserisci ore lavorate (Giornale ore)"
                          >
                            ⏱️ Consuntiva
                          </button>
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
                        </td>
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

          <div className="phases-table-container">
            <table className="phases-table">
              <thead>
                <tr>
                  <th>Fase Lavorazione</th>
                  <th>Addetti e Spaccato Ore</th>
                  <th>Giorni Lavorativi Previsti</th>
                  <th>Ore Previste / Giorno</th>
                  <th>Totale Consuntivato</th>
                  <th>Semaforo</th>
                  <th style={{ textAlign: 'right' }}>Azione</th>
                </tr>
              </thead>
              <tbody>
                {ganttData.tasks.length === 0 ? (
                  <tr>
                    <td colSpan="7" style={{ textAlign: 'center', color: 'var(--text-tertiary)', padding: 32 }}>
                      Nessuna fase disponibile. Aggiungi fasi per registrare le ore.
                    </td>
                  </tr>
                ) : (
                  ganttData.tasks.map(task => {
                    const st = computeStato(task);
                    const dates = getWorkDatesBetween(
                      task.start_date ? task.start_date.split(' ')[0] : '',
                      task.end_date ? task.end_date.split(' ')[0] : ''
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
                    return (
                      <tr key={task.id}>
                        <td style={{ fontWeight: 600 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ width: 12, height: 12, borderRadius: '50%', backgroundColor: tColor, flexShrink: 0, display: 'inline-block', border: '1px solid rgba(255,255,255,0.2)' }} title={`Colore fase: ${tColor}`} />
                            <span>{task.text}</span>
                          </div>
                        </td>
                        <td>

                          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                            {workersList.map(w => (
                              <div key={w} style={{ fontSize: 13 }}>
                                <span className="worker-chip">👤 {w}</span>: <strong>{workerTotals[w]}h</strong> fatte
                              </div>
                            ))}
                          </div>
                        </td>
                        <td>{dates.length} giorni lavorativi</td>
                        <td>~{oreGg} h/giorno</td>
                        <td>
                          <span style={{ fontSize: 15, fontWeight: 700, color: totalTaskEff >= task.planned_hours ? 'var(--success)' : 'var(--accent-500)' }}>
                            {totalTaskEff} h
                          </span> / {task.planned_hours || 8} h prev
                        </td>
                        <td>
                          {st === 'ok' && <span className="semaforo-ok">🟢 Regolare</span>}
                          {st === 'attenzione' && <span className="semaforo-attenzione">🟡 Attenzione</span>}
                          {st === 'ritardo' && <span className="semaforo-ritardo">🔴 Ritardo</span>}
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <button
                            className="btn btn-primary btn-sm"
                            onClick={() => openOreModalForTask(task)}
                          >
                            ⏱️ Consuntiva Ore
                          </button>
                        </td>
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
                    📅 Inizio/Fine: <strong>{item.task.start_date?.split(' ')[0]} → {item.task.end_date?.split(' ')[0]}</strong> |{' '}
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
              <h2>{editingTask ? 'Modifica Fase Lavorazione' : 'Nuova Fase Lavorazione (Ufficio Tecnico)'}</h2>
              <button className="btn-ghost btn-icon" onClick={() => setShowTaskModal(false)}>✕</button>
            </div>
            <form onSubmit={handleSaveTaskForm}>
              <div className="input-group">
                <label>Fase di Lavorazione *</label>
                <select
                  className="input"
                  value={taskForm.faseSel}
                  onChange={(e) => {
                    const val = e.target.value;
                    setTaskForm({
                      ...taskForm,
                      faseSel: val,
                      color: val !== '__custom__' ? (PHASE_DEFAULT_COLORS[val] || taskForm.color) : taskForm.color
                    });
                  }}
                >
                  {PREDEFINED_PHASES.map(p => (
                    <option key={p} value={p}>
                      {p === '__custom__' ? '✏️ Altra lavorazione personalizzata...' : p}
                    </option>
                  ))}
                </select>
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
                </div>
              )}

              {/* Colore personalizzato della fase */}
              <div className="input-group" style={{ marginTop: 14 }}>
                <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span>Colore Fase (Gantt & Timeline)</span>
                  <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', fontWeight: 'normal' }}>Personalizzabile (Default assegna colore univoco)</span>
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


              {/* Sezione Pianificazione Temporale e Durate sincronizzate */}
              <div style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-lg)', padding: 14, marginTop: 16 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent-500)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 12 }}>
                  🗓️ Pianificazione e Durata (Impostabile in Giorni e in Ore)
                </div>

                <div style={{ display: 'flex', gap: 12 }}>
                  <div className="input-group" style={{ flex: 1 }}>
                    <label>Data Avvio Lavorazione</label>
                    <input
                      type="date"
                      className="input"
                      value={taskForm.start_date}
                      onChange={(e) => handleStartDateChange(e.target.value)}
                    />
                  </div>
                  <div className="input-group" style={{ flex: 1 }}>
                    <label>Data Fine Lavorazione</label>
                    <input
                      type="date"
                      className="input"
                      value={taskForm.end_date}
                      onChange={(e) => handleEndDateChange(e.target.value)}
                    />
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 12, marginTop: 12 }}>
                  <div className="input-group" style={{ flex: 1 }}>
                    <label>Durata in Giorni (Calendario)</label>
                    <div style={{ position: 'relative' }}>
                      <input
                        type="number"
                        min="1"
                        step="1"
                        className="input"
                        style={{ fontWeight: 600, color: 'var(--accent-500)', paddingRight: '56px' }}
                        value={taskForm.duration_days}
                        onChange={(e) => handleDurationDaysChange(e.target.value)}
                      />
                      <span style={{ position: 'absolute', right: 30, top: 9, fontSize: 12, color: 'var(--text-tertiary)', pointerEvents: 'none' }}>giorni</span>
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
                        style={{ fontWeight: 600, color: 'var(--success)', paddingRight: '48px' }}
                        value={taskForm.planned_hours}
                        onChange={(e) => handlePlannedHoursChange(e.target.value)}
                      />
                      <span style={{ position: 'absolute', right: 30, top: 9, fontSize: 12, color: 'var(--text-tertiary)', pointerEvents: 'none' }}>ore</span>
                    </div>
                  </div>
                </div>

                {/* Preset veloci cliccabili */}
                <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 6, marginTop: 12 }}>
                  <span style={{ fontSize: 11, color: 'var(--text-secondary)', marginRight: 4 }}>Preset veloci:</span>
                  <button
                    type="button"
                    className="btn-ghost btn-sm"
                    style={{ border: '1px solid var(--border-color)', borderRadius: 12, padding: '2px 8px', fontSize: 11 }}
                    onClick={() => applyDurationPreset(1, 4)}
                  >
                    ⚡ Mezza giornata (1g / 4h)
                  </button>
                  <button
                    type="button"
                    className="btn-ghost btn-sm"
                    style={{ border: '1px solid var(--border-color)', borderRadius: 12, padding: '2px 8px', fontSize: 11 }}
                    onClick={() => applyDurationPreset(1, 8)}
                  >
                    ⚡ 1 Giorno (8h)
                  </button>
                  <button
                    type="button"
                    className="btn-ghost btn-sm"
                    style={{ border: '1px solid var(--border-color)', borderRadius: 12, padding: '2px 8px', fontSize: 11 }}
                    onClick={() => applyDurationPreset(2, 16)}
                  >
                    ⚡ 2 Giorni (16h)
                  </button>
                  <button
                    type="button"
                    className="btn-ghost btn-sm"
                    style={{ border: '1px solid var(--border-color)', borderRadius: 12, padding: '2px 8px', fontSize: 11 }}
                    onClick={() => applyDurationPreset(5, 40)}
                  >
                    ⚡ 1 Settimana (5g / 40h)
                  </button>
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
                <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                  <input
                    className="input"
                    style={{ flex: 1, height: 36, fontSize: '0.85rem' }}
                    placeholder="Aggiungi altro addetto..."
                    value={taskForm.customWorker}
                    onChange={(e) => setTaskForm({ ...taskForm, customWorker: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        addCustomWorker();
                      }
                    }}
                  />
                  <button type="button" className="btn btn-secondary btn-sm" onClick={addCustomWorker}>
                    Aggiungi Addetto
                  </button>
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
                            onClick={() => toggleWorkerSelection(w)}
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

              <div className="modal-footer" style={{ marginTop: 24 }}>
                <button type="button" className="btn btn-secondary" onClick={() => setShowTaskModal(false)}>
                  Annulla
                </button>
                <button type="submit" className="btn btn-primary">
                  {editingTask ? 'Salva Modifiche' : 'Aggiungi Fase'}
                </button>
              </div>
            </form>
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
              <button className="btn-ghost btn-icon" onClick={() => setShowOreModal(false)}>✕</button>
            </div>

            {(() => {
              const dates = getWorkDatesBetween(
                selectedTaskForHours.start_date ? selectedTaskForHours.start_date.split(' ')[0] : '',
                selectedTaskForHours.end_date ? selectedTaskForHours.end_date.split(' ')[0] : ''
              );
              const workers = Array.isArray(selectedTaskForHours.workers) && selectedTaskForHours.workers.length > 0
                ? selectedTaskForHours.workers
                : ['Addetto Generico'];
              const oreGg = dates.length > 0 ? (Number(selectedTaskForHours.planned_hours || 8) / dates.length) : (selectedTaskForHours.planned_hours || 8);

              return (
                <div style={{ marginTop: 16 }}>
                  <div style={{ overflowX: 'auto', maxHeight: 380 }}>
                    <table className="ore-grid-table">
                      <thead>
                        <tr>
                          <th style={{ minWidth: 130, textAlign: 'left' }}>Addetto / Giorno</th>
                          {dates.map(d => (
                            <th key={d} style={{ minWidth: 85 }}>
                              {d.split('-')[2]}/{d.split('-')[1]}<br/>
                              <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--text-tertiary)' }}>({oreGg.toFixed(1)}h prev)</span>
                            </th>
                          ))}
                          <th style={{ minWidth: 80 }}>Totale Addetto</th>
                        </tr>
                      </thead>
                      <tbody>
                        {workers.map(w => {
                          let totW = 0;
                          return (
                            <tr key={w}>
                              <td style={{ textAlign: 'left', fontWeight: 600 }}>👤 {w}</td>
                              {dates.map(d => {
                                const val = (actualHoursMap[w] && actualHoursMap[w][d]) || '';
                                totW += Number(val) || 0;
                                return (
                                  <td key={d}>
                                    <input
                                      type="number"
                                      step="0.5"
                                      min="0"
                                      max="24"
                                      className="ore-input"
                                      value={val}
                                      onChange={(e) => {
                                        const newVal = e.target.value;
                                        setActualHoursMap(prev => {
                                          const next = { ...prev };
                                          if (!next[w]) next[w] = {};
                                          next[w][d] = newVal;
                                          return next;
                                        });
                                      }}
                                    />
                                  </td>
                                );
                              })}
                              <td style={{ fontWeight: 700, color: 'var(--accent-500)' }}>{totW} h</td>
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
                        return (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                            <span style={{ fontSize: 15, color: 'var(--text-primary)' }}>
                              Totale consuntivato finora: <strong style={{ color: 'var(--accent-500)' }}>{totAll} h</strong> / {selectedTaskForHours.planned_hours || 8} h prev
                            </span>
                            {st === 'ok' && <span className="semaforo-ok">🟢 Stato OK (Regolare)</span>}
                            {st === 'attenzione' && <span className="semaforo-attenzione">🟡 Stato Attenzione</span>}
                            {st === 'ritardo' && <span className="semaforo-ritardo">🔴 Stato Ritardo</span>}
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
                  placeholder="es. Lancio ERP e GanttFlow Q3"
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

