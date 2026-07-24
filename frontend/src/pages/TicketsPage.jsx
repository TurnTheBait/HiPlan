import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import './TicketsPage.css';

const BACKEND_URL = import.meta.env.VITE_API_URL
  ? import.meta.env.VITE_API_URL.replace(/\/api\/?$/, '')
  : `http://${window.location.hostname}:8000`;

/* ─── helpers ─── */
const PRIORITY_ICON = { low: '🔵', medium: '🟡', high: '🔴' };
const PRIORITY_LABEL = { low: 'Bassa', medium: 'Media', high: 'Alta' };
const STATUS_CLASS = {
  'Da gestire': 'da-gestire',
  'In attesa del cliente': 'in-attesa',
  'In elaborazione': 'in-elaborazione',
  'Completato': 'completato'
};

function fmtDate(dt) {
  if (!dt) return '';
  return new Date(dt).toLocaleDateString('it-IT', { day: '2-digit', month: 'short', year: 'numeric' });
}

function fmtDateTime(dt) {
  if (!dt) return '';
  return new Date(dt).toLocaleString('it-IT', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

const AVATAR_COLORS = ['#6366f1', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981', '#3b82f6', '#e11d48', '#0891b2'];

function avatarColor(name) {
  return AVATAR_COLORS[(name || '?').charCodeAt(0) % AVATAR_COLORS.length];
}

function Av({ name, size = 32 }) {
  return (
    <div
      className="ticket-avatar"
      style={{ width: size, height: size, background: avatarColor(name), fontSize: size * 0.38 + 'px' }}
    >
      {(name || '?')[0].toUpperCase()}
    </div>
  );
}

/* ─── Assignee tag input ─── */
function AssigneeInput({ selected, onChange, users }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const inputRef = useRef(null);

  const filtered = users.filter(u =>
    !selected.includes(u.username) &&
    ((u.full_name || '').toLowerCase().includes(query.toLowerCase()) ||
      u.username.toLowerCase().includes(query.toLowerCase()))
  ).slice(0, 8);

  function add(username) {
    onChange([...selected, username]);
    setQuery('');
    setOpen(false);
    inputRef.current?.focus();
  }

  function remove(username) {
    onChange(selected.filter(u => u !== username));
  }

  return (
    <div className="assignee-tags-box" onClick={() => inputRef.current?.focus()}>
      {selected.map(u => (
        <span key={u} className="assignee-tag">
          {u}
          <button type="button" onClick={() => remove(u)}>×</button>
        </span>
      ))}
      <div className="assignee-input-wrap">
        <input
          ref={inputRef}
          className="assignee-input"
          placeholder={selected.length === 0 ? 'Tutti (lascia vuoto) o cerca utente...' : 'Aggiungi...'}
          value={query}
          onChange={e => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
        />
        {open && filtered.length > 0 && (
          <div className="assignee-dropdown">
            {filtered.map(u => (
              <div key={u.id} className="assignee-dropdown-item" onMouseDown={() => add(u.username)}>
                <div className="assignee-item-avatar">{(u.full_name || u.username)[0].toUpperCase()}</div>
                <div className="assignee-item-info">
                  <div className="assignee-item-name">{u.full_name || u.username}</div>
                  <div className="assignee-item-username">@{u.username}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── New Ticket Modal ─── */
function NewTicketModal({ onClose, onCreated, projects, users }) {
  const [form, setForm] = useState({
    title: '',
    description: '',
    project_id: '',
    custom_project_code: '',
    priority: 'medium',
    assigned_to: [],
    status: 'Da gestire'
  });
  const [saving, setSaving] = useState(false);
  const [files, setFiles] = useState([]);
  const [dragActive, setDragActive] = useState(false);
  const toast = useToast();
  const fileRef = useRef(null);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.title.trim()) { toast.error('Il titolo è obbligatorio'); return; }
    setSaving(true);
    try {
      const { data } = await api.post('/tickets', {
        title: form.title.trim(),
        description: form.description,
        project_id: form.project_id === 'custom' ? null : (form.project_id || null),
        custom_project_code: form.project_id === 'custom' ? form.custom_project_code.trim() : null,
        priority: form.priority,
        assigned_to: form.assigned_to,
      });
      for (const file of files) {
        const fd = new FormData();
        fd.append('file', file);
        await api.post(`/tickets/${data.id}/attachments`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      }
      toast.success('Ticket creato!');
      onCreated(data.id);
      onClose();
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Errore nella creazione del ticket');
    } finally {
      setSaving(false);
    }
  }

  function handleDrag(e) {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  }

  function handleDrop(e) {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      setFiles(prev => [...prev, ...Array.from(e.dataTransfer.files)]);
    }
  }

  return (
    <div className="tickets-modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="tickets-modal">
        <div className="tickets-modal-header">
          <h2 className="tickets-modal-title">Nuovo Ticket</h2>
          <button className="tickets-modal-close" onClick={onClose}>✕</button>
        </div>
        <form className="tickets-modal-body" onSubmit={handleSubmit}>
          <div className="tkt-field">
            <label>Titolo *</label>
            <input
              type="text"
              placeholder="Descrivi brevemente il problema o l'evento..."
              value={form.title}
              onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
              autoFocus
            />
          </div>
          <div className="tkt-field">
            <label>Descrizione</label>
            <textarea
              placeholder="Dettagli aggiuntivi, passi per riprodurre il problema, ecc."
              value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
            />
          </div>
          <div className="tkt-field-row">
            <div className="tkt-field">
              <label>Commessa</label>
              <select value={form.project_id} onChange={e => setForm(f => ({ ...f, project_id: e.target.value }))}>
                <option value="">— Nessuna —</option>
                <option value="custom">✏️ Inserimento manuale</option>
                {projects.map(p => (
                  <option key={p.id} value={p.id}>{p.code ? `${p.code} – ` : ''}{p.client || p.name}</option>
                ))}
              </select>
              {form.project_id === 'custom' && (
                <input
                  type="text"
                  placeholder="Codice commessa personalizzato"
                  value={form.custom_project_code}
                  onChange={e => setForm(f => ({ ...f, custom_project_code: e.target.value }))}
                  style={{ marginTop: 8 }}
                  autoFocus
                />
              )}
            </div>
            <div className="tkt-field">
              <label>Priorità</label>
              <select value={form.priority} onChange={e => setForm(f => ({ ...f, priority: e.target.value }))}>
                <option value="low">🔵 Bassa</option>
                <option value="medium">🟡 Media</option>
                <option value="high">🔴 Alta</option>
              </select>
            </div>
          </div>
          <div className="tkt-field">
            <label>Addetti (vuoto = avviso tutti)</label>
            <AssigneeInput selected={form.assigned_to} onChange={v => setForm(f => ({ ...f, assigned_to: v }))} users={users} />
          </div>
          <div className="tkt-field">
            <label>Allegati</label>
            <div
              className={`ticket-dropzone ${dragActive ? 'active' : ''}`}
              onDragEnter={handleDrag} onDragOver={handleDrag} onDragLeave={handleDrag} onDrop={handleDrop}
            >
              Trascina qui i file o
              <label className="ticket-upload-label" style={{ display: 'inline-block', marginLeft: 8 }}>
                📎 Scegli file
                <input ref={fileRef} type="file" multiple style={{ display: 'none' }} onChange={e => setFiles(prev => [...prev, ...Array.from(e.target.files)])} />
              </label>
            </div>
            {files.length > 0 && (
              <div className="ticket-pending-files">
                {files.map((f, i) => (
                  <span key={i} className="ticket-pending-chip">
                    📄 {f.name}
                    <button type="button" onClick={() => setFiles(p => p.filter((_, j) => j !== i))}>×</button>
                  </span>
                ))}
              </div>
            )}
          </div>
          <div className="tkt-modal-footer">
            <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>Annulla</button>
            <button type="submit" className="btn btn-primary btn-sm" disabled={saving}>
              {saving ? 'Creazione...' : '+ Crea Ticket'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ─── Edit Ticket Modal ─── */
function EditTicketModal({ ticket, onClose, onUpdated, projects, users }) {
  const [form, setForm] = useState({
    title: ticket.title,
    description: ticket.description || '',
    project_id: ticket.project_id ? ticket.project_id : (ticket.custom_project_code ? 'custom' : ''),
    custom_project_code: ticket.custom_project_code || '',
    priority: ticket.priority,
    assigned_to: ticket.assigned_to || [],
    status: ticket.status,
  });
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.patch(`/tickets/${ticket.id}`, {
        ...form,
        project_id: form.project_id === 'custom' ? null : (form.project_id || null),
        custom_project_code: form.project_id === 'custom' ? form.custom_project_code.trim() : null
      });
      toast.success('Ticket aggiornato!');
      onUpdated();
      onClose();
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Errore aggiornamento');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="tickets-modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="tickets-modal">
        <div className="tickets-modal-header">
          <h2 className="tickets-modal-title">Modifica Ticket</h2>
          <button className="tickets-modal-close" onClick={onClose}>✕</button>
        </div>
        <form className="tickets-modal-body" onSubmit={handleSubmit}>
          <div className="tkt-field">
            <label>Titolo *</label>
            <input type="text" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} autoFocus />
          </div>
          <div className="tkt-field">
            <label>Descrizione</label>
            <textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
          </div>
          <div className="tkt-field-row">
            <div className="tkt-field">
              <label>Commessa</label>
              <select value={form.project_id} onChange={e => setForm(f => ({ ...f, project_id: e.target.value }))}>
                <option value="">— Nessuna —</option>
                <option value="custom">✏️ Inserimento manuale</option>
                {projects.map(p => (
                  <option key={p.id} value={p.id}>{p.code ? `${p.code} – ` : ''}{p.client || p.name}</option>
                ))}
              </select>
              {form.project_id === 'custom' && (
                <input
                  type="text"
                  placeholder="Codice commessa personalizzato"
                  value={form.custom_project_code}
                  onChange={e => setForm(f => ({ ...f, custom_project_code: e.target.value }))}
                  style={{ marginTop: 8 }}
                  autoFocus
                />
              )}
            </div>
            <div className="tkt-field">
              <label>Priorità</label>
              <select value={form.priority} onChange={e => setForm(f => ({ ...f, priority: e.target.value }))}>
                <option value="low">🔵 Bassa</option>
                <option value="medium">🟡 Media</option>
                <option value="high">🔴 Alta</option>
              </select>
            </div>
          </div>
          <div className="tkt-field">
            <label>Addetti di riferimento</label>
            <AssigneeInput selected={form.assigned_to} onChange={v => setForm(f => ({ ...f, assigned_to: v }))} users={users} />
          </div>
          <div className="tkt-field">
            <label>Stato</label>
            <select value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}>
              <option value="Da gestire">Da gestire</option>
              <option value="In attesa del cliente">In attesa del cliente</option>
              <option value="In elaborazione">In elaborazione</option>
              <option value="Completato">Completato</option>
            </select>
          </div>
          <div className="tkt-modal-footer">
            <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>Annulla</button>
            <button type="submit" className="btn btn-primary btn-sm" disabled={saving}>
              {saving ? 'Salvataggio...' : '💾 Salva'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ─── Ticket Detail Panel ─── */
function TicketDetail({ ticket, currentUser, onRefresh, users, projects, phases }) {
  const [replyText, setReplyText] = useState('');
  const [replyActionType, setReplyActionType] = useState(phases?.[0] || '📝 Nota Interna');
  const [replyFiles, setReplyFiles] = useState([]);
  const [sending, setSending] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [uploadingTicket, setUploadingTicket] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const toast = useToast();
  const navigate = useNavigate();
  const replyFileRef = useRef(null);
  const ticketFileRef = useRef(null);

  const canEdit = currentUser?.role === 'admin' || ticket.author_id === currentUser?.id;
  const isClosed = ticket.status === 'Completato';

  async function sendReply() {
    if (!replyText.trim() && replyFiles.length === 0) return;
    setSending(true);
    try {
      const { data } = await api.post(`/tickets/${ticket.id}/replies`, {
        content: replyText.trim(),
        action_type: replyActionType
      });
      if (replyFiles.length > 0) {
        const lastReply = data.replies[data.replies.length - 1];
        for (const file of replyFiles) {
          const fd = new FormData();
          fd.append('file', file);
          await api.post(`/tickets/${ticket.id}/replies/${lastReply.id}/attachments`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
        }
      }
      setReplyText('');
      setReplyActionType(phases?.[0] || '📝 Nota Interna');
      setReplyFiles([]);
      toast.success('Risposta inviata!');
      onRefresh();
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Errore nell\'invio della risposta');
    } finally {
      setSending(false);
    }
  }

  async function deleteReply(replyId) {
    if (!window.confirm('Eliminare questa risposta?')) return;
    try {
      await api.delete(`/tickets/${ticket.id}/replies/${replyId}`);
      toast.success('Risposta eliminata');
      onRefresh();
    } catch { toast.error('Errore nell\'eliminazione'); }
  }

  async function changeStatus(newStatus) {
    try {
      await api.patch(`/tickets/${ticket.id}`, { status: newStatus });
      toast.success(`Stato modificato in: ${newStatus}`);
      onRefresh();
    } catch { toast.error('Errore aggiornamento stato'); }
  }

  async function deleteTicket() {
    if (!window.confirm('Eliminare definitivamente questo ticket?')) return;
    try {
      await api.delete(`/tickets/${ticket.id}`);
      toast.success('Ticket eliminato');
      onRefresh(true);
    } catch { toast.error('Errore eliminazione'); }
  }

  async function uploadTicketFile(files) {
    setUploadingTicket(true);
    try {
      for (const file of files) {
        const fd = new FormData();
        fd.append('file', file);
        await api.post(`/tickets/${ticket.id}/attachments`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      }
      toast.success('Allegato aggiunto!');
      onRefresh();
    } catch { toast.error('Errore upload allegato'); } finally { setUploadingTicket(false); }
  }

  function handleDrag(e) {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  }

  function handleDrop(e) {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      setReplyFiles(prev => [...prev, ...Array.from(e.dataTransfer.files)]);
    }
  }

  const ticketAtts = Array.isArray(ticket.attachments) ? ticket.attachments : [];

  return (
    <div className="tickets-detail">
      {showEdit && (
        <EditTicketModal
          ticket={ticket}
          onClose={() => setShowEdit(false)}
          onUpdated={onRefresh}
          projects={projects}
          users={users}
        />
      )}

      {/* Header */}
      <div className="ticket-detail-header">
        <div className="ticket-detail-header-top">
          <h2 className="ticket-detail-title">{ticket.title}</h2>
          <div className="ticket-detail-actions">
            {canEdit && (
              <>

                <button className="btn btn-ghost btn-sm" onClick={() => setShowEdit(true)} title="Modifica" style={{ fontSize: '0.78rem' }}>
                  ✏️ Modifica
                </button>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={deleteTicket}
                  title="Elimina"
                  style={{ fontSize: '0.78rem', color: 'var(--danger)' }}
                >
                  🗑️
                </button>
              </>
            )}
          </div>
        </div>

        <div className="ticket-detail-meta">
          {canEdit ? (
            <select
              className={`ticket-status-badge ${STATUS_CLASS[ticket.status] || 'open'}`}
              value={ticket.status}
              onChange={(e) => changeStatus(e.target.value)}
              style={{ cursor: 'pointer', border: 'none', outline: 'none' }}
            >
              <option value="Da gestire">● Da gestire</option>
              <option value="In attesa del cliente">● In attesa del cliente</option>
              <option value="In elaborazione">● In elaborazione</option>
              <option value="Completato">● Completato</option>
            </select>
          ) : (
            <span className={`ticket-status-badge ${STATUS_CLASS[ticket.status] || 'open'}`}>
              ● {ticket.status}
            </span>
          )}
          <span className={`ticket-priority-badge ${ticket.priority}`}>
            {PRIORITY_ICON[ticket.priority]} {PRIORITY_LABEL[ticket.priority]}
          </span>
          {ticket.project_id ? (
            <>
              <span style={{ color: 'var(--border-default)' }}>·</span>
              <button className="ticket-detail-project-link" onClick={() => navigate(`/projects/${ticket.project_id}`)}>
                📂 {ticket.project_code || ticket.project_name}
              </button>
            </>
          ) : ticket.custom_project_code ? (
            <>
              <span style={{ color: 'var(--border-default)' }}>·</span>
              <span className="ticket-detail-meta-item">
                📂 {ticket.custom_project_code}
              </span>
            </>
          ) : null}
          <span style={{ color: 'var(--border-default)' }}>·</span>
          <span className="ticket-detail-meta-item">
            👤 {ticket.assigned_to?.length > 0 ? ticket.assigned_to.join(', ') : 'Tutti'}
          </span>
          <span style={{ color: 'var(--border-default)' }}>·</span>
          <span className="ticket-detail-meta-item">
            {ticket.author_full_name || ticket.author_username} · {fmtDate(ticket.created_at)}
          </span>
        </div>
      </div>

      {/* Scrollable body */}
      <div className="ticket-detail-body">

        {/* Description */}
        <div className="ticket-section">
          <div className="ticket-section-label">Descrizione</div>
          {ticket.description
            ? <div className="ticket-description-text">{ticket.description}</div>
            : <div className="ticket-description-empty">Nessuna descrizione fornita.</div>
          }
        </div>

        {/* Ticket Attachments */}
        {(ticketAtts.length > 0 || canEdit) && (
          <div className="ticket-section" style={{ paddingTop: 12, paddingBottom: 12 }}>
            <div className="ticket-section-label">Allegati ({ticketAtts.length})</div>
            <div className="ticket-attachments-list" style={{ marginBottom: ticketAtts.length > 0 ? 8 : 0 }}>
              {ticketAtts.map((att, i) => (
                <a key={i} href={`${BACKEND_URL}/${att.path}`} target="_blank" rel="noopener noreferrer" className="ticket-attachment-chip">
                  📄 {att.name}
                </a>
              ))}
            </div>
            {canEdit && (
              <label className="ticket-upload-label">
                {uploadingTicket ? '⏳ Upload...' : '📎 Aggiungi allegato'}
                <input ref={ticketFileRef} type="file" multiple style={{ display: 'none' }}
                  onChange={e => { uploadTicketFile(Array.from(e.target.files)); e.target.value = ''; }} />
              </label>
            )}
          </div>
        )}

        {/* Replies */}
        <div className="tickets-replies-section">
          <div className="ticket-section-label" style={{ marginBottom: 12 }}>
            Risposte ({ticket.replies?.length || 0})
          </div>
          {!ticket.replies?.length && (
            <div className="ticket-no-replies">Nessuna risposta ancora — sii il primo a rispondere!</div>
          )}
          {ticket.replies?.map(reply => {
            const ratts = Array.isArray(reply.attachments) ? reply.attachments : [];
            const canDel = currentUser?.role === 'admin' || reply.author_id === currentUser?.id;
            return (
              <div key={reply.id} className="ticket-timeline-item">
                <div className="ticket-timeline-marker">
                  <Av name={reply.author_full_name || reply.author_username} size={36} />
                </div>
                <div className="ticket-timeline-content-card">
                  <div className="ticket-timeline-header">
                    <div className="ticket-timeline-author-row">
                      <span className="ticket-timeline-author">{reply.author_full_name || reply.author_username}</span>
                      <span className="ticket-timeline-date">{fmtDateTime(reply.created_at)}</span>
                    </div>
                    <span className="ticket-timeline-badge">
                      {reply.action_type || '📝 Nota Interna'}
                    </span>
                    {canDel && (
                      <button className="ticket-timeline-delete" onClick={() => deleteReply(reply.id)}>🗑️</button>
                    )}
                  </div>
                  <div className="ticket-timeline-body">
                    <div className={`ticket-timeline-text ${reply.action_type === '🔄 Cambio Stato' ? 'system-message' : ''}`}>
                      {reply.content}
                    </div>
                    {ratts.length > 0 && (
                      <div className="ticket-attachments-list" style={{ marginTop: 12 }}>
                        {ratts.map((att, i) => (
                          <a key={i} href={`${BACKEND_URL}/${att.path}`} target="_blank" rel="noopener noreferrer" className="ticket-attachment-chip">
                            📄 {att.name}
                          </a>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Reply input */}
      {isClosed ? (
        <div className="ticket-closed-notice">
          🔒 Ticket chiuso.{canEdit && ' Puoi riaprirlo per continuare la discussione.'}
        </div>
      ) : (
        <div
          className={`ticket-reply-area ${dragActive ? 'active-dropzone' : ''}`}
          onDragEnter={handleDrag} onDragOver={handleDrag} onDragLeave={handleDrag} onDrop={handleDrop}
        >
          {dragActive && <div className="ticket-drop-overlay">Rilascia per allegare</div>}
          <div className="ticket-reply-top-row">
            <select
              className="ticket-reply-type-select"
              value={replyActionType}
              onChange={e => setReplyActionType(e.target.value)}
            >
              {(phases || []).map(p => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </div>
          <div className="ticket-reply-row">
            <Av name={currentUser?.full_name || currentUser?.username} size={36} />
            <textarea
              className="ticket-reply-textarea"
              placeholder="Scrivi i dettagli dell'evento..."
              value={replyText}
              onChange={e => setReplyText(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && e.ctrlKey) sendReply(); }}
            />
          </div>
          {replyFiles.length > 0 && (
            <div className="ticket-pending-files" style={{ paddingLeft: 42 }}>
              {replyFiles.map((f, i) => (
                <span key={i} className="ticket-pending-chip">
                  📄 {f.name}
                  <button type="button" onClick={() => setReplyFiles(p => p.filter((_, j) => j !== i))}>×</button>
                </span>
              ))}
            </div>
          )}
          <div className="ticket-reply-actions">
            <span className="ticket-reply-hint">Ctrl+Invio per inviare</span>
            <label className="ticket-upload-label" style={{ cursor: 'pointer' }}>
              📎
              <input ref={replyFileRef} type="file" multiple style={{ display: 'none' }}
                onChange={e => setReplyFiles(p => [...p, ...Array.from(e.target.files)])} />
            </label>
            <button
              className="btn btn-primary btn-sm"
              onClick={sendReply}
              disabled={sending || (!replyText.trim() && replyFiles.length === 0)}
            >
              {sending ? '⏳' : '✉️ Invia'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── Main Page ─── */
export default function TicketsPage() {
  const { user } = useAuth();
  const toast = useToast();
  const location = useLocation();
  const passedProjectId = location.state?.projectId;

  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState(null);
  const [showNew, setShowNew] = useState(false);
  const [statusFilter, setStatusFilter] = useState('open_all');
  const [priorityFilter, setPriorityFilter] = useState('all');
  const [projectFilter, setProjectFilter] = useState(passedProjectId || 'all');
  const [search, setSearch] = useState('');
  const [projects, setProjects] = useState([]);
  const [users, setUsers] = useState([]);
  const [phases, setPhases] = useState([]);

  const loadedRef = useRef(false);

  useEffect(() => {
    if (loadedRef.current) return; // prevent double-call in StrictMode
    loadedRef.current = true;
    loadAll();
  }, []);

  useEffect(() => {
    if (location.state?.projectId) {
      setProjectFilter(location.state.projectId);
    } else {
      setProjectFilter('all');
    }
  }, [location.state?.projectId]);

  async function loadAll() {
    setLoading(true);
    try {
      const [tRes, pRes, phRes] = await Promise.all([
        api.get('/tickets'),
        api.get('/projects'),
        api.get('/settings/ticket_phases')
      ]);
      setTickets(Array.isArray(tRes.data) ? tRes.data : []);
      setProjects(Array.isArray(pRes.data) ? pRes.data : []);
      setPhases(Array.isArray(phRes.data) ? phRes.data : []);
    } catch (err) {
      toast.error('Errore nel caricamento dei ticket. Assicurati che il backend sia aggiornato.');
    } finally {
      setLoading(false);
    }
    // Load users separately — not critical
    try {
      const { data } = await api.get('/users');
      setUsers(Array.isArray(data) ? data : []);
    } catch { /* users not available for this role */ }
  }

  const refreshTickets = useCallback(async (resetSelected = false) => {
    try {
      const { data } = await api.get('/tickets');
      setTickets(Array.isArray(data) ? data : []);
      if (resetSelected) setSelectedId(null);
    } catch { /* ignore */ }
  }, []);

  const selectedTicket = tickets.find(t => t.id === selectedId) || null;

  const projectFilteredTickets = tickets.filter(t => projectFilter === 'all' || t.project_id === projectFilter);

  const filtered = tickets.filter(t => {
    if (projectFilter !== 'all' && t.project_id !== projectFilter) return false;
    if (statusFilter === 'open_all' && t.status === 'Completato') return false;
    if (statusFilter !== 'open_all' && statusFilter !== 'all' && t.status !== statusFilter) return false;
    if (priorityFilter !== 'all' && t.priority !== priorityFilter) return false;
    if (search && !t.title.toLowerCase().includes(search.toLowerCase()) && !(t.project_code || '').toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const baseTickets = projectFilteredTickets.filter(t => {
    if (statusFilter === 'open_all') return t.status !== 'Completato';
    if (statusFilter === 'all') return true;
    return t.status === statusFilter;
  });
  const highCount = baseTickets.filter(t => t.priority === 'high').length;
  const mediumCount = baseTickets.filter(t => t.priority === 'medium').length;
  const lowCount = baseTickets.filter(t => t.priority === 'low').length;

  return (
    <div className="tickets-page-wrapper">
      {/* Header */}
      <div className="tickets-page-header">
        <div>
          <h1>Gestione Ticket</h1>
          <p>Segnalazioni, problemi ed eventi legati alle commesse</p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowNew(true)}>
          + Nuovo Ticket
        </button>
      </div>

      {showNew && (
        <NewTicketModal
          onClose={() => setShowNew(false)}
          onCreated={id => { refreshTickets(); setSelectedId(id); }}
          projects={projects}
          users={users}
        />
      )}

      {/* Body */}
      <div className="tickets-body">
        {/* Sidebar */}
        <aside className="tickets-sidebar">
          <div className="tickets-sidebar-section-title">Stato</div>
          {[
            { key: 'open_all', icon: '🔥', label: 'Aperti', count: projectFilteredTickets.filter(t => t.status !== 'Completato').length },
            { key: 'Da gestire', icon: '⏳', label: 'Da gestire', count: projectFilteredTickets.filter(t => t.status === 'Da gestire').length },
            { key: 'In attesa del cliente', icon: '📞', label: 'In attesa', count: projectFilteredTickets.filter(t => t.status === 'In attesa del cliente').length },
            { key: 'In elaborazione', icon: '⚙️', label: 'In elaborazione', count: projectFilteredTickets.filter(t => t.status === 'In elaborazione').length },
            { key: 'Completato', icon: '✅', label: 'Completato', count: projectFilteredTickets.filter(t => t.status === 'Completato').length },
          ].map(f => (
            <button
              key={f.key}
              className={`tickets-filter-btn ${statusFilter === f.key ? 'active' : ''}`}
              onClick={() => setStatusFilter(f.key)}
            >
              <span>{f.icon} {f.label}</span>
              <span className="tickets-filter-count">{f.count}</span>
            </button>
          ))}

          <div className="tickets-sidebar-section-title">Priorità</div>
          {[
            { key: 'all', icon: '📋', label: 'Tutte', count: baseTickets.length },
            { key: 'high', icon: '🔴', label: 'Alta', count: highCount },
            { key: 'medium', icon: '🟡', label: 'Media', count: mediumCount },
            { key: 'low', icon: '🔵', label: 'Bassa', count: lowCount },
          ].map(f => (
            <button
              key={f.key}
              className={`tickets-filter-btn ${priorityFilter === f.key ? 'active' : ''}`}
              onClick={() => setPriorityFilter(f.key)}
            >
              <span>{f.icon} {f.label}</span>
              {f.count !== null && <span className="tickets-filter-count">{f.count}</span>}
            </button>
          ))}

          {projectFilter !== 'all' && (
            <>
              <div className="tickets-sidebar-section-title">Filtro Commessa</div>
              <button
                className="tickets-filter-btn active"
                onClick={() => { setProjectFilter('all'); window.history.replaceState({}, ''); }}
              >
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  📂 {projects.find(p => p.id === projectFilter)?.code || 'Commessa'}
                </span>
                <span className="tickets-filter-count" style={{ cursor: 'pointer' }}>✖</span>
              </button>
            </>
          )}
        </aside>

        {/* Ticket list */}
        <div className="tickets-list-panel">
          <div className="tickets-list-header">
            <h3>{filtered.length} ticket</h3>
          </div>
          <div className="tickets-search-wrap">
            <input
              className="tickets-search"
              placeholder="🔍 Cerca ticket..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          <div className="tickets-list">
            {loading ? (
              <div className="tickets-empty">
                <div className="tickets-empty-icon">⏳</div>
                <div>Caricamento...</div>
              </div>
            ) : filtered.length === 0 ? (
              <div className="tickets-empty">
                <div className="tickets-empty-icon">📋</div>
                <div>{tickets.length === 0 ? 'Nessun ticket aperto' : 'Nessun risultato'}</div>
                {tickets.length === 0 && (
                  <button className="btn btn-primary btn-sm" onClick={() => setShowNew(true)}>
                    + Nuovo Ticket
                  </button>
                )}
              </div>
            ) : (
              filtered.map(t => (
                <div
                  key={t.id}
                  className={`ticket-card ${selectedId === t.id ? 'selected' : ''}`}
                  onClick={() => setSelectedId(t.id)}
                >
                  <div className="ticket-card-title">{t.title}</div>
                  <div className="ticket-card-badges">
                    <span className={`ticket-status-badge ${STATUS_CLASS[t.status] || 'open'}`}>
                      ● {t.status}
                    </span>
                    <span className={`ticket-priority-badge ${t.priority}`}>
                      {PRIORITY_ICON[t.priority]} {PRIORITY_LABEL[t.priority]}
                    </span>
                  </div>
                  {t.project_id ? (
                    <div className="ticket-card-project">📂 {t.project_code || t.project_name}</div>
                  ) : t.custom_project_code ? (
                    <div className="ticket-card-project">📂 {t.custom_project_code}</div>
                  ) : null}
                  <div className="ticket-card-footer">
                    <span className="ticket-card-author">{t.author_full_name || t.author_username}</span>
                    <span className="ticket-card-replies">💬 {t.reply_count}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Detail */}
        {selectedTicket ? (
          <TicketDetail
            key={selectedTicket.id}
            ticket={selectedTicket}
            currentUser={user}
            onRefresh={(reset) => refreshTickets(reset === true)}
            users={users}
            projects={projects}
            phases={phases}
          />
        ) : (
          <div className="tickets-detail">
            <div className="tickets-detail-placeholder">
              <div className="tickets-detail-placeholder-icon">📋</div>
              <div style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
                Seleziona un ticket dalla lista
              </div>
              <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                oppure crea un nuovo ticket
              </div>
              <button className="btn btn-primary btn-sm" onClick={() => setShowNew(true)}>
                + Nuovo Ticket
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
