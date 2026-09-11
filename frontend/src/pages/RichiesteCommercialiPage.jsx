import { useState, useEffect, useCallback, useRef } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import AppIcon from '../components/ui/AppIcon';
import {
  listRichieste,
  getRichiesta,
  createRichiesta,
  updateRichiesta,
  deleteRichiesta,
  getTrashRichieste,
  restoreRichiesta,
  hardDeleteRichiesta,
  emptyTrashRichieste,
  uploadAttachmentsRichiesta,
  prendiInCarico,
  addArticolo,
  updateArticolo,
  deleteArticolo,
  uploadAttachmentsArticolo,
  inviaAdAdmin,
  salvaArticoli,
  completaRichiesta,
  getMyRole,
  getRCUsers,
} from '../api/richiesteCommerciali';
import './RichiesteCommercialiPage.css';

// ─── Costanti ─────────────────────────────────────────────────────────────────

const STATUS_CONFIG = {
  aperta: { label: 'Aperta', dot: 'aperta', color: '#ef4444', bg: 'rgba(239, 68, 68, 0.12)' },
  in_lavorazione: { label: 'In Lavorazione', dot: 'in_lavorazione', color: '#f59e0b', bg: 'rgba(245, 158, 11, 0.12)' },
  manca_listino: { label: 'Manca Listino', dot: 'manca_listino', color: '#3b82f6', bg: 'rgba(59, 130, 246, 0.12)' },
  completata: { label: 'Completata', dot: 'completata', color: '#10b981', bg: 'rgba(16, 185, 129, 0.12)' },
};

const TIPO_FORNITURA_LABELS = {
  materie_prime: 'Materie Prime',
  mp_lavorazione: 'MP + Lavorazione',
  compravendita: 'Compravendita',
};

const STATUS_FILTER_TABS = [
  { key: 'in_lavorazione', label: 'In Lavorazione', color: '#f59e0b' },
  { key: 'manca_listino', label: 'Manca Listino', color: '#3b82f6' },
  { key: 'completata', label: 'Completate', color: '#10b981' },
];

const BACKEND_URL = import.meta.env.VITE_API_URL
  ? import.meta.env.VITE_API_URL.replace(/\/api\/?$/, '')
  : `http://${window.location.hostname}:8000`;

function getAttachmentUrl(pathOrUrl) {
  if (!pathOrUrl) return '';
  if (pathOrUrl.startsWith('http://') || pathOrUrl.startsWith('https://')) {
    return pathOrUrl;
  }
  const clean = pathOrUrl.startsWith('/') ? pathOrUrl : `/${pathOrUrl}`;
  return `${BACKEND_URL}${clean}`;
}

