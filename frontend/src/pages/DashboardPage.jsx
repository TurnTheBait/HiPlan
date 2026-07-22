import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import TimelineView from '../components/calendar/TimelineView';
import './DashboardPage.css';
import { STATUS_LABELS_IT } from '../utils/statusLabels';

export default function DashboardPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const today = new Date();
  const [timelineYear, setTimelineYear] = useState(today.getFullYear());
  const [timelineMonth, setTimelineMonth] = useState(today.getMonth());
  const [projects, setProjects] = useState([]);
  const [projectsWithTasks, setProjectsWithTasks] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [myTasksToday, setMyTasksToday] = useState([]);
  const [vacations, setVacations] = useState([]);
  const [recoveryItems, setRecoveryItems] = useState([]);
  const [dismissedKeys, setDismissedKeys] = useState(
    () => new Set(JSON.parse(localStorage.getItem('recovery_dismissed') || '[]'))
  );
  const [loading, setLoading] = useState(true);

  const MONTH_NAMES_IT = [
    'Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno',
    'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre'
  ];

  function prevMonth() {
    if (timelineMonth === 0) {
      setTimelineMonth(11);
      setTimelineYear(y => y - 1);
    } else {
      setTimelineMonth(m => m - 1);
    }
  }

  function nextMonth() {
    if (timelineMonth === 11) {
      setTimelineMonth(0);
      setTimelineYear(y => y + 1);
    } else {
      setTimelineMonth(m => m + 1);
    }
  }

  function goToToday() {
    const now = new Date();
    setTimelineYear(now.getFullYear());
    setTimelineMonth(now.getMonth());
  }

  useEffect(() => {
    loadData();
  }, []);

