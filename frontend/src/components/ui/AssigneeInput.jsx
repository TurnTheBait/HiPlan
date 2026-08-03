import React, { useState, useRef } from 'react';
import AppIcon from './AppIcon';
import './AssigneeInput.css';

export default function AssigneeInput({ selected = [], onChange, users = [], placeholder = 'Aggiungi...' }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const inputRef = useRef(null);

  const safeSelected = Array.isArray(selected) ? selected : [];
  const safeUsers = Array.isArray(users) ? users : [];

  const filtered = safeUsers.filter(u =>
    !safeSelected.includes(u.username) &&
    ((u.full_name || '').toLowerCase().includes(query.toLowerCase()) ||
      (u.username || '').toLowerCase().includes(query.toLowerCase()))
  ).slice(0, 8);

  function add(username) {
    onChange([...safeSelected, username]);
    setQuery('');
    setOpen(false);
    inputRef.current?.focus();
  }

  function remove(username) {
    onChange(safeSelected.filter(u => u !== username));
  }

  return (
    <div className="assignee-tags-box" onClick={() => inputRef.current?.focus()}>
      {safeSelected.map(u => (
        <span key={u} className="assignee-tag">
          {u}
          <button type="button" onClick={() => remove(u)} aria-label={`Rimuovi ${u}`}>
            <AppIcon name="close" size={11} />
          </button>
        </span>
      ))}
      <div className="assignee-input-wrap">
        <input
          ref={inputRef}
          className="assignee-input"
          placeholder={safeSelected.length === 0 ? 'Nessuno (lascia vuoto) o cerca utente...' : placeholder}
          value={query}
          onChange={e => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
        />
        {open && filtered.length > 0 && (
          <div className="assignee-dropdown">
            {filtered.map(u => (
              <div key={u.id} className="assignee-option" onClick={() => add(u.username)}>
                {u.full_name || u.username} <span style={{ opacity: 0.6, fontSize: '0.8em' }}>({u.username})</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
