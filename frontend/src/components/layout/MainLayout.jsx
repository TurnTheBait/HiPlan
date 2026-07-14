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
            <span className="sidebar-logo-icon">📊</span>
            {!collapsed && <span className="sidebar-logo-text">GanttFlow</span>}
          </div>
          <button className="btn-icon btn-ghost sidebar-toggle" onClick={() => setCollapsed(!collapsed)}>
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
