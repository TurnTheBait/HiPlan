import React, { useState, useEffect } from 'react';
import api from '../../api/client';
import { useToast } from '../../context/ToastContext';
import AppIcon from '../ui/AppIcon';

export default function TaskComments({ projectId, taskId, currentUser }) {
  const toast = useToast();
  const [comments, setComments] = useState([]);
  const [newComment, setNewComment] = useState('');
  const [loading, setLoading] = useState(true);

  const [users, setUsers] = useState([]);
  const [showMentions, setShowMentions] = useState(false);
  const [mentionFilter, setMentionFilter] = useState('');
  const [mentionIndex, setMentionIndex] = useState(-1);

  useEffect(() => {
    fetchComments();
    fetchUsers();
  }, [taskId]);

  const fetchUsers = async () => {
    try {
      const res = await api.get('/users');
      setUsers(res.data);
    } catch (err) {
      console.error("Errore fetch users per menzioni", err);
    }
  };

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
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', flex: 1 }}>
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
                      aria-label="Elimina commento"
                      onMouseOver={e => e.currentTarget.style.opacity = 1}
                      onMouseOut={e => e.currentTarget.style.opacity = 0.8}
                    >
                      <AppIcon name="close" size={12} />
                    </button>
                  )}
                </div>
                <div>{c.content}</div>
              </div>
            );
          })
        )}
      </div>
      <form onSubmit={handleAddComment} style={{ display: 'flex', flexDirection: 'row', alignItems: 'stretch', gap: '8px', position: 'relative' }}>
        {showMentions && (
          <div style={{
            position: 'absolute',
            bottom: '100%',
            left: 0,
            width: '250px',
            maxHeight: '150px',
            overflowY: 'auto',
            backgroundColor: 'var(--bg-primary)',
            border: '1px solid var(--border-color)',
            borderRadius: '8px',
            boxShadow: '0 -4px 12px rgba(0,0,0,0.1)',
            zIndex: 10,
            marginBottom: '4px'
          }}>
            {users.filter(u => u.username.toLowerCase().includes(mentionFilter.toLowerCase()) || (u.full_name && u.full_name.toLowerCase().includes(mentionFilter.toLowerCase()))).map(u => (
              <div 
                key={u.id}
                onClick={() => {
                  const prefix = newComment.substring(0, mentionIndex);
                  setNewComment(prefix + u.username + ' ');
                  setShowMentions(false);
                }}
                style={{
                  padding: '8px 12px',
                  cursor: 'pointer',
                  borderBottom: '1px solid var(--border-color)'
                }}
                onMouseOver={(e) => e.currentTarget.style.backgroundColor = 'var(--bg-secondary)'}
                onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
              >
                <strong>{u.username}</strong> {u.full_name ? `(${u.full_name})` : ''}
              </div>
            ))}
          </div>
        )}
        <input
          type="text"
          className="input"
          placeholder="Scrivi un commento o usa @nome per menzionare..."
          value={newComment}
          onChange={e => {
            const val = e.target.value;
            setNewComment(val);
            
            // Check for @mentions
            const lastAt = val.lastIndexOf('@');
            if (lastAt !== -1 && (lastAt === 0 || val[lastAt - 1] === ' ')) {
              const afterAt = val.substring(lastAt + 1);
              if (!afterAt.includes(' ')) {
                setShowMentions(true);
                setMentionFilter(afterAt);
                setMentionIndex(lastAt + 1);
                return;
              }
            }
            setShowMentions(false);
          }}
          style={{ flex: 1 }}
        />
        <button type="submit" className="btn btn-primary">Invia</button>
      </form>
    </div>
  );
}
