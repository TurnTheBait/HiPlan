import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import './DashboardPage.css';
import { STATUS_LABELS_IT } from '../utils/statusLabels';

export default function DashboardPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [projects, setProjects] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [myTasksToday, setMyTasksToday] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    try {
      const [projRes, notifRes, tasksRes] = await Promise.all([
        api.get('/projects'),
        api.get('/notifications'),
        api.get('/users/me/tasks/today'),
      ]);
      setProjects(projRes.data);
      setNotifications(notifRes.data);
      setMyTasksToday(tasksRes.data);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }

  const stats = {
    total: projects.length,
    active: projects.filter((p) => p.status === 'active').length,
    completed: projects.filter((p) => p.status === 'completed').length,
    planning: projects.filter((p) => p.status === 'planning').length,
  };

  const avgProgress = projects.length > 0
    ? Math.round(projects.reduce((acc, p) => acc + (p.progress || 0), 0) / projects.length * 100)
    : 0;

  if (loading) {
    return <div className="loading-screen"><div className="spinner" /></div>;
  }

  return (
    <div className="dashboard animate-fadeIn">
      <div className="dashboard-welcome">
        <h1>Ciao, {user?.full_name || user?.username} 👋</h1>
        <p>Ecco un riepilogo dei tuoi progetti</p>
      </div>

      <div className="stats-grid">
        <div className="stat-card stat-total">
          <div className="stat-icon">📁</div>
          <div className="stat-info">
            <span className="stat-value">{stats.total}</span>
            <span className="stat-label">Totale Progetti</span>
          </div>
        </div>
        <div className="stat-card stat-active">
          <div className="stat-icon">🚀</div>
          <div className="stat-info">
            <span className="stat-value">{stats.active}</span>
            <span className="stat-label">Attivi</span>
          </div>
        </div>
        <div className="stat-card stat-completed">
          <div className="stat-icon">✅</div>
          <div className="stat-info">
            <span className="stat-value">{stats.completed}</span>
            <span className="stat-label">Completati</span>
          </div>
        </div>
        <div className="stat-card stat-progress">
          <div className="stat-icon">📈</div>
          <div className="stat-info">
            <span className="stat-value">{avgProgress}%</span>
            <span className="stat-label">Progresso Medio</span>
          </div>
        </div>
      </div>

      <div className="dashboard-grid">
        <div className="card dashboard-section" style={{ gridColumn: '1 / -1' }}>
          <h2>I Miei Task di Oggi</h2>
          {myTasksToday.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon">🎉</div>
              <h3>Nessun task per oggi!</h3>
              <p>Hai la giornata libera oppure i tuoi task sono già completati.</p>
            </div>
          ) : (
            <div className="recent-projects" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '16px' }}>
              {myTasksToday.map(task => (
                <div
                  key={task.id}
                  className="recent-project-item"
                  onClick={() => navigate(`/projects/${task.project_id}`)}
                  style={{ borderLeft: '4px solid var(--accent-500)', padding: '16px' }}
                >
                  <div className="recent-project-info" style={{ marginBottom: '8px' }}>
                    <span className="recent-project-name" style={{ fontSize: '1.1rem' }}>{task.text}</span>
                  </div>
                  <div className="recent-project-meta" style={{ marginBottom: '12px' }}>
                    <span style={{ color: 'var(--accent-400)' }}>🏢 {task.project_name}</span>
                    {task.my_assigned_hours ? (
                      <span style={{ color: '#10b981', fontWeight: 600 }}>⏱ {task.my_assigned_hours}h a te (su {task.planned_hours}h totali)</span>
                    ) : (
                      <span>⏱ {task.planned_hours}h stimate (totali)</span>
                    )}
                  </div>
                  <div className="progress-bar" style={{ width: '100%' }}>
                    <div
                      className="progress-bar-fill"
                      style={{ width: `${task.progress}%`, background: task.progress === 100 ? 'var(--success-color)' : 'var(--accent-500)' }}
                    />
                  </div>
                  <div style={{ textAlign: 'right', marginTop: '4px', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                    {task.progress}% completato
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="card dashboard-section">
          <h2>Progetti Recenti</h2>
          {projects.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon">📋</div>
              <h3>Nessun progetto</h3>
              <p>Crea il tuo primo progetto per iniziare</p>
              <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={() => navigate('/projects')}>
                + Nuovo Progetto
              </button>
            </div>
          ) : (
            <div className="recent-projects">
              {projects.slice(0, 5).map((project) => (
                <div
                  key={project.id}
                  className="recent-project-item"
                  onClick={() => navigate(`/projects/${project.id}`)}
                >
                  <div className="recent-project-info">
                    <span className="recent-project-name">{project.name}</span>
                    <span className={`badge badge-${project.status}`}>{STATUS_LABELS_IT[project.status] || project.status}</span>
                  </div>
                  <div className="progress-bar" style={{ width: '100%' }}>
                    <div
                      className="progress-bar-fill"
                      style={{ width: `${(project.progress || 0) * 100}%` }}
                    />
                  </div>
                  <div className="recent-project-meta">
                    <span>{project.task_count} task</span>
                    <span>{project.member_count} membri</span>
                    <span>{Math.round((project.progress || 0) * 100)}%</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="card dashboard-section">
          <h2>Notifiche</h2>
          {notifications.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon">🔔</div>
              <h3>Nessuna notifica</h3>
              <p>Tutto tranquillo per ora</p>
            </div>
          ) : (
            <div className="notifications-list">
              {notifications.slice(0, 8).map((n) => (
                <div key={n.id} className={`notification-item ${n.is_read ? '' : 'unread'}`}>
                  <span className="notification-icon">
                    {n.type === 'assignment' ? '👤' : n.type === 'deadline' ? '⏰' : '📝'}
                  </span>
                  <div className="notification-content">
                    <span className="notification-title">{n.title}</span>
                    {n.message && <span className="notification-message">{n.message}</span>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
