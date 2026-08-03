import { useState, useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import AppIcon from '../components/ui/AppIcon';
import './TodoPage.css';

const BACKEND_URL = import.meta.env.VITE_API_URL
  ? import.meta.env.VITE_API_URL.replace(/\/api\/?$/, '')
  : `http://${window.location.hostname}:8000`;

function formatDate(dateStr) {
  if (!dateStr) return null;
  const d = dateStr.includes('T') ? new Date(dateStr) : new Date(dateStr + 'T00:00:00');
  return d.toLocaleString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).replace(',', '');
}

function getDueDaysLeft(dateStr) {
  if (!dateStr) return null;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const due = dateStr.includes('T') ? new Date(dateStr) : new Date(dateStr + 'T00:00:00');
  due.setHours(0, 0, 0, 0);
  return Math.ceil((due - today) / 86400000);
}

export default function TodoPage() {
  const { user } = useAuth();
  const toast = useToast();

  const [todos, setTodos] = useState([]);
  const [allUsers, setAllUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('open');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(null);

  // Modal
  const [showModal, setShowModal] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const fileInputRef = useRef(null);
  const modalFileRef = useRef(null);
  const dropZoneRef = useRef(null);

  // Pending attachments in modal (uploaded after creation)
  const [pendingFiles, setPendingFiles] = useState([]);

  const emptyForm = {
    title: '',
    content: '',
    notify_date: '',
    due_date: '',
    assignees: [],
    notify_email: true,
  };
  const [form, setForm] = useState(emptyForm);

  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    loadTodos();
    loadUsers();
  }, []);

  useEffect(() => {
    if (todos.length > 0) {
      const params = new URLSearchParams(location.search);
      const todoId = params.get('todoId');
      if (todoId) {
        const targetTodo = todos.find(t => String(t.id) === todoId);
        if (targetTodo) {
          setSelected(targetTodo);
          openEdit(targetTodo);
          if (targetTodo.is_completed) {
            setFilter('completed');
          } else {
            setFilter('open');
          }
        }
        params.delete('todoId');
        navigate({ search: params.toString() }, { replace: true });
      }
    }
  }, [location.search, todos, navigate]);

  async function loadTodos() {
    setLoading(true);
    try {
      const { data } = await api.get('/todos');
      setTodos(data);
      if (selected) {
        const refreshed = data.find(t => t.id === selected.id);
        setSelected(refreshed || null);
      }
    } catch {
      toast.error('Errore nel caricamento dei TODO');
    } finally {
      setLoading(false);
    }
  }

  async function loadUsers() {
    try {
      const { data } = await api.get('/users');
      setAllUsers(data);
    } catch { /* ignore */ }
  }

  // Sorted users: current user first, then alphabetical by full_name/username
  const sortedUsers = [...allUsers].sort((a, b) => {
    if (a.id === user?.id) return -1;
    if (b.id === user?.id) return 1;
    const nameA = (a.full_name || a.username).toLowerCase();
    const nameB = (b.full_name || b.username).toLowerCase();
    return nameA.localeCompare(nameB);
  });

  // ---- Filtering ----
  const filtered = todos.filter(t => {
    if (filter === 'mine' && t.creator_id !== user?.id) return false;
    if (filter === 'assigned' && !t.assignees.includes(user?.id)) return false;
    if (filter === 'open' && t.is_completed) return false;
    if (filter === 'completed' && !t.is_completed) return false;
    if (search) {
      const q = search.toLowerCase();
      if (!t.title.toLowerCase().includes(q) && !(t.content || '').toLowerCase().includes(q)) return false;
    }
    return true;
  });

  // ---- Create / Edit ----
  function openCreate() {
    setEditMode(false);
    setPendingFiles([]);
    setForm({ ...emptyForm, assignees: [user?.id] });
    setShowModal(true);
  }

  function openEdit(todo) {
    setEditMode(true);
    setPendingFiles([]);
    setForm({
      title: todo.title || '',
      content: todo.content || '',
      notify_date: todo.notify_date || '',
      due_date: todo.due_date || '',
      assignees: todo.assignees || [],
      notify_email: todo.notify_email !== undefined ? todo.notify_email : true,
    });
    setSelected(todo);
    setShowModal(true);
  }

  function closeModal() {
    setShowModal(false);
    setPendingFiles([]);
  }

  async function saveTodo() {
    if (!form.title.trim()) {
      toast.error('Il titolo è obbligatorio');
      return;
    }
    setSaving(true);
    try {
      let savedTodo;
      const payload = {
        ...form,
        notify_date: form.notify_date || null,
        due_date: form.due_date || null,
        notify_email: !!(form.notify_date && form.due_date),
      };

      if (editMode && selected) {
        const { data } = await api.patch(`/todos/${selected.id}`, payload);
        savedTodo = data;
        toast.success('TODO aggiornato');
        setSelected(data);
      } else {
        const { data } = await api.post('/todos', payload);
        savedTodo = data;
        toast.success('TODO creato');
      }

      // Upload pending files after creation/update
      if (pendingFiles.length > 0 && savedTodo?.id) {
        for (const file of pendingFiles) {
          const fd = new FormData();
          fd.append('file', file);
          try {
            await api.post(`/todos/${savedTodo.id}/attachments`, fd, {
              headers: { 'Content-Type': 'multipart/form-data' },
            });
          } catch {
            toast.error(`Errore caricamento allegato: ${file.name}`);
          }
        }
      }

      closeModal();
      await loadTodos();
    } catch (e) {
      const detail = e?.response?.data?.detail;
      toast.error(typeof detail === 'string' ? detail : 'Errore nel salvataggio');
    } finally {
      setSaving(false);
    }
  }

  const canEdit = (todo) => user?.id === todo.creator_id || user?.role === 'admin';

  async function toggleComplete(todo, e) {
    e?.stopPropagation();
    if (!canEdit(todo)) {
      toast.error('Solo il creatore può modificare lo stato del TODO');
      return;
    }
    try {
      const { data } = await api.patch(`/todos/${todo.id}`, { is_completed: !todo.is_completed });
      setTodos(prev => prev.map(t => t.id === todo.id ? data : t));
      if (selected?.id === todo.id) setSelected(data);
      toast.success(data.is_completed ? 'TODO completato' : 'TODO riaperto');
    } catch (err) {
      toast.error(err?.response?.data?.detail || 'Errore aggiornamento stato');
    }
  }

  async function deleteTodo(todo, e) {
    e?.stopPropagation();
    if (!confirm(`Eliminare "${todo.title}"?`)) return;
    try {
      await api.delete(`/todos/${todo.id}`);
      toast.success('TODO eliminato');
      if (selected?.id === todo.id) setSelected(null);
      setTodos(prev => prev.filter(t => t.id !== todo.id));
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Errore eliminazione');
    }
  }

  async function uploadAttachment(file, todoId) {
    const fd = new FormData();
    fd.append('file', file);
    try {
      await api.post(`/todos/${todoId}/attachments`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      toast.success('Allegato caricato');
      await loadTodos();
    } catch {
      toast.error('Errore caricamento allegato');
    }
  }

  async function removeAttachment(filename, e) {
    e?.stopPropagation();
    try {
      await api.delete(`/todos/${selected.id}/attachments/${encodeURIComponent(filename)}`);
      toast.success('Allegato rimosso');
      await loadTodos();
    } catch {
      toast.error('Errore rimozione allegato');
    }
  }

  // Pending files management in modal
  function addPendingFile(file) {
    setPendingFiles(prev => [...prev, file]);
  }

  function removePendingFile(idx) {
    setPendingFiles(prev => prev.filter((_, i) => i !== idx));
  }

  function toggleAssignee(uid) {
    setForm(prev => {
      const already = prev.assignees.includes(uid);
      return {
        ...prev,
        assignees: already
          ? prev.assignees.filter(id => id !== uid)
          : [...prev.assignees, uid],
      };
    });
  }

  // Drag & drop in modal
  function handleModalDrop(e) {
    e.preventDefault();
    setDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    files.forEach(addPendingFile);
  }

  // Drag & drop on detail panel
  function handleDetailDrop(e) {
    e.preventDefault();
    if (!selected) return;
    const files = Array.from(e.dataTransfer.files);
    files.forEach(f => uploadAttachment(f, selected.id));
  }

  const canDelete = (todo) => user?.id === todo.creator_id || user?.role === 'admin';

  const openCount = todos.filter(t => !t.is_completed).length;
  const completedCount = todos.filter(t => t.is_completed).length;

  return (
    <div className="todo-page-wrapper animate-fadeIn">
      <div className="todo-body">
        {/* Sidebar Filters */}
        <aside className="todo-sidebar">
          <button className="btn btn-primary sidebar-create-btn" onClick={openCreate}>
            <AppIcon name="plus" />
            Nuovo TODO
          </button>
          <span className="todo-sidebar-section-title">Vista</span>
          {[
            { key: 'all', icon: 'list', label: 'Tutti', count: todos.length },
            { key: 'open', icon: 'clock', label: 'Aperti', count: openCount },
            { key: 'completed', icon: 'check', label: 'Completati', count: completedCount },
          ].map(f => (
            <button
              key={f.key}
              className={`todo-filter-btn ${filter === f.key ? 'active' : ''}`}
              onClick={() => setFilter(f.key)}
            >
              <span className="filter-label"><AppIcon name={f.icon} size={16} />{f.label}</span>
              <span style={{ marginLeft: 'auto', fontSize: '0.72rem', opacity: 0.7 }}>{f.count}</span>
            </button>
          ))}

          <span className="todo-sidebar-section-title" style={{ marginTop: 16 }}>Ruolo</span>
          {[
            { key: 'mine', icon: 'user', label: 'Creati da me' },
            { key: 'assigned', icon: 'users', label: 'Assegnati a me' },
          ].map(f => (
            <button
              key={f.key}
              className={`todo-filter-btn ${filter === f.key ? 'active' : ''}`}
              onClick={() => setFilter(prev => prev === f.key ? 'all' : f.key)}
            >
              <span className="filter-label"><AppIcon name={f.icon} size={16} />{f.label}</span>
            </button>
          ))}
        </aside>

        {/* Main */}
        <div className="todo-main">
          <div className="todo-main-toolbar">
            <input
              className="todo-search"
              type="text"
              placeholder="Cerca TODO..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
              {filtered.length} risultat{filtered.length === 1 ? 'o' : 'i'}
            </span>
          </div>

          <div className="todo-list">
            {loading && (
              <div className="todo-empty">
                <div className="spinner" />
                <p>Caricamento...</p>
              </div>
            )}
            {!loading && filtered.length === 0 && (
              <div className="todo-empty">
                <div className="todo-empty-icon"><AppIcon name="todo" size={28} /></div>
                <p>Nessun TODO trovato</p>
                <button className="btn btn-primary btn-sm" onClick={openCreate}>
                  Crea il primo TODO
                </button>
              </div>
            )}
            {!loading && filtered.map(todo => {
              const daysLeft = getDueDaysLeft(todo.due_date);
              const isOverdue = daysLeft !== null && daysLeft < 0 && !todo.is_completed;
              const isWarning = daysLeft !== null && daysLeft >= 0 && daysLeft <= 1 && !todo.is_completed;

              return (
                <div
                  key={todo.id}
                  className={`todo-card ${todo.is_completed ? 'completed' : ''} ${selected?.id === todo.id ? 'selected' : ''}`}
                  onClick={() => setSelected(prev => prev?.id === todo.id ? null : todo)}
                >
                  <button
                    className={`todo-card-checkbox ${todo.is_completed ? 'checked' : ''}`}
                    onClick={e => toggleComplete(todo, e)}
                    title={todo.is_completed ? 'Segna come aperto' : 'Segna come completato'}
                  >
                    {todo.is_completed && '✓'}
                  </button>

                  <div className="todo-card-body" style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
                    <div className="todo-card-title" style={{ margin: 0, flex: 1 }}>{todo.title}</div>
                    <div className="todo-card-meta" style={{ marginTop: 0, flexShrink: 0 }}>
                      {todo.due_date && (
                        <span className={`todo-meta-badge due-badge ${isOverdue || isWarning ? 'due-warning' : ''}`}>
                          {isOverdue || isWarning
                            ? <AppIcon name="alert" size={14} />
                            : <AppIcon name="calendar" size={14} />}
                          {formatDate(todo.due_date)}
                          {daysLeft !== null && !todo.is_completed && (
                            daysLeft === 0 ? ' · Oggi!' :
                              daysLeft === 1 ? ' · Domani' :
                                daysLeft < 0 ? ` · ${Math.abs(daysLeft)}g scaduto` :
                                  ` · ${daysLeft}g`
                          )}
                        </span>
                      )}
                      {todo.notify_date && (
                        <span className="todo-meta-badge notify-badge">
                          <AppIcon name="bell" size={14} />
                          {formatDate(todo.notify_date)}
                        </span>
                      )}
                      {todo.notify_email && (
                        <span className="todo-meta-badge email-badge"><AppIcon name="mail" size={14} /> Mail</span>
                      )}
                      {todo.assignees_detail?.length > 0 && (
                        <span className="todo-meta-badge assignee-badge">
                          <AppIcon name="users" size={14} />
                          {todo.assignees_detail.length}
                        </span>
                      )}
                      {todo.attachments?.length > 0 && (
                        <span className="todo-meta-badge assignee-badge">
                          <AppIcon name="paperclip" size={14} />
                          {todo.attachments.length}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="todo-card-actions">
                    {canEdit(todo) && (
                      <button
                        className="todo-card-btn"
                        onClick={e => { e.stopPropagation(); openEdit(todo); }}
                        title="Modifica"
                      ><AppIcon name="edit" size={15} /></button>
                    )}
                    {canDelete(todo) && (
                      <button
                        className="todo-card-btn delete"
                        onClick={e => deleteTodo(todo, e)}
                        title="Elimina"
                      ><AppIcon name="trash" size={15} /></button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Detail Panel */}
        {selected && (
          <div
            className="todo-detail-panel"
            onDragOver={e => e.preventDefault()}
            onDrop={handleDetailDrop}
          >
            <div className="todo-detail-header">
              <h3 className="todo-detail-title">{selected.title}</h3>
              <button
                className={`todo-status-toggle ${selected.is_completed ? 'completed' : 'open'}`}
                onClick={e => toggleComplete(selected, e)}
              >
                <span className={`status-dot ${selected.is_completed ? 'completed' : 'open'}`} />
                {selected.is_completed ? 'Completato' : 'Aperto'}
              </button>
            </div>
            <div className="todo-detail-body">
              {selected.content && (
                <div>
                  <div className="todo-detail-section-label"><AppIcon name="notes" size={13} />Contenuto</div>
                  <div className="todo-detail-content">{selected.content}</div>
                </div>
              )}

              <div>
                <div className="todo-detail-section-label"><AppIcon name="calendar" size={13} />Date</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {selected.notify_date && (
                    <span className="todo-detail-date-row">
                      <AppIcon name="bell" size={13} /> Data notifica: <strong>{formatDate(selected.notify_date)}</strong>
                    </span>
                  )}
                  {selected.due_date && (
                    <span className="todo-detail-date-row">
                      <AppIcon name="calendar" size={13} /> Scadenza: <strong>{formatDate(selected.due_date)}</strong>
                    </span>
                  )}
                  {!selected.notify_date && !selected.due_date && (
                    <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>Nessuna data</span>
                  )}
                </div>
              </div>

              <div>
                <div className="todo-detail-section-label"><AppIcon name="users" size={13} />Assegnati</div>
                <div className="todo-detail-assignee-chips">
                  {(selected.assignees_detail || []).map(a => (
                    <span key={a.id} className="todo-detail-assignee-chip">
                      <span style={{
                        width: 20, height: 20, borderRadius: '50%',
                        background: 'var(--accent-500, #185FA5)', color: 'white',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: '0.65rem', fontWeight: 700, flexShrink: 0
                      }}>
                        {a.username?.[0]?.toUpperCase()}
                      </span>
                      {a.full_name || a.username}
                      {a.id === selected.creator_id && <span className="todo-creator-label">Creatore</span>}
                    </span>
                  ))}
                </div>
              </div>

              {selected.notify_email && (
                <div>
                  <div className="todo-detail-section-label"><AppIcon name="mail" size={13} />Notifiche email</div>
                  <div className="todo-detail-section-value" style={{ fontSize: '0.82rem', color: '#10b981' }}>
                    Notifiche email attive — le notifiche di base (notifica e scadenza) verranno inviate anche via email.
                  </div>
                </div>
              )}

              <div>
                <div className="todo-detail-section-label"><AppIcon name="paperclip" size={13} />Allegati</div>
                {(selected.attachments || []).length === 0 && (
                  <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>Nessun allegato. Trascina qui i file o usa il pulsante.</span>
                )}
                <div className="todo-attachment-list">
                  {(selected.attachments || []).map(att => (
                    <div key={att.filename} className="todo-attachment-item">
                      <a
                        className="todo-attachment-name"
                        href={`${BACKEND_URL}${att.url}`}
                        target="_blank"
                        rel="noreferrer"
                        onClick={e => e.stopPropagation()}
                      >
                        <AppIcon name="paperclip" size={13} />{att.filename}
                      </a>
                      {canDelete(selected) && (
                        <button
                          className="todo-attachment-del"
                          onClick={e => removeAttachment(att.filename, e)}
                          aria-label="Rimuovi allegato"
                        ><AppIcon name="close" size={13} /></button>
                      )}
                    </div>
                  ))}
                </div>
                {canEdit(selected) && (
                  <>
                    <input
                      type="file"
                      ref={fileInputRef}
                      style={{ display: 'none' }}
                      onChange={e => { if (e.target.files[0]) uploadAttachment(e.target.files[0], selected.id); e.target.value = ''; }}
                    />
                    <button
                      className="todo-upload-btn"
                      style={{ marginTop: 8 }}
                      onClick={() => fileInputRef.current?.click()}
                    >
                      + Aggiungi allegato (o trascina qui)
                    </button>
                  </>
                )}
              </div>

              <div style={{ marginTop: 'auto', paddingTop: 12, borderTop: '1px solid var(--border-subtle)' }}>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  Creato da <strong>{selected.creator_full_name || selected.creator_username}</strong>
                  {selected.created_at && ` · ${new Date(selected.created_at).toLocaleDateString('it-IT')}`}
                </span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Create / Edit Modal */}
      {showModal && (
        <div className="todo-modal-overlay">
          <div
            className={`todo-modal ${dragOver ? 'drag-over' : ''}`}
            onClick={e => e.stopPropagation()}
            onDragOver={e => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={e => {
              e.preventDefault();
              setDragOver(false);
              Array.from(e.dataTransfer.files).forEach(addPendingFile);
            }}
          >
            <div className="todo-modal-header">
              <h2>{editMode ? 'Modifica TODO' : 'Nuovo TODO'}</h2>
              <button className="todo-modal-close" onClick={closeModal} aria-label="Chiudi">
                <AppIcon name="close" />
              </button>
            </div>

            <div className="todo-modal-body">
              {/* Titolo */}
              <div className="todo-form-group">
                <label className="todo-form-label">Titolo *</label>
                <input
                  className="todo-form-input"
                  type="text"
                  placeholder="Descrivi brevemente il TODO..."
                  value={form.title}
                  onChange={e => setForm(p => ({ ...p, title: e.target.value }))}
                  autoFocus
                />
              </div>

              {/* Contenuto */}
              <div className="todo-form-group">
                <label className="todo-form-label">Descrizione</label>
                <textarea
                  className="todo-form-input"
                  placeholder="Aggiungi dettagli, link, istruzioni..."
                  value={form.content}
                  onChange={e => setForm(p => ({ ...p, content: e.target.value }))}
                />
              </div>

              {/* Allegati nel modal */}
              <div className="todo-form-group">
                <label className="todo-form-label"><AppIcon name="paperclip" size={13} />Allegati{pendingFiles.length > 0 ? ` (${pendingFiles.length})` : ''}</label>
                <div
                  ref={dropZoneRef}
                  className={`todo-modal-dropzone ${dragOver ? 'active' : ''}`}
                  onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                  onDragLeave={(e) => {
                    if (!e.currentTarget.contains(e.relatedTarget)) setDragOver(false);
                  }}
                  onDrop={handleModalDrop}
                >
                  <span className="inline-detail-row" style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                    <AppIcon name="folder" size={15} />
                    {dragOver ? 'Rilascia i file qui' : 'Trascina i file qui oppure'}
                  </span>
                  {!dragOver && (
                    <>
                      <input
                        type="file"
                        ref={modalFileRef}
                        style={{ display: 'none' }}
                        multiple
                        onChange={e => { Array.from(e.target.files).forEach(addPendingFile); e.target.value = ''; }}
                      />
                      <button
                        type="button"
                        className="todo-upload-btn"
                        style={{ width: 'auto', padding: '6px 14px' }}
                        onClick={() => modalFileRef.current?.click()}
                      >
                        <AppIcon name="plus" size={14} />
                        Seleziona file
                      </button>
                    </>
                  )}
                </div>
                {pendingFiles.length > 0 && (
                  <div className="todo-attachment-list" style={{ marginTop: 6 }}>
                    {pendingFiles.map((f, i) => (
                      <div key={i} className="todo-attachment-item">
                        <span className="todo-attachment-name"><AppIcon name="paperclip" size={13} />{f.name}</span>
                        <button className="todo-attachment-del" onClick={() => removePendingFile(i)} aria-label="Rimuovi allegato">
                          <AppIcon name="close" size={13} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Date */}
              <div className="todo-form-row">
                <div className="todo-form-group">
                  <label className="todo-form-label"><AppIcon name="bell" size={13} />Data e ora notifica</label>
                  <input
                    className="todo-form-input"
                    type="datetime-local"
                    value={form.notify_date ? form.notify_date.substring(0, 16) : ''}
                    onChange={e => {
                      let v = e.target.value;
                      if (v && !form.notify_date && v.endsWith('00:00')) {
                        v = v.replace('00:00', '08:00');
                      }
                      setForm(p => ({ ...p, notify_date: v }));
                    }}
                  />
                </div>
                <div className="todo-form-group">
                  <label className="todo-form-label"><AppIcon name="calendar" size={13} />Data e ora scadenza</label>
                  <input
                    className="todo-form-input"
                    type="datetime-local"
                    value={form.due_date ? form.due_date.substring(0, 16) : ''}
                    onChange={e => {
                      let v = e.target.value;
                      if (v && !form.due_date && v.endsWith('00:00')) {
                        v = v.replace('00:00', '18:00');
                      }
                      setForm(p => ({ ...p, due_date: v }));
                    }}
                  />

                </div>

              </div>

              {/* Assegnati */}
              <div className="todo-form-group">
                <label className="todo-form-label">
                  <AppIcon name="users" size={13} />
                  Assegnati ({form.assignees.length})
                  {form.assignees.length === 0 && (
                    <span style={{ color: '#ef4444', fontWeight: 400, marginLeft: 6 }}>
                      — Nessun assegnato
                    </span>
                  )}
                </label>
                <div className="todo-assignee-list">
                  {sortedUsers.map(u => {
                    const isSelected = form.assignees.includes(u.id);
                    const isCurrentUser = u.id === user?.id;
                    return (
                      <div
                        key={u.id}
                        className={`todo-assignee-item ${isSelected ? 'selected' : ''}`}
                        onClick={() => toggleAssignee(u.id)}
                      >
                        <div className="todo-assignee-avatar">
                          {u.username?.[0]?.toUpperCase()}
                        </div>
                        <div style={{ flex: 1 }}>
                          <div className="todo-assignee-name">{u.full_name || u.username}</div>
                          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                            {isCurrentUser ? 'Tu' : u.username}
                          </div>
                        </div>
                        {isSelected && <span className="todo-assignee-check">✓</span>}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="todo-modal-footer">
              <button className="btn btn-ghost" onClick={closeModal}>
                Annulla
              </button>
              <button
                className="btn btn-primary"
                onClick={saveTodo}
                disabled={saving}
              >
                {saving ? 'Salvataggio...' : editMode ? 'Aggiorna' : 'Crea TODO'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
