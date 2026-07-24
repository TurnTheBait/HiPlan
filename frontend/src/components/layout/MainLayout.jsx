import { useState, useEffect } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import api from '../../api/client';
import './MainLayout.css';

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

export default function MainLayout() {
  const { user, logout } = useAuth();
  const { theme, cycleTheme } = useTheme();
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    fetchUnread();
    const interval = setInterval(fetchUnread, 30000);
    window.addEventListener('notifications-changed', fetchUnread);
    return () => {
      clearInterval(interval);
      window.removeEventListener('notifications-changed', fetchUnread);
    };
  }, []);

  async function fetchUnread() {
    try {
      const { data } = await api.get('/notifications/unread-count');
      setUnreadCount(data.count);
    } catch { /* ignore */ }
  }

  function handleLogout() {
    logout();
    navigate('/login');
  }

  const themeLabel = theme === 'system' ? 'Sistema' : theme === 'light' ? 'Chiaro' : 'Scuro';
  const ThemeIcon = theme === 'system' ? MonitorIcon : theme === 'light' ? SunIcon : MoonIcon;

  return (
    <div className={`app-layout ${collapsed ? 'sidebar-collapsed' : ''}`}>
      <aside className="sidebar">
        <div className="sidebar-header">
          <div 
            className="sidebar-logo" 
            onClick={() => navigate('/dashboard')} 
            style={{ cursor: 'pointer' }}
            title="Torna alla Dashboard"
          >
            <img
              src="/hiway-icon.png"
              alt="HiWay"
              className="hiway-sidebar-img"
            />
            {!collapsed && (
              <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.15 }}>
                <span className="sidebar-logo-text" style={{ fontSize: '1.05rem' }}>HiPlan</span>
                <span style={{ fontSize: '0.62rem', color: 'var(--sidebar-text)', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase' }}>for HiWay</span>
              </div>
            )}
          </div>
          <button className="sidebar-toggle" onClick={() => setCollapsed(!collapsed)} title={collapsed ? 'Espandi' : 'Comprimi'}>
            {collapsed ? '→' : '←'}
          </button>
        </div>

        <nav className="sidebar-nav">
          <NavLink to="/dashboard" className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}>
            <span className="sidebar-link-icon">📊</span>
            {!collapsed && <span>Dashboard</span>}
            {unreadCount > 0 && (
              <span
                className="notification-badge"
                style={{
                  position: collapsed ? 'absolute' : 'static',
                  top: collapsed ? '4px' : 'auto',
                  right: collapsed ? '4px' : 'auto',
                  marginLeft: collapsed ? 0 : 'auto',
                }}
              >
                {unreadCount}
              </span>
            )}
          </NavLink>
          <NavLink to="/projects" className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}>
            <span className="sidebar-link-icon">📂</span>
            {!collapsed && <span>Progetti</span>}
          </NavLink>
          <NavLink to="/calendar" className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}>
            <span className="sidebar-link-icon">📅</span>
            {!collapsed && <span>Calendario</span>}
          </NavLink>
          <NavLink to="/notes" className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}>
            <span className="sidebar-link-icon">📝</span>
            {!collapsed && <span>Blocchi Note</span>}
          </NavLink>
          <NavLink to="/conflicts" className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}>
            <span className="sidebar-link-icon">👷‍♂️</span>
            {!collapsed && <span>Panoramica addetti</span>}
          </NavLink>
          <NavLink to="/tickets" className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}>
            <span className="sidebar-link-icon">🎫</span>
            {!collapsed && <span>Ticket</span>}
          </NavLink>
          {user?.role === 'admin' && (
            <NavLink to="/admin" end className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}>
              <span className="sidebar-link-icon">⚙️</span>
              {!collapsed && <span>Admin</span>}
            </NavLink>
          )}
        </nav>

        <div className="sidebar-footer">
          <button
            className="theme-toggle-btn"
            onClick={cycleTheme}
            title={`Tema: ${themeLabel}. Clicca per cambiare.`}
          >
            <ThemeIcon />
            {!collapsed && <span>{themeLabel}</span>}
          </button>

          <div className="sidebar-user" style={{ cursor: 'pointer' }} onClick={() => navigate('/me')} title="Apri il mio profilo">
            <div className="sidebar-avatar">{user?.username?.[0]?.toUpperCase() || '?'}</div>
            {!collapsed && (
              <div className="sidebar-user-info">
                <span className="sidebar-user-name">{user?.full_name || user?.username}</span>
                <span className="sidebar-user-role">{user?.role?.toUpperCase()}</span>
              </div>
            )}
          </div>

          <button className="btn-ghost btn-sm sidebar-logout" onClick={handleLogout} title="Esci">
            {collapsed ? '⏻' : '⏻ Esci'}
          </button>
        </div>
      </aside>

      <main className="main-content">
        <div className="main-body">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