function getAttachmentInfo(att) {
  if (!att) return { name: '', url: '' };
  if (typeof att === 'string') {
    let name = att.split('/').pop() || att;
    if (name.includes('_')) {
      const parts = name.split('_');
      if (parts[0].length <= 12) {
        name = parts.slice(1).join('_');
      }
    }
    return {
      name: decodeURIComponent(name),
      url: getAttachmentUrl(att),
    };
  }
  return {
    name: att.name || (att.url ? decodeURIComponent(att.url.split('/').pop()) : 'Allegato'),
    url: getAttachmentUrl(att.url || att.path),
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function StatusBadge({ status }) {
  const cfg = STATUS_CONFIG[status] || { label: status, color: 'var(--text-secondary)', bg: 'var(--bg-tertiary)' };
  return (
    <span className={`rc-status-pill status-${status}`} style={{ color: cfg.color, background: cfg.bg }}>
      <span className="rc-status-dot" style={{ background: cfg.color }} />
      {cfg.label}
    </span>
  );
}

function parseDate(dt) {
  if (!dt) return null;
  const str = String(dt);
  const hasTimezone = /Z|[+-]\d{2}(?::?\d{2})?$/i.test(str);
  const normalized = hasTimezone ? str : `${str.replace(' ', 'T')}Z`;
  const d = new Date(normalized);
  return isNaN(d.getTime()) ? null : d;
}

function formatDate(dt) {
  const d = parseDate(dt);
  if (!d) return '—';
  return d.toLocaleString('it-IT', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function formatCurrency(v) {
  if (v == null) return '—';
  return new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(v);
}

/** Visualizza i badge diff (vecchio testo sbarrato in rosso, nuovo testo in verde) solo se c'è una modifica effettiva. */
function TextDiffBadges({ original, current }) {
  const origTrimmed = (original || '').trim();
  const currTrimmed = (current || '').trim();
  if (!origTrimmed || !currTrimmed || origTrimmed === currTrimmed) {
    return null;
  }
  return (
    <div className="rc-diff-badges">
      <span className="rc-diff-original" title="Testo originale precedente">{origTrimmed}</span>
      <span className="rc-diff-modified" title="Testo modificato">{currTrimmed}</span>
    </div>
  );
}

function TextDiff({ original, current }) {
  if (!original || original === current) {
    return <span>{current || '—'}</span>;
  }
  return <TextDiffBadges original={original} current={current} />;
}

// ─── Dropzone Component ───────────────────────────────────────────────────────

function Dropzone({ files, onFilesChange, existingUrls = [] }) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef();

  const handleDrop = (e) => {
    e.preventDefault();
    setDragging(false);
    const dropped = Array.from(e.dataTransfer.files);
    onFilesChange([...files, ...dropped]);
  };

  return (
    <div>
      <div
        className={`rc-dropzone${dragging ? ' dragover' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
      >
        <span className="rc-dropzone__icon"><AppIcon name="paperclip" size={22} /></span>
        <span>Trascina i file qui o clicca per selezionare allegati</span>
        <input
          ref={inputRef}
          type="file"
          multiple
          style={{ display: 'none' }}
          onChange={(e) => onFilesChange([...files, ...Array.from(e.target.files)])}
        />
      </div>
      <div className="rc-attachments-list">
        {files.map((f, i) => (
          <div key={i} className="rc-attachment-chip">
            <AppIcon name="fileText" size={14} />
            <span className="rc-attachment-name">{f.name}</span>
            <button type="button" className="rc-attachment-remove" onClick={() => onFilesChange(files.filter((_, j) => j !== i))}>
              <AppIcon name="close" size={12} />
            </button>
          </div>
        ))}
        {existingUrls.map((url, i) => {
          const info = getAttachmentInfo(url);
          return (
            <div key={`ex-${i}`} className="rc-attachment-chip">
              <AppIcon name="fileText" size={14} />
              <a
                href={info.url}
                target="_blank"
                rel="noopener noreferrer"
                className="rc-attachment-link"
                title={`Apri ${info.name} in una nuova scheda`}
              >
                {info.name}
              </a>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ArticleDropzone({ existingAttachments = [], pendingFiles = [], onUpload, onRemovePending, isUploading }) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef();

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragging(false);
    const dropped = Array.from(e.dataTransfer.files);
    if (dropped.length > 0 && onUpload) {
      onUpload(dropped);
    }
  };

  return (
    <div className="rc-article-dropzone-box">
      <div
        className={`rc-dropzone rc-dropzone--article${dragging ? ' dragover' : ''}${isUploading ? ' is-uploading' : ''}`}
        onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setDragging(true); }}
        onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); setDragging(false); }}
        onDrop={handleDrop}
        onClick={() => !isUploading && inputRef.current?.click()}
      >
        <span className="rc-dropzone__icon">
          <AppIcon name="paperclip" size={17} />
        </span>
        <span className="rc-dropzone__text">
          {isUploading ? (
            'Caricamento allegati in corso...'
          ) : (
            <>
              <strong>Trascina i file qui</strong> oppure <span className="rc-dropzone__link">clicca per selezionare allegati</span>
            </>
          )}
        </span>
        <input
          ref={inputRef}
          type="file"
          multiple
          style={{ display: 'none' }}
          onChange={(e) => {
            const files = Array.from(e.target.files);
            if (files.length > 0 && onUpload) onUpload(files);
            e.target.value = '';
          }}
        />
      </div>

      {/* Allegati esistenti sul server */}
      {existingAttachments?.length > 0 && (
        <div className="rc-attachments-list" style={{ marginTop: 8 }}>
          {existingAttachments.map((att, i) => {
            const info = getAttachmentInfo(att);
            return (
              <div key={i} className="rc-attachment-chip">
                <AppIcon name="fileText" size={13} />
                <a
                  href={info.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rc-attachment-link"
                  title={`Apri ${info.name} in una nuova scheda`}
                >
                  {info.name}
                </a>
              </div>
            );
          })}
        </div>
      )}

      {/* File locali in attesa di caricamento / salvataggio */}
      {pendingFiles?.length > 0 && (
        <div className="rc-attachments-list" style={{ marginTop: 8 }}>
          {pendingFiles.map((file, i) => (
            <div key={`pending-${i}`} className="rc-attachment-chip rc-attachment-chip--pending">
              <AppIcon name="fileText" size={13} />
              <span className="rc-attachment-name" style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={file.name}>
                {file.name}
              </span>
              {onRemovePending && (
                <button
                  type="button"
                  className="btn-icon btn-ghost"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemovePending(i);
                  }}
                  style={{ padding: 2, marginLeft: 4 }}
                  title="Rimuovi file selezionato"
                >
                  <AppIcon name="close" size={11} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function getErrorMessage(err, defaultMsg = 'Si è verificato un errore') {
  return err.response?.data?.detail || err.message || defaultMsg;
}

// ─── Modal di Conferma Azioni ─────────────────────────────────────────────────

function ConfirmActionModal({
  isOpen,
  title,
  message,
  confirmLabel = 'Conferma',
  cancelLabel = 'Annulla',
  confirmVariant = 'primary',
  confirmIcon = 'check',
  loading = false,
  onConfirm,
  onCancel,
}) {
  if (!isOpen) return null;

  const getVariantStyles = () => {
    switch (confirmVariant) {
      case 'success':
        return { background: 'linear-gradient(135deg, #16a34a, #15803d)', borderColor: '#16a34a', color: '#fff' };
      case 'warning':
        return { background: 'linear-gradient(135deg, #d97706, #b45309)', borderColor: '#d97706', color: '#fff' };
      case 'danger':
        return { background: 'linear-gradient(135deg, #dc2626, #b91c1c)', borderColor: '#dc2626', color: '#fff' };
      default:
        return {};
    }
  };

  return (
    <div className="rc-modal-overlay rc-modal-overlay--confirm" onClick={loading ? undefined : onCancel}>
      <div className="rc-modal rc-modal--confirm" onClick={(e) => e.stopPropagation()}>
        <div className="rc-modal__header">
          <h3 className="rc-modal__title" style={{ fontSize: '1.05rem' }}>
            <AppIcon name={confirmIcon} size={18} /> {title}
          </h3>
          <button
            type="button"
            className="btn-icon btn-ghost"
            onClick={onCancel}
            disabled={loading}
            aria-label="Chiudi"
          >
            <AppIcon name="close" size={16} />
          </button>
        </div>
        <div className="rc-modal__body" style={{ padding: '20px 24px' }}>
          <p style={{ margin: 0, fontSize: '0.92rem', lineHeight: '1.5', color: 'var(--text-secondary)' }}>
            {message}
          </p>
        </div>
        <div className="rc-modal__footer" style={{ padding: '14px 24px', gap: 10 }}>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onCancel}
            disabled={loading}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            style={getVariantStyles()}
            onClick={onConfirm}
            disabled={loading}
          >
            {loading ? 'Attendi...' : (
              <>
                <AppIcon name={confirmIcon} size={15} /> {confirmLabel}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Modal Nuova Richiesta ────────────────────────────────────────────────────

// ─── Modal Nuova Richiesta ────────────────────────────────────────────────────

function NuovaRichiestaModal({ onClose, onCreated }) {
  const [form, setForm] = useState({ title: '', descrizione: '', numero_offerta: '', cliente: '' });
  const [articoli, setArticoli] = useState([]);
  const [files, setFiles] = useState([]);
  const [saving, setSaving] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const { showToast } = useToast();

  const handleAddArticolo = () => {
    setArticoli(prev => [
      ...prev,
      {
        id: Date.now() + Math.random(),
        titolo: '',
        descrizione: '',
        is_standard: false,
        is_atex: false,
        is_alimentare: false,
        tipo_fornitura: null,
      },
    ]);
  };

  const handleRemoveArticolo = (index) => {
    setArticoli(prev => prev.filter((_, i) => i !== index));
  };

  const handleUpdateArticoloField = (index, field, value) => {
    setArticoli(prev => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      return next;
    });
  };

  const handleToggleArticoloTipologia = (index, type) => {
    setArticoli(prev => {
      const next = [...prev];
      const art = { ...next[index] };
      if (type === 'standard') {
        art.is_standard = !art.is_standard;
        art.is_atex = false;
        art.is_alimentare = false;
      } else if (type === 'atex') {
        art.is_atex = !art.is_atex;
        art.is_standard = false;
      } else if (type === 'alimentare') {
        art.is_alimentare = !art.is_alimentare;
        art.is_standard = false;
      }
      next[index] = art;
      return next;
    });
  };

  const handlePreSubmit = (e) => {
    e.preventDefault();
    if (!form.title.trim() || !form.cliente.trim()) {
      showToast('Titolo e Cliente sono obbligatori', 'error');
      return;
    }
    for (let i = 0; i < articoli.length; i++) {
      if (!articoli[i].titolo.trim()) {
        showToast(`Inserisci il titolo per l'Articolo #${i + 1}`, 'error');
        return;
      }
    }
    setShowConfirm(true);
  };

  const handleConfirmCreate = async () => {
    setSaving(true);
    try {
      const payload = {
        ...form,
        articoli: articoli.map(({ id, ...rest }) => rest),
      };
      const created = await createRichiesta(payload);
      if (files.length > 0 && created?.id) {
        await uploadAttachmentsRichiesta(created.id, files);
      }
      showToast('Richiesta creata con successo! L\'ufficio acquisti è stato notificato via email.', 'success');
      setShowConfirm(false);
      if (onCreated) {
        await onCreated(created);
      }
      onClose();
    } catch (err) {
      showToast(getErrorMessage(err, 'Errore nella creazione della richiesta'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const confirmArticlesText = articoli.length > 0
    ? ` con ${articoli.length} ${articoli.length === 1 ? 'articolo specificato' : 'articoli specificati'}`
    : '';

  return (
    <>
      <div className="rc-modal-overlay">
        <div className="rc-modal rc-modal--large">
          <div className="rc-modal__header">
            <h2 className="rc-modal__title">
              <AppIcon name="plus" size={20} /> Nuova Richiesta Preventivo
            </h2>
            <button type="button" className="btn-icon btn-ghost" onClick={onClose} aria-label="Chiudi">
              <AppIcon name="close" size={18} />
            </button>
          </div>
          <form onSubmit={handlePreSubmit} className="rc-modal-form">
            <div className="rc-modal__body">
              <div className="rc-form-row">
                <div className="rc-form-group">
                  <label className="rc-label">Titolo <span className="required">*</span></label>
                  <input
                    className="input"
                    value={form.title}
                    onChange={(e) => setForm({ ...form, title: e.target.value })}
                    placeholder="Titolo richiesta"
                    required
                  />
                </div>
                <div className="rc-form-group">
                  <label className="rc-label">Cliente <span className="required">*</span></label>
                  <input
                    className="input"
                    value={form.cliente}
                    onChange={(e) => setForm({ ...form, cliente: e.target.value })}
                    placeholder="Nome cliente"
                    required
                  />
                </div>
              </div>
              <div className="rc-form-group" style={{ maxWidth: 420 }}>
                <label className="rc-label"># Offerta</label>
                <input
                  className="input"
                  value={form.numero_offerta}
                  onChange={(e) => setForm({ ...form, numero_offerta: e.target.value })}
                  placeholder="Numero offerta"
                />
              </div>
              <div className="rc-form-group">
                <label className="rc-label">Descrizione</label>
                <textarea
                  className="input"
                  value={form.descrizione}
                  onChange={(e) => setForm({ ...form, descrizione: e.target.value })}
                  placeholder="Descrizione dettagliata della richiesta..."
                  rows={3}
                />
              </div>

              {/* ── Articoli da Preventivare (opzionale per il commerciale) ── */}
              <div style={{ marginTop: 18, marginBottom: 18 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
                  <div>
                    <label className="rc-label" style={{ marginBottom: 2, display: 'flex', alignItems: 'center', gap: 6 }}>
                      <AppIcon name="list" size={15} />
                      Articoli da Preventivare {articoli.length > 0 && `(${articoli.length})`}
                    </label>
                    <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                      Puoi indicare gli articoli richiesti (i costi saranno inseriti dall'Ufficio Acquisti).
                    </span>
                  </div>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={handleAddArticolo}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 10px', height: 30, fontSize: '0.8rem' }}
                  >
                    <AppIcon name="plus" size={12} /> Aggiungi Articolo
                  </button>
                </div>

                {articoli.length === 0 ? (
                  <div
                    onClick={handleAddArticolo}
                    style={{
                      padding: '14px 16px',
                      border: '1px dashed var(--border)',
                      borderRadius: 8,
                      textAlign: 'center',
                      cursor: 'pointer',
                      background: 'var(--bg-secondary)',
                      transition: 'all 0.15s ease',
                    }}
                    title="Clicca per aggiungere un articolo"
                  >
                    <span style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                      Nessun articolo aggiunto. <strong style={{ color: 'var(--accent-500)' }}>+ Clicca qui per aggiungere un articolo</strong>
                    </span>
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {articoli.map((art, idx) => (
                      <div
                        key={art.id}
                        style={{
                          background: 'var(--bg-secondary)',
                          border: '1px solid var(--border)',
                          borderRadius: 8,
                          padding: '12px 14px',
                        }}
                      >
                        {/* Header articolo */}
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                          <span style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--accent-500)', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                            <span style={{ width: 18, height: 18, borderRadius: '50%', background: 'var(--accent-500)', color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.72rem' }}>
                              {idx + 1}
                            </span>
                            Articolo #{idx + 1}
                          </span>
                          <button
                            type="button"
                            className="btn-icon btn-ghost text-danger"
                            onClick={() => handleRemoveArticolo(idx)}
                            style={{ padding: 3 }}
                            title="Rimuovi questo articolo"
                          >
                            <AppIcon name="close" size={13} />
                          </button>
                        </div>

                        {/* Titolo articolo */}
                        <div className="rc-form-group" style={{ marginBottom: 8 }}>
                          <label className="rc-label" style={{ fontSize: '0.8rem' }}>Titolo Articolo <span className="required">*</span></label>
                          <input
                            className="input"
                            value={art.titolo}
                            onChange={(e) => handleUpdateArticoloField(idx, 'titolo', e.target.value)}
                            placeholder="Es. Motoriduttore, Pompa, Sensore..."
                            style={{ fontSize: '0.85rem', padding: '5px 10px', height: 32 }}
                            required
                          />
                        </div>

                        {/* Descrizione articolo */}
                        <div className="rc-form-group" style={{ marginBottom: 8 }}>
                          <label className="rc-label" style={{ fontSize: '0.8rem' }}>Specifiche / Note per Acquisti</label>
                          <textarea
                            className="input"
                            rows={2}
                            value={art.descrizione}
                            onChange={(e) => handleUpdateArticoloField(idx, 'descrizione', e.target.value)}
                            placeholder="Codice fornitore, dimensioni o specifiche tecniche..."
                            style={{ fontSize: '0.82rem', padding: '6px 10px' }}
                          />
                        </div>

                        {/* Tipologia Prodotto e Tipo Fornitura */}
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'center' }}>
                          <div>
                            <span style={{ fontSize: '0.76rem', color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>Tipologia Prodotto</span>
                            <div className="rc-pill-group">
                              <button
                                type="button"
                                className={`rc-pill-chip rc-pill-chip--standard ${art.is_standard ? 'is-active' : ''}`}
                                onClick={() => handleToggleArticoloTipologia(idx, 'standard')}
                                style={{ padding: '2px 8px', fontSize: '0.76rem' }}
                              >
                                <span className={`rc-pill-chip__indicator ${art.is_standard ? 'is-active' : ''}`}>
                                  {art.is_standard && <AppIcon name="check" size={10} />}
                                </span>
                                <span>Standard</span>
                              </button>
                              <button
                                type="button"
                                className={`rc-pill-chip rc-pill-chip--atex ${art.is_atex ? 'is-active' : ''}`}
                                onClick={() => handleToggleArticoloTipologia(idx, 'atex')}
                                style={{ padding: '2px 8px', fontSize: '0.76rem' }}
                              >
                                <span className={`rc-pill-chip__indicator ${art.is_atex ? 'is-active' : ''}`}>
                                  {art.is_atex && <AppIcon name="check" size={10} />}
                                </span>
                                <span>ATEX</span>
                              </button>
                              <button
                                type="button"
                                className={`rc-pill-chip rc-pill-chip--alimentare ${art.is_alimentare ? 'is-active' : ''}`}
                                onClick={() => handleToggleArticoloTipologia(idx, 'alimentare')}
                                style={{ padding: '2px 8px', fontSize: '0.76rem' }}
                              >
                                <span className={`rc-pill-chip__indicator ${art.is_alimentare ? 'is-active' : ''}`}>
                                  {art.is_alimentare && <AppIcon name="check" size={10} />}
                                </span>
                                <span>Alimentare</span>
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="rc-form-group" style={{ marginBottom: 0 }}>
                <label className="rc-label">Allegati</label>
                <Dropzone files={files} onFilesChange={setFiles} />
              </div>
            </div>
            <div className="rc-modal__footer">
              <button type="button" className="btn btn-secondary" onClick={onClose}>Annulla</button>
              <button type="submit" className="btn btn-primary" disabled={saving}>
                <AppIcon name="plus" size={16} /> Crea Richiesta
              </button>
            </div>
          </form>
        </div>
      </div>

      <ConfirmActionModal
        isOpen={showConfirm}
        title="Conferma Creazione Richiesta"
        message={`Sei sicuro di voler creare e inviare la richiesta di preventivo per il cliente "${form.cliente}"${confirmArticlesText}? L'ufficio acquisti riceverà una notifica via email.`}
        confirmLabel="Crea Richiesta"
        confirmIcon="plus"
        confirmVariant="primary"
        loading={saving}
        onConfirm={handleConfirmCreate}
        onCancel={() => !saving && setShowConfirm(false)}
      />
    </>
  );
}

// ─── Form Articolo (acquisti) ─────────────────────────────────────────────────

function ArticoloForm({ richiestaId, articolo, userRole, status, index = 0, onSaved, onCancel }) {
  const [form, setForm] = useState(articolo ? {
    titolo: articolo.titolo || '',
    costo: (articolo.costo != null && articolo.costo > 0) ? articolo.costo : '',
    descrizione: articolo.descrizione || '',
    is_standard: Boolean(articolo.is_standard),
    is_atex: Boolean(articolo.is_atex),
    is_alimentare: Boolean(articolo.is_alimentare),
    tipo_fornitura: articolo.tipo_fornitura || null,
    prezzo_listino: articolo.prezzo_listino != null ? articolo.prezzo_listino : '',
    note_admin: articolo.note_admin || '',
  } : {
    titolo: '', costo: '', descrizione: '',
    is_standard: false, is_atex: false, is_alimentare: false,
    tipo_fornitura: null,
    prezzo_listino: '',
    note_admin: '',
  });
  const [files, setFiles] = useState([]);
  const [saving, setSaving] = useState(false);
  const { showToast } = useToast();

  let originalSnap = null;
  if (userRole === 'admin' && articolo?.testo_originale_acquisti) {
    try { originalSnap = JSON.parse(articolo.testo_originale_acquisti); } catch { originalSnap = null; }
  }
  const origTitolo = (originalSnap && originalSnap.titolo !== undefined) ? originalSnap.titolo : (articolo?.titolo || '');
  const origDesc = (originalSnap && originalSnap.descrizione !== undefined) ? originalSnap.descrizione : (articolo?.descrizione || '');
  const origNote = (originalSnap && originalSnap.note_admin !== undefined) ? originalSnap.note_admin : (articolo?.note_admin || '');

  const handleToggleTipologia = (type) => {
    if (type === 'standard') {
      // Standard: esclusivo (se attivato, spegne sia ATEX che Alimentare)
      setForm(prev => ({
        ...prev,
        is_standard: !prev.is_standard,
        is_atex: false,
        is_alimentare: false,
      }));
    } else if (type === 'atex') {
      // ATEX: può coesistere con Alimentare, ma disattiva Standard
      setForm(prev => ({
        ...prev,
        is_atex: !prev.is_atex,
        is_standard: false,
      }));
    } else if (type === 'alimentare') {
      // Alimentare: può coesistere con ATEX, ma disattiva Standard
      setForm(prev => ({
        ...prev,
        is_alimentare: !prev.is_alimentare,
        is_standard: false,
      }));
    }
  };

  const handleToggleTipoFornitura = (val) => {
    // Singola opzione oppure nessuna (cliccando su quella attiva la deseleziona)
    setForm(prev => ({
      ...prev,
      tipo_fornitura: prev.tipo_fornitura === val ? null : val,
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.titolo.trim() || form.costo === '' || form.costo === null) {
      showToast('Titolo e Costo sono obbligatori', 'error');
      return;
    }
    setSaving(true);
    try {
      let saved;
      const payload = {
        ...form,
        costo: parseFloat(form.costo),
        tipo_fornitura: form.tipo_fornitura || null,
        prezzo_listino: form.prezzo_listino !== '' && form.prezzo_listino != null ? parseFloat(form.prezzo_listino) : null,
        note_admin: form.note_admin?.trim() || null,
      };
      if (articolo) {
        saved = await updateArticolo(richiestaId, articolo.id, payload);
      } else {
        saved = await addArticolo(richiestaId, payload);
      }
      if (files.length > 0) {
        const withAttachments = await uploadAttachmentsArticolo(richiestaId, saved.id, files);
        if (withAttachments) saved = withAttachments;
      }
      showToast(articolo ? 'Articolo modificato con successo' : 'Articolo aggiunto con successo', 'success');
      onSaved(saved);
    } catch (err) {
      showToast(getErrorMessage(err, 'Errore nel salvataggio dell\'articolo'), 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="rc-articolo-card rc-articolo-card--editable" data-theme={index % 6}>
      {/* Barra superiore con Badge numerato e Azioni */}
      <div className="rc-articolo-card__topbar">
        <div className="rc-articolo-card__badge">
          <AppIcon name="package" size={13} />
          <span>Articolo #{index + 1}</span>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={onCancel}
            title="Annulla inserimento articolo"
          >
            <AppIcon name="close" size={13} /> Annulla
          </button>
        </div>
      </div>

      <div className="rc-form-group" style={{ marginBottom: 0 }}>
        <label className="rc-label">Titolo Articolo <span className="required">*</span></label>
        {userRole === 'admin' && <TextDiffBadges original={origTitolo} current={form.titolo} />}
        <input
          className="input"
          style={{ fontWeight: 600 }}
          value={form.titolo}
          onChange={e => setForm({ ...form, titolo: e.target.value })}
          placeholder="Titolo articolo *"
          required
          autoFocus
        />
      </div>

      <div className="rc-form-group" style={{ marginTop: 6 }}>
        <label className="rc-label">Descrizione</label>
        {userRole === 'admin' && <TextDiffBadges original={origDesc} current={form.descrizione} />}
        <textarea
          className="input"
          rows={2}
          value={form.descrizione}
          onChange={e => setForm({ ...form, descrizione: e.target.value })}
          placeholder="Descrizione tecnica, specifiche o note per l'articolo..."
        />
      </div>

      <div className="rc-form-row">
        <div className="rc-form-group" style={{ minWidth: 170 }}>
          <label className="rc-label">Costo Acquisti (€) <span className="required">*</span></label>
          <input
            className="input"
            type="number"
            step="0.01"
            style={{ borderColor: 'var(--primary-500)', fontWeight: 700, fontSize: '0.95rem' }}
            value={form.costo}
            onChange={e => setForm({ ...form, costo: e.target.value })}
            placeholder="0.00 *"
            required
          />
        </div>

        <div className="rc-form-group" style={{ flex: 2 }}>
          <label className="rc-label">Tipologia Prodotto</label>
          <div className="rc-pill-group" style={{ padding: '2px 0' }}>
            <button
              type="button"
              className={`rc-pill-chip rc-pill-chip--standard ${form.is_standard ? 'is-active' : ''}`}
              onClick={() => handleToggleTipologia('standard')}
            >
              <span className={`rc-pill-chip__indicator ${form.is_standard ? 'is-active' : ''}`}>
                {form.is_standard && <AppIcon name="check" size={11} />}
              </span>
              <span>Standard</span>
            </button>

            <button
              type="button"
              className={`rc-pill-chip rc-pill-chip--atex ${form.is_atex ? 'is-active' : ''}`}
              onClick={() => handleToggleTipologia('atex')}
            >
              <span className={`rc-pill-chip__indicator ${form.is_atex ? 'is-active' : ''}`}>
                {form.is_atex && <AppIcon name="check" size={11} />}
              </span>
              <span>ATEX</span>
            </button>

            <button
              type="button"
              className={`rc-pill-chip rc-pill-chip--alimentare ${form.is_alimentare ? 'is-active' : ''}`}
              onClick={() => handleToggleTipologia('alimentare')}
            >
              <span className={`rc-pill-chip__indicator ${form.is_alimentare ? 'is-active' : ''}`}>
                {form.is_alimentare && <AppIcon name="check" size={11} />}
              </span>
              <span>Alimentare</span>
            </button>
          </div>
        </div>
      </div>

      {userRole === 'admin' && status === 'manca_listino' && (
        <div className="rc-form-row" style={{ marginTop: 6 }}>
          <div className="rc-form-group" style={{ marginBottom: 0, flex: 1 }}>
            <label className="rc-label">Prezzo Listino (€)</label>
            <input
              className="input"
              type="number"
              step="0.01"
              value={form.prezzo_listino}
              onChange={e => setForm({ ...form, prezzo_listino: e.target.value })}
              placeholder="0.00"
            />
          </div>
          <div className="rc-form-group" style={{ marginBottom: 0, flex: 2 }}>
            <label className="rc-label">Note Admin (visibili al commerciale)</label>
            {userRole === 'admin' && <TextDiffBadges original={origNote} current={form.note_admin} />}
            <input
              className="input"
              value={form.note_admin}
              onChange={e => setForm({ ...form, note_admin: e.target.value })}
              placeholder="Es. Validità 30gg, sconti applicati..."
            />
          </div>
        </div>
      )}

      {/* Tipo Fornitura (Acquisti / Admin) */}
      <div className="rc-form-group">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
          <label className="rc-label" style={{ marginBottom: 0 }}>Tipo Fornitura</label>
          <span style={{ fontSize: '0.74rem', color: 'var(--text-tertiary)' }}>
            (opzionale: clicca per selezionare o deselezionare)
          </span>
        </div>
        <div className="rc-pill-group" style={{ padding: '2px 0' }}>
          {Object.entries(TIPO_FORNITURA_LABELS).map(([val, lab]) => {
            const isSelected = form.tipo_fornitura === val;
            return (
              <button
                key={val}
                type="button"
                className={`rc-pill-chip rc-pill-chip--fornitura ${isSelected ? 'is-active' : ''}`}
                onClick={() => handleToggleTipoFornitura(val)}
              >
                <span className={`rc-pill-chip__indicator rc-pill-chip__indicator--radio ${isSelected ? 'is-active' : ''}`}>
                  {isSelected && <span className="rc-pill-chip__dot" />}
                </span>
                <span>{lab}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Allegati dell'articolo con Drag and Drop */}
      <div className="rc-form-group" style={{ marginTop: 6, marginBottom: 0 }}>
        <label className="rc-label" style={{ marginBottom: 6 }}>Allegati Articolo</label>
        <ArticleDropzone
          existingAttachments={articolo?.attachments || []}
          pendingFiles={files}
          onUpload={(newFiles) => setFiles(prev => [...prev, ...newFiles])}
          onRemovePending={(fileIdx) => setFiles(prev => prev.filter((_, i) => i !== fileIdx))}
        />
      </div>

      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 14, paddingTop: 10, borderTop: '1px solid var(--border-subtle)' }}>
        <button type="button" className="btn btn-secondary btn-sm" onClick={onCancel}>
          Annulla
        </button>
        <button type="submit" className="btn btn-primary btn-sm" disabled={saving}>
          {saving ? 'Salvataggio...' : (articolo ? <><AppIcon name="save" size={14} /> Salva Modifiche</> : <><AppIcon name="plus" size={14} /> Aggiungi Articolo</>)}
        </button>
      </div>
    </form>
  );
}

// ─── Modal Dettaglio / Gestione ───────────────────────────────────────────────

function DettaglioModal({ richiestaId, userRole, onClose, onUpdated, onDeleted }) {
  const [richiesta, setRichiesta] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showArticoloForm, setShowArticoloForm] = useState(false);
  const [editingArticolo, setEditingArticolo] = useState(null);
  const [prezziListino, setPrezziListino] = useState({});
  const [noteAdmin, setNoteAdmin] = useState({});
  const [titoliAdmin, setTitoliAdmin] = useState({});
  const [descrizioniAdmin, setDescrizioniAdmin] = useState({});
  const [costiAcquisti, setCostiAcquisti] = useState({});
  const [titoliAcquisti, setTitoliAcquisti] = useState({});
  const [descrizioniAcquisti, setDescrizioniAcquisti] = useState({});
  const [tipologiaAcquisti, setTipologiaAcquisti] = useState({});
  const [tipoFornituraAcquisti, setTipoFornituraAcquisti] = useState({});
  const [descrizioneRichiestaAdmin, setDescrizioneRichiestaAdmin] = useState('');
  const [savingArticoli, setSavingArticoli] = useState(false);
  const [uploadingAttArtId, setUploadingAttArtId] = useState(null);
  const [sending, setSending] = useState(false);
  const [changingStatus, setChangingStatus] = useState(false);
  const [isEditingRichiesta, setIsEditingRichiesta] = useState(false);
  const [editRichiestaForm, setEditRichiestaForm] = useState({
    title: '',
    cliente: '',
    numero_offerta: '',
    description: '',
  });
  const [savingRichiesta, setSavingRichiesta] = useState(false);
  const [confirmModal, setConfirmModal] = useState(null);
  const { showToast } = useToast();

  const load = useCallback(async () => {
    try {
      const data = await getRichiesta(richiestaId);
      setRichiesta(data);
      setDescrizioneRichiestaAdmin(data.description || '');
      // Precompila i campi admin con i valori attuali
      const pInit = {}, nInit = {}, tInit = {}, dInit = {};
      const cInit = {}, tAcqInit = {}, dAcqInit = {}, tipInit = {}, tfInit = {};
      data.articoli?.forEach(a => {
        pInit[a.id] = a.prezzo_listino != null ? a.prezzo_listino : '';
        nInit[a.id] = a.note_admin || '';
        tInit[a.id] = a.titolo || '';
        dInit[a.id] = a.descrizione || '';

        cInit[a.id] = (a.costo != null && a.costo > 0) ? a.costo : '';
        tAcqInit[a.id] = a.titolo || '';
        dAcqInit[a.id] = a.descrizione || '';
        tipInit[a.id] = {
          is_standard: Boolean(a.is_standard),
          is_atex: Boolean(a.is_atex),
          is_alimentare: Boolean(a.is_alimentare),
        };
        tfInit[a.id] = a.tipo_fornitura || null;
      });
      setPrezziListino(pInit);
      setNoteAdmin(nInit);
      setTitoliAdmin(tInit);
      setDescrizioniAdmin(dInit);

      setCostiAcquisti(cInit);
      setTitoliAcquisti(tAcqInit);
      setDescrizioniAcquisti(dAcqInit);
      setTipologiaAcquisti(tipInit);
      setTipoFornituraAcquisti(tfInit);
      return data;
    } catch (err) {
      showToast(getErrorMessage(err, 'Errore nel caricamento del dettaglio'), 'error');
      return null;
    } finally {
      setLoading(false);
    }
  }, [richiestaId, showToast]);

  useEffect(() => { load(); }, [load]);

  const startEditingRichiesta = () => {
    setEditRichiestaForm({
      title: richiesta.title || '',
      cliente: richiesta.cliente || '',
      numero_offerta: richiesta.numero_offerta || '',
      description: richiesta.description || '',
    });
    setIsEditingRichiesta(true);
  };

  const handleSaveRichiesta = async (e) => {
    if (e) e.preventDefault();
    if (!editRichiestaForm.title.trim() || !editRichiestaForm.cliente.trim()) {
      showToast('Titolo e Cliente sono obbligatori', 'error');
      return;
    }
    setSavingRichiesta(true);
    try {
      const updated = await updateRichiesta(richiestaId, {
        title: editRichiestaForm.title.trim(),
        cliente: editRichiestaForm.cliente.trim(),
        numero_offerta: editRichiestaForm.numero_offerta.trim() || null,
        descrizione: editRichiestaForm.description.trim() || null,
      });
      showToast('Richiesta modificata con successo', 'success');
      setIsEditingRichiesta(false);
      if (updated) setRichiesta(updated);
      await load();
      if (onUpdated) await onUpdated(updated);
    } catch (err) {
      showToast(getErrorMessage(err, 'Errore durante la modifica della richiesta'), 'error');
    } finally {
      setSavingRichiesta(false);
    }
  };

  const handleStatusChange = async (newStatus) => {
    if (newStatus === richiesta.status) return;
    setChangingStatus(true);
    try {
      const updated = await updateRichiesta(richiestaId, { status: newStatus });
      showToast(`Stato cambiato in "${STATUS_CONFIG[newStatus]?.label || newStatus}"`, 'success');
      if (updated) setRichiesta(updated);
      await load();
      if (onUpdated) await onUpdated(updated);
    } catch (err) {
      showToast(getErrorMessage(err, 'Errore cambio stato'), 'error');
    } finally {
      setChangingStatus(false);
    }
  };

  const handlePrendiInCaricoClick = () => {
    setConfirmModal({
      title: 'Conferma Presa in Carico',
      message: 'Sei sicuro di voler prendere in carico questa richiesta? Lo stato passerà a "In Lavorazione".',
      confirmLabel: 'Prendi in Carico',
      confirmIcon: 'check',
      confirmVariant: 'primary',
      action: async () => {
        setSending(true);
        try {
          const updated = await prendiInCarico(richiestaId);
          showToast('Richiesta presa in carico!', 'success');
          if (updated) setRichiesta(updated);
          await load();
          if (onUpdated) await onUpdated(updated);
          setConfirmModal(null);
        } catch (err) {
          showToast(getErrorMessage(err, 'Errore presa in carico'), 'error');
        } finally {
          setSending(false);
        }
      },
    });
  };

  const handleToggleTipologiaAcquisti = (artId, type) => {
    setTipologiaAcquisti(prev => {
      const current = prev[artId] || { is_standard: false, is_atex: false, is_alimentare: false };
      if (type === 'standard') {
        return {
          ...prev,
          [artId]: {
            is_standard: !current.is_standard,
            is_atex: false,
            is_alimentare: false,
          },
        };
      } else if (type === 'atex') {
        return {
          ...prev,
          [artId]: {
            ...current,
            is_atex: !current.is_atex,
            is_standard: false,
          },
        };
      } else if (type === 'alimentare') {
        return {
          ...prev,
          [artId]: {
            ...current,
            is_alimentare: !current.is_alimentare,
            is_standard: false,
          },
        };
      }
      return prev;
    });
  };

  const handleToggleTipoFornituraAcquisti = (artId, val) => {
    setTipoFornituraAcquisti(prev => ({
      ...prev,
      [artId]: prev[artId] === val ? null : val,
    }));
  };

  const handleUploadArticoloAttachments = async (artId, fileList) => {
    if (!fileList || fileList.length === 0) return;
    setUploadingAttArtId(artId);
    try {
      await uploadAttachmentsArticolo(richiestaId, artId, Array.from(fileList));
      showToast('Allegati caricati con successo', 'success');
      await load();
    } catch (err) {
      showToast(getErrorMessage(err, 'Errore nel caricamento allegati articolo'), 'error');
    } finally {
      setUploadingAttArtId(null);
    }
  };

  const buildAcquistiArticoliPayload = () => {
    return (richiesta?.articoli || []).map(a => {
      const tip = tipologiaAcquisti[a.id] || {
        is_standard: Boolean(a.is_standard),
        is_atex: Boolean(a.is_atex),
        is_alimentare: Boolean(a.is_alimentare),
      };
      const rawCosto = costiAcquisti[a.id];
      const parsedCosto = rawCosto !== undefined && rawCosto !== '' ? parseFloat(rawCosto) : (a.costo || 0);
      return {
        id: a.id,
        titolo: (titoliAcquisti[a.id] !== undefined ? titoliAcquisti[a.id] : a.titolo)?.trim(),
        costo: isNaN(parsedCosto) ? 0 : parsedCosto,
        descrizione: (descrizioniAcquisti[a.id] !== undefined ? descrizioniAcquisti[a.id] : (a.descrizione || '')).trim(),
        is_standard: Boolean(tip.is_standard),
        is_atex: Boolean(tip.is_atex),
        is_alimentare: Boolean(tip.is_alimentare),
        tipo_fornitura: tipoFornituraAcquisti[a.id] !== undefined ? tipoFornituraAcquisti[a.id] : (a.tipo_fornitura || null),
      };
    });
  };

  const handleSaveAllArticoli = async () => {
    if (!richiesta?.articoli?.length) return;
    const isMancaListinoAdmin = userRole === 'admin' && richiesta.status === 'manca_listino';
    const payloadArticoli = isMancaListinoAdmin
      ? (richiesta.articoli || []).map(a => ({
          id: a.id,
          titolo: (titoliAdmin[a.id] !== undefined ? titoliAdmin[a.id] : a.titolo)?.trim(),
          descrizione: (descrizioniAdmin[a.id] !== undefined ? descrizioniAdmin[a.id] : (a.descrizione || '')).trim(),
          costo: a.costo,
          prezzo_listino: prezziListino[a.id] !== '' && prezziListino[a.id] != null ? parseFloat(prezziListino[a.id]) : null,
          note_admin: (noteAdmin[a.id] !== undefined ? noteAdmin[a.id] : (a.note_admin || '')).trim() || null,
        }))
      : buildAcquistiArticoliPayload();

    setSavingArticoli(true);
    try {
      const updated = await salvaArticoli(richiestaId, payloadArticoli, isMancaListinoAdmin ? descrizioneRichiestaAdmin : null);
      showToast('Modifiche salvate con successo', 'success');
      if (updated) setRichiesta(updated);
      await load();
      if (onUpdated) await onUpdated(updated);
    } catch (err) {
      showToast(getErrorMessage(err, 'Errore nel salvataggio degli articoli'), 'error');
    } finally {
      setSavingArticoli(false);
    }
  };

  const handleInviaAdAdminClick = () => {
    if (!richiesta?.articoli?.length) {
      showToast('Aggiungi almeno un articolo prima di inviare', 'error');
      return;
    }

    const payloadArticoli = buildAcquistiArticoliPayload();

    const missingTitle = payloadArticoli.find(a => !a.titolo);
    if (missingTitle) {
      showToast('Tutti gli articoli devono avere un titolo', 'error');
      return;
    }

    const missingCosto = payloadArticoli.find(a => !a.costo || a.costo <= 0);
    if (missingCosto) {
      showToast(`Inserisci un costo valido per tutti gli articoli prima di inviare (manca su "${missingCosto.titolo || 'Articolo'}")`, 'error');
      return;
    }

    const isAcquisti = userRole === 'acquisti';
    setConfirmModal({
      title: isAcquisti ? 'Conferma Consegna Preventivo' : 'Conferma Invio a Listino',
      message: isAcquisti
        ? 'Tutte le modifiche agli articoli verranno salvate automaticamente. La richiesta passerà allo stato "Manca Listino" e verrà notificato l\'amministratore.'
        : 'Tutte le modifiche agli articoli verranno salvate automaticamente e la richiesta passerà alla fase "Manca Listino".',
      confirmLabel: isAcquisti ? 'Consegna' : 'Invia a Listino',
      confirmIcon: 'send',
      confirmVariant: 'primary',
      action: async () => {
        setSending(true);
        try {
          const updated = await inviaAdAdmin(richiestaId, { articoli: payloadArticoli });
          showToast('Preventivo consegnato con successo! Articoli salvati e inviati all\'amministrazione.', 'success');
          if (updated) setRichiesta(updated);
          await load();
          if (onUpdated) await onUpdated(updated);
          setConfirmModal(null);
        } catch (err) {
          showToast(getErrorMessage(err, 'Errore invio all\'admin'), 'error');
        } finally {
          setSending(false);
        }
      },
    });
  };

  const handleCompletaClick = () => {
    const articoliPayload = richiesta.articoli.map(a => ({
      id: a.id,
      prezzo_listino: parseFloat(prezziListino[a.id]) || 0,
      titolo: (titoliAdmin[a.id] !== undefined ? titoliAdmin[a.id] : a.titolo)?.trim(),
      descrizione: (descrizioniAdmin[a.id] !== undefined ? descrizioniAdmin[a.id] : (a.descrizione || '')).trim(),
      note_admin: (noteAdmin[a.id] !== undefined ? noteAdmin[a.id] : (a.note_admin || '')).trim(),
    }));
    if (articoliPayload.some(a => !a.prezzo_listino)) {
      showToast('Inserisci il prezzo di listino per tutti gli articoli', 'error');
      return;
    }
    setConfirmModal({
      title: 'Conferma Completamento con Listino',
      message: 'Confermi il completamento della richiesta con i prezzi di listino inseriti? La richiesta passerà a "Completata" e il commerciale riceverà notifica via email.',
      confirmLabel: 'Completa con Listino',
      confirmIcon: 'check',
      confirmVariant: 'success',
      action: async () => {
        setSending(true);
        try {
          const updated = await completaRichiesta(richiestaId, articoliPayload, descrizioneRichiestaAdmin);
          showToast('Richiesta completata! Il commerciale è stato notificato via email.', 'success');
          if (updated) setRichiesta(updated);
          await load();
          if (onUpdated) await onUpdated(updated);
          setConfirmModal(null);
        } catch (err) {
          showToast(getErrorMessage(err, 'Errore completamento richiesta'), 'error');
        } finally {
          setSending(false);
        }
      },
    });
  };

  const handleDeleteArticolo = async (artId) => {
    if (!confirm('Eliminare questo articolo?')) return;
    try {
      await deleteArticolo(richiestaId, artId);
      showToast('Articolo eliminato con successo', 'success');
      const fresh = await load();
      if (onUpdated && fresh) await onUpdated(fresh);
    } catch (err) {
      showToast(getErrorMessage(err, 'Errore eliminazione articolo'), 'error');
    }
  };

  const handleArticoloSaved = async () => {
    setShowArticoloForm(false);
    setEditingArticolo(null);
    const fresh = await load();
    if (onUpdated && fresh) await onUpdated(fresh);
  };

  const handleDeleteRichiesta = async () => {
    if (!window.confirm(`Sei sicuro di voler spostare la richiesta "${richiesta.title}" nel cestino?\nVerrà conservata per 90 giorni prima dell'eliminazione definitiva.`)) {
      return;
    }
    setSending(true);
    try {
      await deleteRichiesta(richiestaId);
      showToast('Richiesta spostata nel cestino', 'success');
      if (onDeleted) {
        await onDeleted(richiestaId);
      } else {
        if (onUpdated) await onUpdated();
        onClose();
      }
    } catch (err) {
      showToast(getErrorMessage(err, 'Errore durante l\'eliminazione'), 'error');
    } finally {
      setSending(false);
    }
  };

  if (loading) {
    return (
      <div className="rc-modal-overlay">
        <div className="rc-modal">
          <div className="rc-loading"><div className="rc-spinner" /> Caricamento...</div>
        </div>
      </div>
    );
  }

  if (!richiesta) return null;

  const canAddArticoli = (
    richiesta.status === 'in_lavorazione' && (userRole === 'acquisti' || userRole === 'admin')
  ) || (
      richiesta.status === 'manca_listino' && userRole === 'admin'
    );

  return (
    <div className="rc-modal-overlay">
      <div className="rc-modal rc-modal--wide">
        <div className="rc-modal__header">
          <div className="rc-modal__title-box">
            {userRole === 'admin' ? (
              <div className="rc-admin-status-wrapper">
                <StatusBadge status={richiesta.status} />
                <div className="rc-admin-status-select-wrap">
                  <span className="rc-admin-status-label">Stato:</span>
                  <select
                    className="rc-admin-status-select"
                    value={richiesta.status}
                    onChange={(e) => handleStatusChange(e.target.value)}
                    disabled={changingStatus}
                    title="Cambia stato richiesta (Admin)"
                  >
                    <option value="aperta">Aperta</option>
                    <option value="in_lavorazione">In Lavorazione</option>
                    <option value="manca_listino">Manca Listino</option>
                    <option value="completata">Completata</option>
                  </select>
                </div>
              </div>
            ) : (
              <StatusBadge status={richiesta.status} />
            )}
            {!isEditingRichiesta ? (
              <h2 className="rc-modal__title">{richiesta.title}</h2>
            ) : (
              <span className="badge badge-standard" style={{ fontSize: '0.85rem' }}>Modalità Modifica Dati</span>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {userRole === 'admin' && !isEditingRichiesta && (
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={startEditingRichiesta}
                title="Modifica informazioni della richiesta"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
              >
                <AppIcon name="edit" size={14} /> Modifica Dati
              </button>
            )}
            <button type="button" className="btn-icon btn-ghost" onClick={onClose} aria-label="Chiudi">
              <AppIcon name="close" size={18} />
            </button>
          </div>
        </div>

        <div className="rc-modal__body">
          {isEditingRichiesta ? (
            <form onSubmit={handleSaveRichiesta} className="rc-edit-richiesta-form">
              <div className="rc-form-group">
                <label className="rc-label">Titolo Richiesta <span className="required">*</span></label>
                <input
                  className="input"
                  value={editRichiestaForm.title}
                  onChange={(e) => setEditRichiestaForm({ ...editRichiestaForm, title: e.target.value })}
                  placeholder="Titolo richiesta..."
                  required
                />
              </div>

              <div className="rc-form-row">
                <div className="rc-form-group" style={{ flex: 1 }}>
                  <label className="rc-label">Cliente <span className="required">*</span></label>
                  <input
                    className="input"
                    value={editRichiestaForm.cliente}
                    onChange={(e) => setEditRichiestaForm({ ...editRichiestaForm, cliente: e.target.value })}
                    placeholder="Nome cliente"
                    required
                  />
                </div>
                <div className="rc-form-group" style={{ flex: 1 }}>
                  <label className="rc-label"># Offerta</label>
                  <input
                    className="input"
                    value={editRichiestaForm.numero_offerta}
                    onChange={(e) => setEditRichiestaForm({ ...editRichiestaForm, numero_offerta: e.target.value })}
                    placeholder="Numero offerta"
                  />
                </div>
              </div>

              <div className="rc-form-group">
                <label className="rc-label">Descrizione</label>
                <textarea
                  className="input"
                  rows={3}
                  value={editRichiestaForm.description}
                  onChange={(e) => setEditRichiestaForm({ ...editRichiestaForm, description: e.target.value })}
                  placeholder="Descrizione dettagliata della richiesta..."
                />
              </div>

              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => setIsEditingRichiesta(false)}
                  disabled={savingRichiesta}
                >
                  Annulla
                </button>
                <button
                  type="submit"
                  className="btn btn-primary btn-sm"
                  disabled={savingRichiesta}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
                >
                  <AppIcon name="save" size={14} />
                  {savingRichiesta ? 'Salvataggio...' : 'Salva Modifiche Richiesta'}
                </button>
              </div>
            </form>
          ) : (
            <>
              {/* Info richiesta */}
              <div className="rc-info-card-grid">
                {/* Blocco 1: Dati Richiesta */}
                <div className="rc-info-block">
                  <div className="rc-info-item">
                    <span className="rc-info-item__label"><AppIcon name="building" size={13} /> Cliente</span>
                    <span className="rc-info-item__value rc-info-item__value--strong">{richiesta.cliente}</span>
                  </div>
                  <div className="rc-info-item">
                    <span className="rc-info-item__label"><AppIcon name="ticket" size={13} /> # Offerta</span>
                    <span className="rc-info-item__value">{richiesta.numero_offerta || '—'}</span>
                  </div>
                </div>

                {/* Blocco 2: Apertura Commerciale */}
                <div className="rc-info-block">
                  <div className="rc-info-item">
                    <span className="rc-info-item__label"><AppIcon name="user" size={13} /> Aperta da</span>
                    <span className="rc-info-item__value">{richiesta.author?.full_name || richiesta.author?.username || '—'}</span>
                  </div>
                  <div className="rc-info-item">
                    <span className="rc-info-item__label"><AppIcon name="calendar" size={13} /> Data apertura</span>
                    <span className="rc-info-item__value rc-info-item__value--date">{formatDate(richiesta.created_at)}</span>
                  </div>
                </div>

                {/* Blocco 3: Lavorazione Ufficio Acquisti */}
                {(['manca_listino', 'completata'].includes(richiesta.status) || richiesta.articoli_inserted_by || (richiesta.articoli?.length > 0 && richiesta.status !== 'aperta')) && (
                  <div className="rc-info-block">
                    <div className="rc-info-item">
                      <span className="rc-info-item__label"><AppIcon name="user" size={13} /> Articoli inseriti da</span>
                      <span className="rc-info-item__value">
                        {richiesta.articoli_inserted_by?.full_name || richiesta.articoli_inserted_by?.username || richiesta.articoli?.[0]?.author?.full_name || richiesta.articoli?.[0]?.author?.username || 'Ufficio Acquisti'}
                      </span>
                    </div>
                    <div className="rc-info-item">
                      <span className="rc-info-item__label"><AppIcon name="clock" size={13} /> Data inserimento articoli</span>
                      <span className="rc-info-item__value rc-info-item__value--date">
                        {formatDate(richiesta.articoli_inserted_at || richiesta.articoli?.[0]?.created_at || richiesta.updated_at)}
                      </span>
                    </div>
                  </div>
                )}

                {/* Blocco 4: Inserimento Listino Prezzi (Amministrazione) */}
                {(richiesta.status === 'completata' || richiesta.listino_inserted_by) && (
                  <div className="rc-info-block">
                    <div className="rc-info-item">
                      <span className="rc-info-item__label"><AppIcon name="tag" size={13} /> Listino inserito da</span>
                      <span className="rc-info-item__value">
                        {richiesta.listino_inserted_by?.full_name || richiesta.listino_inserted_by?.username || 'Amministrazione'}
                      </span>
                    </div>
                    <div className="rc-info-item">
                      <span className="rc-info-item__label"><AppIcon name="clock" size={13} /> Data inserimento listino</span>
                      <span className="rc-info-item__value rc-info-item__value--date">
                        {formatDate(richiesta.listino_inserted_at || richiesta.updated_at)}
                      </span>
                    </div>
                  </div>
                )}
              </div>

              {userRole === 'admin' && richiesta.status === 'manca_listino' ? (
                <div className="rc-form-group">
                  <label className="rc-label">Descrizione Richiesta</label>
                  <TextDiffBadges
                    original={richiesta.description_originale || richiesta.description}
                    current={descrizioneRichiestaAdmin}
                  />
                  <textarea
                    className="input"
                    rows={4}
                    value={descrizioneRichiestaAdmin}
                    onChange={(e) => setDescrizioneRichiestaAdmin(e.target.value)}
                    placeholder="Descrizione della richiesta commerciale..."
                  />
                </div>
              ) : (
                richiesta.description && (
                  <div className="rc-form-group">
                    <span className="rc-label">Descrizione</span>
                    {userRole === 'admin' && richiesta.description_originale && (
                      <TextDiffBadges
                        original={richiesta.description_originale}
                        current={richiesta.description}
                      />
                    )}
                    <p className="rc-description-box">
                      {richiesta.description}
                    </p>
                  </div>
                )
              )}
            </>
          )}

          {/* Allegati richiesta */}
          {richiesta.attachments?.length > 0 && (
            <div className="rc-form-group">
              <span className="rc-label">Allegati richiesta</span>
              <div className="rc-attachments-list">
                {richiesta.attachments.map((att, i) => {
                  const info = getAttachmentInfo(att);
                  return (
                    <div key={i} className="rc-attachment-chip">
                      <AppIcon name="fileText" size={14} />
                      <a
                        href={info.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="rc-attachment-link"
                        title={`Apri ${info.name} in una nuova scheda`}
                      >
                        {info.name}
                      </a>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <hr className="rc-section-divider" />

          {/* ── Sezione Articoli ── */}
          <div className="rc-articoli-section">
            <div className="rc-articoli-header">
              <h3 className="rc-articoli-title">
                <AppIcon name="list" size={18} /> Articoli ({richiesta.articoli?.length || 0})
              </h3>
              {canAddArticoli && !showArticoloForm && (
                <button className="btn btn-primary btn-sm" onClick={() => setShowArticoloForm(true)}>
                  <AppIcon name="plus" size={14} /> Aggiungi articolo
                </button>
              )}
            </div>

            {/* Form nuovo articolo */}
            {showArticoloForm && (
              <ArticoloForm
                richiestaId={richiestaId}
                userRole={userRole}
                status={richiesta.status}
                index={richiesta.articoli?.length || 0}
                onSaved={handleArticoloSaved}
                onCancel={() => setShowArticoloForm(false)}
              />
            )}

            {/* Lista articoli */}
            {richiesta.articoli?.length === 0 && !showArticoloForm && (
              <div className="empty-state" style={{ padding: '24px', border: '1px dashed var(--border-subtle)', borderRadius: 'var(--radius-md)' }}>
                <div className="empty-state-icon"><AppIcon name="briefcase" size={26} /></div>
                <p>
                  {richiesta.status === 'aperta'
                    ? "La richiesta deve essere presa in carico dall'Ufficio Acquisti prima di poter inserire gli articoli"
                    : "Nessun articolo ancora compilato"}
                </p>
              </div>
            )}

            {richiesta.articoli?.map((articolo, index) => {
              const isEditing = editingArticolo?.id === articolo.id;
              if (isEditing) {
                return (
                  <ArticoloForm
                    key={articolo.id}
                    richiestaId={richiestaId}
                    articolo={editingArticolo}
                    userRole={userRole}
                    status={richiesta.status}
                    index={index}
                    onSaved={handleArticoloSaved}
                    onCancel={() => setEditingArticolo(null)}
                  />
                );
              }

              // Vista Admin (fase MANCA_LISTINO): campi editabili + diff + bottoni di modifica/eliminazione
              if (userRole === 'admin' && richiesta.status === 'manca_listino') {
                let originalSnap = null;
                try { originalSnap = articolo.testo_originale_acquisti ? JSON.parse(articolo.testo_originale_acquisti) : null; }
                catch { originalSnap = null; }

                return (
                  <div key={articolo.id} className="rc-articolo-card rc-articolo-card--editable" data-theme={index % 6}>
                    {/* Barra superiore con Badge numerato e Azioni */}
                    <div className="rc-articolo-card__topbar">
                      <div className="rc-articolo-card__badge">
                        <AppIcon name="package" size={13} />
                        <span>Articolo #{index + 1}</span>
                      </div>
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          onClick={() => setEditingArticolo(articolo)}
                          title="Modifica articolo completo"
                        >
                          <AppIcon name="edit" size={13} />
                        </button>
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm text-danger"
                          onClick={() => handleDeleteArticolo(articolo.id)}
                          title={`Elimina articolo #${index + 1}`}
                        >
                          <AppIcon name="trash" size={13} />
                        </button>
                      </div>
                    </div>

                    <div className="rc-form-group" style={{ marginBottom: 4 }}>
                      <label className="rc-label">Titolo</label>
                      <TextDiffBadges
                        original={originalSnap?.titolo || articolo.titolo}
                        current={titoliAdmin[articolo.id]}
                      />
                      <input
                        className="input"
                        value={titoliAdmin[articolo.id] || ''}
                        onChange={(e) => setTitoliAdmin({ ...titoliAdmin, [articolo.id]: e.target.value })}
                      />
                    </div>

                    <div className="rc-form-group">
                      <label className="rc-label">Descrizione</label>
                      <TextDiffBadges
                        original={originalSnap?.descrizione !== undefined ? originalSnap.descrizione : (articolo.descrizione || '')}
                        current={descrizioniAdmin[articolo.id]}
                      />
                      <textarea
                        className="input"
                        rows={3}
                        value={descrizioniAdmin[articolo.id] || ''}
                        onChange={(e) => setDescrizioniAdmin({ ...descrizioniAdmin, [articolo.id]: e.target.value })}
                      />
                    </div>

                    <div className="rc-form-row">
                      <div className="rc-form-group">
                        <label className="rc-label">Costo Acquisti</label>
                        <div className="input" style={{ background: 'var(--bg-tertiary)', cursor: 'default', color: 'var(--success)', fontWeight: 700 }}>
                          {formatCurrency(articolo.costo)}
                        </div>
                      </div>
                      <div className="rc-form-group">
                        <label className="rc-label">Prezzo Listino (€) <span className="required">*</span></label>
                        <input
                          className="input"
                          type="number"
                          step="0.01"
                          value={prezziListino[articolo.id] || ''}
                          onChange={(e) => setPrezziListino({ ...prezziListino, [articolo.id]: e.target.value })}
                          placeholder="0.00"
                          style={{ borderColor: 'var(--accent-500)' }}
                        />
                      </div>
                    </div>

                    <div className="rc-form-group">
                      <label className="rc-label">Note Admin (per il commerciale)</label>
                      <TextDiffBadges
                        original={originalSnap?.note_admin !== undefined ? originalSnap.note_admin : (articolo.note_admin || '')}
                        current={noteAdmin[articolo.id]}
                      />
                      <textarea
                        className="input"
                        rows={2}
                        value={noteAdmin[articolo.id] || ''}
                        onChange={(e) => setNoteAdmin({ ...noteAdmin, [articolo.id]: e.target.value })}
                        placeholder="Note aggiuntive per il commerciale..."
                      />
                    </div>

                    <div className="rc-articolo-card__tags">
                      {articolo.is_standard && <span className="badge badge-standard">Standard</span>}
                      {articolo.is_atex && <span className="badge badge-atex">ATEX</span>}
                      {articolo.is_alimentare && <span className="badge badge-alimentare">Alimentare</span>}
                      {articolo.tipo_fornitura && (
                        <span className="badge badge-low">{TIPO_FORNITURA_LABELS[articolo.tipo_fornitura] || articolo.tipo_fornitura}</span>
                      )}
                      {articolo.created_at && (
                        <span style={{ fontSize: '0.74rem', color: 'var(--text-tertiary)', marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          <AppIcon name="clock" size={12} /> {formatDate(articolo.created_at)}
                          {(articolo.author?.full_name || articolo.author?.username) && (
                            <span>({articolo.author.full_name || articolo.author.username})</span>
                          )}
                        </span>
                      )}
                    </div>

                    {/* Allegati articolo con Drag and Drop */}
                    <div className="rc-form-group" style={{ marginTop: 6, marginBottom: 0 }}>
                      <label className="rc-label" style={{ marginBottom: 6 }}>Allegati Articolo</label>
                      <ArticleDropzone
                        existingAttachments={articolo.attachments || []}
                        onUpload={(files) => handleUploadArticoloAttachments(articolo.id, files)}
                        isUploading={uploadingAttArtId === articolo.id}
                      />
                    </div>
                  </div>
                );
              }

              // Vista Acquisti / Admin (fase IN_LAVORAZIONE): modifica diretta di costi, dettagli, tipologia e tipo fornitura
              if ((userRole === 'acquisti' || userRole === 'admin') && richiesta.status === 'in_lavorazione') {
                const tip = tipologiaAcquisti[articolo.id] || {
                  is_standard: Boolean(articolo.is_standard),
                  is_atex: Boolean(articolo.is_atex),
                  is_alimentare: Boolean(articolo.is_alimentare),
                };
                const tipoForn = tipoFornituraAcquisti[articolo.id] !== undefined
                  ? tipoFornituraAcquisti[articolo.id]
                  : (articolo.tipo_fornitura || null);

                return (
                  <div key={articolo.id} className="rc-articolo-card rc-articolo-card--editable" data-theme={index % 6}>
                    {/* Barra superiore con Badge numerato e Azioni */}
                    <div className="rc-articolo-card__topbar">
                      <div className="rc-articolo-card__badge">
                        <AppIcon name="package" size={13} />
                        <span>Articolo #{index + 1}</span>
                      </div>
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm text-danger"
                          onClick={() => handleDeleteArticolo(articolo.id)}
                          title={`Elimina articolo #${index + 1}`}
                        >
                          <AppIcon name="trash" size={13} /> Elimina
                        </button>
                      </div>
                    </div>

                    <div className="rc-form-group" style={{ marginBottom: 0 }}>
                      <label className="rc-label">Titolo Articolo <span className="required">*</span></label>
                      <input
                        className="input"
                        style={{ fontWeight: 600 }}
                        value={titoliAcquisti[articolo.id] !== undefined ? titoliAcquisti[articolo.id] : (articolo.titolo || '')}
                        onChange={(e) => setTitoliAcquisti({ ...titoliAcquisti, [articolo.id]: e.target.value })}
                        placeholder="Titolo articolo *"
                      />
                    </div>

                    <div className="rc-form-group" style={{ marginTop: 6 }}>
                      <label className="rc-label">Descrizione</label>
                      <textarea
                        className="input"
                        rows={2}
                        value={descrizioniAcquisti[articolo.id] !== undefined ? descrizioniAcquisti[articolo.id] : (articolo.descrizione || '')}
                        onChange={(e) => setDescrizioniAcquisti({ ...descrizioniAcquisti, [articolo.id]: e.target.value })}
                        placeholder="Descrizione tecnica, specifiche o note per l'articolo..."
                      />
                    </div>

                    <div className="rc-form-row">
                      <div className="rc-form-group" style={{ minWidth: 170 }}>
                        <label className="rc-label">Costo Acquisti (€) <span className="required">*</span></label>
                        <input
                          className="input"
                          type="number"
                          step="0.01"
                          style={{ borderColor: 'var(--primary-500)', fontWeight: 700, fontSize: '0.95rem' }}
                          value={costiAcquisti[articolo.id] !== undefined ? costiAcquisti[articolo.id] : (articolo.costo > 0 ? articolo.costo : '')}
                          onChange={(e) => setCostiAcquisti({ ...costiAcquisti, [articolo.id]: e.target.value })}
                          placeholder="0.00 *"
                        />
                      </div>

                      <div className="rc-form-group" style={{ flex: 2 }}>
                        <label className="rc-label">Tipologia Prodotto</label>
                        <div className="rc-pill-group" style={{ padding: '2px 0' }}>
                          <button
                            type="button"
                            className={`rc-pill-chip rc-pill-chip--standard ${tip.is_standard ? 'is-active' : ''}`}
                            onClick={() => handleToggleTipologiaAcquisti(articolo.id, 'standard')}
                          >
                            <span className={`rc-pill-chip__indicator ${tip.is_standard ? 'is-active' : ''}`}>
                              {tip.is_standard && <AppIcon name="check" size={11} />}
                            </span>
                            <span>Standard</span>
                          </button>

                          <button
                            type="button"
                            className={`rc-pill-chip rc-pill-chip--atex ${tip.is_atex ? 'is-active' : ''}`}
                            onClick={() => handleToggleTipologiaAcquisti(articolo.id, 'atex')}
                          >
                            <span className={`rc-pill-chip__indicator ${tip.is_atex ? 'is-active' : ''}`}>
                              {tip.is_atex && <AppIcon name="check" size={11} />}
                            </span>
                            <span>ATEX</span>
                          </button>

                          <button
                            type="button"
                            className={`rc-pill-chip rc-pill-chip--alimentare ${tip.is_alimentare ? 'is-active' : ''}`}
                            onClick={() => handleToggleTipologiaAcquisti(articolo.id, 'alimentare')}
                          >
                            <span className={`rc-pill-chip__indicator ${tip.is_alimentare ? 'is-active' : ''}`}>
                              {tip.is_alimentare && <AppIcon name="check" size={11} />}
                            </span>
                            <span>Alimentare</span>
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* Tipo Fornitura (Acquisti / Admin) */}
                    <div className="rc-form-group">
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                        <label className="rc-label" style={{ marginBottom: 0 }}>Tipo Fornitura</label>
                        <span style={{ fontSize: '0.74rem', color: 'var(--text-tertiary)' }}>
                          (opzionale: clicca per selezionare o deselezionare)
                        </span>
                      </div>
                      <div className="rc-pill-group" style={{ padding: '2px 0' }}>
                        {Object.entries(TIPO_FORNITURA_LABELS).map(([val, lab]) => {
                          const isSelected = tipoForn === val;
                          return (
                            <button
                              key={val}
                              type="button"
                              className={`rc-pill-chip rc-pill-chip--fornitura ${isSelected ? 'is-active' : ''}`}
                              onClick={() => handleToggleTipoFornituraAcquisti(articolo.id, val)}
                            >
                              <span className={`rc-pill-chip__indicator rc-pill-chip__indicator--radio ${isSelected ? 'is-active' : ''}`}>
                                {isSelected && <span className="rc-pill-chip__dot" />}
                              </span>
                              <span>{lab}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Allegati dell'articolo con Drag and Drop */}
                    <div className="rc-form-group" style={{ marginTop: 6, marginBottom: 0 }}>
                      <label className="rc-label" style={{ marginBottom: 6 }}>Allegati Articolo</label>
                      <ArticleDropzone
                        existingAttachments={articolo.attachments || []}
                        onUpload={(files) => handleUploadArticoloAttachments(articolo.id, files)}
                        isUploading={uploadingAttArtId === articolo.id}
                      />
                    </div>

                    {articolo.created_at && (
                      <div style={{ fontSize: '0.74rem', color: 'var(--text-tertiary)', marginTop: 8, display: 'flex', alignItems: 'center', gap: 4 }}>
                        <AppIcon name="clock" size={12} /> {formatDate(articolo.created_at)}
                        {(articolo.author?.full_name || articolo.author?.username) && (
                          <span>({articolo.author.full_name || articolo.author.username})</span>
                        )}
                      </div>
                    )}
                  </div>
                );
              }

              // Vista Commerciale (solo completate)
              if (userRole === 'commerciale') {
                return (
                  <div key={articolo.id} className="rc-articolo-card rc-articolo-card--editable" data-theme={index % 6}>
                    <div className="rc-articolo-card__topbar">
                      <div className="rc-articolo-card__badge">
                        <AppIcon name="package" size={13} />
                        <span>Articolo #{index + 1}</span>
                      </div>
                      {articolo.prezzo_listino != null && (
                        <span className="badge badge-active" style={{ fontSize: '0.85rem' }}>
                          Listino: {formatCurrency(articolo.prezzo_listino)}
                        </span>
                      )}
                    </div>
                    <h4 className="rc-articolo-card__title" style={{ margin: '4px 0 2px 0' }}>{articolo.titolo}</h4>
                    {articolo.descrizione && (
                      <p style={{ margin: '4px 0 8px 0', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{articolo.descrizione}</p>
                    )}
                    {articolo.note_admin && (
                      <p style={{ margin: '4px 0 8px 0', fontSize: '0.85rem', color: 'var(--text-secondary)', fontStyle: 'italic' }}>
                        Note: {articolo.note_admin}
                      </p>
                    )}
                    <div className="rc-articolo-card__tags">
                      {articolo.is_standard && <span className="badge badge-standard">Standard</span>}
                      {articolo.is_atex && <span className="badge badge-atex">ATEX</span>}
                      {articolo.is_alimentare && <span className="badge badge-alimentare">Alimentare</span>}
                      {articolo.tipo_fornitura && (
                        <span className="badge badge-low">{TIPO_FORNITURA_LABELS[articolo.tipo_fornitura] || articolo.tipo_fornitura}</span>
                      )}
                    </div>
                    {articolo.attachments?.length > 0 && (
                      <div className="rc-attachments-list" style={{ marginTop: 10 }}>
                        {articolo.attachments.map((att, i) => {
                          const info = getAttachmentInfo(att);
                          return (
                            <div key={i} className="rc-attachment-chip">
                              <AppIcon name="fileText" size={14} />
                              <a
                                href={info.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="rc-attachment-link"
                                title={`Apri ${info.name} in una nuova scheda`}
                              >
                                {info.name}
                              </a>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              }

              // Vista standard (acquisti + admin non in fase manca_listino)
              let originalSnap = null;
              if (userRole === 'admin' && articolo.testo_originale_acquisti) {
                try { originalSnap = JSON.parse(articolo.testo_originale_acquisti); }
                catch { originalSnap = null; }
              }
              const origTitolo = (originalSnap && originalSnap.titolo !== undefined) ? originalSnap.titolo : null;
              const origDesc = (originalSnap && originalSnap.descrizione !== undefined) ? originalSnap.descrizione : null;
              const origNote = (originalSnap && originalSnap.note_admin !== undefined) ? originalSnap.note_admin : null;

              return (
                <div key={articolo.id} className="rc-articolo-card">
                  <div className="rc-articolo-card__topbar">
                    <div className="rc-articolo-card__badge">
                      <AppIcon name="package" size={13} />
                      <span>Articolo #{index + 1}</span>
                    </div>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      {userRole === 'admin' && (
                        <span className="rc-price-tag">Costo: {formatCurrency(articolo.costo)}</span>
                      )}
                      {articolo.costo != null && articolo.costo > 0 && userRole !== 'admin' ? (
                        <span className="rc-price-tag">Costo: {formatCurrency(articolo.costo)}</span>
                      ) : (
                        userRole !== 'admin' && <span className="badge badge-pending" style={{ fontSize: '0.8rem' }}>Costo da definire</span>
                      )}
                      {articolo.prezzo_listino != null && (
                        <span className="badge badge-active" style={{ fontSize: '0.85rem' }}>
                          Listino: {formatCurrency(articolo.prezzo_listino)}
                        </span>
                      )}
                      {canAddArticoli && (
                        <>
                          <button className="btn btn-secondary btn-sm" onClick={() => setEditingArticolo(articolo)} title="Modifica">
                            <AppIcon name="edit" size={13} />
                          </button>
                          <button className="btn btn-secondary btn-sm text-danger" onClick={() => handleDeleteArticolo(articolo.id)} title="Elimina">
                            <AppIcon name="trash" size={13} />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                  <div style={{ margin: '4px 0 2px 0' }}>
                    {userRole === 'admin' && origTitolo && (
                      <TextDiffBadges original={origTitolo} current={articolo.titolo} />
                    )}
                    <h4 className="rc-articolo-card__title" style={{ margin: 0 }}>{articolo.titolo}</h4>
                  </div>
                  {articolo.descrizione && (
                    <div style={{ margin: '4px 0 8px 0', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                      {userRole === 'admin' && origDesc && (
                        <TextDiffBadges original={origDesc} current={articolo.descrizione} />
                      )}
                      <p style={{ margin: 0 }}>{articolo.descrizione}</p>
                    </div>
                  )}
                  {articolo.note_admin && (
                    <div style={{ margin: '4px 0 8px 0', fontSize: '0.85rem', color: 'var(--text-secondary)', fontStyle: 'italic' }}>
                      {userRole === 'admin' && origNote && (
                        <TextDiffBadges original={origNote} current={articolo.note_admin} />
                      )}
                      <p style={{ margin: 0 }}>Note Admin: {articolo.note_admin}</p>
                    </div>
                  )}
                  <div className="rc-articolo-card__tags">
                    {articolo.is_standard && <span className="badge badge-standard">Standard</span>}
                    {articolo.is_atex && <span className="badge badge-atex">ATEX</span>}
                    {articolo.is_alimentare && <span className="badge badge-alimentare">Alimentare</span>}
                    {articolo.tipo_fornitura && (
                      <span className="badge badge-low">{TIPO_FORNITURA_LABELS[articolo.tipo_fornitura] || articolo.tipo_fornitura}</span>
                    )}
                    {articolo.created_at && (
                      <span style={{ fontSize: '0.74rem', color: 'var(--text-tertiary)', marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        <AppIcon name="clock" size={12} /> {formatDate(articolo.created_at)}
                        {(articolo.author?.full_name || articolo.author?.username) && (
                          <span>({articolo.author.full_name || articolo.author.username})</span>
                        )}
                      </span>
                    )}
                  </div>
                  {articolo.attachments?.length > 0 && (
                    <div className="rc-attachments-list" style={{ marginTop: 10 }}>
                      {articolo.attachments.map((att, i) => {
                        const info = getAttachmentInfo(att);
                        return (
                          <div key={i} className="rc-attachment-chip">
                            <AppIcon name="fileText" size={14} />
                            <a
                              href={info.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="rc-attachment-link"
                              title={`Apri ${info.name} in una nuova scheda`}
                            >
                              {info.name}
                            </a>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Footer con azioni contestuali */}
        <div className="rc-modal__footer">
          {userRole === 'admin' && (
            <button
              type="button"
              className="btn btn-secondary text-danger"
              onClick={handleDeleteRichiesta}
              disabled={sending}
              style={{ marginRight: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}
              title="Sposta la richiesta nel cestino per 90 giorni"
            >
              <AppIcon name="trash" size={15} /> Sposta nel Cestino
            </button>
          )}

          <button className="btn btn-secondary" onClick={onClose}>Chiudi</button>

          {/* Acquisti / Admin in_lavorazione: Salva Modifiche (senza inviare) */}
          {(userRole === 'acquisti' || userRole === 'admin') && richiesta.status === 'in_lavorazione' && richiesta.articoli?.length > 0 && (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={handleSaveAllArticoli}
              disabled={sending || savingArticoli}
              title="Salva le modifiche agli articoli senza inviare ad amministrazione"
            >
              <AppIcon name="save" size={15} /> {savingArticoli ? 'Salvataggio...' : 'Salva Modifiche'}
            </button>
          )}

          {/* Acquisti: invia ad admin (Consegna) */}
          {userRole === 'acquisti' && richiesta.status === 'in_lavorazione' && (
            <button className="btn btn-primary" onClick={handleInviaAdAdminClick} disabled={sending || savingArticoli}>
              <AppIcon name="send" size={16} /> Consegna
            </button>
          )}

          {/* Admin: prendi in carico se ancora aperta */}
          {userRole === 'admin' && richiesta.status === 'aperta' && (
            <button className="btn btn-primary" onClick={handlePrendiInCaricoClick} disabled={sending}>
              <AppIcon name="check" size={16} /> Prendi in Carico
            </button>
          )}

          {/* Admin: invia ad admin (se in lavorazione) */}
          {userRole === 'admin' && richiesta.status === 'in_lavorazione' && (
            <button className="btn btn-primary" onClick={handleInviaAdAdminClick} disabled={sending || savingArticoli}>
              <AppIcon name="send" size={16} /> Invia a Listino
            </button>
          )}

          {/* Admin in manca_listino: Salva Modifiche (bozza senza completare) */}
          {userRole === 'admin' && richiesta.status === 'manca_listino' && (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={handleSaveAllArticoli}
              disabled={sending || savingArticoli}
              title="Salva le modifiche ai testi e prezzi senza completare la richiesta"
            >
              <AppIcon name="save" size={15} /> {savingArticoli ? 'Salvataggio...' : 'Salva Modifiche'}
            </button>
          )}

          {/* Admin: completa con prezzi listino */}
          {userRole === 'admin' && richiesta.status === 'manca_listino' && (
            <button className="btn btn-primary" style={{ background: 'linear-gradient(135deg, #16a34a, #15803d)' }} onClick={handleCompletaClick} disabled={sending}>
              <AppIcon name="check" size={16} /> Completa con Listino
            </button>
          )}
        </div>
      </div>

      {confirmModal && (
        <ConfirmActionModal
          isOpen={Boolean(confirmModal)}
          title={confirmModal.title}
          message={confirmModal.message}
          confirmLabel={confirmModal.confirmLabel}
          confirmIcon={confirmModal.confirmIcon}
          confirmVariant={confirmModal.confirmVariant}
          loading={sending}
          onConfirm={confirmModal.action}
          onCancel={() => !sending && setConfirmModal(null)}
        />
      )}
    </div>
  );
}

// ─── Modale Cestino (90 giorni - Solo Admin) ──────────────────────────────────

function TrashModal({ onClose, onRestored, onDeleted }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [processingId, setProcessingId] = useState(null);
  const { showToast } = useToast();

  const loadTrash = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getTrashRichieste();
      setItems(data || []);
    } catch (err) {
      showToast(getErrorMessage(err, 'Errore nel caricamento del cestino'), 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    loadTrash();
  }, [loadTrash]);

  const handleRestore = async (item) => {
    setProcessingId(item.id);
    try {
      const restored = await restoreRichiesta(item.id);
      showToast(`Richiesta "${item.title}" ripristinata con successo!`, 'success');
      setItems((prev) => prev.filter((x) => x.id !== item.id));
      if (onRestored) {
        await onRestored(restored || item);
      }
    } catch (err) {
      showToast(getErrorMessage(err, 'Errore durante il ripristino'), 'error');
    } finally {
      setProcessingId(null);
    }
  };

  const handleHardDelete = async (item) => {
    if (!window.confirm(`Sei sicuro di voler eliminare definitivamente la richiesta "${item.title}"?\nQuesta operazione non può essere annullata.`)) {
      return;
    }
    setProcessingId(item.id);
    try {
      await hardDeleteRichiesta(item.id);
      showToast('Richiesta eliminata definitivamente dal database', 'success');
      setItems((prev) => prev.filter((x) => x.id !== item.id));
      if (onDeleted) {
        await onDeleted(item.id);
      }
    } catch (err) {
      showToast(getErrorMessage(err, 'Errore durante l\'eliminazione definitiva'), 'error');
    } finally {
      setProcessingId(null);
    }
  };

  const handleEmptyTrash = async () => {
    if (items.length === 0) return;
    if (!window.confirm(`Sei sicuro di voler svuotare il cestino?\nTutte le ${items.length} richieste verranno eliminate in modo irreversibile dal database.`)) {
      return;
    }
    setLoading(true);
    try {
      await emptyTrashRichieste();
      showToast('Cestino svuotato con successo', 'success');
      setItems([]);
      if (onDeleted) {
        await onDeleted();
      }
    } catch (err) {
      showToast(getErrorMessage(err, 'Errore durante lo svuotamento del cestino'), 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rc-modal-overlay">
      <div className="rc-modal rc-modal--wide" style={{ maxWidth: 840 }}>
        <div className="rc-modal__header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{
              width: 40, height: 40, borderRadius: 10,
              background: 'rgba(239, 68, 68, 0.12)', color: 'var(--danger, #ef4444)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0
            }}>
              <AppIcon name="trash" size={20} />
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <h2 className="rc-modal__title" style={{ margin: 0 }}>Cestino Preventivazione</h2>
                <span className="filter-chip-count">
                  {items.length} {items.length === 1 ? 'richiesta' : 'richieste'}
                </span>
              </div>
              <p style={{ margin: '3px 0 0', fontSize: '0.8rem', color: 'var(--text-tertiary)' }}>
                Gli elementi nel cestino vengono conservati per 90 giorni prima dell'eliminazione definitiva automatica.
              </p>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {items.length > 0 && (
              <button
                type="button"
                className="btn btn-secondary text-danger btn-sm"
                onClick={handleEmptyTrash}
                style={{ display: 'flex', alignItems: 'center', gap: 6 }}
              >
                <AppIcon name="trash" size={14} /> Svuota Cestino
              </button>
            )}
            <button type="button" className="btn-icon btn-ghost" onClick={onClose} aria-label="Chiudi">
              <AppIcon name="close" size={18} />
            </button>
          </div>
        </div>

        <div className="rc-modal__body" style={{ maxHeight: '60vh', overflowY: 'auto', padding: '16px 20px' }}>
          {loading ? (
            <div className="rc-loading"><div className="rc-spinner" /> Caricamento cestino...</div>
          ) : items.length === 0 ? (
            <div className="empty-state" style={{ padding: '40px 20px', textAlign: 'center' }}>
              <div style={{
                width: 52, height: 52, borderRadius: '50%',
                background: 'var(--bg-tertiary)', color: 'var(--text-tertiary)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 12px auto'
              }}>
                <AppIcon name="trash" size={24} />
              </div>
              <h3 style={{ margin: '0 0 4px', fontSize: '1rem', color: 'var(--text-primary)' }}>Cestino vuoto</h3>
              <p style={{ margin: 0, fontSize: '0.84rem', color: 'var(--text-secondary)' }}>Nessuna richiesta presente nel cestino.</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {items.map((item) => (
                <div
                  key={item.id}
                  className="card"
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '12px 16px', gap: 16, flexWrap: 'wrap'
                  }}
                >
                  <div style={{ flex: '1 1 300px', minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: 650, color: 'var(--text-primary)', fontSize: '0.94rem' }}>
                        {item.title}
                      </span>
                      {item.cliente && (
                        <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                          • {item.cliente}
                        </span>
                      )}
                      {item.numero_offerta && (
                        <span className="badge badge-low" style={{ fontSize: '0.72rem' }}>
                          #{item.numero_offerta}
                        </span>
                      )}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 4, fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>
                      <span>Articoli: {item.articoli_count}</span>
                      <span>•</span>
                      <span>Eliminata il {item.deleted_at ? formatDate(item.deleted_at) : 'N/D'}</span>
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                    <span
                      style={{
                        fontSize: '0.74rem', fontWeight: 650, padding: '3px 9px', borderRadius: 999,
                        background: item.days_left <= 7 ? 'rgba(239, 68, 68, 0.12)' : (item.days_left <= 30 ? 'rgba(245, 158, 11, 0.12)' : 'var(--bg-tertiary)'),
                        color: item.days_left <= 7 ? 'var(--danger, #ef4444)' : (item.days_left <= 30 ? '#d97706' : 'var(--text-secondary)'),
                        whiteSpace: 'nowrap'
                      }}
                    >
                      {item.days_left <= 0 ? 'Eliminazione oggi' : `Tra ${item.days_left} giorni`}
                    </span>

                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => handleRestore(item)}
                      disabled={processingId === item.id}
                      style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: '0.8rem' }}
                      title="Ripristina richiesta"
                    >
                      <AppIcon name="undo" size={14} /> Ripristina
                    </button>

                    <button
                      type="button"
                      className="btn btn-icon btn-sm text-danger"
                      onClick={() => handleHardDelete(item)}
                      disabled={processingId === item.id}
                      title="Elimina definitivamente"
                    >
                      <AppIcon name="trash" size={15} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rc-modal__footer">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Chiudi
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Pagina Principale ────────────────────────────────────────────────────────

export default function RichiesteCommercialiPage() {
  const { user } = useAuth();
  const { showToast } = useToast();

  const [richieste, setRichieste] = useState([]);
  const [loading, setLoading] = useState(true);
  const [userRole, setUserRole] = useState(() => (user?.role === 'admin' ? 'admin' : null));
  const [filterStatus, setFilterStatus] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [showNuovaModal, setShowNuovaModal] = useState(false);
  const [selectedRichiestaId, setSelectedRichiestaId] = useState(null);
  const [showTrashModal, setShowTrashModal] = useState(false);
  const [trashCount, setTrashCount] = useState(0);
  const [viewMode, setViewMode] = useState(() => {
    try {
      return localStorage.getItem('rc_view_mode') || 'list';
    } catch {
      return 'list';
    }
  });

  const handleViewModeChange = (mode) => {
    setViewMode(mode);
    try {
      localStorage.setItem('rc_view_mode', mode);
    } catch { }
  };

  const loadTrashCount = useCallback(async () => {
    try {
      const data = await getTrashRichieste();
      setTrashCount(data?.length || 0);
    } catch {
      // Non admin o endpoint non disponibile
    }
  }, []);

  const loadRichieste = useCallback(async () => {
    try {
      const data = await listRichieste();
      if (Array.isArray(data)) {
        setRichieste((prev) => {
          const map = new Map();
          data.forEach((item) => map.set(item.id, item));
          // Preserva eventuali elementi appena creati/ripristinati non ancora presenti
          prev.forEach((item) => {
            if (!map.has(item.id)) {
              map.set(item.id, item);
            }
          });
          return Array.from(map.values()).sort(
            (a, b) => (parseDate(b.created_at)?.getTime() || 0) - (parseDate(a.created_at)?.getTime() || 0)
          );
        });
      }
    } catch (err) {
      showToast(getErrorMessage(err, 'Errore nel caricamento delle richieste'), 'error');
    }
  }, [showToast]);

  const handleQuickDelete = async (req) => {
    if (!window.confirm(`Sei sicuro di voler spostare la richiesta "${req.title}" nel cestino?\nVerrà conservata per 90 giorni prima dell'eliminazione definitiva.`)) {
      return;
    }
    // Rimozione ottimistica immediata dalla UI
    setRichieste((prev) => prev.filter((r) => r.id !== req.id));
    setTrashCount((prev) => prev + 1);
    try {
      await deleteRichiesta(req.id);
      showToast('Richiesta spostata nel cestino', 'success');
      await loadRichieste();
      await loadTrashCount();
    } catch (err) {
      showToast(getErrorMessage(err, 'Errore durante l\'eliminazione'), 'error');
      await loadRichieste();
      await loadTrashCount();
    }
  };

  useEffect(() => {
    let cancelled = false;
    async function init() {
      if (!user) return;
      setLoading(true);
      try {
        let role = user.role === 'admin' ? 'admin' : null;
        if (!role) {
          const res = await getMyRole();
          if (res?.enabled) {
            role = res.role;
          }
        }
        if (cancelled) return;
        if (!role) {
          setUserRole(null);
          setLoading(false);
          return;
        }
        setUserRole(role);
        const data = await listRichieste();
        if (!cancelled) {
          setRichieste(data);
          if (role === 'admin') {
            loadTrashCount();
          }
        }
      } catch (err) {
        if (!cancelled) {
          showToast(getErrorMessage(err, 'Errore nel caricamento delle richieste'), 'error');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }
    init();
    return () => { cancelled = true; };
  }, [user, showToast, loadTrashCount]);

  // Statistiche per status
  const stats = Object.keys(STATUS_CONFIG).reduce((acc, s) => {
    acc[s] = richieste.filter(r => r.status === s).length;
    return acc;
  }, {});

  // Conteggio richieste attive per la vista "Tutte" (escluse le completate)
  const activeCount = richieste.filter(r => r.status !== 'completata').length;

  // Filtra richieste
  const filtered = richieste.filter(r => {
    if (filterStatus) {
      if (r.status !== filterStatus) return false;
    } else {
      // Nella vista "Tutte", nascondi le richieste completate
      if (r.status === 'completata') return false;
    }

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return (
        r.title?.toLowerCase().includes(q) ||
        r.cliente?.toLowerCase().includes(q) ||
        r.numero_offerta?.toLowerCase().includes(q) ||
        r.author?.username?.toLowerCase().includes(q) ||
        r.author?.full_name?.toLowerCase().includes(q) ||
        r.articoli_inserted_by?.username?.toLowerCase().includes(q) ||
        r.articoli_inserted_by?.full_name?.toLowerCase().includes(q) ||
        r.listino_inserted_by?.username?.toLowerCase().includes(q) ||
        r.listino_inserted_by?.full_name?.toLowerCase().includes(q)
      );
    }
    return true;
  });

  if (loading) {
    return (
      <div className="rc-page">
        <div className="rc-loading"><div className="rc-spinner" /> Caricamento richieste...</div>
      </div>
    );
  }

  // Se l'utente non è abilitato, reindirizza direttamente senza mostrare la pagina
  if (userRole === null) {
    return <Navigate to="/dashboard" replace />;
  }

  return (
    <div className="rc-page animate-fadeIn">
      {/* Command Bar / Filtri, Ricerca e Azioni */}
      <div className="rc-command-bar card">
        {/* Riga Superiore: Filtri di stato a sinistra, Azioni principali a destra */}
        <div className="rc-command-bar__row rc-command-bar__row--top">
          <div className="rc-filters">
            <button
              className={`filter-chip ${filterStatus === null ? 'active' : ''}`}
              onClick={() => setFilterStatus(null)}
              title="Mostra tutte le richieste aperte (in lavorazione e manca listino)"
            >
              <span>Aperte</span>
              <span className="filter-chip-count">{activeCount}</span>
            </button>
            {STATUS_FILTER_TABS.map((tab) => (
              <button
                key={tab.key}
                className={`filter-chip ${filterStatus === tab.key ? 'active' : ''}`}
                onClick={() => setFilterStatus(filterStatus === tab.key ? null : tab.key)}
              >
                <span className="rc-filter-dot" style={{ background: tab.color }} />
                <span>{tab.label}</span>
                <span className="filter-chip-count">{stats[tab.key] || 0}</span>
              </button>
            ))}
          </div>

          <div className="rc-command-bar__actions">
            {userRole === 'admin' && (
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setShowTrashModal(true)}
                style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 6, height: 36 }}
                title="Cestino Preventivazione (conservazione per 90 giorni)"
              >
                <AppIcon name="trash" size={15} />
                <span>Cestino</span>
                {trashCount > 0 && (
                  <span className="trash-badge-count">{trashCount}</span>
                )}
              </button>
            )}

            {(userRole === 'commerciale' || userRole === 'admin') && (
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => setShowNuovaModal(true)}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 36 }}
              >
                <AppIcon name="plus" size={15} />
                <span>Nuova Richiesta</span>
              </button>
            )}
          </div>
        </div>

        {/* Riga Inferiore: Ricerca a sinistra, Selettore Griglia/Elenco a destra */}
        <div className="rc-command-bar__row rc-command-bar__row--bottom">
          <div className="rc-search-box">
            <span className="rc-search-icon"><AppIcon name="search" size={15} /></span>
            <input
              type="text"
              className="input rc-search-input"
              placeholder="Cerca per titolo, cliente, offerta o referente..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <button type="button" className="rc-search-clear" onClick={() => setSearchQuery('')} aria-label="Cancella ricerca">
                <AppIcon name="close" size={13} />
              </button>
            )}
          </div>

          <div className="rc-view-switcher" role="group" aria-label="Modalità visualizzazione">
            <button
              type="button"
              className={`rc-view-btn ${viewMode === 'grid' ? 'active' : ''}`}
              onClick={() => handleViewModeChange('grid')}
              title="Visualizzazione a Griglia"
            >
              <AppIcon name="grid" size={15} />
              <span className="rc-view-btn__text">Griglia</span>
            </button>
            <button
              type="button"
              className={`rc-view-btn ${viewMode === 'list' ? 'active' : ''}`}
              onClick={() => handleViewModeChange('list')}
              title="Visualizzazione a Elenco"
            >
              <AppIcon name="list" size={15} />
              <span className="rc-view-btn__text">Elenco</span>
            </button>
          </div>
        </div>
      </div>

      {/* Grid o Elenco richieste oppure Empty State */}
      {filtered.length === 0 ? (
        <div className="empty-state card">
          <div className="empty-state-icon">
            <AppIcon name={searchQuery || filterStatus ? 'search' : 'briefcase'} size={42} />
          </div>
          <h3>
            {searchQuery || filterStatus
              ? 'Nessuna richiesta trovata'
              : richieste.length > 0
              ? 'Nessuna richiesta aperta'
              : 'Nessuna richiesta ancora'}
          </h3>
          <p>
            {searchQuery || filterStatus
              ? 'Nessuna richiesta corrisponde ai filtri o al termine di ricerca.'
              : richieste.length > 0
              ? 'Tutte le richieste registrate sono state completate. Clicca su "Completate" per visualizzarle.'
              : 'Non ci sono ancora richieste registrate. Creane una nuova per iniziare il coordinamento commerciale e acquisti.'}
          </p>
          {!searchQuery && !filterStatus && (
            <div style={{ display: 'flex', gap: 10, marginTop: 16, justifyContent: 'center', flexWrap: 'wrap' }}>
              {richieste.length > 0 && (
                <button type="button" className="btn btn-secondary" onClick={() => setFilterStatus('completata')}>
                  <AppIcon name="check" size={16} /> Mostra completate ({stats['completata'] || 0})
                </button>
              )}
              {(userRole === 'commerciale' || userRole === 'admin') && (
                <button type="button" className="btn btn-primary" onClick={() => setShowNuovaModal(true)}>
                  <AppIcon name="plus" size={16} /> {richieste.length > 0 ? 'Nuova Richiesta' : 'Crea la prima richiesta'}
                </button>
              )}
            </div>
          )}
        </div>
      ) : viewMode === 'list' ? (
        <div className="card rc-list-card">
          <div className="rc-table-responsive">
            <table className="rc-table">
              <thead>
                <tr>
                  <th>Richiesta & Cliente</th>
                  <th>Stato</th>
                  <th>Addetti Coinvolti</th>
                  <th>Articoli</th>
                  <th>Data</th>
                  <th style={{ textAlign: 'right' }}>Azioni</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr
                    key={r.id}
                    className="rc-table-row"
                    onClick={() => setSelectedRichiestaId(r.id)}
                  >
                    <td>
                      <div className="rc-table__title">{r.title}</div>
                      <div className="rc-table__sub">
                        <span className="rc-table__sub-item">
                          <AppIcon name="building" size={13} /> <strong>{r.cliente}</strong>
                        </span>
                        {r.numero_offerta && (
                          <span className="rc-table__sub-item">
                            <AppIcon name="ticket" size={13} /> Offerta: <strong>{r.numero_offerta}</strong>
                          </span>
                        )}
                      </div>
                    </td>
                    <td>
                      <StatusBadge status={r.status} />
                    </td>
                    <td>
                      <div className="rc-table__addetti-list">
                        <div className="rc-table__addetto" title="Aperta dal Commerciale">
                          <span className="rc-table__addetto-role">Commerciale:</span>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                            <AppIcon name="user" size={11} /> {r.author?.full_name || r.author?.username || '—'}
                          </span>
                        </div>
                        {(r.articoli_inserted_by || r.articoli?.length > 0 || ['in_lavorazione', 'manca_listino', 'completata'].includes(r.status)) && (
                          <div className="rc-table__addetto" title="Lavorata dall'Ufficio Acquisti">
                            <span className="rc-table__addetto-role">Acquisti:</span>
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                              <AppIcon name="briefcase" size={11} />{' '}
                              {r.articoli_inserted_by?.full_name || r.articoli_inserted_by?.username || r.articoli?.[0]?.author?.full_name || r.articoli?.[0]?.author?.username || (r.status === 'in_lavorazione' ? 'In lavorazione' : 'Acquisti')}
                            </span>
                          </div>
                        )}
                        {(r.listino_inserted_by || r.status === 'completata') && (
                          <div className="rc-table__addetto" title="Listino inserito dall'Amministrazione">
                            <span className="rc-table__addetto-role">Listino:</span>
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--success, #16a34a)' }}>
                              <AppIcon name="tag" size={11} />{' '}
                              {r.listino_inserted_by?.full_name || r.listino_inserted_by?.username || 'Admin'}
                            </span>
                          </div>
                        )}
                      </div>
                    </td>
                    <td>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontWeight: 500, fontSize: '0.82rem' }}>
                        <AppIcon name="list" size={13} /> {r.articoli?.length || 0}
                      </span>
                    </td>
                    <td>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                        <AppIcon name="clock" size={12} /> {formatDate(r.created_at)}
                      </span>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }} onClick={(e) => e.stopPropagation()}>
                        {userRole === 'admin' && (
                          <button
                            type="button"
                            className="btn-icon btn-ghost text-danger"
                            onClick={() => handleQuickDelete(r)}
                            title="Sposta nel cestino per 90 giorni"
                            style={{ width: 28, height: 28, padding: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
                          >
                            <AppIcon name="trash" size={14} />
                          </button>
                        )}
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          onClick={() => setSelectedRichiestaId(r.id)}
                          style={{ fontSize: '0.78rem', padding: '4px 10px' }}
                        >
                          Dettagli <AppIcon name="arrowRight" size={12} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="rc-grid">
          {filtered.map((r) => (
            <div
              key={r.id}
              className="card rc-card"
              onClick={() => setSelectedRichiestaId(r.id)}
            >
              <div className="rc-card__header">
                <h3 className="rc-card__title">{r.title}</h3>
                <StatusBadge status={r.status} />
              </div>
              <div className="rc-card__meta">
                <div className="rc-card__meta-item">
                  <AppIcon name="building" size={14} />
                  <span><strong>{r.cliente}</strong></span>
                </div>
                {r.numero_offerta && (
                  <div className="rc-card__meta-item">
                    <AppIcon name="ticket" size={14} />
                    <span>Offerta: <strong>{r.numero_offerta}</strong></span>
                  </div>
                )}
                {/* Addetti che hanno operato */}
                <div className="rc-card__addetti">
                  <div className="rc-card__addetto" title="Aperta dal Commerciale">
                    <span className="rc-card__addetto-label">Commerciale:</span>
                    <span className="rc-card__addetto-name">
                      <AppIcon name="user" size={12} /> {r.author?.full_name || r.author?.username || '—'}
                    </span>
                  </div>

                  {(r.articoli_inserted_by || r.articoli?.length > 0 || ['in_lavorazione', 'manca_listino', 'completata'].includes(r.status)) && (
                    <div className="rc-card__addetto" title="Lavorata dall'Ufficio Acquisti">
                      <span className="rc-card__addetto-label">Acquisti:</span>
                      <span className="rc-card__addetto-name">
                        <AppIcon name="briefcase" size={12} />{' '}
                        {r.articoli_inserted_by?.full_name || r.articoli_inserted_by?.username || r.articoli?.[0]?.author?.full_name || r.articoli?.[0]?.author?.username || (r.status === 'in_lavorazione' ? 'In lavorazione' : 'Acquisti')}
                      </span>
                    </div>
                  )}

                  {(r.listino_inserted_by || r.status === 'completata') && (
                    <div className="rc-card__addetto" title="Listino inserito dall'Amministrazione">
                      <span className="rc-card__addetto-label">Listino:</span>
                      <span className="rc-card__addetto-name rc-card__addetto-name--listino">
                        <AppIcon name="tag" size={12} />{' '}
                        {r.listino_inserted_by?.full_name || r.listino_inserted_by?.username || 'Admin'}
                      </span>
                    </div>
                  )}
                </div>
                {r.articoli?.length > 0 && (
                  <div className="rc-card__meta-item">
                    <AppIcon name="list" size={14} />
                    <span>{r.articoli.length} {r.articoli.length === 1 ? 'articolo' : 'articoli'}</span>
                  </div>
                )}
              </div>
              <div className="rc-card__footer">
                <span className="rc-card__date">
                  <AppIcon name="clock" size={13} /> {formatDate(r.created_at)}
                </span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {userRole === 'admin' && (
                    <button
                      type="button"
                      className="btn-icon btn-ghost text-danger"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleQuickDelete(r);
                      }}
                      title="Sposta nel cestino per 90 giorni"
                      style={{ width: 28, height: 28, padding: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
                    >
                      <AppIcon name="trash" size={14} />
                    </button>
                  )}
                  <span className="rc-card__action">
                    Dettagli <AppIcon name="arrowRight" size={13} />
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modali */}
      {showNuovaModal && (
        <NuovaRichiestaModal
          onClose={() => setShowNuovaModal(false)}
          onCreated={async (newReq) => {
            setFilterStatus(null);
            setSearchQuery('');
            if (newReq) {
              setRichieste((prev) => [newReq, ...prev.filter((r) => r.id !== newReq.id)]);
            }
            await loadRichieste();
            if (userRole === 'admin') loadTrashCount();
          }}
        />
      )}

      {selectedRichiestaId && (
        <DettaglioModal
          richiestaId={selectedRichiestaId}
          userRole={userRole}
          onClose={async () => {
            setSelectedRichiestaId(null);
            await loadRichieste();
          }}
          onDeleted={async (deletedId) => {
            setRichieste((prev) => prev.filter((r) => r.id !== deletedId));
            setTrashCount((prev) => prev + 1);
            setSelectedRichiestaId(null);
            await loadRichieste();
            if (userRole === 'admin') await loadTrashCount();
          }}
          onUpdated={async (updatedItem) => {
            if (updatedItem) {
              setRichieste((prev) => prev.map((r) => (r.id === updatedItem.id ? updatedItem : r)));
            }
            await loadRichieste();
            if (userRole === 'admin') await loadTrashCount();
          }}
        />
      )}

      {showTrashModal && (
        <TrashModal
          onClose={async () => {
            setShowTrashModal(false);
            await loadRichieste();
            await loadTrashCount();
          }}
          onRestored={async (restoredItem) => {
            if (restoredItem) {
              setRichieste((prev) => [restoredItem, ...prev.filter((r) => r.id !== restoredItem.id)]);
            }
            setTrashCount((prev) => Math.max(0, prev - 1));
            await loadRichieste();
            await loadTrashCount();
          }}
          onDeleted={async (deletedId) => {
            if (deletedId) {
              setTrashCount((prev) => Math.max(0, prev - 1));
            } else {
              setTrashCount(0);
            }
            await loadTrashCount();
            await loadRichieste();
          }}
        />
      )}
    </div>
  );
}
