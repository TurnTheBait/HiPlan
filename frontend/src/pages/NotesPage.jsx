import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import AppIcon from '../components/ui/AppIcon';
import AssigneeInput from '../components/ui/AssigneeInput';
import './NotesPage.css';

const BACKEND_URL = import.meta.env.VITE_API_URL
  ? import.meta.env.VITE_API_URL.replace(/\/api\/?$/, '')
  : `http://${window.location.hostname}:8000`;

export default function NotesPage() {
  const { user } = useAuth();
  const toast = useToast();

  // Elenco note e filtri
  const [notes, setNotes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState('all'); // 'all' | 'private' | 'shared'

  // Nota attiva per la visualizzazione / modifica
  const [activeNoteId, setActiveNoteId] = useState(null);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [visibility, setVisibility] = useState('private');
  const [sharedWith, setSharedWith] = useState([]);

  // Stato UI editor
  const [saving, setSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState(null);
  const [showVisibilityMenu, setShowVisibilityMenu] = useState(false);

  // Modale Nuova Nota
  const [showNewModal, setShowNewModal] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newVisibility, setNewVisibility] = useState('private');
  const [newSharedWith, setNewSharedWith] = useState([]);

  const [users, setUsers] = useState([]);

  // Ref per l'editor visuale contentEditable e timeout autocalcolato
  const editorRef = useRef(null);
  const saveTimeoutRef = useRef(null);

  useEffect(() => {
    async function loadUsers() {
      try {
        const { data } = await api.get('/users');
        setUsers(data);
      } catch (err) {
        console.error('Failed to load users', err);
      }
    }
    loadUsers();
  }, []);

  useEffect(() => {
    // Aggiungi classe full-height-page al main-body per occupare tutta l'altezza
    const mainBody = document.querySelector('.main-body');
    if (mainBody) mainBody.classList.add('full-height-page');
    return () => {
      if (mainBody) mainBody.classList.remove('full-height-page');
    };
  }, []);

  useEffect(() => {
    loadNotes();
  }, []);

  const location = useLocation();
  const navigate = useNavigate();

  async function loadNotes() {
    setLoading(true);
    try {
      const { data } = await api.get('/notes');
      setNotes(data);
    } catch {
      toast.error('Errore durante il caricamento dei blocchi note');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (notes.length > 0) {
      const params = new URLSearchParams(location.search);
      const urlNoteId = params.get('noteId');
      if (urlNoteId) {
        const targetNote = notes.find(n => n.id === urlNoteId);
        if (targetNote) {
          selectNote(targetNote);
        }
        params.delete('noteId');
        navigate({ search: params.toString() }, { replace: true });
      } else if (!activeNoteId) {
        selectNote(notes[0]);
      }
    }
  }, [location.search, notes]);

  function selectNote(note) {
    if (!note) {
      setActiveNoteId(null);
      if (editorRef.current) editorRef.current.innerHTML = '';
      return;
    }
    setActiveNoteId(note.id);
    setTitle(note.title || '');
    setVisibility(note.visibility || 'private');
    setSharedWith(note.shared_with || []);
    const cleanHtml = convertMarkdownToHtml(note.content || '');
    setContent(cleanHtml);
    if (editorRef.current) {
      editorRef.current.innerHTML = cleanHtml;
    }
    setLastSaved(null);
    setShowVisibilityMenu(false);
  }

  useEffect(() => {
    if (editorRef.current && activeNoteId) {
      if (editorRef.current.innerHTML !== content && !saving) {
        editorRef.current.innerHTML = convertMarkdownToHtml(content || '');
      }
    }
  }, [activeNoteId]);

  const activeNote = useMemo(() => {
    return notes.find(n => n.id === activeNoteId) || null;
  }, [notes, activeNoteId]);

  // Salvataggio su backend (manuale o debounced)
  const saveNoteToBackend = useCallback(async (noteId, newTitle, newContent) => {
    if (!noteId) return;
    setSaving(true);
    try {
      const { data } = await api.patch(`/notes/${noteId}`, {
        title: newTitle,
        content: newContent
      });
      setNotes(prev => prev.map(n => n.id === noteId ? data : n));
      setLastSaved(new Date());
    } catch {
      toast.error('Errore durante il salvataggio automatico');
    } finally {
      setSaving(false);
    }
  }, [toast]);

  // Modifica Titolo
  function handleTitleChange(e) {
    const val = e.target.value;
    setTitle(val);
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => {
      saveNoteToBackend(activeNoteId, val, content);
    }, 1000);
  }

  // Conversione da markdown grezzo / testo o HTML esistente per visualizzazione pulita
  function convertMarkdownToHtml(raw) {
    if (!raw || typeof raw !== 'string') return '';
    if (/<(h[1-6]|p|div|ul|ol|li|blockquote|pre|strong|em|br)[^>]*>/i.test(raw)) {
      return raw;
    }
    const lines = raw.split('\n');
    let html = '';
    let inCode = false;
    let codeBuffer = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.trim().startsWith('```')) {
        if (inCode) {
          html += `<pre class="note-code-block"><code>${codeBuffer.join('\n')}</code></pre>`;
          codeBuffer = [];
          inCode = false;
        } else {
          inCode = true;
        }
        continue;
      }
      if (inCode) {
        codeBuffer.push(line);
        continue;
      }
      if (line.startsWith('# ')) {
        html += `<h1 class="note-h1">${formatInline(line.substring(2))}</h1>`;
        continue;
      }
      if (line.startsWith('## ')) {
        html += `<h2 class="note-h2">${formatInline(line.substring(3))}</h2>`;
        continue;
      }
      if (line.startsWith('### ')) {
        html += `<h3 class="note-h3">${formatInline(line.substring(4))}</h3>`;
        continue;
      }
      if (line.trim().startsWith('[ ] ') || line.trim().startsWith('[x] ')) {
        const isChecked = line.trim().startsWith('[x] ');
        const text = line.trim().substring(4);
        html += `<div class="note-checklist-item" contenteditable="false"><input type="checkbox" class="note-checkbox" ${isChecked ? 'checked' : ''} /> <span contenteditable="true" class="checklist-text">${formatInline(text)}</span></div>`;
        continue;
      }
      if (line.trim().startsWith('- ') || (line.trim().startsWith('* ') && !line.trim().startsWith('* *'))) {
        html += `<ul><li>${formatInline(line.trim().substring(2))}</li></ul>`;
        continue;
      }
      if (line.trim().startsWith('> ')) {
        html += `<blockquote>${formatInline(line.trim().substring(2))}</blockquote>`;
        continue;
      }
      if (!line.trim()) {
        html += `<p><br></p>`;
      } else {
        html += `<p>${formatInline(line)}</p>`;
      }
    }
    if (inCode && codeBuffer.length > 0) {
      html += `<pre class="note-code-block"><code>${codeBuffer.join('\n')}</code></pre>`;
    }
    return html || '<p><br></p>';
  }

  function formatInline(str) {
    return str
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      .replace(/`(.*?)`/g, '<code>$1</code>');
  }

  // Modifica Contenuto da editor visuale
  function handleEditorInput() {
    if (!editorRef.current || !activeNoteId) return;
    const newHtml = editorRef.current.innerHTML;
    setContent(newHtml);
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => {
      saveNoteToBackend(activeNoteId, title, newHtml);
    }, 1000);
  }

  // Supporto interattivo per toggle delle checkbox nella checklist
  function handleEditorClick(e) {
    if (e.target && e.target.classList.contains('note-checkbox')) {
      if (e.target.checked) {
        e.target.setAttribute('checked', 'checked');
      } else {
        e.target.removeAttribute('checked');
      }
      handleEditorInput();
    }
  }

  // Supporto scorciatoie da tastiera
  function handleEditorKeyDown(e) {
    if (e.key === 'Enter') {
      // Per consentire comportamento naturale di nuova riga
    }
  }

  // Cambio Visibilità
  async function handleToggleVisibility(targetVisibility, targetSharedWith = sharedWith) {
    if (!activeNoteId) {
      setShowVisibilityMenu(false);
      return;
    }
    try {
      const { data } = await api.patch(`/notes/${activeNoteId}`, {
        visibility: targetVisibility,
        shared_with: targetSharedWith
      });
      setVisibility(data.visibility);
      setSharedWith(data.shared_with);
      setNotes(prev => prev.map(n => n.id === activeNoteId ? data : n));
      // Only close the menu if we are clicking a major option, not while editing the user list
      if (targetVisibility !== 'selected' || targetSharedWith === sharedWith) {
         // Do not auto-close if we are just updating the sharedWith list interactively
      }
      toast.success('Visibilità blocco note aggiornata!');
    } catch {
      toast.error("Errore nell'aggiornamento della visibilità");
    }
  }

  // Creazione Nuova Nota dal modal
  async function handleCreateNote(e) {
    e.preventDefault();
    if (!newTitle.trim()) return;
    try {
      const { data } = await api.post('/notes', {
        title: newTitle.trim(),
        content: '',
        visibility: newVisibility,
        shared_with: newSharedWith,
        is_shared: newVisibility === 'team'
      });
      setNotes(prev => [data, ...prev]);
      selectNote(data);
      setShowNewModal(false);
      setNewTitle('');
      setNewVisibility('private');
      setNewSharedWith([]);
      toast.success('Nuovo blocco note creato!');
    } catch {
      toast.error('Errore nella creazione della nota');
    }
  }

  // Eliminazione Nota
  async function handleDeleteNote() {
    if (!activeNoteId) return;
    if (!window.confirm(`Eliminare definitivamente la nota "${title}"?`)) return;
    try {
      await api.delete(`/notes/${activeNoteId}`);
      toast.success('Nota eliminata');
      const updated = notes.filter(n => n.id !== activeNoteId);
      setNotes(updated);
      if (updated.length > 0) {
        selectNote(updated[0]);
      } else {
        selectNote(null);
      }
    } catch {
      toast.error('Errore durante l\'eliminazione');
    }
  }

  async function handleUploadAttachment(e) {
    if (!activeNoteId) {
      toast.error('Salva la nota prima di aggiungere allegati');
      return;
    }
    if (!e.target.files || e.target.files.length === 0) return;
    await uploadFiles(e.target.files);
  }

  async function handleDropAttachment(e) {
    e.preventDefault();
    e.stopPropagation();
    if (!activeNoteId) {
      toast.error('Salva la nota prima di aggiungere allegati');
      return;
    }
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      await uploadFiles(e.dataTransfer.files);
    }
  }

  async function uploadFiles(files) {
    try {
      for (const file of files) {
        const fd = new FormData();
        fd.append('file', file);
        await api.post(`/notes/${activeNoteId}/attachments`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      }
      toast.success('Allegati caricati!');
      loadNotes();
    } catch (err) {
      toast.error('Errore durante il caricamento');
    }
  }

  async function handleDeleteAttachment(filename) {
    if (!activeNoteId) return;
    if (!window.confirm('Eliminare questo allegato?')) return;
    try {
      await api.delete(`/notes/${activeNoteId}/attachments/${encodeURIComponent(filename)}`);
      toast.success('Allegato eliminato');
      loadNotes();
    } catch (err) {
      toast.error('Errore durante l\'eliminazione');
    }
  }

  // Formattazione visuale istantanea stile Notion (H1, H2, Bold, Check-list, ecc.)
  function applyFormatting(formatType) {
    if (!editorRef.current) return;
    editorRef.current.focus();

    switch (formatType) {
      case 'h1':
        document.execCommand('formatBlock', false, '<h1>');
        break;
      case 'h2':
        document.execCommand('formatBlock', false, '<h2>');
        break;
      case 'bold':
        document.execCommand('bold', false, null);
        break;
      case 'italic':
        document.execCommand('italic', false, null);
        break;
      case 'bullet':
        document.execCommand('insertUnorderedList', false, null);
        break;
      case 'todo': {
        const sel = window.getSelection();
        const text = sel && sel.toString() ? sel.toString() : 'Attività da fare';
        document.execCommand('insertHTML', false, `<div class="note-checklist-item" contenteditable="false"><input type="checkbox" class="note-checkbox" /> <span contenteditable="true" class="checklist-text">${text}</span></div><p><br></p>`);
        break;
      }
      case 'quote':
        document.execCommand('formatBlock', false, 'blockquote');
        break;
      case 'code': {
        const sel = window.getSelection();
        const text = sel && sel.toString() ? sel.toString() : 'inserisci qui il codice';
        document.execCommand('insertHTML', false, `<pre class="note-code-block"><code>${text}</code></pre><p><br></p>`);
        break;
      }
      case 'normal':
        document.execCommand('formatBlock', false, '<p>');
        break;
      default:
        return;
    }
    handleEditorInput();
  }

  // Estratto di testo pulito per la sidebar
  function getCleanSnippet(htmlOrMarkdown) {
    if (!htmlOrMarkdown) return 'Nessun testo...';
    const clean = htmlOrMarkdown
      .replace(/<[^>]*>?/gm, ' ')
      .replace(/[#*`>-]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return clean || 'Nessun testo...';
  }

  // Filtra note per tab e ricerca
  const filteredNotes = useMemo(() => {
    return notes.filter(n => {
      const isActuallyShared = n.is_shared || n.visibility === 'team' || n.visibility === 'selected';
      if (!isActuallyShared && n.owner_id !== user?.id) return false;
      if (activeTab === 'private' && isActuallyShared) return false;
      if (activeTab === 'shared' && !isActuallyShared) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesTitle = n.title?.toLowerCase().includes(q);
        const matchesContent = n.content?.toLowerCase().includes(q);
        return matchesTitle || matchesContent;
      }
      return true;
    });
  }, [notes, activeTab, searchQuery, user]);

  // Formatta data in modo compatto
  function formatRelativeDate(dateStr) {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    const now = new Date();
    const diffHours = Math.round((now - date) / (1000 * 60 * 60));
    if (diffHours < 1) return 'Adesso';
    if (diffHours < 24) return `${diffHours}h fa`;
    return date.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit' });
  }

  if (loading) return <div className="loading-screen"><div className="spinner" /></div>;

  return (
    <div className="notes-page-container animate-fadeIn">
      {/* SIDEBAR SINISTRA */}
      <aside className="notes-sidebar">
        <div className="notes-sidebar-top">
          <div className="notes-sidebar-title">
            <span>Le tue note</span>
          </div>
          <button
            className="btn btn-primary btn-sm"
            onClick={() => {
              setNewTitle('');
              setNewVisibility('private');
              setNewSharedWith([]);
              setShowNewModal(true);
            }}
          >
            <AppIcon name="plus" size={15} />
            Nuova
          </button>
        </div>

        {/* CAMPO DI RICERCA */}
        <div className="notes-search-wrapper" style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
          <img
            src="/hiway-icon.png"
            alt="HiWay"
            title="Cerca in HiWay GanttFlow"
            className="notes-search-icon"
            style={{ position: 'absolute', left: 12, width: 18, height: 18, objectFit: 'contain', pointerEvents: 'none' }}
          />
          <input
            type="text"
            className="notes-search-input"
            style={{ paddingLeft: 38 }}
            placeholder="Cerca tra gli appunti..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              aria-label="Cancella ricerca"
              style={{ position: 'absolute', right: 12, background: 'none', border: 'none', color: 'var(--text-tertiary)', cursor: 'pointer', fontSize: 13 }}
            >
              <AppIcon name="close" size={14} />
            </button>
          )}
        </div>

        {/* TABS FILTRO */}
        <div className="notes-tabs">
          <button
            className={`notes-tab-btn ${activeTab === 'all' ? 'active' : ''}`}
            onClick={() => setActiveTab('all')}
          >
            Tutte ({notes.length})
          </button>
          <button
            className={`notes-tab-btn ${activeTab === 'private' ? 'active' : ''}`}
            onClick={() => setActiveTab('private')}
          >
            <AppIcon name="lock" size={14} />
            Private
          </button>
          <button
            className={`notes-tab-btn ${activeTab === 'shared' ? 'active' : ''}`}
            onClick={() => setActiveTab('shared')}
          >
            <AppIcon name="users" size={14} />
            Condivise
          </button>
        </div>

        {/* LISTA SCHEDE NOTE */}
        <div className="notes-list">
          {filteredNotes.length === 0 ? (
            <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.8125rem', padding: '32px 12px' }}>
              Nessun blocco note trovato.
            </div>
          ) : (
            filteredNotes.map(note => {
              const isSelected = note.id === activeNoteId;
              const isMine = note.owner_id === user?.id;
              return (
                <div
                  key={note.id}
                  className={`note-card ${isSelected ? 'active' : ''}`}
                  onClick={() => selectNote(note)}
                >
                  <div className="note-card-header">
                    <span className="note-card-title">{note.title || 'Senza Titolo'}</span>
                    <span className={`note-visibility-badge ${note.visibility === 'team' ? 'badge-shared' : note.visibility === 'selected' ? 'badge-selected' : 'badge-private'}`}>
                      <AppIcon name={note.visibility === 'team' ? 'users' : note.visibility === 'selected' ? 'user-check' : 'lock'} size={12} />
                      {note.visibility === 'team' ? 'Condiviso' : note.visibility === 'selected' ? 'Utenti Selezionati' : 'Privato'}
                    </span>
                  </div>
                  <div className="note-card-snippet">
                    {getCleanSnippet(note.content)}
                  </div>
                  <div className="note-card-meta">
                    <span className="note-meta-owner"><AppIcon name="user" size={12} />{note.owner?.full_name || note.owner?.username || (isMine ? 'Tu' : 'Utente')}</span>
                    <span>{formatRelativeDate(note.updated_at || note.created_at)}</span>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </aside>

      {/* AREA EDITOR CENTRALE (NOTION STYLE) */}
      <main className="notes-editor-container">
        {!activeNote ? (
          <div className="notes-empty-selection">
            <span className="empty-state-icon"><AppIcon name="notes" size={28} /></span>
            <h3 style={{ fontSize: '1.25rem', color: 'var(--text-primary)', marginBottom: '8px' }}>Seleziona o crea un blocco note</h3>
            <p style={{ maxWidth: 400, marginBottom: '24px', lineHeight: 1.5 }}>
              Scrivi appunti, specifiche di commessa o check-list con formattazione visuale in stile Notion. Puoi decidere in qualsiasi momento se mantenere il file privato o condividerlo con il resto del team.
            </p>
            <button
              className="btn btn-primary"
              onClick={() => {
                setNewTitle('');
                setNewVisibility('private');
                setNewSharedWith([]);
                setShowNewModal(true);
              }}
            >
              <AppIcon name="plus" />
              Crea il primo blocco note
            </button>
          </div>
        ) : (
          <>
            {/* TOOLBAR TOP (OWNER, VISIBILITÀ, AZIONI) — FISSA, NON SCROLLA */}
            <div className="notes-editor-toolbar-top">
              <div className="note-owner-info">
                <span className="sidebar-avatar" style={{ width: 26, height: 26, fontSize: '0.7rem' }}>
                  {activeNote.owner?.username?.[0]?.toUpperCase() || 'U'}
                </span>
                <span>
                  Autore: <strong>{activeNote.owner?.full_name || activeNote.owner?.username || (activeNote.owner_id === user?.id ? 'Tu' : 'Utente')}</strong>
                </span>
                {saving && <span className="note-save-state">Salvataggio…</span>}
                {!saving && lastSaved && <span className="note-save-state saved"><AppIcon name="check" size={13} />Salvato {lastSaved.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}</span>}
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                {/* MENU TOGGLE MODIFICA VISIBILITÀ */}
                <div className="visibility-toggle-dropdown">
                  <button
                    type="button"
                    className={`visibility-btn-interactive ${visibility === 'team' ? 'badge-shared' : visibility === 'selected' ? 'badge-selected' : 'badge-private'}`}
                    onClick={() => {
                      if (activeNote.owner_id === user?.id) {
                        setShowVisibilityMenu(!showVisibilityMenu);
                      }
                    }}
                    title={activeNote.owner_id === user?.id ? "Clicca per modificare la visibilità del blocco note" : "Solo l'autore può modificare la visibilità"}
                    style={{ cursor: activeNote.owner_id === user?.id ? 'pointer' : 'default', opacity: activeNote.owner_id === user?.id ? 1 : 0.8 }}
                  >
                    <AppIcon name={visibility === 'team' ? 'users' : visibility === 'selected' ? 'user-check' : 'lock'} size={14} />
                    {visibility === 'team' ? 'Condiviso' : visibility === 'selected' ? 'Utenti Selezionati' : 'Privato'}
                    {activeNote.owner_id === user?.id && <AppIcon name="chevronDown" size={12} />}
                  </button>

                  {showVisibilityMenu && activeNote.owner_id === user?.id && (
                    <div className="visibility-menu-popup">
                      <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)', marginBottom: 8 }}>
                        IMPOSTAZIONI VISIBILITÀ
                      </div>
                      <div
                        className={`visibility-option ${visibility === 'private' ? 'selected' : ''}`}
                        onClick={() => handleToggleVisibility('private')}
                      >
                        <AppIcon name="lock" size={18} />
                        <div>
                          <div style={{ fontWeight: 600, fontSize: '0.85rem', color: 'var(--text-primary)' }}>File Privato</div>
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Visibile solo al tuo account personale</div>
                        </div>
                      </div>
                      <div
                        className={`visibility-option ${visibility === 'team' ? 'selected' : ''}`}
                        onClick={() => handleToggleVisibility('team')}
                        style={{ marginTop: 6 }}
                      >
                        <AppIcon name="users" size={18} />
                        <div>
                          <div style={{ fontWeight: 600, fontSize: '0.85rem', color: 'var(--text-primary)' }}>In Condivisione</div>
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Accessibile in lettura a tutto il team</div>
                        </div>
                      </div>
                      <div
                        className={`visibility-option ${visibility === 'selected' ? 'selected' : ''}`}
                        onClick={() => handleToggleVisibility('selected', sharedWith)}
                        style={{ marginTop: 6 }}
                      >
                        <AppIcon name="user-check" size={18} />
                        <div>
                          <div style={{ fontWeight: 600, fontSize: '0.85rem', color: 'var(--text-primary)' }}>Utenti Selezionati</div>
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Solo gli utenti scelti possono leggere</div>
                        </div>
                      </div>
                      {visibility === 'selected' && (
                        <div style={{ padding: '8px 12px', borderTop: '1px solid var(--border-subtle)', marginTop: 8 }}>
                          <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: 6 }}>SELEZIONA UTENTI</div>
                          <AssigneeInput 
                            selected={sharedWith} 
                            onChange={(newShared) => {
                              setSharedWith(newShared);
                              handleToggleVisibility('selected', newShared);
                            }} 
                            users={users} 
                          />
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* PULSANTE ELIMINA */}
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={handleDeleteNote}
                  style={{ color: '#f87171' }}
                  title="Elimina nota"
                >
                  <AppIcon name="trash" size={15} />
                  Elimina
                </button>
              </div>
            </div>

            {/* AREA SCROLLABILE: FORMATTING BAR + TITOLO + CONTENUTO + ALLEGATI */}
            <div className="notes-editor-scroll">
              {/* TOOLBAR DI FORMATTAZIONE STYLE NOTION */}
              <div className="notion-formatting-bar">
                <button type="button" className="format-btn" onClick={() => applyFormatting('normal')} title="Testo normale (P)">P Normale</button>
                <button type="button" className="format-btn" onClick={() => applyFormatting('h1')} title="Titolo grande (H1)">H1 Titolo</button>
                <button type="button" className="format-btn" onClick={() => applyFormatting('h2')} title="Sottotitolo (H2)">H2 Sottotitolo</button>
                <button type="button" className="format-btn" onClick={() => applyFormatting('bold')} title="Grassetto"><strong>B</strong> Grassetto</button>
                <button type="button" className="format-btn" onClick={() => applyFormatting('italic')} title="Corsivo"><em>I</em> Corsivo</button>
                <button type="button" className="format-btn" onClick={() => applyFormatting('bullet')} title="Elenco puntato">• Elenco</button>
                <button type="button" className="format-btn" onClick={() => applyFormatting('todo')} title="Check-list interattiva"><AppIcon name="check" size={14} /> Check-list [ ]</button>
                <button type="button" className="format-btn" onClick={() => applyFormatting('quote')} title="Citazione">❝ Citazione</button>
                <button type="button" className="format-btn" onClick={() => applyFormatting('code')} title="Blocco Codice">⟨/⟩ Codice</button>
              </div>

              {/* CAMPO TITOLO */}
              <input
                type="text"
                className="note-title-input"
                value={title}
                onChange={handleTitleChange}
                placeholder="Titolo del Blocco Note..."
              />

              {/* AREA TESTO VISUALE WYSIWYG CENTRALE */}
              <div
                ref={editorRef}
                contentEditable
                className="note-content-area"
                onInput={handleEditorInput}
                onClick={handleEditorClick}
                onKeyDown={handleEditorKeyDown}
                placeholder="Scrivi qui i tuoi appunti in stile Notion... Usa i pulsanti sopra per formattare con titoli, check-list e citazioni."
                suppressContentEditableWarning
              />

              {/* ALLEGATI DELLA NOTA */}
              {activeNote && (
                <div 
                  style={{ marginTop: 24, paddingTop: 16, borderTop: '1px solid var(--border-default)', paddingBottom: 16 }}
                  onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
                  onDrop={handleDropAttachment}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                    <h4 style={{ margin: 0, fontSize: 14, color: 'var(--text-secondary)' }}>Allegati</h4>
                    <div>
                      <input
                        type="file"
                        id="note-attachment-upload"
                        multiple
                        style={{ display: 'none' }}
                        onChange={handleUploadAttachment}
                      />
                      <label htmlFor="note-attachment-upload" className="btn btn-secondary btn-sm" style={{ cursor: 'pointer' }}>
                        + Aggiungi File
                      </label>
                    </div>
                  </div>
                  
                  {Array.isArray(activeNote.attachments) && activeNote.attachments.length > 0 ? (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                      {activeNote.attachments.map((att, idx) => (
                        <div key={idx} style={{ 
                          display: 'flex', alignItems: 'center', gap: 8, 
                          padding: '4px 12px', background: 'var(--bg-secondary)', 
                          border: '1px solid var(--border-subtle)', borderRadius: 16, fontSize: 13 
                        }}>
                          <a className="inline-detail-row" href={`${BACKEND_URL}/${att.path}`} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent-500)', textDecoration: 'none' }}>
                            <AppIcon name="paperclip" size={13} />{att.name}
                          </a>
                          <button 
                            onClick={() => handleDeleteAttachment(att.name)}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--danger)', padding: 0, fontSize: 14 }}
                            title="Elimina allegato"
                            aria-label="Elimina allegato"
                          >
                            <AppIcon name="close" size={13} />
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div style={{ fontSize: 13, color: 'var(--text-muted)', fontStyle: 'italic' }}>
                      Nessun allegato presente
                    </div>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </main>

      {/* MODALE NUOVA NOTA */}
      {showNewModal && (
        <div className="note-modal-overlay animate-fadeIn">
          <div className="note-modal-box" onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h3 style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
                Nuovo blocco note
              </h3>
              <button
                type="button"
                className="btn-ghost btn-icon"
                onClick={() => setShowNewModal(false)}
                aria-label="Chiudi"
              >
                <AppIcon name="close" />
              </button>
            </div>

            <form onSubmit={handleCreateNote}>
              <div className="input-group">
                <label>Titolo del Blocco Note *</label>
                <input
                  type="text"
                  className="input"
                  placeholder="Es. Check-list collaudo o Appunti di riunione..."
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  required
                  autoFocus
                />
              </div>

              <div className="input-group" style={{ marginTop: 20 }}>
                <label>Visibilità Iniziale del File</label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 8 }}>
                  <label
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 12,
                      padding: 14,
                      borderRadius: 10,
                      background: newVisibility === 'private' ? 'rgba(56, 189, 248, 0.1)' : 'rgba(255, 255, 255, 0.03)',
                      border: `1px solid ${newVisibility === 'private' ? '#38bdf8' : 'var(--border-subtle)'}`,
                      cursor: 'pointer'
                    }}
                  >
                    <input
                      type="radio"
                      name="visibility"
                      checked={newVisibility === 'private'}
                      onChange={() => setNewVisibility('private')}
                      style={{ marginTop: 3 }}
                    />
                    <div>
                      <div className="inline-heading" style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '0.9rem' }}><AppIcon name="lock" size={15} />File privato</div>
                      <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: 2 }}>
                        Visibile solo a te. Potrai comunque renderlo condiviso in qualsiasi momento una volta aperto.
                      </div>
                    </div>
                  </label>

                  <label
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 12,
                      padding: 14,
                      borderRadius: 10,
                      background: newVisibility === 'team' ? 'rgba(16, 185, 129, 0.1)' : 'rgba(255, 255, 255, 0.03)',
                      border: `1px solid ${newVisibility === 'team' ? '#34d399' : 'var(--border-subtle)'}`,
                      cursor: 'pointer'
                    }}
                  >
                    <input
                      type="radio"
                      name="visibility"
                      checked={newVisibility === 'team'}
                      onChange={() => setNewVisibility('team')}
                      style={{ marginTop: 3 }}
                    />
                    <div>
                      <div className="inline-heading" style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '0.9rem' }}><AppIcon name="users" size={15} />Condiviso con il team</div>
                      <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: 2 }}>
                        Accessibile a tutto il personale per la consultazione e la collaborazione comune.
                      </div>
                    </div>
                  </label>

                  <div style={{
                    borderRadius: 10,
                    background: newVisibility === 'selected' ? 'rgba(245, 158, 11, 0.1)' : 'rgba(255, 255, 255, 0.03)',
                    border: `1px solid ${newVisibility === 'selected' ? '#f59e0b' : 'var(--border-subtle)'}`,
                    display: 'flex',
                    flexDirection: 'column'
                  }}>
                    <label
                      style={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: 12,
                        padding: 14,
                        cursor: 'pointer'
                      }}
                    >
                      <input
                        type="radio"
                        name="visibility"
                        checked={newVisibility === 'selected'}
                        onChange={() => setNewVisibility('selected')}
                        style={{ marginTop: 3 }}
                      />
                      <div>
                        <div className="inline-heading" style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '0.9rem' }}><AppIcon name="user-check" size={15} />Utenti selezionati</div>
                        <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: 2 }}>
                          Scegli manualmente quali utenti possono leggere questo blocco note.
                        </div>
                      </div>
                    </label>
                    {newVisibility === 'selected' && (
                      <div style={{ padding: '0 14px 14px 44px' }}>
                        <AssigneeInput 
                          selected={newSharedWith} 
                          onChange={setNewSharedWith} 
                          users={users} 
                          placeholder="Cerca utente per aggiungerlo..."
                        />
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 28 }}>
                <button type="button" className="btn btn-secondary" onClick={() => setShowNewModal(false)}>
                  Annulla
                </button>
                <button type="submit" className="btn btn-primary">
                  Crea e Apri Blocco Note →
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
