import React, { useState, useEffect } from 'react';
import api from '../../api/client';
import { useToast } from '../../context/ToastContext';

export default function TaskComments({ projectId, taskId, currentUser }) {
  const toast = useToast();
  const [comments, setComments] = useState([]);
  const [newComment, setNewComment] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchComments();
  }, [taskId]);

  const fetchComments = async () => {
    try {
      const res = await api.get(`/projects/${projectId}/tasks/${taskId}/comments`);
      setComments(res.data);
    } catch (err) {
      console.error(err);
      toast.error('Errore nel caricamento dei commenti');
    } finally {
      setLoading(false);
    }
  };

  const handleAddComment = async (e) => {
    e.preventDefault();
    if (!newComment.trim()) return;

    try {
      const res = await api.post(
        `/projects/${projectId}/tasks/${taskId}/comments`,
        { content: newComment }
      );
      setComments([...comments, res.data]);
      setNewComment('');
    } catch (err) {
      console.error(err);
      toast.error("Errore durante l'invio del commento");
    }
  };

  const handleDeleteComment = async (commentId) => {
    if (!window.confirm("Sei sicuro di voler eliminare questo commento?")) return;
    try {
      await api.delete(`/projects/${projectId}/tasks/${taskId}/comments/${commentId}`);
      setComments(comments.filter(c => c.id !== commentId));
      toast.success("Commento eliminato");
    } catch (err) {
      console.error(err);
      toast.error("Errore nell'eliminazione del commento");
    }
  };

  if (loading) return <div>Caricamento commenti...</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ flex: 1, overflowY: 'auto', marginBottom: '1rem', display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {comments.length === 0 ? (
          <p style={{ color: 'var(--text-muted)', textAlign: 'center', marginTop: '2rem' }}>Nessun commento ancora. Scrivi qualcosa per iniziare la discussione!</p>
        ) : (
          comments.map(c => {
            const isMe = c.author_id === currentUser?.id;
            return (
              <div key={c.id} style={{
                alignSelf: isMe ? 'flex-end' : 'flex-start',
                backgroundColor: isMe ? 'var(--accent-600)' : 'var(--bg-secondary)',
                color: isMe ? '#fff' : 'var(--text-primary)',
                padding: '10px 14px',
                borderRadius: '12px',
                maxWidth: '80%'
              }}>
                <div style={{ fontSize: '0.75rem', opacity: 0.8, marginBottom: 4, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>{isMe ? 'Tu' : (c.author_id ? 'Utente' : 'Sconosciuto')} • {new Date(c.created_at).toLocaleString()}</span>
                  {isMe && (
                    <button 
                      onClick={() => handleDeleteComment(c.id)}
                      style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', padding: 0, marginLeft: 10, opacity: 0.8 }}
                      title="Elimina commento"
                      onMouseOver={e => e.target.style.opacity = 1}
                      onMouseOut={e => e.target.style.opacity = 0.8}
                    >
                      ✕
                    </button>
                  )}
                </div>
                <div>{c.content}</div>
              </div>
            );
          })
        )}
      </div>
      <form onSubmit={handleAddComment} style={{ display: 'flex', flexDirection: 'row', alignItems: 'stretch', gap: '8px' }}>
        <input
          type="text"
          className="input"
          placeholder="Scrivi un commento o usa @nome per menzionare..."
          value={newComment}
          onChange={e => setNewComment(e.target.value)}
          style={{ flex: 1 }}
        />
        <button type="submit" className="btn btn-primary">Invia</button>
      </form>
    </div>
  );
}
