import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import api from '../api/client';
import AppIcon from '../components/ui/AppIcon';
import './AgentPage.css';

// ── Helpers ───────────────────────────────────────────────────────────────

const ACTION_LABELS = {
  phase_rescheduled: 'Fase spostata',
  cascade_rescheduled: 'Cascata',
  vacation_conflict: 'Conflitto ferie',
  lag_detected: 'Ritardo rilevato',
  conflict_detected: 'Conflitto addetto',
};

const ACTION_ICONS = {
  phase_rescheduled: 'gantt',
  cascade_rescheduled: 'timeline',
  vacation_conflict: 'vacations',
  lag_detected: 'clock',
  conflict_detected: 'alert',
};

function formatDate(d) {
  if (!d) return '—';
  const date = new Date(d + 'T00:00:00');
  return date.toLocaleDateString('it-IT', { day: '2-digit', month: 'short', year: 'numeric' });
}

function formatDateTime(iso) {
  if (!iso) return '—';
  const isoZ = iso.endsWith('Z') ? iso : iso + 'Z';
  const d = new Date(isoZ);
  return d.toLocaleString('it-IT', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

// ── Sub-components ────────────────────────────────────────────────────────

function AgentStatCard({ label, value, icon, colorClass = 'agent-stat-default' }) {
  return (
    <div className={`agent-stat-card ${colorClass}`}>
      <div className="agent-stat-icon">
        <AppIcon name={icon} size={20} />
      </div>
      <div className="agent-stat-info">
        <div className="agent-stat-label">{label}</div>
        <div className="agent-stat-value">{value}</div>
      </div>
    </div>
  );
}

function LogItem({ log, isAdmin, onRevert, reverting }) {
  const typeClass = log.action_type || 'phase_rescheduled';

  return (
    <div className="agent-log-item">
      <div className={`agent-log-dot ${typeClass}`}>
        <AppIcon name={ACTION_ICONS[typeClass] || 'list'} size={24} />
      </div>

      <div className={`agent-log-body ${log.reverted ? 'reverted' : ''}`}>
        {/* Top row */}
        <div className="agent-log-top">
          <span className={`agent-log-type-badge badge-${typeClass}`}>
            {ACTION_LABELS[typeClass] || typeClass}
          </span>
          <span className="agent-log-task" title={log.task_name}>
            {log.task_name || 'Fase sconosciuta'}
          </span>
          {log.project_name && (
            <span className="agent-log-project">
              {log.project_code ? `[${log.project_code}] ` : ''}{log.project_name}
            </span>
          )}
          {log.reverted === 1 && (
            <span className="agent-log-reverted-badge">↩ Revocata</span>
          )}
        </div>

        {/* Date shift */}
        {(log.old_start_date || log.new_start_date) && (
          <div className="agent-log-dates">
            <span className="agent-date-from">
              {formatDate(log.old_start_date)}
              {log.old_end_date && log.old_end_date !== log.old_start_date
                ? ` → ${formatDate(log.old_end_date)}`
                : ''}
            </span>
            <span className="agent-date-arrow">→</span>
            <span className="agent-date-to">
              {formatDate(log.new_start_date)}
              {log.new_end_date && log.new_end_date !== log.new_start_date
                ? ` → ${formatDate(log.new_end_date)}`
                : ''}
            </span>
          </div>
        )}

        {/* Worker */}
        {log.worker && (
          <div className="agent-log-worker">
            👤 <span>{log.worker}</span>
          </div>
        )}

        {/* Reason */}
        {log.reason && (
          <div className="agent-log-reason">{log.reason}</div>
        )}

        {/* Footer */}
        <div className="agent-log-footer">
          <span className="agent-log-time" style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <AppIcon name="clock" size={12} /> {formatDateTime(log.created_at)}
          </span>

          {isAdmin && log.reverted !== 1 && (
            <button
              className="btn btn-danger btn-sm"
              onClick={() => onRevert(log.id)}
              disabled={reverting === log.id}
              title="Ripristina le date originali della fase"
              style={{ background: 'transparent', color: 'var(--danger)', border: '1px solid var(--danger)' }}
            >
              {reverting === log.id ? (
                <span className="agent-running-spinner" />
              ) : '↩ '}
              Revoca
            </button>
          )}

          {log.reverted === 1 && (
            <span className="agent-reverted-info">
              Revocata da {log.reverted_by || 'admin'} il {formatDateTime(log.reverted_at)}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────

export default function AgentPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  // Agent status
  const [status, setStatus] = useState(null);
  const [toggling, setToggling] = useState(false);
  const [running, setRunning] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [runResult, setRunResult] = useState(null);
  const [analysisResult, setAnalysisResult] = useState(null);

  // Logs
  const [logs, setLogs] = useState([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [reverting, setReverting] = useState(null);
  const [visibleCount, setVisibleCount] = useState(10);

  // Filters
  const [filterType, setFilterType] = useState('');
  const [filterWorker, setFilterWorker] = useState('');
  const [showReverted, setShowReverted] = useState(true);

  // Stats from last run
  const [stats, setStats] = useState(null);

  const pollRef = useRef(null);

  // ── Fetch ─────────────────────────────────────────────────────────────

  const fetchStatus = useCallback(async () => {
    try {
      const { data } = await api.get('/agent/status');
      setStatus(data);
    } catch { /* ignore */ }
  }, []);

  const fetchLogs = useCallback(async () => {
    setLogsLoading(true);
    try {
      const params = new URLSearchParams({ limit: '200', include_reverted: showReverted });
      if (filterType) params.set('action_type', filterType);
      if (filterWorker) params.set('worker', filterWorker);
      const { data } = await api.get(`/agent/logs?${params.toString()}`);
      setLogs(data);
    } catch { /* ignore */ }
    finally { setLogsLoading(false); }
  }, [filterType, filterWorker, showReverted]);

  useEffect(() => {
    fetchStatus();
    fetchLogs();
    // Polling ogni 30 secondi
    pollRef.current = setInterval(() => {
      fetchStatus();
      fetchLogs();
    }, 30000);
    return () => clearInterval(pollRef.current);
  }, [fetchStatus, fetchLogs]);

  // ── Actions ───────────────────────────────────────────────────────────

  async function handleToggle() {
    if (!isAdmin) return;
    setToggling(true);
    try {
      await api.post('/agent/toggle');
      await fetchStatus();
    } catch { /* ignore */ }
    finally { setToggling(false); }
  }

  async function handleRunNow() {
    if (!isAdmin) return;
    setRunning(true);
    setRunResult(null);
    setAnalysisResult(null);
    try {
      const { data } = await api.post('/agent/run-now');
      setRunResult(data);
      await fetchStatus();
      await fetchLogs();
    } catch { /* ignore */ }
    finally { setRunning(false); }
  }

  async function handleAnalyzeNow() {
    if (!isAdmin) return;
    setAnalyzing(true);
    setRunResult(null);
    setAnalysisResult(null);
    try {
      const { data } = await api.post('/agent/analyze');
      setAnalysisResult(data);
    } catch { /* ignore */ }
    finally { setAnalyzing(false); }
  }

  async function handleRevert(logId) {
    setReverting(logId);
    try {
      await api.post(`/agent/logs/${logId}/revert`);
      await fetchLogs();
    } catch { /* ignore */ }
    finally { setReverting(null); }
  }

  // ── Derived stats ─────────────────────────────────────────────────────

  const totalActions = logs.length;
  const totalReverted = logs.filter(l => l.reverted === 1).length;
  const totalCascade = logs.filter(l => l.action_type === 'cascade_rescheduled').length;
  const totalVacation = logs.filter(l => l.action_type === 'vacation_conflict').length;
  const totalLag = logs.filter(l => l.action_type === 'lag_detected').length;

  const agentActive = status?.enabled ?? true;
  const lastRun = status?.last_run
    ? `Ultima esecuzione: ${formatDateTime(status.last_run)}`
    : 'Non ancora eseguito';

  // ── Render ────────────────────────────────────────────────────────────

  return (
    <div className="agent-page">

      {/* ── Header card ─────────────────────────────────────────────── */}
      <div className="projects-command-stack" style={{ display: 'flex', justifyContent: 'space-between', padding: '16px 20px', alignItems: 'center', marginBottom: '24px' }}>
        <div className="agent-header-info">
          <div className={`agent-icon-wrap ${agentActive ? 'active' : 'paused'}`}>
            <AppIcon name="agent" size={28} style={{ color: agentActive ? 'var(--accent-600)' : 'var(--text-secondary)' }} />
            {agentActive && <span className="agent-pulse" />}
          </div>

          <div className="agent-header-text">
            <h1>
              Agente Ripianificazione
              <span className={`agent-status-badge ${agentActive ? 'active' : 'paused'}`}>
                {agentActive ? '● Attivo' : '⏸ In pausa'}
              </span>
            </h1>
            <p>
              Analizza automaticamente le commesse e ripianifica le fasi con conflitti o ritardi.
            </p>
            <p className="agent-last-run">{lastRun}</p>
          </div>
        </div>

        {isAdmin && (
          <div className="page-action-group">
            <button
              className={`btn ${agentActive ? 'btn-danger' : 'btn-primary'} btn-sm`}
              onClick={handleToggle}
              disabled={toggling}
              title={agentActive ? 'Metti in pausa l\'agente' : 'Attiva l\'agente'}
            >
              {toggling && <span className="agent-running-spinner" style={{ marginRight: '6px' }} />}
              {!toggling && (agentActive ? <AppIcon name="pause" size={16} style={{ marginRight: '4px' }} /> : <AppIcon name="play" size={16} style={{ marginRight: '4px' }} />)}
              {agentActive ? 'Metti in pausa' : 'Attiva agente'}
            </button>

            <button
              className="btn btn-secondary btn-sm"
              onClick={handleAnalyzeNow}
              disabled={analyzing || running}
              title="Analizza la situazione senza applicare modifiche (dry-run)"
            >
              {analyzing && <span className="agent-running-spinner" style={{ marginRight: '6px' }} />}
              {!analyzing && <AppIcon name="search" size={16} style={{ marginRight: '4px' }} />}
              {analyzing ? 'Analisi in corso…' : 'Analizza situazione'}
            </button>
          </div>
        )}
      </div>

      {/* ── Run result notification ──────────────────────────────────── */}
      {runResult && (
        <div style={{
          background: 'rgba(16,185,129,0.08)',
          border: '1px solid rgba(16,185,129,0.3)',
          borderRadius: '12px',
          padding: '14px 18px',
          fontSize: '0.85rem',
          color: 'var(--text-primary)',
          display: 'flex',
          gap: '16px',
          flexWrap: 'wrap',
          alignItems: 'center',
          marginBottom: '24px'
        }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><AppIcon name="check" size={16} color="var(--success)" /> <strong>Ciclo completato</strong></span>
          <span>📦 {runResult.phases_rescheduled} fasi spostate</span>
          <span>🔗 {runResult.cascade_rescheduled} propagazioni</span>
          <span>🏖️ {runResult.vacation_conflicts} conflitti ferie</span>
          <span>⏰ {runResult.lag_detected} ritardi</span>
          {runResult.errors?.length > 0 && (
            <span style={{ color: 'var(--danger)' }}>⚠️ {runResult.errors.length} errori</span>
          )}
          <button
            style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', opacity: 0.5, fontSize: '1rem' }}
            onClick={() => setRunResult(null)}
          >✕</button>
        </div>
      )}

      {/* ── Analysis result notification ──────────────────────────────────── */}
      {analysisResult && (
        <div style={{
          background: 'rgba(7,127,186,0.08)',
          border: '1px solid rgba(7,127,186,0.3)',
          borderRadius: '12px',
          padding: '14px 18px',
          fontSize: '0.85rem',
          color: 'var(--text-primary)',
          display: 'flex',
          gap: '16px',
          flexWrap: 'wrap',
          alignItems: 'center',
          marginBottom: '24px'
        }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><AppIcon name="search" size={16} color="var(--accent-600)" /> <strong>Analisi completata (nessuna modifica salvata)</strong></span>
          <span>📦 {analysisResult.phases_rescheduled} fasi da spostare</span>
          <span>🔗 {analysisResult.cascade_rescheduled} propagazioni</span>
          <span>🏖️ {analysisResult.vacation_conflicts} conflitti ferie</span>
          <span>⏰ {analysisResult.lag_detected} ritardi</span>
          {analysisResult.errors?.length > 0 && (
            <span style={{ color: 'var(--danger)' }}>⚠️ {analysisResult.errors.length} errori</span>
          )}

          <div style={{ marginLeft: 'auto', display: 'flex', gap: '12px', alignItems: 'center' }}>
            <button className="btn btn-primary btn-sm" onClick={handleRunNow} disabled={running}>
              {running ? 'Applicazione in corso…' : 'Applica ora'}
            </button>
            <button
              style={{ background: 'none', border: 'none', cursor: 'pointer', opacity: 0.5, fontSize: '1rem', padding: '4px' }}
              onClick={() => setAnalysisResult(null)}
              title="Chiudi"
            >✕</button>
          </div>
        </div>
      )}

      {/* ── Stats strip ──────────────────────────────────────────────── */}
      <div className="agent-stats-strip">
        <AgentStatCard label="Azioni totali" value={totalActions} icon="list" colorClass="agent-stat-primary" />
        <AgentStatCard label="Fasi spostate" value={logs.filter(l => l.action_type === 'phase_rescheduled').length} icon="gantt" colorClass="agent-stat-info" />
        <AgentStatCard label="A cascata" value={totalCascade} icon="timeline" colorClass="agent-stat-purple" />
        <AgentStatCard label="Conflitti ferie" value={totalVacation} icon="vacations" colorClass="agent-stat-warning" />
        <AgentStatCard label="Ritardi" value={totalLag} icon="clock" colorClass="agent-stat-danger" />
        <AgentStatCard label="Revocate" value={totalReverted} icon="arrowLeft" colorClass="agent-stat-gray" />
      </div>

      {/* ── Filters ──────────────────────────────────────────────────── */}
      <div className="page-action-bar" style={{ marginBottom: '16px' }}>
        <div className="inline-detail-row">
          <select
            className="input"
            value={filterType}
            onChange={e => setFilterType(e.target.value)}
            style={{ width: '180px' }}
          >
            <option value="">Tutti i tipi</option>
            <option value="phase_rescheduled">Fase spostata</option>
            <option value="cascade_rescheduled">Cascata</option>
            <option value="vacation_conflict">Conflitto ferie</option>
            <option value="lag_detected">Ritardo rilevato</option>
            <option value="conflict_detected">Conflitto addetto</option>
          </select>

          <input
            className="input"
            type="text"
            placeholder="Filtra per addetto…"
            value={filterWorker}
            onChange={e => setFilterWorker(e.target.value)}
            style={{ width: '180px' }}
          />

          <label className="input" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', cursor: 'pointer', width: 'auto', marginBottom: 0, maxHeight: '40px' }}>
            <input
              type="checkbox"
              checked={showReverted}
              onChange={e => setShowReverted(e.target.checked)}
              style={{ margin: 0, cursor: 'pointer' }}
            />
            <span style={{ color: 'var(--text-secondary)' }}>Mostra revocate</span>
          </label>
        </div>

        <div className="page-action-group">
          {(filterType || filterWorker) && (
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => { setFilterType(''); setFilterWorker(''); }}
            >
              ✕ Azzera filtri
            </button>
          )}
        </div>
      </div>

      {/* ── Timeline ─────────────────────────────────────────────────── */}
      <div className="agent-timeline-section">
        <div className="agent-timeline-header">
          <span className="agent-timeline-title">
            <AppIcon name="list" size={18} /> Cronologia azioni
            <span className="agent-log-count">{logs.length} azioni</span>
          </span>
          {logsLoading && (
            <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
              Aggiornamento…
            </span>
          )}
        </div>

        {logs.length === 0 && !logsLoading ? (
          <div className="empty-state">
            <div style={{ marginBottom: '16px', color: 'var(--text-tertiary)' }}>
              <AppIcon name="list" size={48} strokeWidth={1} />
            </div>
            <h3>Nessuna azione registrata</h3>
            <p style={{ maxWidth: '380px' }}>
              {agentActive
                ? 'L\'agente è attivo e inizierà ad analizzare le commesse al prossimo ciclo (ogni 15 minuti).'
                : 'L\'agente è in pausa. Attivalo o usa "Esegui ora" per analizzare le commesse.'}
            </p>
            {isAdmin && (
              <div style={{ display: 'flex', gap: '8px', marginTop: '16px' }}>
                <button className="btn btn-secondary" onClick={handleAnalyzeNow} disabled={analyzing || running}>
                  {analyzing ? 'Analisi in corso…' : 'Analizza situazione'}
                </button>
                <button className="btn btn-primary" onClick={handleRunNow} disabled={running || analyzing}>
                  {running ? 'In esecuzione…' : 'Esegui ora'}
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="agent-timeline">
            {logs.slice(0, visibleCount).map(log => (
              <LogItem
                key={log.id}
                log={log}
                isAdmin={isAdmin}
                onRevert={handleRevert}
                reverting={reverting}
              />
            ))}
            {visibleCount < logs.length && (
              <div style={{ textAlign: 'center', padding: '24px 0 8px 0' }}>
                <button
                  className="btn btn-secondary"
                  onClick={() => setVisibleCount(c => c + 10)}
                  style={{ minWidth: '180px' }}
                >
                  Carica altro ({logs.length - visibleCount})
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
