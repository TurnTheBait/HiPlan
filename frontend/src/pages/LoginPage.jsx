import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { useTheme } from '../context/ThemeContext';
import './LoginPage.css';

/* SVG icons for theme toggle */
function SunIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="5" />
      <line x1="12" y1="1" x2="12" y2="3" />
      <line x1="12" y1="21" x2="12" y2="23" />
      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
      <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
      <line x1="1" y1="12" x2="3" y2="12" />
      <line x1="21" y1="12" x2="23" y2="12" />
      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
      <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}

function MonitorIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
      <line x1="8" y1="21" x2="16" y2="21" />
      <line x1="12" y1="17" x2="12" y2="21" />
    </svg>
  );
}

const DEPARTMENT_OPTIONS = [
  { value: 'ufficio_tecnico', label: '🔧 Ufficio Tecnico' },
  { value: 'produzione', label: '🏭 Produzione' },
  { value: 'acquisti', label: '🛒 Acquisti' },
];

export default function LoginPage() {
  const [isRegister, setIsRegister] = useState(false);
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [department, setDepartment] = useState('ufficio_tecnico');
  const [loading, setLoading] = useState(false);
  const { login, register } = useAuth();
  const { theme, cycleTheme } = useTheme();
  const toast = useToast();

  const themeLabel = theme === 'system' ? 'Sistema' : theme === 'light' ? 'Chiaro' : 'Scuro';
  const ThemeIcon = theme === 'system' ? MonitorIcon : theme === 'light' ? SunIcon : MoonIcon;

  async function handleSubmit(e) {
    e.preventDefault();
    setLoading(true);
    try {
      if (isRegister) {
        await register(email, username, password, fullName, department);
        toast.success('Account creato con successo!');
      } else {
        await login(email, password);
        toast.success('Bentornato!');
      }
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Errore di autenticazione');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-page">
      <div className="login-bg-gradient" />
      
      <button
        type="button"
        className="btn btn-ghost"
        style={{
          position: 'absolute',
          top: 16,
          right: 16,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          color: 'var(--text-secondary)'
        }}
        onClick={cycleTheme}
        title={`Tema: ${themeLabel}. Clicca per cambiare.`}
      >
        <ThemeIcon />
        <span style={{ fontSize: '0.875rem' }}>{themeLabel}</span>
      </button>

      <div className="login-container animate-slideUp">
        <div className="login-logo">
          <img
            src="/hiway-logo.png"
            alt="HiWay - Leader in bulk material handling"
            className="hiway-login-logo"
            style={{ maxHeight: 64, maxWidth: '100%', objectFit: 'contain', marginBottom: 16 }}
          />
          <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12, marginBottom: 8 }}>
            <span style={{ fontSize: '1.75rem', fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.03em', lineHeight: 1 }}>HiPlan</span>
            <span style={{ fontSize: '0.75rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em', padding: '4px 8px', borderRadius: '4px', background: 'rgba(99, 102, 241, 0.15)', color: 'var(--text-accent)', border: '1px solid rgba(99, 102, 241, 0.3)' }}>FOR HIWAY</span>
          </div>
          <p>Gestione commesse e pianificazione tecnica</p>
        </div>

        <form className="login-form" onSubmit={handleSubmit}>
          <h2>{isRegister ? 'Crea un account' : 'Accedi'}</h2>

          <div className="input-group">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              className="input"
              placeholder="nome@azienda.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>

          {isRegister && (
            <>
              <div className="input-group">
                <label htmlFor="username">Username</label>
                <input
                  id="username"
                  type="text"
                  className="input"
                  placeholder="il-tuo-username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  required
                  minLength={3}
                />
              </div>
              <div className="input-group">
                <label htmlFor="fullName">Nome completo</label>
                <input
                  id="fullName"
                  type="text"
                  className="input"
                  placeholder="Mario Rossi"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                />
              </div>
              <div className="input-group">
                <label htmlFor="department">Reparto</label>
                <select
                  id="department"
                  className="input"
                  value={department}
                  onChange={(e) => setDepartment(e.target.value)}
                  required
                >
                  {DEPARTMENT_OPTIONS.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>
            </>
          )}

          <div className="input-group">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              className="input"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
            />
          </div>

          <button type="submit" className="btn btn-primary login-submit" disabled={loading}>
            {loading ? <span className="spinner" style={{ width: 18, height: 18, borderWidth: 2 }} /> : null}
            {isRegister ? 'Registrati' : 'Accedi'}
          </button>

          <p className="login-toggle">
            {isRegister ? 'Hai già un account?' : 'Non hai un account?'}
            <button type="button" className="btn-link" onClick={() => setIsRegister(!isRegister)}>
              {isRegister ? 'Accedi' : 'Registrati'}
            </button>
          </p>
        </form>
      </div>
    </div>
  );
}
