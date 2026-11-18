import { useEffect, useState } from 'react';

async function call(path, method = 'GET', body) {
  const response = await fetch(`/ran-api/api${path}`, {
    method, headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let data; try { data = text ? JSON.parse(text) : {}; } catch { data = { message: text }; }
  if (!response.ok) throw new Error(data.detail || data.error || `RAN backend HTTP ${response.status}`);
  return data;
}

export default function RANTelemetryTab({ active }) {
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function refresh() {
    setError('');
    try { setStatus(await call('/telemetry/status')); } catch (e) { setError(e.message); }
  }
  useEffect(() => { if (active) refresh(); }, [active]);
  async function start() {
    setBusy(true); setError('');
    try {
      await call('/telemetry/simulator/start', 'POST', {
        sinks: ['kafka'], kafka_topic: 'dtwin.telemetry',
        sample_period_s: 30, speed: 1, noise_scale: 0.3,
      });
      await refresh();
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }
  async function stop() {
    setBusy(true); setError('');
    try { await call('/telemetry/simulator/stop', 'POST', {}); await refresh(); }
    catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }
  const simulator = status?.simulator || {};
  return (
    <section className={`tab ${active ? 'active' : ''}`}>
      <div className="page-title">RAN Data Ingestion</div>
      <div className="card">
        <h3>RAN telemetry simulator</h3>
        <p className="sub">Controls the RAN backend telemetry simulator. The supplied simulator generates simulated measurements; it does not represent live radio measurements unless your backend is connected to a real telemetry source.</p>
        <div className="whatif-actions">
          <button className="btn blue" onClick={refresh} disabled={busy}>↻ Refresh status</button>
          <button className="btn green" onClick={start} disabled={busy || simulator.phase === 'live'}>{busy ? 'Working…' : '▶ Start simulator'}</button>
          <button className="btn" onClick={stop} disabled={busy || !simulator.phase || simulator.phase === 'stopped'}>■ Stop simulator</button>
        </div>
        {error && <p style={{ color: '#b42318', marginTop: 12 }}>{error}</p>}
        <div className="row" style={{ marginTop: 16 }}>
          <div className="stat"><div className="v">{simulator.phase || '—'}</div><div className="l">Simulator phase</div></div>
          <div className="stat"><div className="v">{status?.samples ?? '—'}</div><div className="l">Samples stored</div></div>
          <div className="stat"><div className="v">{simulator.entities ?? '—'}</div><div className="l">Entities</div></div>
          <div className="stat"><div className="v">{simulator.errors ?? '—'}</div><div className="l">Simulator errors</div></div>
        </div>
        <div className="sub" style={{ marginTop: 12 }}>Telemetry source and simulator details</div>
        <pre className="log" style={{ maxHeight: 280 }}>{JSON.stringify(status || { message: 'No status loaded yet.' }, null, 2)}</pre>
      </div>
    </section>
  );
}
