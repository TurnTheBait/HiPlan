import React, { useState, useRef, useEffect } from 'react';
import AppIcon from './AppIcon';

export default function MultiSelectDropdown({ 
  value = [], 
  onChange, 
  options = [], 
  placeholder = 'Seleziona...', 
  style = {}
}) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef(null);

  useEffect(() => {
    function handleClickOutside(event) {
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const toggleOption = (optionValue) => {
    if (value.includes(optionValue)) {
      onChange(value.filter(v => v !== optionValue));
    } else {
      onChange([...value, optionValue]);
    }
  };

  const selectedLabels = value
    .map(v => {
      const opt = options.find(o => o.value === v);
      return opt ? opt.label : v;
    })
    .join(', ');

  return (
    <div 
      ref={containerRef} 
      style={{ position: 'relative', ...style }}
    >
      <div 
        className="input"
        style={{ 
          padding: '6px 12px', 
          fontSize: 13, 
          borderRadius: 10, 
          minHeight: 38,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          cursor: 'pointer',
          background: 'var(--bg-primary)',
          color: value.length > 0 ? 'var(--text-primary)' : 'var(--text-secondary)',
          border: '1px solid var(--border-default)',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          userSelect: 'none'
        }}
        onClick={() => setIsOpen(!isOpen)}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', paddingRight: 8 }}>
          {value.length > 0 ? selectedLabels : placeholder}
        </span>
        <AppIcon name={isOpen ? 'chevronUp' : 'chevronDown'} size={14} style={{ color: 'var(--text-muted)' }} />
      </div>

      {isOpen && (
        <div style={{
          position: 'absolute',
          top: '100%',
          left: 0,
          right: 0,
          marginTop: 4,
          background: 'var(--bg-secondary)',
          border: '1px solid var(--border-subtle)',
          borderRadius: 8,
          boxShadow: 'var(--shadow-md)',
          zIndex: 100,
          maxHeight: 250,
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          padding: '4px 0'
        }}>
          {options.length === 0 ? (
            <div style={{ padding: '8px 12px', color: 'var(--text-muted)', fontSize: 13 }}>
              Nessuna opzione
            </div>
          ) : (
            options.map((opt, idx) => (
              <div 
                key={idx}
                onClick={() => toggleOption(opt.value)}
                style={{
                  padding: '8px 12px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  cursor: 'pointer',
                  background: value.includes(opt.value) ? 'var(--accent-50)' : 'transparent',
                  color: value.includes(opt.value) ? 'var(--accent-600)' : 'var(--text-primary)',
                  fontSize: 13
                }}
                onMouseEnter={(e) => {
                  if (!value.includes(opt.value)) e.currentTarget.style.background = 'var(--bg-tertiary)';
                }}
                onMouseLeave={(e) => {
                  if (!value.includes(opt.value)) e.currentTarget.style.background = 'transparent';
                }}
              >
                <div style={{ 
                  width: 14, height: 14, borderRadius: 3, 
                  border: `1px solid ${value.includes(opt.value) ? 'var(--accent-500)' : 'var(--border-strong)'}`,
                  background: value.includes(opt.value) ? 'var(--accent-500)' : 'transparent',
                  display: 'flex', alignItems: 'center', justifyContent: 'center'
                }}>
                  {value.includes(opt.value) && <AppIcon name="check" size={10} style={{ color: '#fff' }} />}
                </div>
                {opt.label}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
