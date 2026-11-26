import { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, RefreshCw, Wifi } from 'lucide-react';
import { loadRANSiteIngestion, RAN_GRAPHDB } from '../../ranGraphdbApi';

const DEFAULT_THRESHOLD = 85;
const fmt = (value, digits = 1) => value == null || !Number.isFinite(Number(value)) ? '—' : Number(value).toLocaleString(undefined, { maximumFractionDigits: digits });
const local = (value = '') => String(value).split(/[/#:]/).filter(Boolean).pop() || String(value);

export default function RANTelemetryTab({ active }) {
  const [data, setData] = useState({ sites: [], clusters: [], readings: [], head: null, threshold: DEFAULT_THRESHOLD });
  const [site, setSite] = useState('');
  const [demand, setDemand] = useState(4);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const refresh = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const next = await loadRANSiteIngestion();
      setData(next);
      setSite((old) => next.sites.some((x) => x.id === old) ? old : (next.sites[0]?.id || ''));
    } catch (e) { setError(e.message || 'Unable to load RAN site telemetry.'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    if (!active) return undefined;
    refresh();
    const timer = setInterval(refresh, 20000);
    return () => clearInterval(timer);
  }, [active, refresh]);

  const selected = useMemo(() => data.sites.find((x) => x.id === site) || null, [data.sites, site]);
  const clusters = useMemo(() => data.clusters.filter((x) => x.site === site), [data.clusters, site]);
  const peakCpu = selected?.peakCpu ?? null;
  const connectedUsers = selected?.users ?? null;
  const perUe = selected?.perUeMbps ?? null;
  const threshold = data.threshold || DEFAULT_THRESHOLD;
  const status = peakCpu == null ? 'NO DATA' : peakCpu >= threshold ? 'OVERLOAD' : peakCpu < 30 ? 'UNDER-LOAD' : 'NORMAL';
  const statusColor = status === 'OVERLOAD' ? '#dc2626' : status === 'UNDER-LOAD' || status === 'NO DATA' ? '#d97706' : '#16a34a';
  const capacity = selected?.dlCapacityMbps ?? null;

  return (
    <section className={`tab ${active ? 'active' : ''}`}>
      <div className="page-title">GraphDB Operations Console</div>
      <div className="ran-ingest-heading">
        <div><div className="ran-eyebrow">NETWORK INTELLIGENCE / RAN</div><div className="ran-subtitle">Explore your RAN topology, drive CU / DU traffic demand per site, and review the what-if scaling plan.</div></div>
        <div className="ran-connection"><span /> GraphDB connected · {RAN_GRAPHDB.repository}</div>
      </div>
      <div className="ran-section-title"><Activity size={17}/> Traffic ingestion</div>

      <div className="card ran-demand-card">
        <div className="ran-card-top">
          <h3>Simulate per-UE traffic demand</h3>
          <label className="ran-site-select">Site
            <select value={site} onChange={(e) => setSite(e.target.value)} disabled={!data.sites.length}>
              {data.sites.length ? data.sites.map((x) => <option key={x.id} value={x.id}>{x.label}</option>) : <option value="">No sites found</option>}
            </select>
          </label>
        </div>
        <p className="ran-description">Adjust the per-UE downlink demand for every DU at the selected site. DU or CU CPU crossing {fmt(threshold, 0)}% indicates an overload condition; values below 30% indicate under-load. Use the What-If page to evaluate a scaling or traffic-steering plan. This slider is a scenario input and does not overwrite live GraphDB telemetry.</p>
        <p className="ran-baseline">Real current baseline: <b>{fmt(perUe)} Mbps per UE</b> · <b>{fmt(connectedUsers, 0)}</b> connected UEs on {selected?.label || 'the selected site'}.</p>
        <div className="ran-ingest-grid">
          <div className="ran-slider-area">
            <div className="ran-slider-value"><b>{fmt(demand)} Mbps</b><span>Scenario demand per UE</span></div>
            <input aria-label="Per UE traffic demand" type="range" min="0" max="20" step="0.1" value={demand} onChange={(e) => setDemand(Number(e.target.value))} />
            <div className="ran-slider-scale"><span>0</span><span>30% ({fmt(6, 1)} Mbps)</span><span>{fmt(threshold, 0)}% CPU threshold</span><span>20 Mbps</span></div>
            <div className="ran-zone-labels"><span>Under-load zone</span><span>Normal zone</span><span>Overload zone</span></div>
            <div className="ran-demand-note">{demand < 6 ? 'Below the illustrative 30% demand marker' : demand > 12 ? 'High demand scenario' : 'Normal demand scenario'} · Use this value when configuring your What-If scenario.</div>
          </div>
          <div className="ran-kpi-grid">
            <div className="ran-kpi green"><strong>{fmt(perUe)}</strong><span>Mbps per UE</span></div>
            <div className="ran-kpi navy"><strong>{fmt(capacity, 0)}</strong><span>Mbps DL capacity per DU</span></div>
            <div className="ran-kpi" style={{ background: statusColor }}><strong>{status}</strong><span>Site status</span></div>
            <div className={`ran-kpi ${peakCpu != null && peakCpu >= threshold ? 'red' : 'green'}`}><strong>{peakCpu == null ? '—' : `${fmt(peakCpu)}%`}</strong><span>Peak DU CPU (threshold {fmt(threshold, 0)}%)</span></div>
          </div>
        </div>
        {error && <p className="ran-error">{error}</p>}
      </div>

      <div className="card ran-cluster-card">
        <div className="ran-cluster-heading"><div><h3>{selected?.label || 'Selected site'} · CU clusters</h3><p className="ran-muted">CU and DU utilization based on the newest observations in the Current named graph.</p></div><button className="btn blue" onClick={refresh} disabled={loading}><RefreshCw size={14} className={loading ? 'ran-spin' : ''}/> {loading ? 'Refreshing…' : 'Refresh'}</button></div>
        <div className="ran-table-wrap"><table className="ran-table"><thead><tr><th>CU CLUSTER</th><th>DUs</th><th>DU CPU (each)</th><th>DU PRB DL</th><th>CU CPU</th><th>Server cores used</th><th>Status</th></tr></thead>
          <tbody>{clusters.length ? clusters.map((row) => <tr key={row.id}><td><b>{row.label}</b></td><td>{row.duCount} · {row.host || 'host n/a'}</td><td>{fmt(row.duCpu)}%</td><td>{fmt(row.duPrb)}%</td><td>{fmt(row.cuCpu)}%</td><td>{row.coresUsed == null ? '—' : `${fmt(row.coresUsed, 0)}${row.totalCores == null ? '' : ` of ${fmt(row.totalCores, 0)}`}`}</td><td><span className={`ran-status ${row.status === 'OVERLOAD' ? 'overload' : row.status === 'NO DATA' ? 'nodata' : 'normal'}`}>{row.status}</span></td></tr>) : <tr><td colSpan="7" className="ran-empty">{loading ? 'Loading site topology and telemetry…' : 'No CU clusters found for this site in the Current graph.'}</td></tr>}</tbody>
        </table></div>
      </div>
      <div className="ran-ingest-footer"><span>GraphDB repository: <b>{RAN_GRAPHDB.repository}</b> · Current graph: <code>{RAN_GRAPHDB.currentGraph}</code></span><span><Wifi size={13}/> Auto-refresh: every 20 seconds · {data.head ? `Latest: ${new Date(data.head).toLocaleTimeString()}` : 'Waiting for telemetry'}</span></div>
    </section>
  );
}
