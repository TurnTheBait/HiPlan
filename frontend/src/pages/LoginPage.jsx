import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import './LoginPage.css';

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
  const toast = useToast();

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
      <div className="login-container animate-slideUp">
        <div className="login-logo">
          <img
            src="/hiway-logo.png"
            alt="HiWay - Leader in bulk material handling"
            className="hiway-login-logo"
            style={{ maxHeight: 64, maxWidth: '100%', objectFit: 'contain', marginBottom: 16 }}
          />
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
            <span style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.03em', lineHeight: 1 }}>HiPlan</span>
            <span style={{ fontSize: '0.7rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em', padding: '2px 8px', borderRadius: '4px', background: 'rgba(99, 102, 241, 0.2)', color: 'var(--accent-200)', border: '1px solid rgba(99, 102, 241, 0.4)' }}>for HiWay</span>
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
