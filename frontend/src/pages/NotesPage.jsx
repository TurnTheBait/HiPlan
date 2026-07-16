import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import './NotesPage.css';

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
  const [isShared, setIsShared] = useState(false);

  // Stato UI editor
  const [saving, setSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState(null);
  const [showVisibilityMenu, setShowVisibilityMenu] = useState(false);

  // Modale Nuova Nota
  const [showNewModal, setShowNewModal] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newIsShared, setNewIsShared] = useState(false);

  // Ref per l'editor visuale contentEditable e timeout autocalcolato
  const editorRef = useRef(null);
  const saveTimeoutRef = useRef(null);

  useEffect(() => {
    loadNotes();
  }, []);

  async function loadNotes() {
    setLoading(true);
    try {
      const { data } = await api.get('/notes');
      setNotes(data);
      if (data.length > 0 && !activeNoteId) {
        selectNote(data[0]);
      }
    } catch {
      toast.error('Errore durante il caricamento dei blocchi note');
    } finally {
      setLoading(false);
    }
  }

  function selectNote(note) {
    if (!note) {
      setActiveNoteId(null);
      if (editorRef.current) editorRef.current.innerHTML = '';
      return;
    }
    setActiveNoteId(note.id);
    setTitle(note.title || '');
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

  // Cambio Visibilità (Privato vs Condiviso)
  async function handleToggleVisibility(targetShared) {
    if (!activeNoteId || targetShared === isShared) {
      setShowVisibilityMenu(false);
      return;
    }
    try {
      const { data } = await api.patch(`/notes/${activeNoteId}`, {
        is_shared: targetShared
      });
      setIsShared(data.is_shared);
      setNotes(prev => prev.map(n => n.id === activeNoteId ? data : n));
      setShowVisibilityMenu(false);
      toast.success(data.is_shared ? 'Blocco note condiviso con il team!' : 'Blocco note reso privato!');
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
        is_shared: newIsShared
      });
      setNotes(prev => [data, ...prev]);
      selectNote(data);
      setShowNewModal(false);
      setNewTitle('');
      setNewIsShared(false);
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
      if (!n.is_shared && n.owner_id !== user?.id) return false;
      if (activeTab === 'private' && n.is_shared) return false;
      if (activeTab === 'shared' && !n.is_shared) return false;
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
    return date.toLocaleDateString('it-IT', { day: '2-digit', month: 'short' });
  }

  if (loading) return <div className="loading-screen"><div className="spinner" /></div>;

  return (
    <div className="notes-page-container animate-fadeIn">
      {/* SIDEBAR SINISTRA */}
      <aside className="notes-sidebar">
        <div className="notes-sidebar-top">
          <div className="notes-sidebar-title">
            <span>▤ Blocchi Note</span>
          </div>
          <button
            className="btn btn-primary btn-sm"
            onClick={() => {
              setNewTitle('');
              setNewIsShared(false);
              setShowNewModal(true);
            }}
            style={{ borderRadius: '20px', padding: '6px 12px', fontWeight: 600 }}
          >
            + Nuova
          </button>
        </div>

        {/* CAMPO DI RICERCA */}
        <div className="notes-search-wrapper">
          <span className="notes-search-icon">🔍</span>
          <input
            type="text"
            className="notes-search-input"
            placeholder="Cerca tra gli appunti..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
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
            🔒 Private
          </button>
          <button
            className={`notes-tab-btn ${activeTab === 'shared' ? 'active' : ''}`}
            onClick={() => setActiveTab('shared')}
          >
            👥 Condivise
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
                    <span className={`note-visibility-badge ${note.is_shared ? 'badge-shared' : 'badge-private'}`}>
                      {note.is_shared ? '👥 Condiviso' : '🔒 Privato'}
                    </span>
                  </div>
                  <div className="note-card-snippet">
                    {getCleanSnippet(note.content)}
                  </div>
                  <div className="note-card-meta">
                    <span>👤 {note.owner?.full_name || note.owner?.username || (isMine ? 'Tu' : 'Utente')}</span>
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
            <span style={{ fontSize: '3rem', marginBottom: '16px' }}>▤</span>
            <h3 style={{ fontSize: '1.25rem', color: 'var(--text-primary)', marginBottom: '8px' }}>Seleziona o crea un blocco note</h3>
            <p style={{ maxWidth: 400, marginBottom: '24px', lineHeight: 1.5 }}>
              Scrivi appunti, specifiche di commessa o check-list con formattazione visuale in stile Notion. Puoi decidere in qualsiasi momento se mantenere il file privato o condividerlo con il resto del team.
            </p>
            <button
              className="btn btn-primary"
              onClick={() => {
                setNewTitle('');
                setNewIsShared(false);
                setShowNewModal(true);
              }}
            >
              + Crea il primo Blocco Note
            </button>
          </div>
        ) : (
          <>
            {/* TOOLBAR TOP (OWNER, VISIBILITÀ, AZIONI) */}
            <div className="notes-editor-toolbar-top">
              <div className="note-owner-info">
                <span className="sidebar-avatar" style={{ width: 26, height: 26, fontSize: '0.7rem' }}>
                  {activeNote.owner?.username?.[0]?.toUpperCase() || 'U'}
                </span>
                <span>
                  Autore: <strong>{activeNote.owner?.full_name || activeNote.owner?.username || (activeNote.owner_id === user?.id ? 'Tu' : 'Utente')}</strong>
                </span>
                {saving && <span style={{ color: '#38bdf8', fontSize: '0.75rem', marginLeft: 12 }}>⏳ Salvataggio...</span>}
                {!saving && lastSaved && <span style={{ color: '#34d399', fontSize: '0.75rem', marginLeft: 12 }}>✓ Salvato {lastSaved.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}</span>}
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                {/* MENU TOGGLE MODIFICA VISIBILITÀ */}
                <div className="visibility-toggle-dropdown">
                  <button
                    type="button"
                    className={`visibility-btn-interactive ${isShared ? 'badge-shared' : 'badge-private'}`}
                    onClick={() => setShowVisibilityMenu(!showVisibilityMenu)}
                    title="Clicca per modificare la visibilità del blocco note"
                  >
                    {isShared ? '👥 Condiviso (Modifica ▼)' : '🔒 Privato (Modifica ▼)'}
                  </button>

                  {showVisibilityMenu && (
                    <div className="visibility-menu-popup">
                      <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)', marginBottom: 8 }}>
                        IMPOSTAZIONI VISIBILITÀ
                      </div>
                      <div
                        className={`visibility-option ${!isShared ? 'selected' : ''}`}
                        onClick={() => handleToggleVisibility(false)}
                      >
                        <span style={{ fontSize: '1.2rem' }}>🔒</span>
                        <div>
                          <div style={{ fontWeight: 600, fontSize: '0.85rem', color: 'var(--text-primary)' }}>File Privato</div>
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Visibile solo al tuo account personale</div>
                        </div>
                      </div>
                      <div
                        className={`visibility-option ${isShared ? 'selected' : ''}`}
                        onClick={() => handleToggleVisibility(true)}
                        style={{ marginTop: 6 }}
                      >
                        <span style={{ fontSize: '1.2rem' }}>👥</span>
                        <div>
                          <div style={{ fontWeight: 600, fontSize: '0.85rem', color: 'var(--text-primary)' }}>In Condivisione</div>
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Accessibile in lettura/modifica a tutto il team</div>
                        </div>
                      </div>
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
                  🗑️ Elimina
                </button>
              </div>
            </div>

            {/* TOOLBAR DI FORMATTAZIONE STYLE NOTION */}
            <div className="notion-formatting-bar">
              <button type="button" className="format-btn" onClick={() => applyFormatting('normal')} title="Testo normale (P)">P Normale</button>
              <button type="button" className="format-btn" onClick={() => applyFormatting('h1')} title="Titolo grande (H1)">H1 Titolo</button>
              <button type="button" className="format-btn" onClick={() => applyFormatting('h2')} title="Sottotitolo (H2)">H2 Sottotitolo</button>
              <button type="button" className="format-btn" onClick={() => applyFormatting('bold')} title="Grassetto"><strong>B</strong> Grassetto</button>
              <button type="button" className="format-btn" onClick={() => applyFormatting('italic')} title="Corsivo"><em>I</em> Corsivo</button>
              <button type="button" className="format-btn" onClick={() => applyFormatting('bullet')} title="Elenco puntato">• Elenco</button>
              <button type="button" className="format-btn" onClick={() => applyFormatting('todo')} title="Check-list interattiva">☑ Check-list [ ]</button>
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
          </>
        )}
      </main>

      {/* MODALE NUOVA NOTA */}
      {showNewModal && (
        <div className="note-modal-overlay animate-fadeIn" onClick={() => setShowNewModal(false)}>
          <div className="note-modal-box" onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h3 style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
                ▤ Nuovo Blocco Note
              </h3>
              <button
                type="button"
                className="btn-ghost"
                onClick={() => setShowNewModal(false)}
                style={{ fontSize: '1.2rem', padding: '4px 8px' }}
              >
                ✕
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
                      background: !newIsShared ? 'rgba(56, 189, 248, 0.1)' : 'rgba(255, 255, 255, 0.03)',
                      border: `1px solid ${!newIsShared ? '#38bdf8' : 'var(--border-subtle)'}`,
                      cursor: 'pointer'
                    }}
                  >
                    <input
                      type="radio"
                      name="visibility"
                      checked={!newIsShared}
                      onChange={() => setNewIsShared(false)}
                      style={{ marginTop: 3 }}
                    />
                    <div>
                      <div style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '0.9rem' }}>🔒 File Privato</div>
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
                      background: newIsShared ? 'rgba(16, 185, 129, 0.1)' : 'rgba(255, 255, 255, 0.03)',
                      border: `1px solid ${newIsShared ? '#34d399' : 'var(--border-subtle)'}`,
                      cursor: 'pointer'
                    }}
                  >
                    <input
                      type="radio"
                      name="visibility"
                      checked={newIsShared}
                      onChange={() => setNewIsShared(true)}
                      style={{ marginTop: 3 }}
                    />
                    <div>
                      <div style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '0.9rem' }}>👥 In Condivisione con il Team</div>
                      <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: 2 }}>
                        Accessibile a tutto il personale per la consultazione e la collaborazione comune.
                      </div>
                    </div>
                  </label>
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
