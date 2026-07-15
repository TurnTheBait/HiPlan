import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import './ProjectsPage.css';
import { STATUS_LABELS_IT, STATUS_OPTIONS } from '../utils/statusLabels';

export default function ProjectsPage() {
  const { user } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const fileInputRef = useRef(null);
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingProject, setEditingProject] = useState(null);
  const [editForm, setEditForm] = useState({ name: '', code: '', client: '', color: '#185FA5', description: '', start_date: '', end_date: '' });
  const [filter, setFilter] = useState('all');
  const [form, setForm] = useState({ name: '', code: '', client: '', color: '#185FA5', status: 'planning', description: '', start_date: '', end_date: '' });

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
      toast.success('Commessa creata con successo!');
      setShowModal(false);
      setForm({ name: '', code: '', client: '', color: '#185FA5', status: 'planning', description: '', start_date: '', end_date: '' });
      loadProjects();
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Errore nella creazione');
    }
  }

  async function handleDelete(id, e) {
    e.stopPropagation();
    if (!confirm('Eliminare questa commessa e tutte le sue fasi di lavorazione?')) return;
    try {
      await api.delete(`/projects/${id}`);
      toast.success('Commessa eliminata');
      loadProjects();
    } catch { toast.error('Errore nell\'eliminazione'); }
  }

  function openEditProject(project, e) {
    e.stopPropagation();
    setEditingProject(project);
    setEditForm({
      name: project.name || '',
      code: project.code || '',
      client: project.client || '',
      color: project.color || '#185FA5',
      description: project.description || '',
      start_date: project.start_date || '',
      end_date: project.end_date || '',
    });
    setShowEditModal(true);
  }

  async function handleEditSubmit(e) {
    e.preventDefault();
    if (!editingProject) return;
    try {
      await api.put(`/projects/${editingProject.id}`, editForm);
      toast.success('Commessa modificata con successo!');
      setShowEditModal(false);
      loadProjects();
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Errore durante la modifica');
    }
  }

  async function handleBackupJson() {
    try {
      const { data } = await api.get('/projects/backup/json');
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const d = new Date();
      a.download = `commesse_backup_${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}.json`;
      a.click();
      window.URL.revokeObjectURL(url);
      toast.success('Backup JSON scaricato!');
    } catch {
      toast.error('Errore durante il download del backup JSON');
    }
  }

  async function handleRestoreJson(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      try {
        const payload = JSON.parse(ev.target.result);
        if (!payload.commesse || !Array.isArray(payload.commesse)) {
          throw new Error('Formato JSON commesse non valido');
        }
        await api.post('/projects/restore/json', payload);
        toast.success(`Caricate ${payload.commesse.length} commesse con successo!`);
        loadProjects();
      } catch (err) {
        toast.error('Errore nel caricamento file JSON commesse');
      }
      e.target.value = '';
    };
    reader.readAsText(file);
  }

  const filtered = filter === 'all' ? projects : projects.filter((p) => p.status === filter);
  const canCreate = user?.role === 'admin' || user?.role === 'editor';

  if (loading) return <div className="loading-screen"><div className="spinner" /></div>;

  return (
    <div className="projects-page animate-fadeIn">
      <div className="projects-header">
        <div>
          <h1>Commesse & Progetti</h1>
          <p>{projects.length} commesse gestite (Ufficio Tecnico)</p>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <button className="btn btn-secondary" style={{ width: '190px' }} onClick={handleBackupJson}>
            💾 Salva Dati (JSON)
          </button>
          {canCreate && (
            <>
              <button className="btn btn-secondary" style={{ width: '190px' }} onClick={() => fileInputRef.current?.click()}>
                📂 Carica Dati (JSON)
              </button>
              <input
                type="file"
                ref={fileInputRef}
                accept=".json"
                style={{ display: 'none' }}
                onChange={handleRestoreJson}
              />
              <button className="btn btn-primary" style={{ width: '190px' }} onClick={() => setShowModal(true)}>
                + Nuova Commessa
              </button>
            </>
          )}
        </div>
      </div>

      <div className="projects-filters">
        {['all', 'planning', 'active', 'completed', 'archived'].map((f) => (
          <button
            key={f}
            className={`filter-chip ${filter === f ? 'active' : ''}`}
            onClick={() => setFilter(f)}
          >
            {STATUS_LABELS_IT[f] || f}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">📂</div>
          <h3>Nessuna commessa trovata</h3>
          <p>{filter !== 'all' ? 'Prova a cambiare filtro' : 'Aggiungi la tua prima commessa o carica un file JSON'}</p>
        </div>
      ) : (
        <div className="projects-grid">
          {filtered.map((project) => (
            <div
              key={project.id}
              className="project-card card"
              onClick={() => navigate(`/projects/${project.id}`)}
              style={{ borderLeft: `4px solid ${project.color || '#185FA5'}` }}
            >
              <div className="project-card-header">
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontWeight: 600, color: '#64b5f6', fontSize: 13 }}>
                    {project.code || 'UT-COMM'}
                  </span>
                  <h3>{project.name}</h3>
                </div>
                <span className={`badge badge-${project.status}`}>{STATUS_LABELS_IT[project.status] || project.status}</span>
              </div>
              <div style={{ fontSize: 12, color: '#aaa', marginBottom: 6 }}>
                🏢 <strong>Cliente:</strong> {project.client || 'Non specificato'}
              </div>
              {project.description && (
                <p className="project-card-desc">{project.description}</p>
              )}
              <div className="project-card-progress">
                <div className="progress-bar">
                  <div
                    className="progress-bar-fill"
                    style={{ width: `${(project.progress || 0) * 100}%`, background: project.color || '#185FA5' }}
                  />
                </div>
                <span className="progress-label">{Math.round((project.progress || 0) * 100)}%</span>
              </div>
              <div className="project-card-footer">
                <span>📋 {project.task_count} fasi</span>
                <span>👥 {project.member_count} addetti</span>
                {(user?.role === 'admin' || project.owner_id === user?.id) && (
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button
                      className="btn-ghost btn-sm"
                      onClick={(e) => openEditProject(project, e)}
                      title="Modifica commessa (titolo, cliente, codice)"
                      style={{ fontSize: 14 }}
                    >
                      ✏️
                    </button>
                    <button
                      className="btn-ghost btn-sm project-delete"
                      onClick={(e) => handleDelete(project.id, e)}
                      title="Elimina commessa"
                    >
                      🗑
                    </button>
                  </div>
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
              <h2>Nuova Commessa Ufficio Tecnico</h2>
              <button className="btn-ghost btn-icon" onClick={() => setShowModal(false)}>✕</button>
            </div>
            <form onSubmit={handleCreate}>
              <div style={{ display: 'flex', gap: 12 }}>
                <div className="input-group" style={{ flex: 1, minWidth: 0 }}>
                  <label htmlFor="project-code">Codice Commessa *</label>
                  <input
                    id="project-code"
                    className="input"
                    value={form.code}
                    onChange={(e) => setForm({ ...form, code: e.target.value })}
                    required
                    placeholder="es. UT-2026-001"
                  />
                </div>
                <div className="input-group" style={{ flex: 2, minWidth: 0 }}>
                  <label htmlFor="project-client">Cliente *</label>
                  <input
                    id="project-client"
                    className="input"
                    value={form.client}
                    onChange={(e) => setForm({ ...form, client: e.target.value })}
                    required
                    placeholder="es. Ferrari S.p.A."
                  />
                </div>
              </div>

              <div style={{ display: 'flex', gap: 12, marginTop: 16 }}>
                <div className="input-group" style={{ flex: 2, minWidth: 0 }}>
                  <label htmlFor="project-name">Nome Progetto / Commessa *</label>
                  <input
                    id="project-name"
                    className="input"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    required
                    placeholder="es. Impianto linea automatica"
                  />
                </div>
                <div className="input-group" style={{ flex: 1.5, minWidth: 0 }}>
                  <label htmlFor="project-status">Stato Iniziale</label>
                  <select
                    id="project-status"
                    className="input"
                    value={form.status}
                    onChange={(e) => setForm({ ...form, status: e.target.value })}
                  >
                    {STATUS_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </div>
                <div className="input-group" style={{ flex: 0.8, minWidth: 0 }}>
                  <label htmlFor="project-color">Colore</label>
                  <input
                    id="project-color"
                    type="color"
                    className="input"
                    style={{ height: 38, padding: 2, flexShrink: 0 }}
                    value={form.color}
                    onChange={(e) => setForm({ ...form, color: e.target.value })}
                  />
                </div>
              </div>

              <div className="input-group" style={{ marginTop: 16 }}>
                <label htmlFor="project-desc">Note e Specifiche Tecniche</label>
                <textarea
                  id="project-desc"
                  className="input"
                  rows="2"
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  placeholder="Descrizione, note del cliente..."
                />
              </div>

              <div style={{ display: 'flex', gap: 12, marginTop: 16 }}>
                <div className="input-group" style={{ flex: 1, minWidth: 0 }}>
                  <label htmlFor="project-start">Data inizio</label>
                  <input
                    id="project-start"
                    type="date"
                    className="input"
                    value={form.start_date}
                    onChange={(e) => setForm({ ...form, start_date: e.target.value })}
                  />
                </div>
                <div className="input-group" style={{ flex: 1, minWidth: 0 }}>
                  <label htmlFor="project-end">Data fine prevista</label>
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
                <button type="submit" className="btn btn-primary">Aggiungi Commessa</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showEditModal && (
        <div className="modal-overlay" onClick={() => setShowEditModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 520 }}>
            <div className="modal-header">
              <h2>Modifica Dati Commessa</h2>
              <button className="btn-ghost btn-icon" onClick={() => setShowEditModal(false)}>✕</button>
            </div>
            <form onSubmit={handleEditSubmit}>
              <div style={{ display: 'flex', gap: 12 }}>
                <div className="input-group" style={{ flex: 1, minWidth: 0 }}>
                  <label htmlFor="card-edit-code">Codice Commessa *</label>
                  <input
                    id="card-edit-code"
                    className="input"
                    value={editForm.code}
                    onChange={(e) => setEditForm({ ...editForm, code: e.target.value })}
                    required
                    placeholder="es. UT-COMM"
                  />
                </div>
                <div className="input-group" style={{ flex: 1, minWidth: 0 }}>
                  <label htmlFor="card-edit-client">Cliente</label>
                  <input
                    id="card-edit-client"
                    className="input"
                    value={editForm.client}
                    onChange={(e) => setEditForm({ ...editForm, client: e.target.value })}
                    placeholder="es. HiWay s.r.l."
                  />
                </div>
              </div>

              <div className="input-group">
                <label htmlFor="card-edit-name">Titolo Commessa *</label>
                <input
                  id="card-edit-name"
                  className="input"
                  value={editForm.name}
                  onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                  required
                  placeholder="es. Lancio ERP e GanttFlow Q3"
                />
              </div>

              <div style={{ display: 'flex', gap: 12 }}>
                <div className="input-group" style={{ flex: 1, minWidth: 0 }}>
                  <label htmlFor="card-edit-start">Data di Inizio</label>
                  <input
                    id="card-edit-start"
                    type="date"
                    className="input"
                    value={editForm.start_date}
                    onChange={(e) => setEditForm({ ...editForm, start_date: e.target.value })}
                  />
                </div>
                <div className="input-group" style={{ flex: 1, minWidth: 0 }}>
                  <label htmlFor="card-edit-end">Data di Fine</label>
                  <input
                    id="card-edit-end"
                    type="date"
                    className="input"
                    value={editForm.end_date}
                    onChange={(e) => setEditForm({ ...editForm, end_date: e.target.value })}
                  />
                </div>
              </div>

              <div style={{ display: 'flex', gap: 12 }}>
                <div className="input-group" style={{ flex: 1, minWidth: 0 }}>
                  <label htmlFor="card-edit-color">Colore Identificativo</label>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <input
                      id="card-edit-color"
                      type="color"
                      value={editForm.color}
                      onChange={(e) => setEditForm({ ...editForm, color: e.target.value })}
                      style={{ width: 44, height: 38, padding: 2, borderRadius: 6, border: '1px solid var(--border-color)', background: 'var(--bg-primary)', cursor: 'pointer', flexShrink: 0 }}
                    />
                    <input
                      className="input"
                      value={editForm.color}
                      onChange={(e) => setEditForm({ ...editForm, color: e.target.value })}
                      placeholder="#185FA5"
                      style={{ flex: 1, minWidth: 0 }}
                    />
                  </div>
                </div>
              </div>

              <div className="input-group">
                <label htmlFor="card-edit-desc">Descrizione / Note</label>
                <textarea
                  id="card-edit-desc"
                  className="input"
                  rows={3}
                  value={editForm.description}
                  onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                  placeholder="Dettagli e obiettivo della commessa..."
                  style={{ resize: 'vertical' }}
                />
              </div>

              <div className="modal-actions" style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 20 }}>
                <button type="button" className="btn btn-secondary" onClick={() => setShowEditModal(false)}>
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