async function loadData() {
    try {
      const [projRes, notifRes, tasksRes, vacRes, recoveryRes] = await Promise.all([
        api.get('/projects'),
        api.get('/notifications'),
        api.get('/users/me/tasks/today'),
        api.get('/vacations/me').catch(() => ({ data: [] })),
        api.get('/vacations/me/recovery').catch(() => ({ data: [] })),
      ]);
      setProjects(projRes.data);
      setNotifications(notifRes.data);
      setMyTasksToday(tasksRes.data);
      setVacations(vacRes.data || []);
      setRecoveryItems(recoveryRes.data || []);

      Promise.all(
        projRes.data.map(async (p) => {
          try {
            const { data: gData } = await api.get(`/projects/${p.id}/gantt`);
            return { ...p, tasks: Array.isArray(gData.tasks) ? gData.tasks : [] };
          } catch {
            return { ...p, tasks: [] };
          }
        })
      ).then(fullData => {
        setProjectsWithTasks(fullData);
      });
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }

  async function deleteNotification(id) {
    try {
      await api.delete(`/notifications/${id}`);
      setNotifications(prev => prev.filter(n => n.id !== id));
      window.dispatchEvent(new Event('notifications-changed'));
    } catch { /* ignore */ }
  }

  async function deleteAllNotifications() {
    try {
      await api.delete('/notifications');
      setNotifications([]);
      window.dispatchEvent(new Event('notifications-changed'));
    } catch { /* ignore */ }
  }

  function getRecoveryKey(item) {
    return `${item.task_id}_${item.vacation_start}`;
  }

  function dismissRecoveryItem(e, item) {
    e.stopPropagation();
    const key = getRecoveryKey(item);
    setDismissedKeys(prev => {
      const next = new Set(prev);
      next.add(key);
      localStorage.setItem('recovery_dismissed', JSON.stringify([...next]));
      return next;
    });
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

  const timelineProjects = useMemo(() => {
    if (!projectsWithTasks.length) return [];
    return projectsWithTasks.filter(p => {
      if (!p.tasks) return false;
      return p.tasks.some(t => Array.isArray(t.workers) && t.workers.includes(user?.username));
    });
  }, [projectsWithTasks, user?.username]);

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

      <div className="card dashboard-section" style={{ marginTop: 24, marginBottom: 24, overflowX: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 12 }}>
          <h2 style={{ display: 'flex', alignItems: 'center', gap: 8, margin: 0 }}>
            <span>📅</span> La tua Timeline ({MONTH_NAMES_IT[timelineMonth]} {timelineYear})
          </h2>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <button
              type="button"
              onClick={prevMonth}
              className="btn btn-secondary"
              style={{ padding: '4px 10px', fontSize: '0.85rem' }}
            >
              &lt; Prec.
            </button>
            <button
              type="button"
              onClick={goToToday}
              className="btn btn-primary"
              style={{ padding: '4px 12px', fontSize: '0.85rem' }}
            >
              Oggi
            </button>
            <button
              type="button"
              onClick={nextMonth}
              className="btn btn-secondary"
              style={{ padding: '4px 10px', fontSize: '0.85rem' }}
            >
              Succ. &gt;
            </button>
          </div>
        </div>
<TimelineView 
          projects={timelineProjects}
          currYear={timelineYear}
          currMonth={timelineMonth}
          filterWorker={user?.username}
          onSelectProject={(proj) => navigate(`/projects/${proj.id}`)}
          vacations={vacations}
        />
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
          <div className="notification-header">
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
                  <button
                    className="notification-delete-btn"
                    onClick={(e) => { e.stopPropagation(); deleteNotification(n.id); }}
                    title="Elimina notifica"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {recoveryItems.filter(item => !dismissedKeys.has(getRecoveryKey(item))).length > 0 && (
          <div className="card dashboard-section" style={{ gridColumn: '1 / -1', border: '2px solid #f59e0b', background: 'rgba(245,158,11,0.05)' }}>
            <h2 style={{ color: '#d97706', display: 'flex', alignItems: 'center', gap: 8 }}>
              ⚠️ Ore da Recuperare per Ferie
            </h2>
            <p style={{ color: 'var(--text-secondary)', marginBottom: 16, fontSize: '0.9rem' }}>
              Hai ore pianificate che cadono nei tuoi giorni di ferie. Coordinati con il tuo responsabile per recuperarle.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {recoveryItems
                .filter(item => !dismissedKeys.has(getRecoveryKey(item)))
                .map((item, i) => (
                  <div
                    key={i}
                    onClick={() => navigate(`/projects/${item.project_id}`)}
                    style={{
                      background: 'var(--bg-secondary)', borderRadius: 10, padding: '12px 16px',
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      borderLeft: '4px solid #f59e0b', gap: 12, flexWrap: 'wrap',
                      cursor: 'pointer'
                    }}
                  >
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 700 }}>📋 {item.task_name}</div>
                      <div style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>Progetto: {item.project_name}</div>
                      <div style={{ color: '#6b7280', fontSize: '0.8rem', marginTop: 3 }}>
                        Ferie: {item.vacation_start} → {item.vacation_end} &middot; {item.vacation_days?.length || 0} gg lavorativi sovrapposti
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{
                        background: '#f59e0b', color: '#fff', borderRadius: 8, padding: '6px 14px',
                        fontWeight: 800, fontSize: '1rem', whiteSpace: 'nowrap'
                      }}>
                        {item.hours_to_recover}h
                      </div>
                      <button
                        onClick={(e) => dismissRecoveryItem(e, item)}
                        title="Segna come recuperata e rimuovi dalla lista"
                        style={{
                          background: 'none', border: '1.5px solid #e5e7eb', borderRadius: 8,
                          cursor: 'pointer', padding: '5px 9px', fontSize: '1rem',
                          color: '#6b7280', transition: 'all 0.15s',
                          display: 'flex', alignItems: 'center'
                        }}
                        onMouseEnter={e => { e.currentTarget.style.borderColor='#ef4444'; e.currentTarget.style.color='#ef4444'; }}
                        onMouseLeave={e => { e.currentTarget.style.borderColor='#e5e7eb'; e.currentTarget.style.color='#6b7280'; }}
                      >
                        🗑️
                      </button>
                    </div>
                  </div>
                ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
