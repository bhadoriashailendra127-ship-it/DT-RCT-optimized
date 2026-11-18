import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { getTrafficState, writeCurrentTraffic } from '../../graphdbApi';

const FALLBACK_CAPACITY = 10000;
const SESSION_THRESHOLD = 8000;
const CPU_THRESHOLD = 85;

export default function TrafficIngestionTab({ active, onRefresh }) {
  const [capacity, setCapacity] = useState(FALLBACK_CAPACITY);
  const [baselineSessions, setBaselineSessions] = useState(null);
  const [sessions, setSessions] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showAlert, setShowAlert] = useState(false);
  const [error, setError] = useState('');
  const [userChanged, setUserChanged] = useState(false);
  const writeTimer = useRef(null);
  const loadPercent = capacity ? (sessions / capacity) * 100 : 0;
  const cpu = useMemo(() => Math.min(100, 12 + 0.86 * loadPercent), [loadPercent]);
  const overloaded = loadPercent > CPU_THRESHOLD && sessions > SESSION_THRESHOLD && cpu > CPU_THRESHOLD;

  useEffect(() => {
    if (!active || loaded) return;
    let cancelled = false;
    getTrafficState().then((state) => {
      if (cancelled) return;
      setCapacity(state.capacity || FALLBACK_CAPACITY);
      setBaselineSessions(state.sessions);
      // Start the interaction at zero as shown in the reference UI. The slider
      // is a user-driven simulation; GraphDB is updated as the user moves it.
      setSessions(0);
      setLoaded(true);
    }).catch((e) => {
      if (!cancelled) {
        setError(e.message);
        setLoaded(true);
      }
    });
    return () => { cancelled = true; };
  }, [active, loaded]);


  useEffect(() => {
    if (!userChanged || !loaded) return undefined;
    if (writeTimer.current) clearTimeout(writeTimer.current);
    writeTimer.current = setTimeout(async () => {
      setSaving(true);
      setError('');
      try {
        await writeCurrentTraffic(sessions, capacity);
        onRefresh?.();
      } catch (e) {
        setError(`Could not write the selected traffic to GraphDB: ${e.message}`);
      } finally {
        setSaving(false);
      }
    }, 250);
    return () => { if (writeTimer.current) clearTimeout(writeTimer.current); };
  }, [sessions, capacity, userChanged, loaded, onRefresh]);

  async function handleSlide(event) {
    const next = Number(event.target.value);
    const wasOverloaded = sessions > SESSION_THRESHOLD && (sessions / capacity) * 100 > CPU_THRESHOLD && Math.min(100, 12 + 0.86 * ((sessions / capacity) * 100)) > CPU_THRESHOLD;
    setSessions(next);
    setUserChanged(true);
    const nowOverloaded = next > SESSION_THRESHOLD && (next / capacity) * 100 > CPU_THRESHOLD && Math.min(100, 12 + 0.86 * ((next / capacity) * 100)) > CPU_THRESHOLD;
    if (!wasOverloaded && nowOverloaded) setShowAlert(true);
  }

  const thresholdSessions = Math.round(capacity * CPU_THRESHOLD / 100);
  return (
    <section className={`tab ${active ? 'active' : ''} gdb-panel traffic-simulation`}>
      <div className="page-title">Traffic ingestion</div>
      <div className="card traffic-sim-card">
        <h3>Simulate active session flow</h3>
        <p className="sub">
          Drag the slider to simulate active PDU session flow on the UPF. Crossing {CPU_THRESHOLD}% of the {capacity.toLocaleString()}-session capacity triggers an overload alert — go to <b>What-If</b> afterwards to have the engine suggest (and execute) a load-split plan.
        </p>
        <p className="note"><i>Real current UPF baseline: {baselineSessions == null ? '—' : baselineSessions.toLocaleString()} active sessions.</i></p>
        <div className="traffic-layout">
          <div className="traffic-slider-area">
            <div className="traffic-range-labels"><span>0</span><strong>{CPU_THRESHOLD}% threshold ({thresholdSessions.toLocaleString()})</strong><span>{capacity.toLocaleString()}</span></div>
            <input
              className={`traffic-range ${overloaded ? 'is-overloaded' : ''}`}
              type="range" min="0" max={capacity} step="100" value={Math.min(sessions, capacity)}
              onChange={handleSlide}
              aria-label="Active PDU sessions"
              title={`${sessions.toLocaleString()} sessions · ${loadPercent.toFixed(2)}% capacity`}
              style={{ '--range-progress': `${Math.min(100, loadPercent)}%`, '--threshold': `${CPU_THRESHOLD}%` }}
            />
            <div className="traffic-zone-labels"><span>Normal zone</span><span>Overload zone</span></div>
            {saving && <div className="traffic-saving">Writing telemetry to GraphDB…</div>}
          </div>
          <div className="traffic-stats-grid">
            <div className={`traffic-stat ${overloaded ? 'danger' : 'success'}`}><div className="value">{sessions.toLocaleString()}</div><div className="label">active sessions</div></div>
            <div className="traffic-stat dark"><div className="value">{capacity.toLocaleString()}</div><div className="label">max sessions</div></div>
            <div className={`traffic-stat ${overloaded ? 'danger' : 'success'}`}><div className="value">{overloaded ? 'OVERLOAD' : 'NORMAL'}</div><div className="label">status</div></div>
            <div className={`traffic-stat ${overloaded ? 'danger' : 'success'}`}><div className="value">{loadPercent.toFixed(2)}%</div><div className="label">load percentage (threshold {CPU_THRESHOLD}%)</div></div>
          </div>
        </div>
        {error && <div className="traffic-error" role="alert">{error}</div>}
        {!loaded && <div className="sub">Loading UPF capacity from GraphDB…</div>}
      </div>
      {showAlert && (
        <div className="traffic-modal-backdrop" role="presentation" onClick={() => setShowAlert(false)}>
          <div className="traffic-modal" role="dialog" aria-modal="true" aria-labelledby="upf-overload-title" onClick={(e) => e.stopPropagation()}>
            <AlertTriangle className="traffic-modal-icon" size={48} fill="#ffbd45" />
            <h2 id="upf-overload-title">UPF OVERLOAD</h2>
            <p>Load has crossed {CPU_THRESHOLD}% of the {capacity.toLocaleString()}-session capacity. The UPF is now in an overloaded state. Go to What-If to have the engine suggest a load-split plan.</p>
            <button className="traffic-acknowledge" onClick={() => setShowAlert(false)}>Acknowledge</button>
          </div>
        </div>
      )}
    </section>
  );
}
