import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../api/client';
import { useToast } from '../context/ToastContext';
import { gantt } from 'dhtmlx-gantt';
import GanttChart from '../components/gantt/GanttChart';
import './ProjectDetailPage.css';

export default function ProjectDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const [project, setProject] = useState(null);
  const [ganttData, setGanttData] = useState({ tasks: [], links: [] });
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState('day');

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

  async function handleTaskUpdate(taskId, data) {
    try {
      await api.put(`/projects/${id}/tasks/${taskId}`, data);
    } catch { toast.error('Errore aggiornamento task'); }
  }

  async function handleTaskCreate(data, tempId) {
    try {
      const { data: created } = await api.post(`/projects/${id}/tasks`, data);
      // Sostituisci l'ID temporaneo con quello reale nel Gantt
      gantt.changeTaskId(tempId, created.id);
    } catch { toast.error('Errore creazione task'); }
  }

  async function handleTaskDelete(taskId) {
    try {
      await api.delete(`/projects/${id}/tasks/${taskId}`);
    } catch { /* task potrebbe essere già stato eliminato */ }
  }

  async function handleLinkCreate(data, tempId) {
    try {
      const { data: created } = await api.post(`/projects/${id}/links`, data);
      gantt.changeLinkId(tempId, created.id);
    } catch { toast.error('Errore creazione dipendenza'); }
  }

  async function handleLinkDelete(linkId) {
    try {
      await api.delete(`/projects/${id}/links/${linkId}`);
    } catch { /* link potrebbe essere già stato eliminato */ }
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
      a.download = `${project.name}.${type === 'excel' ? 'xlsx' : 'pdf'}`;
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
            ← Progetti
          </button>
          <h1>{project?.name}</h1>
          <span className={`badge badge-${project?.status}`}>{project?.status}</span>
        </div>

        <div className="project-detail-actions">
          <div className="zoom-controls">
            {['day', 'week', 'month', 'quarter'].map((z) => (
              <button
                key={z}
                className={`filter-chip ${viewMode === z ? 'active' : ''}`}
                onClick={() => handleZoom(z)}
              >
                {z === 'day' ? 'Giorno' : z === 'week' ? 'Settimana' : z === 'month' ? 'Mese' : 'Trimestre'}
              </button>
            ))}
          </div>
          <div className="export-buttons">
            <button className="btn btn-secondary btn-sm" onClick={() => handleExport('pdf')}>
              📄 PDF
            </button>
            <button className="btn btn-secondary btn-sm" onClick={() => handleExport('excel')}>
              📊 Excel
            </button>
          </div>
        </div>
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
  );
}
