import { useState, useEffect } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import api from '../../api/client';
import './MainLayout.css';

export default function MainLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    fetchUnread();
    const interval = setInterval(fetchUnread, 30000);
    return () => clearInterval(interval);
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

  return (
    <div className={`app-layout ${collapsed ? 'sidebar-collapsed' : ''}`}>
      <aside className="sidebar">
        <div className="sidebar-header">
          <div className="sidebar-logo">
            <img
              src="/hiway-logo.png"
              alt="HiWay"
              className="hiway-sidebar-img"
            />
            {!collapsed && (
              <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.15 }}>
                <span className="sidebar-logo-text" style={{ fontSize: '1.05rem', background: 'linear-gradient(135deg, #ffffff, var(--accent-200))', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>GanttFlow</span>
                <span style={{ fontSize: '0.62rem', color: 'var(--accent-400)', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase' }}>by HiWay</span>
              </div>
            )}
          </div>
          <button className="sidebar-toggle" onClick={() => setCollapsed(!collapsed)} title={collapsed ? 'Espandi' : 'Comprimi'}>
            {collapsed ? '→' : '←'}
          </button>
        </div>

        <nav className="sidebar-nav">
          <NavLink to="/dashboard" className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}>
            <span className="sidebar-link-icon">◫</span>
            {!collapsed && <span>Dashboard</span>}
          </NavLink>
          <NavLink to="/projects" className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}>
            <span className="sidebar-link-icon">☰</span>
            {!collapsed && <span>Progetti</span>}
          </NavLink>
          <NavLink to="/calendar" className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}>
            <span className="sidebar-link-icon">▦</span>
            {!collapsed && <span>Calendario</span>}
          </NavLink>
          <NavLink to="/notes" className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}>
            <span className="sidebar-link-icon">▤</span>
            {!collapsed && <span>Blocchi Note</span>}
          </NavLink>
          {user?.role === 'admin' && (
            <NavLink to="/admin" className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}>
              <span className="sidebar-link-icon">⚙</span>
              {!collapsed && <span>Admin</span>}
            </NavLink>
          )}
        </nav>

        <div className="sidebar-footer">
          <div className="sidebar-user">
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
        <header className="main-header">
          <div className="header-spacer" />
          <div className="header-actions">
            <button
              className="btn-ghost btn-icon header-notification"
              onClick={() => navigate('/dashboard')}
              title="Notifiche"
            >
              🔔
              {unreadCount > 0 && <span className="notification-badge">{unreadCount}</span>}
            </button>
          </div>
        </header>

        <div className="main-body">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
