import { useEffect, useMemo, useState } from 'react';
import { loadRANTopology, RAN_GRAPHDB, runRANWhatIf } from '../../ranGraphdbApi';

const shortId = (iri = '') => String(iri).split(/[/#:]/).filter(Boolean).pop() || iri;

export default function RANWhatIfTab({ active, onRefreshGraph }) {
  const [topology, setTopology] = useState(null);
  const [entityId, setEntityId] = useState('');
  const [factor, setFactor] = useState(1.3);
  const [preview, setPreview] = useState(null);
  const [execution, setExecution] = useState(null);
  const [loading, setLoading] = useState('');
  const [error, setError] = useState('');
  const [serviceStatus, setServiceStatus] = useState(null);

  const entities = useMemo(() => {
    if (!topology) return [];
    const dus = (topology.duMetrics || []).map((x) => ({ id: shortId(x.du), label: `${shortId(x.du)} · Distributed Unit` }));
    const cells = (topology.cells || []).map((x) => ({ id: shortId(x.cell), label: `${x.name || shortId(x.cell)} · Cell` }));
    return [...dus, ...cells];
  }, [topology]);

  useEffect(() => {
    if (!active) return undefined;
    let alive = true;
    setError('');
    Promise.all([
      loadRANTopology('current'),
      fetch('/ran-whatif/health').then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || `What-if service HTTP ${r.status}`);
        return d;
      }),
    ]).then(([graph, status]) => {
      if (!alive) return;
      setTopology(graph);
      setServiceStatus(status);
      setEntityId((previous) => previous && [...(graph.duMetrics || []).map((x) => shortId(x.du)), ...(graph.cells || []).map((x) => shortId(x.cell))].includes(previous)
        ? previous
        : shortId(graph.duMetrics?.[0]?.du || graph.cells?.[0]?.cell || ''));
    }).catch((e) => { if (alive) setError(e.message); });
    return () => { alive = false; };
  }, [active]);

  const scenario = () => ({
    name: `ran-traffic-surge-${entityId}-${Math.round(factor * 100)}`,
    steps: [{ surge: { entities: [entityId], factor: Number(factor) } }],
  });

  async function runPreview() {
    setLoading('preview'); setError(''); setPreview(null); setExecution(null);
    try {
      const result = await runRANWhatIf('preview', scenario());
      setPreview(result);
    } catch (e) { setError(e.message); }
    finally { setLoading(''); }
  }

  async function execute() {
    setLoading('execute'); setError('');
    try {
      const result = await runRANWhatIf('execute', scenario());
      setExecution(result);
      await onRefreshGraph?.('target');
    } catch (e) { setError(e.message); }
    finally { setLoading(''); }
  }

  const fmt = (value) => value == null ? '—' : Number.isFinite(Number(value)) ? Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 }) : value;
  return (
    <section className={`tab ${active ? 'active' : ''}`}>
      <div className="page-title">What-if simulation</div>
      <div className="card whatif-intro">
        <h3>RAN traffic surge — automated what-if analysis</h3>
        <p className="sub">The engine reads the network from the Current graph and overlays the newest reading of every telemetry series using the supplied GraphDB queries. Preview runs the scenario with <code>--dry-run</code> and writes nothing. Execute derives and replaces only the Target graph.</p>
        <div className="row" style={{ alignItems: 'end', marginTop: 14 }}>
          <label style={{ minWidth: 260, flex: 1 }}>Affected network element
            <select className="input" value={entityId} onChange={(e) => { setEntityId(e.target.value); setPreview(null); setExecution(null); }} disabled={!entities.length || !!loading}>
              {!entities.length && <option value="">No DU or Cell found in Current graph</option>}
              {entities.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
            </select>
          </label>
          <label style={{ minWidth: 220, flex: 1 }}>Traffic multiplier: <b>{Number(factor).toFixed(2)}×</b>
            <input type="range" min="1.05" max="2" step="0.05" value={factor} onChange={(e) => { setFactor(Number(e.target.value)); setPreview(null); setExecution(null); }} style={{ display: 'block', width: '100%' }} />
            <span className="sub">{Math.round((factor - 1) * 100)}% additional traffic</span>
          </label>
        </div>
        <div className="whatif-actions" style={{ marginTop: 14 }}>
          <button className="btn blue" onClick={runPreview} disabled={!!loading || !entityId || (!serviceStatus?.script_exists || serviceStatus?.graphdb_connected === false)}>{loading === 'preview' ? 'Analysing…' : '▶ Run what-if analysis'}</button>
          <button className="btn green" onClick={execute} disabled={!!loading || !preview?.ok || !!execution}>{loading === 'execute' ? 'Writing target…' : '⚡ Execute what-if'}</button>
        </div>
        <div className="sub" style={{ marginTop: 9 }}>Repository: <b>{RAN_GRAPHDB.repository}</b> · Current: <code>{RAN_GRAPHDB.currentGraph}</code> · Target: <code>{RAN_GRAPHDB.targetGraph}</code></div>
        {serviceStatus && <div className="sub" style={{ marginTop: 5 }}>Engine: {serviceStatus.script_exists ? 'script detected' : 'script missing'} · GraphDB: {serviceStatus.graphdb_connected ? `connected (${serviceStatus.current_graph_triples ?? 0} Current triples)` : 'not connected'} · repository: {serviceStatus.repository || 'not reported'}</div>}
      </div>
      {error && <div className="card" style={{ marginTop: 14, color: '#b42318' }}><b>RAN what-if error:</b><div style={{ whiteSpace: 'pre-wrap', marginTop: 6 }}>{error}</div></div>}
      {preview && <div className="card" style={{ marginTop: 14 }}>
        <div className="flex justify-between items-center flex-wrap gap-2"><h3>Proposed what-if result</h3><span className={`badge ${preview.ok ? 'success' : 'danger'}`}>{preview.ok ? 'PREVIEW READY' : 'PREVIEW FAILED'}</span></div>
        <p className="sub">Read-only analysis. The engine reads Current topology and latest telemetry; no GraphDB graph is modified.</p>
        <pre className="log" style={{ maxHeight: 430, overflow: 'auto', whiteSpace: 'pre-wrap' }}>{preview.narration || preview.stderr || 'The engine returned no narration.'}</pre>
        {preview.ok && <p className="note">Review the projected changes, then select <b>Execute what-if</b> to create/replace the derived Target graph.</p>}
      </div>}
      {execution && <div className="card" style={{ marginTop: 14 }}>
        <h3>Target state created successfully</h3>
        <p className="sub">The engine wrote the derived network structure and projected KPI values to the Target graph and attempted to refresh the GraphDB <code>target-view</code> saved query.</p>
        <pre className="log" style={{ maxHeight: 430, overflow: 'auto', whiteSpace: 'pre-wrap' }}>{execution.narration}</pre>
        <p className="note">Target graph refreshed. Open Ontology Graph and select <b>Target state</b> to visualize it.</p>
      </div>}
      {!preview && !error && !loading && <div className="card" style={{ marginTop: 14 }}><span className="note">Choose a DU or Cell and traffic multiplier, then click “Run what-if analysis”.</span></div>}
      {topology && <div className="sub" style={{ marginTop: 10 }}>Current graph inventory: {fmt(topology.duMetrics?.length)} DUs, {fmt(topology.cells?.length)} Cells, {fmt(topology.tripleCount)} RDF triples.</div>}
    </section>
  );
}
