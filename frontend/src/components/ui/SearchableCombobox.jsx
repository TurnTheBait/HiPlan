import React, { useState, useRef, useEffect, useMemo } from 'react';
import AppIcon from './AppIcon';

export default function SearchableCombobox({
  value,
  onChange,
  options = [],
  placeholder = 'Seleziona o scrivi...',
  allowCustom = true,
  renderOption,
  groupBy,
  groupLabels = {}
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState(value || '');
  const containerRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    if (!isOpen) {
      const selectedOpt = options.find(o => o.value === value);
      setSearch(selectedOpt ? (selectedOpt.label || selectedOpt.value) : (value || ''));
    }
  }, [value, isOpen, options]);

  useEffect(() => {
    function handleClickOutside(event) {
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        setIsOpen(false);
        // If they typed something and allowCustom is true, emit onChange if it changed
        if (allowCustom && isOpen && search !== value) {
          onChange(search, null);
        } else if (!allowCustom && isOpen) {
          setSearch(value || '');
        }
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen, search, value, allowCustom, onChange]);

  const filteredOptions = useMemo(() => {
    if (!search) return options;
    const lowerSearch = search.toLowerCase();
    return options.filter(opt => {
      const label = String(opt.label || opt.value || '').toLowerCase();
      return label.includes(lowerSearch);
    });
  }, [options, search]);

  const groupedOptions = useMemo(() => {
    if (!groupBy) return { ungrouped: filteredOptions };
    const groups = {};
    filteredOptions.forEach(opt => {
      const g = opt[groupBy] || 'ungrouped';
      if (!groups[g]) groups[g] = [];
      groups[g].push(opt);
    });
    return groups;
  }, [filteredOptions, groupBy]);

  const handleSelect = (opt) => {
    setSearch(opt.label || opt.value);
    onChange(opt.value, opt);
    setIsOpen(false);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (filteredOptions.length === 1) {
        handleSelect(filteredOptions[0]);
      } else if (allowCustom && search.trim()) {
        onChange(search, null);
        setIsOpen(false);
      }
    }
    if (e.key === 'Escape') {
      setIsOpen(false);
      setSearch(value || '');
    }
  };

  return (
    <div ref={containerRef} style={{ position: 'relative', width: '100%' }}>
      <div
        className="input"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          background: 'var(--bg-secondary)',
          padding: '0',
          overflow: 'hidden'
        }}
      >
        <input
          ref={inputRef}
          type="text"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            if (!isOpen) setIsOpen(true);
            if (allowCustom) {
              // Update parent state as they type for immediate feedback if needed,
              // but usually we wait for blur or enter to finalize.
              onChange(e.target.value, null);
            }
          }}
          onFocus={() => setIsOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          style={{
            flex: 1,
            border: 'none',
            background: 'transparent',
            padding: '8px 12px',
            outline: 'none',
            color: 'var(--text-primary)',
            fontFamily: 'inherit',
            fontSize: 'inherit',
            fontWeight: 600,
            width: '100%'
          }}
        />
        <div
          onClick={() => setIsOpen(!isOpen)}
          style={{ padding: '0 10px', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex', alignItems: 'center' }}
        >
          <AppIcon name={isOpen ? 'chevronUp' : 'chevronDown'} size={20} />
        </div>
      </div>

      {isOpen && (
        <div
          className="dropdown-menu"
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            right: 0,
            marginTop: 4,
            maxHeight: 320,
            overflowY: 'auto',
            zIndex: 100,
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border-default)',
            borderRadius: 'var(--radius-sm)',
            boxShadow: 'var(--shadow-xl)',
          }}
        >
          {filteredOptions.length === 0 && (
            <div style={{ padding: '10px 12px', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
              {allowCustom ? 'Premi Invio per usare questo valore personalizzato...' : 'Nessun risultato trovato'}
            </div>
          )}

          {groupBy ? Object.keys(groupedOptions).map(gKey => (
            <div key={gKey}>
              <div style={{
                padding: '6px 12px',
                fontSize: '0.72rem',
                fontWeight: 700,
                color: 'var(--text-secondary)',
                background: 'var(--bg-tertiary)',
                borderBottom: '1px solid var(--border-default)',
                borderTop: gKey !== Object.keys(groupedOptions)[0] ? '1px solid var(--border-default)' : 'none',
                textTransform: 'uppercase'
              }}>
                {groupLabels[gKey] || gKey}
              </div>
              {groupedOptions[gKey].map(opt => (
                <div
                  key={opt.value}
                  style={{
                    padding: '8px 12px',
                    cursor: 'pointer',
                    borderBottom: '1px solid var(--border-default)',
                    background: (value === opt.value || search === opt.label) ? 'var(--primary-subtle, rgba(59,130,246,0.15))' : 'transparent',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between'
                  }}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    handleSelect(opt);
                  }}
                >
                  {renderOption ? renderOption(opt, search) : (
                    <span style={{ fontWeight: (value === opt.value || search === opt.label) ? 600 : 400, color: 'var(--text-primary)' }}>
                      {opt.label || opt.value}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )) : filteredOptions.map(opt => (
            <div
              key={opt.value}
              style={{
                padding: '8px 12px',
                cursor: 'pointer',
                borderBottom: '1px solid var(--border-default)',
                background: (value === opt.value || search === opt.label) ? 'var(--primary-subtle, rgba(59,130,246,0.15))' : 'transparent',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between'
              }}
              onMouseDown={(e) => {
                e.preventDefault();
                handleSelect(opt);
              }}
            >
              {renderOption ? renderOption(opt, search) : (
                <span style={{ fontWeight: (value === opt.value || search === opt.label) ? 600 : 400, color: 'var(--text-primary)' }}>
                  {opt.label || opt.value}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
