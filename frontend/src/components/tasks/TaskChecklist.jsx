import React, { useState, useEffect } from 'react';
import api from '../../api/client';
import { useToast } from '../../context/ToastContext';

export default function TaskChecklist({ projectId, taskId }) {
  const toast = useToast();
  const [items, setItems] = useState([]);
  const [newItemText, setNewItemText] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchItems();
  }, [taskId]);

  const fetchItems = async () => {
    try {
      const res = await api.get(`/projects/${projectId}/tasks/${taskId}/checklists`);
      setItems(res.data);
    } catch (err) {
      console.error(err);
      toast.error('Errore nel caricamento della checklist');
    } finally {
      setLoading(false);
    }
  };

  const handleAddItem = async (e) => {
    e.preventDefault();
    if (!newItemText.trim()) return;

    try {
      const res = await api.post(
        `/projects/${projectId}/tasks/${taskId}/checklists`,
        { text: newItemText }
      );
      setItems([...items, res.data]);
      setNewItemText('');
    } catch (err) {
      console.error(err);
      toast.error("Errore durante l'aggiunta dell'elemento");
    }
  };

  const toggleItem = async (item) => {
    try {
      const res = await api.put(
        `/projects/${projectId}/tasks/${taskId}/checklists/${item.id}`,
        { is_completed: !item.is_completed }
      );
      setItems(items.map(i => i.id === item.id ? res.data : i));
    } catch (err) {
      console.error(err);
      toast.error("Errore durante l'aggiornamento");
    }
  };

  const deleteItem = async (itemId) => {
    try {
      await api.delete(
        `/projects/${projectId}/tasks/${taskId}/checklists/${itemId}`
      );
      setItems(items.filter(i => i.id !== itemId));
    } catch (err) {
      console.error(err);
      toast.error("Errore durante l'eliminazione");
    }
  };

  if (loading) return <div>Caricamento checklist...</div>;

  const completedCount = items.filter(i => i.is_completed).length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ marginBottom: 16 }}>
        <h3 style={{ margin: '0 0 8px 0', fontSize: '1rem' }}>Sotto-attività</h3>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <progress value={completedCount} max={items.length || 1} style={{ flex: 1 }} />
          <span style={{ fontSize: '0.85rem' }}>{completedCount} / {items.length} completati</span>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', marginBottom: '1rem', display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {items.length === 0 ? (
          <p style={{ color: 'var(--text-muted)', textAlign: 'center', marginTop: '1rem' }}>Nessun elemento nella checklist.</p>
        ) : (
          items.map(item => (
            <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px', background: 'var(--bg-tertiary)', borderRadius: '6px' }}>
              <input 
                type="checkbox" 
                checked={item.is_completed} 
                onChange={() => toggleItem(item)} 
                style={{ cursor: 'pointer', width: 18, height: 18 }}
              />
              <span style={{ flex: 1, textDecoration: item.is_completed ? 'line-through' : 'none', opacity: item.is_completed ? 0.6 : 1 }}>
                {item.text}
              </span>
              <button className="btn-ghost btn-icon" onClick={() => deleteItem(item.id)} style={{ color: 'var(--danger)' }}>
                ✕
              </button>
            </div>
          ))
        )}
      </div>

      <form onSubmit={handleAddItem} style={{ display: 'flex', gap: '8px' }}>
        <input
          type="text"
          className="input"
          placeholder="Aggiungi una voce alla checklist..."
          value={newItemText}
          onChange={e => setNewItemText(e.target.value)}
          style={{ flex: 1 }}
        />
        <button type="submit" className="btn btn-secondary">Aggiungi</button>
      </form>
    </div>
  );
}
