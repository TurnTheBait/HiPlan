import React, { useState, useEffect, useRef } from 'react';
import api from '../../api/client';
import { useToast } from '../../context/ToastContext';

export default function TaskAttachments({ projectId, taskId }) {
  const toast = useToast();
  const [attachments, setAttachments] = useState([]);
  const [loading, setLoading] = useState(true);
  const fileInputRef = useRef(null);

  useEffect(() => {
    fetchAttachments();
  }, [taskId]);

  const fetchAttachments = async () => {
    try {
      const res = await api.get(`/projects/${projectId}/tasks/${taskId}/attachments`);
      setAttachments(res.data);
    } catch (err) {
      console.error(err);
      toast.error('Errore nel caricamento degli allegati');
    } finally {
      setLoading(false);
    }
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    // Reset input immediately so choosing the same file again from Finder always triggers onChange
    e.target.value = null;

    const formData = new FormData();
    formData.append('file', file);

    const toastId = toast.loading('Caricamento in corso...');

    try {
      const res = await api.post(
        `/projects/${projectId}/tasks/${taskId}/attachments`,
        formData,
        {
          headers: {
            'Content-Type': undefined
          }
        }
      );
      
      setAttachments(prev => [...prev, res.data]);
      toast.success('File caricato con successo', { id: toastId });
    } catch (err) {
      console.error(err);
      toast.error('Errore durante il caricamento');
    }
  };

  if (loading) return <div>Caricamento allegati...</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ margin: 0, fontSize: '1rem' }}>Documenti e File</h3>
        <input 
          type="file" 
          ref={fileInputRef} 
          style={{ display: 'none' }} 
          onChange={handleFileUpload}
        />
        <button 
          type="button"
          className="btn btn-secondary btn-sm" 
          onClick={() => {
            if (fileInputRef.current) {
              fileInputRef.current.value = null;
              fileInputRef.current.click();
            }
          }}
        >
          + Carica File
        </button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {attachments.length === 0 ? (
          <div style={{ 
            border: '2px dashed var(--border-default)', 
            borderRadius: '8px', 
            padding: '2rem', 
            textAlign: 'center',
            color: 'var(--text-muted)'
          }}>
            <p>Nessun file allegato. Trascina qui un file o usa il pulsante in alto.</p>
          </div>
        ) : (
          attachments.map(att => (
            <div key={att.id} style={{ 
              display: 'flex', 
              alignItems: 'center', 
              justifyContent: 'space-between',
              padding: '10px 12px', 
              background: 'var(--bg-tertiary)', 
              borderRadius: '6px',
              border: '1px solid var(--border-default)'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, overflow: 'hidden' }}>
                <span style={{ fontSize: '1.2rem' }}>📄</span>
                <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                  <span style={{ fontWeight: 600, whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>
                    {att.file_name}
                  </span>
                  <span style={{ fontSize: '0.75rem', opacity: 0.7 }}>
                    {new Date(att.created_at).toLocaleString()}
                  </span>
                </div>
              </div>
              <a 
                href={`http://127.0.0.1:8000${att.file_path}`} 
                target="_blank" 
                rel="noreferrer"
                className="btn btn-primary btn-sm"
                style={{ textDecoration: 'none' }}
              >
                Apri
              </a>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
