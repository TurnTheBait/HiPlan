import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import AppIcon from '../ui/AppIcon';
import api from '../../api/client';
import './GlobalSearch.css';

export default function GlobalSearch({ isOpen, onClose }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setResults([]);
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (!isOpen) return;
      if (e.key === 'Escape') {
        onClose();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex(prev => (prev < results.length - 1 ? prev + 1 : prev));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex(prev => (prev > 0 ? prev - 1 : 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (results[selectedIndex]) {
          handleSelect(results[selectedIndex]);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, results, selectedIndex]);

  useEffect(() => {
    const delayDebounceFn = setTimeout(() => {
      if (query.trim().length >= 2) {
        performSearch(query.trim());
      } else {
        setResults([]);
      }
    }, 300);
    return () => clearTimeout(delayDebounceFn);
  }, [query]);

  const performSearch = async (q) => {
    setIsLoading(true);
    try {
      const res = await api.get(`/search?q=${encodeURIComponent(q)}`);
      setResults(res.data);
      setSelectedIndex(0);
    } catch (err) {
      console.error('Search error', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSelect = (item) => {
    onClose();
    navigate(item.link);
  };

  if (!isOpen) return null;

  return (
    <div className="global-search-overlay" onClick={onClose}>
      <div className="global-search-modal" onClick={e => e.stopPropagation()}>
        <div className="global-search-header">
          <AppIcon name="search" size={20} color="var(--text-muted)" />
          <input
            ref={inputRef}
            type="text"
            placeholder="Cerca commesse, fasi, ticket, note..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {isLoading && <span className="global-search-loader">...</span>}
          <button className="global-search-close" onClick={onClose}>
            <AppIcon name="close" size={20} />
          </button>
        </div>
        <div className="global-search-results">
          {query.length >= 2 && results.length === 0 && !isLoading && (
            <div className="global-search-empty">Nessun risultato trovato per "{query}"</div>
          )}
          {results.map((item, index) => {
            let iconName = 'folder';
            if (item.type === 'project') iconName = 'briefcase';
            if (item.type === 'task') iconName = 'list';
            if (item.type === 'todo') iconName = 'check-square';
            if (item.type === 'ticket' || item.type === 'ticket_reply') iconName = 'message-circle';
            if (item.type === 'note' || item.type === 'project_note') iconName = 'file-text';
            if (item.type === 'task_comment') iconName = 'message-square';

            return (
              <div
                key={`${item.type}-${item.id}`}
                className={`global-search-item ${index === selectedIndex ? 'selected' : ''}`}
                onClick={() => handleSelect(item)}
                onMouseEnter={() => setSelectedIndex(index)}
              >
                <div className="global-search-item-icon">
                  <AppIcon name={iconName} size={18} />
                </div>
                <div className="global-search-item-content">
                  <div className="global-search-item-title">{item.title}</div>
                  <div className="global-search-item-subtitle">{item.subtitle} &bull; {item.match_context}</div>
                </div>
                <div className="global-search-item-arrow">
                  <AppIcon name="chevronRight" size={16} />
                </div>
              </div>
            );
          })}
        </div>
        <div className="global-search-footer">
          <span><strong>↑↓</strong> per navigare</span>
          <span><strong>Invio</strong> per selezionare</span>
          <span><strong>Esc</strong> per chiudere</span>
        </div>
      </div>
    </div>
  );
}
