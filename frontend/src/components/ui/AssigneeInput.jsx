import React, { useState, useRef } from 'react';
import AppIcon from './AppIcon';
import './AssigneeInput.css';

export default function AssigneeInput({ selected = [], onChange, users = [], placeholder = 'Aggiungi...', valueKey = 'username', direction = 'down' }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const inputRef = useRef(null);

  const safeSelected = Array.isArray(selected) ? selected : [];
  const safeUsers = Array.isArray(users) ? users : [];

  const filtered = safeUsers.filter(u =>
    !safeSelected.includes(u[valueKey]) &&
    ((u.full_name || '').toLowerCase().includes(query.toLowerCase()) ||
      (u.username || '').toLowerCase().includes(query.toLowerCase()))
  ).slice(0, 8);

  function add(val) {
    onChange([...safeSelected, val]);
    setQuery('');
    setOpen(false);
    inputRef.current?.focus();
  }

  function remove(val) {
    onChange(safeSelected.filter(v => v !== val));
  }

  return (
    <div className="assignee-tags-box" onClick={() => inputRef.current?.focus()}>
      {safeSelected.map(val => {
        const u = safeUsers.find(user => user[valueKey] === val);
        const displayLabel = u ? (u.full_name || u.username) : val;
        return (
          <span key={val} className="assignee-tag">
            {displayLabel}
            <button type="button" onClick={() => remove(val)} aria-label={`Rimuovi ${displayLabel}`}>
              <AppIcon name="close" size={11} />
            </button>
          </span>
        );
      })}
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
          <div className={`assignee-dropdown ${direction === 'up' ? 'assignee-dropdown-up' : ''}`}>
            {filtered.map(u => (
              <div key={u.id} className="assignee-dropdown-item" onMouseDown={() => add(u[valueKey])}>
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
