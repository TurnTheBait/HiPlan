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
  const [showNotifications, setShowNotifications] = useState(false);
  const [notifications, setNotifications] = useState([]);

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

  async function fetchNotifications() {
    try {
      const { data } = await api.get('/notifications');
      setNotifications(data);
    } catch { /* ignore */ }
  }

  useEffect(() => {
    if (showNotifications) {
      fetchNotifications();
    }
  }, [showNotifications]);

  async function markAsRead(id) {
    try {
      await api.patch(`/notifications/${id}`, { is_read: true });
      fetchNotifications();
      fetchUnread();
    } catch { /* ignore */ }
  }

  async function deleteNotification(id) {
    try {
      await api.delete(`/notifications/${id}`);
      fetchNotifications();
      fetchUnread();
    } catch { /* ignore */ }
  }

  async function deleteAllNotifications() {
    try {
      await api.delete('/notifications');
      fetchNotifications();
      fetchUnread();
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
          </NavLink>
          <NavLink to="/projects" className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}>
            <span className="sidebar-link-icon">📂</span>
            {!collapsed && <span>Commesse</span>}
          </NavLink>
          <NavLink to="/calendar" className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}>
            <span className="sidebar-link-icon">📅</span>
            {!collapsed && <span>Calendario</span>}
          </NavLink>
          <NavLink to="/notes" className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}>
            <span className="sidebar-link-icon">📝</span>
            {!collapsed && <span>Blocchi Note</span>}
          </NavLink>
          <NavLink to="/todo" className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}>
            <span className="sidebar-link-icon">☑️</span>
            {!collapsed && <span>TODO</span>}
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
            onClick={() => setShowNotifications(true)}
            title="Notifiche"
            style={{ position: 'relative' }}
          >
            <div style={{ width: 18, height: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.1rem' }}>🔔</div>
            {!collapsed && <span>Notifiche</span>}
            {unreadCount > 0 && (
              <div
                className="notification-badge"
                style={{
                  position: 'absolute',
                  top: '-4px',
                  right: collapsed ? '-4px' : '8px',
                }}
              >
                {unreadCount}
              </div>
            )}
          </button>

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
            {collapsed ? '❌' : '❌ Esci'}
          </button>
        </div>
      </aside>

      <main className="main-content">
        <div className="main-body">
          <Outlet />
        </div>
      </main>

      {showNotifications && (
        <div className="modal-overlay" onClick={() => setShowNotifications(false)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ width: 650, padding: 0, overflow: 'hidden' }}>
            <div className="modal-header" style={{ padding: '20px 24px', borderBottom: '1px solid var(--border-subtle)' }}>
              <h2>Notifiche</h2>
              {notifications.length > 0 && (
                <button
                  className="btn btn-ghost btn-sm notification-delete-all"
                  onClick={deleteAllNotifications}
                  title="Elimina tutte le notifiche"
                >
                  🗑️ Elimina tutte
                </button>
              )}
            </div>

            <div style={{ maxHeight: '60vh', overflowY: 'auto', padding: '20px 24px' }}>
              {notifications.length === 0 ? (
                <div className="empty-state" style={{ padding: '40px 0' }}>
                  <div className="empty-state-icon">🔔</div>
                  <h3>Nessuna notifica</h3>
                  <p>Tutto tranquillo per ora</p>
                </div>
              ) : (
                <div className="notifications-list">
                  {notifications.map((n) => (
                    <div key={n.id} className={`notification-item ${n.is_read ? '' : 'unread'}`}
                      onClick={() => {
                        if (n.project_id && n.task_id) {
                          navigate(`/projects/${n.project_id}?open_task=${n.task_id}`);
                        } else if (n.project_id) {
                          navigate(`/projects/${n.project_id}`);
                        }
                        setShowNotifications(false);
                      }}
                      style={{ cursor: n.project_id ? 'pointer' : 'default', padding: '16px', background: 'var(--bg-card)', borderRadius: '12px', border: '1px solid var(--border-subtle)', marginBottom: '12px', display: 'flex', gap: '16px' }}
                    >
                      <span className="notification-icon" style={{ fontSize: '1.4rem' }}>
                        {n.type === 'assignment' ? '👤' : n.type === 'deadline' ? '⏰' : '📝'}
                      </span>
                      <div className="notification-content" style={{ flex: 1 }}>
                        <div className="notification-title" style={{ fontWeight: 600, marginBottom: '4px', fontSize: '0.95rem' }}>{n.title}</div>
                        <div className="notification-message" style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>{n.message}</div>
                        <div className="notification-time" style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', marginTop: '6px' }}>
                          {new Date(n.created_at).toLocaleString('it-IT')}
                        </div>
                      </div>
                      <div className="notification-actions" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        {!n.is_read && (
                          <button
                            className="btn-icon"
                            title="Segna come letta"
                            onClick={(e) => { e.stopPropagation(); markAsRead(n.id); }}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.2rem', opacity: 0.6 }}
                          >
                            ✅
                          </button>
                        )}
                        <button
                          className="btn-icon"
                          title="Elimina"
                          onClick={(e) => { e.stopPropagation(); deleteNotification(n.id); }}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.2rem', opacity: 0.6 }}
                        >
                          🗑️
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="modal-actions" style={{ padding: '16px 24px', borderTop: '1px solid var(--border-subtle)', justifyContent: 'center' }}>
              <button type="button" className="btn btn-secondary" onClick={() => setShowNotifications(false)}>Chiudi</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
