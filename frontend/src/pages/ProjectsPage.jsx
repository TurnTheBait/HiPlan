import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import './ProjectsPage.css';

export default function ProjectsPage() {
  const { user } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [filter, setFilter] = useState('all');
  const [form, setForm] = useState({ name: '', description: '', start_date: '', end_date: '' });

  useEffect(() => { loadProjects(); }, []);

  async function loadProjects() {
    try {
      const { data } = await api.get('/projects');
      setProjects(data);
    } catch { toast.error('Errore nel caricamento progetti'); }
    finally { setLoading(false); }
  }

  async function handleCreate(e) {
    e.preventDefault();
    try {
      await api.post('/projects', {
        ...form,
        start_date: form.start_date || null,
        end_date: form.end_date || null,
      });
      toast.success('Progetto creato!');
      setShowModal(false);
      setForm({ name: '', description: '', start_date: '', end_date: '' });
      loadProjects();
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Errore nella creazione');
    }
  }

  async function handleDelete(id, e) {
    e.stopPropagation();
    if (!confirm('Eliminare questo progetto e tutti i suoi dati?')) return;
    try {
      await api.delete(`/projects/${id}`);
      toast.success('Progetto eliminato');
      loadProjects();
    } catch { toast.error('Errore nell\'eliminazione'); }
  }

  const filtered = filter === 'all' ? projects : projects.filter((p) => p.status === filter);
  const canCreate = user?.role === 'admin' || user?.role === 'pm';

  if (loading) return <div className="loading-screen"><div className="spinner" /></div>;

  return (
    <div className="projects-page animate-fadeIn">
      <div className="projects-header">
        <div>
          <h1>Progetti</h1>
          <p>{projects.length} progetti totali</p>
        </div>
        {canCreate && (
          <button className="btn btn-primary" onClick={() => setShowModal(true)}>
            + Nuovo Progetto
          </button>
        )}
      </div>

      <div className="projects-filters">
        {['all', 'planning', 'active', 'completed', 'archived'].map((f) => (
          <button
            key={f}
            className={`filter-chip ${filter === f ? 'active' : ''}`}
            onClick={() => setFilter(f)}
          >
            {f === 'all' ? 'Tutti' : f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">📂</div>
          <h3>Nessun progetto trovato</h3>
          <p>{filter !== 'all' ? 'Prova a cambiare filtro' : 'Crea il tuo primo progetto'}</p>
        </div>
      ) : (
        <div className="projects-grid">
          {filtered.map((project) => (
            <div
              key={project.id}
              className="project-card card"
              onClick={() => navigate(`/projects/${project.id}`)}
            >
              <div className="project-card-header">
                <h3>{project.name}</h3>
                <span className={`badge badge-${project.status}`}>{project.status}</span>
              </div>
              {project.description && (
                <p className="project-card-desc">{project.description}</p>
              )}
              <div className="project-card-progress">
                <div className="progress-bar">
                  <div
                    className="progress-bar-fill"
                    style={{ width: `${(project.progress || 0) * 100}%` }}
                  />
                </div>
                <span className="progress-label">{Math.round((project.progress || 0) * 100)}%</span>
              </div>
              <div className="project-card-footer">
                <span>📋 {project.task_count} task</span>
                <span>👥 {project.member_count} membri</span>
                {(user?.role === 'admin' || project.owner_id === user?.id) && (
                  <button
                    className="btn-ghost btn-sm project-delete"
                    onClick={(e) => handleDelete(project.id, e)}
                  >
                    🗑
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Nuovo Progetto</h2>
              <button className="btn-ghost btn-icon" onClick={() => setShowModal(false)}>✕</button>
            </div>
            <form onSubmit={handleCreate}>
              <div className="input-group">
                <label htmlFor="project-name">Nome del progetto</label>
                <input
                  id="project-name"
                  className="input"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  required
                  placeholder="es. Lancio Prodotto Q3"
                />
              </div>
              <div className="input-group" style={{ marginTop: 16 }}>
                <label htmlFor="project-desc">Descrizione</label>
                <textarea
                  id="project-desc"
                  className="input"
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  placeholder="Breve descrizione del progetto..."
                />
              </div>
              <div style={{ display: 'flex', gap: 12, marginTop: 16 }}>
                <div className="input-group" style={{ flex: 1 }}>
                  <label htmlFor="project-start">Data inizio</label>
                  <input
                    id="project-start"
                    type="date"
                    className="input"
                    value={form.start_date}
                    onChange={(e) => setForm({ ...form, start_date: e.target.value })}
                  />
                </div>
                <div className="input-group" style={{ flex: 1 }}>
                  <label htmlFor="project-end">Data fine</label>
                  <input
                    id="project-end"
                    type="date"
                    className="input"
                    value={form.end_date}
                    onChange={(e) => setForm({ ...form, end_date: e.target.value })}
                  />
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setShowModal(false)}>
                  Annulla
                </button>
                <button type="submit" className="btn btn-primary">Crea Progetto</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
