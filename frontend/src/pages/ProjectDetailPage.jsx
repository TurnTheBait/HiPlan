import { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../api/client';
import { useToast } from '../context/ToastContext';
import { gantt } from 'dhtmlx-gantt';
import GanttChart from '../components/gantt/GanttChart';
import './ProjectDetailPage.css';

const PREDEFINED_PHASES = [
  'Layout - Invio al cliente per approvazione',
  'Approvazione cliente',
  'Utenze elettriche',
  'Calcolo strutturale',
  'Progettazione esecutiva - Messa in tavola - Codifica - Distinta base',
  'Targhette',
  'Documentazione tecnica (Manuali)',
  'Certificati',
  'Certificati - Approvazione Responsabile',
  'Compilazione modulo check list',
  'Inserimento costi in Higest',
  '__custom__', // Personalizzata
];

const PREDEFINED_WORKERS = [
  'Alessio', 'Edoardo', 'Ermal', 'Luca', 'Marco', 'Michelangelo', 'Cliente'
];

export default function ProjectDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const [project, setProject] = useState(null);
  const [ganttData, setGanttData] = useState({ tasks: [], links: [] });
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState('day');
  const [activeTab, setActiveTab] = useState('gantt');

  // Stato Modale Nuova / Modifica Fase
  const [showTaskModal, setShowTaskModal] = useState(false);
  const [editingTask, setEditingTask] = useState(null);
  const [taskForm, setTaskForm] = useState({
    faseSel: PREDEFINED_PHASES[0],
    customText: '',
    start_date: new Date().toISOString().split('T')[0],
    end_date: new Date().toISOString().split('T')[0],
    planned_hours: 8.0,
    workers: ['Alessio'],
    customWorker: '',
  });

  // Stato Modale Consuntivo Ore
  const [showOreModal, setShowOreModal] = useState(false);
  const [selectedTaskForHours, setSelectedTaskForHours] = useState(null);
  const [actualHoursMap, setActualHoursMap] = useState({});

  useEffect(() => { loadProject(); }, [id]);

  async function loadProject() {
    try {
      const [projRes, ganttRes] = await Promise.all([
        api.get(`/projects/${id}`),
        api.get(`/projects/${id}/gantt`),
      ]);
      setProject(projRes.data);
      setGanttData(ganttRes.data);
    } catch {
      toast.error('Progetto non trovato');
      navigate('/projects');
    } finally {
      setLoading(false);
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
      if (tempId) gantt.changeLinkId(tempId, created.id);
    } catch { toast.error('Errore creazione dipendenza'); }
  }

  async function handleLinkDelete(linkId) {
    try {
      await api.delete(`/projects/${id}/links/${linkId}`);
    } catch { /* già rimosso */ }
  }

  function openNewTaskModal() {
    setEditingTask(null);
    setTaskForm({
      faseSel: PREDEFINED_PHASES[0],
      customText: '',
      start_date: project?.start_date || new Date().toISOString().split('T')[0],
      end_date: project?.end_date || new Date().toISOString().split('T')[0],
      planned_hours: 8.0,
      workers: ['Alessio'],
      customWorker: '',
    });
    setShowTaskModal(true);
  }

  function openEditTaskModal(task) {
    setEditingTask(task);
    const isPredefined = PREDEFINED_PHASES.includes(task.text);
    setTaskForm({
      faseSel: isPredefined ? task.text : '__custom__',
      customText: isPredefined ? '' : task.text,
      start_date: task.start_date ? task.start_date.split(' ')[0] : new Date().toISOString().split('T')[0],
      end_date: task.end_date ? task.end_date.split(' ')[0] : new Date().toISOString().split('T')[0],
      planned_hours: Number(task.planned_hours) || 8.0,
      workers: Array.isArray(task.workers) ? [...task.workers] : [],
      customWorker: '',
    });
    setShowTaskModal(true);
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

    const payload = {
      text: taskName.trim(),
      start_date: taskForm.start_date,
      end_date: taskForm.end_date,
      duration: diffDays,
      planned_hours: Number(taskForm.planned_hours) || 8.0,
      workers: taskForm.workers,
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

  function toggleWorkerSelection(w) {
    setTaskForm(prev => {
      const exists = prev.workers.includes(w);
      return {
        ...prev,
        workers: exists ? prev.workers.filter(x => x !== w) : [...prev.workers, w]
      };
    });
  }

  function addCustomWorker() {
    const w = taskForm.customWorker.trim();
    if (w && !taskForm.workers.includes(w)) {
      setTaskForm(prev => ({
        ...prev,
        workers: [...prev.workers, w],
        customWorker: ''
      }));
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
          { unit: "quarter", step: 1, format: "Q%q" },
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
          <button className="btn btn-ghost btn-sm" onClick={() => navigate('/projects')}>
            ← Commesse
          </button>
          <div className="commessa-meta" style={{ borderLeft: `4px solid ${project?.color || '#185FA5'}` }}>
            <span className="commessa-code">{project?.code || 'UT-COMM'}</span>
            <span>—</span>
            <span className="commessa-client">🏢 {project?.client || 'Cliente'}</span>
          </div>
          <h1>{project?.name}</h1>
          <span className={`badge badge-${project?.status}`}>{project?.status}</span>
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
        <div className="toolbar-left">
          <button className="btn btn-primary btn-sm" onClick={openNewTaskModal}>
            + Nuova Fase
          </button>
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
            <button className="btn btn-secondary btn-sm" onClick={() => handleExport('pdf')} title="Esporta PDF">
              📄 PDF
            </button>
            <button className="btn btn-secondary btn-sm" onClick={() => handleExport('excel')} title="Esporta Excel">
              📊 Excel
            </button>
          </div>
        </div>
      </div>

      {/* TAB 1: GANTT */}
      {activeTab === 'gantt' && (
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0, width: '100%', maxWidth: '100%' }}>
          <div style={{ fontSize: 13, color: '#94a3b8', marginBottom: 8, display: 'flex', justifyContent: 'space-between' }}>
            <span>💡 Clicca e trascina per modificare le fasi. Per registrare le ore effettive di lavoro o consuntivare per singolo addetto, passa alla tab <strong>Consuntivazione Ore</strong> o clicca sul pulsante <code>+ Nuova Fase</code> per aggiungere un task normato.</span>
          </div>
          <div className="gantt-wrapper">
            <GanttChart
              tasks={ganttData.tasks}
              links={ganttData.links}
              onTaskUpdate={handleTaskUpdate}
              onTaskCreate={handleTaskCreate}
              onTaskDelete={handleTaskDelete}
              onLinkCreate={handleLinkCreate}
              onLinkDelete={handleLinkDelete}
            />
          </div>
        </div>
      )}

      {/* TAB 2: SCHEDA & FASI */}
      {activeTab === 'commessa' && (
        <div className="animate-fadeIn">
          <div className="commessa-summary-card">
            <h3 style={{ margin: 0, color: '#f8fafc' }}>Riepilogo Generale Commessa</h3>
            {project?.description && (
              <p style={{ color: '#cbd5e1', fontSize: 14, marginTop: 8 }}>{project.description}</p>
            )}
            <div className="commessa-stats-grid">
              <div className="stat-box">
                <div className="stat-box-label">Codice Commessa</div>
                <div className="stat-box-value" style={{ color: '#64b5f6' }}>{project?.code || 'N/D'}</div>
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
                <div className="stat-box-value" style={{ color: totalEff >= totalPrev ? '#10b981' : '#f8fafc' }}>
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
                    <td colSpan="6" style={{ textAlign: 'center', color: '#94a3b8', padding: 32 }}>
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
                    return (
                      <tr key={task.id}>
                        <td style={{ fontWeight: 600 }}>{task.text}</td>
                        <td>
                          {Array.isArray(task.workers) && task.workers.length > 0 ? (
                            task.workers.map(w => (
                              <span key={w} className="worker-chip">👤 {w}</span>
                            ))
                          ) : (
                            <span style={{ color: '#64748b', fontSize: 12 }}>Nessun addetto</span>
                          )}
                        </td>
                        <td style={{ fontSize: 13, color: '#cbd5e1' }}>
                          {task.start_date ? task.start_date.split(' ')[0] : ''} → {task.end_date ? task.end_date.split(' ')[0] : ''}
                        </td>
                        <td>
                          <strong>{task.planned_hours || 8}h</strong> prev /{' '}
                          <span style={{ color: tEff < (task.planned_hours * 0.5) ? '#ef4444' : '#10b981', fontWeight: 700 }}>
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
            <h3 style={{ margin: 0, color: '#f8fafc' }}>Consuntivazione Ore Effettive per Fase e Addetto</h3>
            <p style={{ color: '#cbd5e1', fontSize: 14, marginTop: 6, marginBottom: 0 }}>
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
                    <td colSpan="7" style={{ textAlign: 'center', color: '#94a3b8', padding: 32 }}>
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

                    return (
                      <tr key={task.id}>
                        <td style={{ fontWeight: 600 }}>{task.text}</td>
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
                          <span style={{ fontSize: 15, fontWeight: 700, color: totalTaskEff >= task.planned_hours ? '#10b981' : '#60a5fa' }}>
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
            <h3 style={{ margin: 0, color: '#f8fafc' }}>Motore Semafori & Allarmi Lavorazioni</h3>
            <p style={{ color: '#cbd5e1', fontSize: 14, marginTop: 6, marginBottom: 0 }}>
              Questo pannello identifica automaticamente tutte le lavorazioni e commesse che non stanno rispettando la consuntivazione oraria attesa (meno del 50% delle ore previste o giorni lavorativi trascorsi con 0 ore registrate).
            </p>
          </div>

          {delaysList.length === 0 ? (
            <div className="commessa-summary-card" style={{ textAlign: 'center', padding: 48, borderColor: 'rgba(16, 185, 129, 0.4)' }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>🎉</div>
              <h3 style={{ color: '#10b981', margin: 0 }}>Nessuna Allerta di Ritardo!</h3>
              <p style={{ color: '#cbd5e1', marginTop: 8 }}>
                Tutte le {ganttData.tasks.length} fasi di lavorazione della commessa sono regolarmente coperte dalla consuntivazione oraria degli addetti.
              </p>
            </div>
          ) : (
            delaysList.map(item => (
              <div key={item.task.id} className={`alert-card ${item.stato}`}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                    <span style={{ fontWeight: 700, fontSize: 16, color: '#f8fafc' }}>
                      {item.task.text}
                    </span>
                    {item.stato === 'ritardo' ? (
                      <span className="semaforo-ritardo">🔴 RITARDO CRITICO (&lt; 50% ORE / 0 ORE IN GIORNI TRASCORSI)</span>
                    ) : (
                      <span className="semaforo-attenzione">🟡 ATTENZIONE (&lt; ORE ATTESE GIORNALIERE)</span>
                    )}
                  </div>
                  <div style={{ fontSize: 13, color: '#cbd5e1' }}>
                    📅 Inizio/Fine: <strong>{item.task.start_date?.split(' ')[0]} → {item.task.end_date?.split(' ')[0]}</strong> |{' '}
                    Addetti: <strong>{Array.isArray(item.task.workers) ? item.task.workers.join(', ') : 'Nessuno'}</strong>
                  </div>
                  <div style={{ fontSize: 13, color: '#94a3b8', marginTop: 4 }}>
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
                  onChange={(e) => setTaskForm({ ...taskForm, faseSel: e.target.value })}
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

              <div style={{ display: 'flex', gap: 12, marginTop: 16 }}>
                <div className="input-group" style={{ flex: 1 }}>
                  <label>Data Avvio Lavorazione</label>
                  <input
                    type="date"
                    className="input"
                    value={taskForm.start_date}
                    onChange={(e) => setTaskForm({ ...taskForm, start_date: e.target.value })}
                  />
                </div>
                <div className="input-group" style={{ flex: 1 }}>
                  <label>Data Fine Lavorazione</label>
                  <input
                    type="date"
                    className="input"
                    value={taskForm.end_date}
                    onChange={(e) => setTaskForm({ ...taskForm, end_date: e.target.value })}
                  />
                </div>
                <div className="input-group" style={{ width: 120 }}>
                  <label>Ore Previste</label>
                  <input
                    type="number"
                    step="0.5"
                    className="input"
                    value={taskForm.planned_hours}
                    onChange={(e) => setTaskForm({ ...taskForm, planned_hours: e.target.value })}
                  />
                </div>
              </div>

              <div className="input-group" style={{ marginTop: 16 }}>
                <label>Addetti Assegnati (Multi-selezione)</label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
                  {PREDEFINED_WORKERS.map(w => {
                    const sel = taskForm.workers.includes(w);
                    return (
                      <button
                        type="button"
                        key={w}
                        onClick={() => toggleWorkerSelection(w)}
                        style={{
                          background: sel ? '#2563eb' : 'var(--bg-primary)',
                          color: sel ? '#fff' : '#cbd5e1',
                          border: `1px solid ${sel ? '#3b82f6' : 'var(--border-color)'}`,
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
                  />
                  <button type="button" className="btn btn-secondary btn-sm" onClick={addCustomWorker}>
                    Aggiungi Addetto
                  </button>
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
                <div style={{ fontSize: 13, color: '#94a3b8', marginTop: 4 }}>
                  Fase: <strong style={{ color: '#64b5f6' }}>{selectedTaskForHours.text}</strong> |{' '}
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
                              <span style={{ fontSize: 11, fontWeight: 400, color: '#94a3b8' }}>({oreGg.toFixed(1)}h prev)</span>
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
                              <td style={{ fontWeight: 700, color: '#60a5fa' }}>{totW} h</td>
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
                            <span style={{ fontSize: 15 }}>
                              Totale consuntivato finora: <strong style={{ color: '#fff' }}>{totAll} h</strong> / {selectedTaskForHours.planned_hours || 8} h prev
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
    </div>
  );
}

