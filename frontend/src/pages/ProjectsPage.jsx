import { useState, useEffect, useRef, useMemo } from 'react';
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
  const [projects, setProjects] = useState([]);
  const [usersList, setUsersList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingProject, setEditingProject] = useState(null);
  const [editForm, setEditForm] = useState({ name: '', code: '', client: '', color: '#185FA5', description: '', start_date: '', end_date: '', responsible_id: '', assigned_workers: [] });
  const [filter, setFilter] = useState('my_projects');
  const [searchQuery, setSearchQuery] = useState('');
  const [form, setForm] = useState({ name: '', code: '', client: '', color: '#185FA5', status: 'planning', description: '', start_date: '', end_date: '', responsible_id: '', assigned_workers: [] });
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [exportFormat, setExportFormat] = useState('pdf');
  const exportMenuRef = useRef(null);

  useEffect(() => {
    function handleClickOutside(e) {
      if (exportMenuRef.current && !exportMenuRef.current.contains(e.target)) {
        setShowExportMenu(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    loadProjects();
    loadUsers();
  }, []);

  async function loadUsers() {
    try {
      const { data } = await api.get('/users');
      if (Array.isArray(data)) setUsersList(data);
    } catch { }
  }

  async function loadProjects() {
    setLoading(true);
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
        responsible_id: form.responsible_id || user?.id || null,
      });
      toast.success('Commessa creata con successo!');
      setShowModal(false);
      setForm({ name: '', code: '', client: '', color: '#185FA5', status: 'planning', description: '', start_date: '', end_date: '', responsible_id: '', assigned_workers: [] });
      loadProjects();
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Errore nella creazione');
    }
  }

  async function handleDelete(id, e) {
    e.stopPropagation();
    if (!window.confirm('Confermi l\'eliminazione definitiva di questa commessa e di tutte le sue fasi di lavorazione?')) return;
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
      responsible_id: project.responsible_id || '',
      assigned_workers: Array.isArray(project.assigned_workers) ? [...project.assigned_workers] : [],
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


  const filtered = useMemo(() => {
    let list = projects;
    if (filter === 'my_projects') {
      list = list.filter(p => p.is_assigned);
    } else if (filter !== 'all') {
      list = list.filter(p => p.status === filter);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(p =>
        (p.name && p.name.toLowerCase().includes(q)) ||
        (p.code && p.code.toLowerCase().includes(q)) ||
        (p.client && p.client.toLowerCase().includes(q)) ||
        (p.responsible_name && p.responsible_name.toLowerCase().includes(q)) ||
        (p.responsible_username && p.responsible_username.toLowerCase().includes(q))
      );
    }
    return list;
  }, [projects, filter, searchQuery]);

  const canCreate = user?.role === 'admin' || user?.role === 'editor';

  async function handleExportFiltered(format) {
    if (filtered.length === 0) return toast.info("Nessuna commessa da esportare");
    const project_ids = filtered.map(p => p.id);
    
    try {
      const res = await api.post(`/projects/export-list/${format}`, { project_ids }, { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `elenco_commesse.${format === 'excel' ? 'xlsx' : 'pdf'}`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      setShowExportMenu(false);
    } catch {
      toast.error('Errore durante l\'esportazione');
    }
  }

  function toggleWorkerSelection(username, isEdit = false) {
    if (isEdit) {
      const current = editForm.assigned_workers || [];
      const updated = current.includes(username) ? current.filter(w => w !== username) : [...current, username];
      setEditForm({ ...editForm, assigned_workers: updated });
    } else {
      const current = form.assigned_workers || [];
      const updated = current.includes(username) ? current.filter(w => w !== username) : [...current, username];
      setForm({ ...form, assigned_workers: updated });
    }
  }

  if (loading) return <div className="loading-screen"><div className="spinner" /></div>;

  return (
    <div className="projects-page animate-fadeIn">
      <div className="projects-header">
        <div>
          <h1>Commesse & Progetti</h1>
          <p>{filtered.length} commesse</p>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <div style={{ position: 'relative' }} ref={exportMenuRef}>
            <button 
              className="btn btn-primary" 
              style={{ display: 'flex', alignItems: 'center', gap: 6 }} 
              onClick={() => setShowExportMenu(!showExportMenu)}
            >
              📥 Stampa / Export ▾
            </button>
            {showExportMenu && (
              <div style={{
                position: 'absolute', top: '100%', right: 0, marginTop: 6,
                background: 'var(--bg-card)', border: '1px solid var(--border-default)',
                borderRadius: 10, padding: 16, zIndex: 300, minWidth: 260,
                boxShadow: '0 8px 32px rgba(0,0,0,0.2)', textAlign: 'left'
              }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Formato:
                </div>
                <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
                  <label style={{
                    flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                    padding: '8px 12px', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: 600,
                    background: exportFormat === 'pdf' ? 'rgba(239, 68, 68, 0.15)' : 'var(--bg-tertiary)',
                    border: exportFormat === 'pdf' ? '2px solid #ef4444' : '1px solid var(--border-default)',
                    color: exportFormat === 'pdf' ? '#ef4444' : 'var(--text-secondary)',
                    transition: 'all 0.2s ease'
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
                    transition: 'all 0.2s ease'
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
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <button className="btn btn-secondary" onClick={() => setShowExportMenu(false)}>Annulla</button>
                  <button className="btn btn-primary" onClick={() => handleExportFiltered(exportFormat)}>Export {exportFormat.toUpperCase()}</button>
                </div>
              </div>
            )}
          </div>
          {canCreate && (
            <button className="btn btn-primary" style={{ width: '190px' }} onClick={() => setShowModal(true)}>
              + Nuova Commessa
            </button>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16, marginBottom: 16 }}>
        <div className="projects-filters" style={{ marginBottom: 0 }}>
          {['my_projects', 'all', 'planning', 'active', 'completed', 'archived'].map((f) => (
            <button
              key={f}
              className={`filter-chip ${filter === f ? 'active' : ''}`}
              onClick={() => setFilter(f)}
            >
              {STATUS_LABELS_IT[f] || f}
            </button>
          ))}
        </div>

        {/* BARRA DI RICERCA CON ICONA HIWAY */}
        <div className="hiway-search-bar" style={{ position: 'relative', display: 'flex', alignItems: 'center', minWidth: 260, flex: '1 1 280px', maxWidth: 400 }}>
          <img
            src="/hiway-icon.png"
            alt="HiWay"
            title="Cerca in HiWay GanttFlow"
            style={{ position: 'absolute', left: 12, width: 20, height: 20, objectFit: 'contain', pointerEvents: 'none' }}
          />
          <input
            type="text"
            className="input"
            style={{ width: '100%', paddingLeft: 40, paddingRight: 32, borderRadius: 20, background: 'var(--bg-secondary)', border: '1px solid var(--border-default)' }}
            placeholder="Cerca commessa, cliente o responsabile..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              style={{ position: 'absolute', right: 10, background: 'none', border: 'none', color: 'var(--text-tertiary)', cursor: 'pointer', fontSize: 14 }}
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">{filter === 'my_projects' ? '👤' : '📂'}</div>
          <h3>{filter === 'my_projects' ? 'Nessuna commessa assegnata a te' : 'Nessuna commessa trovata'}</h3>
          <p>{filter === 'my_projects' ? 'Non risulti ancora Responsabile o Addetto di alcuna commessa o fase.' : (filter !== 'all' ? 'Prova a cambiare filtro' : 'Aggiungi la tua prima commessa o carica un file JSON')}</p>
          {filter === 'my_projects' && (
            <button className="btn btn-secondary" style={{ marginTop: 16 }} onClick={() => setFilter('all')}>
              📋 Vedi Tutte le Commesse
            </button>
          )}
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
                  <h3>{project.name || project.code || 'Senza Titolo'}</h3>
                </div>
                <span className={`badge badge-${project.status}`}>{STATUS_LABELS_IT[project.status] || project.status}</span>
              </div>
              <div style={{ fontSize: 12, color: '#aaa', marginBottom: 4 }}>
                🏢 <strong>Cliente:</strong> {project.client || 'Non specificato'}
              </div>
              <div style={{ fontSize: 12, color: '#bbb', marginBottom: 4 }}>
                👤 <strong>Responsabile:</strong> {project.responsible_name || project.responsible_username || (project.owner_id === user?.id ? user?.username : 'Non specificato')}
              </div>
              <div style={{ fontSize: 12, color: '#bbb', marginBottom: 6 }}>
                👥 <strong>Addetti Commessa:</strong> {project.assigned_workers?.length > 0 ? project.assigned_workers.join(', ') : 'Vedi fasi'}
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
                <span>👥 {project.member_count} totali</span>
                {(user?.role === 'admin' || user?.role === 'editor' || project.owner_id === user?.id || project.responsible_id === user?.id || project.responsible_username === user?.username) && (
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button
                      className="btn-ghost btn-sm"
                      onClick={(e) => openEditProject(project, e)}
                      title="Modifica commessa (titolo, cliente, codice, responsabile, addetti)"
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
              <h2>Nuova Commessa</h2>
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
                  <label htmlFor="project-name">Nome Progetto / Commessa</label>
                  <input
                    id="project-name"
                    className="input"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
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

              <div style={{ display: 'flex', gap: 12, marginTop: 16 }}>
                <div className="input-group" style={{ flex: 1, minWidth: 0 }}>
                  <label htmlFor="project-responsible">Responsabile di Commessa</label>
                  <select
                    id="project-responsible"
                    className="input"
                    value={form.responsible_id || ''}
                    onChange={(e) => setForm({ ...form, responsible_id: e.target.value })}
                  >
                    <option value="">-- Seleziona (Default: Tu) --</option>
                    {usersList.map(u => (
                      <option key={u.id} value={u.id}>{u.full_name || u.username} ({u.username})</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="input-group" style={{ marginTop: 16 }}>
                <label>Addetti della Commessa (Multi-selezione)</label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 6 }}>
                  {usersList.map(u => {
                    const selected = (form.assigned_workers || []).includes(u.username);
                    return (
                      <button
                        key={u.id}
                        type="button"
                        onClick={() => toggleWorkerSelection(u.username, false)}
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
          <div className="modal" onClick={(e) => e.stopPropagation()}>
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
                  placeholder="es. Lancio ERP e HiPlan Q3"
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
                <label htmlFor="card-edit-responsible">Responsabile di Commessa</label>
                <select
                  id="card-edit-responsible"
                  className="input"
                  value={editForm.responsible_id || ''}
                  onChange={(e) => setEditForm({ ...editForm, responsible_id: e.target.value })}
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
                    const selected = (editForm.assigned_workers || []).includes(u.username);
                    return (
                      <button
                        key={u.id}
                        type="button"
                        onClick={() => toggleWorkerSelection(u.username, true)}
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

