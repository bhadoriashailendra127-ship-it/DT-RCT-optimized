import { useMemo, useState } from 'react';
import ResultsTable from '../ResultsTable';
import { RAN_GRAPHDB, RAN_QUERY_PRESETS, runRANSparql } from '../../ranGraphdbApi';

export default function RANQueriesTab({ active }) {
  const [selected, setSelected] = useState(0);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [meta, setMeta] = useState('');
  const preset = RAN_QUERY_PRESETS[selected];
  const grouped = useMemo(() => RAN_QUERY_PRESETS.reduce((acc, item, index) => {
    (acc[item.stage] ||= []).push({ ...item, index }); return acc;
  }, {}), []);

  async function run() {
    setError(''); setResult(null); setMeta('');
    const start = performance.now();
    try {
      if (preset.api) {
        const response = await fetch(`/ran-api${preset.api}`);
        const data = await response.json();
        if (!response.ok) throw new Error(data.detail || data.error || `RAN backend HTTP ${response.status}`);
        const rows = Array.isArray(data) ? data : [data];
        const columns = rows.length ? Object.keys(rows[0]) : [];
        setResult({ columns, rows: rows.map((r) => columns.map((c) => typeof r[c] === 'object' ? JSON.stringify(r[c]) : String(r[c] ?? ''))) });
      } else {
        const bindings = await runRANSparql(preset.query);
        const columns = bindings.length ? Object.keys(bindings[0]) : [];
        setResult({ columns, rows: bindings.map((r) => columns.map((c) => r[c]?.value ?? '')) });
      }
      setMeta(`${(performance.now() - start).toFixed(0)} ms · ${preset.api ? 'RAN simulation API' : `GraphDB · ${RAN_GRAPHDB.repository}`}`);
    } catch (e) { setError(e.message); }
  }

  return (
    <section className={`tab ${active ? 'active' : ''}`}>
      <div className="page-title">RAN Intelligence</div>
      <div className="row" style={{ alignItems: 'flex-start' }}>
        <div className="qlist">
          {Object.entries(grouped).map(([stage, items]) => <div key={stage}>
            <div className="stageh">{stage}</div>
            {items.map((item) => <button key={item.id} className={`qitem ${selected === item.index ? 'sel' : ''}`} onClick={() => { setSelected(item.index); setResult(null); setError(''); setMeta(''); }}>
              <div className="qid">{item.id}</div><div className="qt">{item.title}</div>
            </button>)}
          </div>)}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="card">
            <h3>{preset.id} — {preset.title}</h3><div className="sub">{preset.stage}</div>
            <pre className="gqlbox" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{preset.query || `GET ${preset.api}`}</pre>
            <button className="btn blue" onClick={run}>▶ Run query</button> <span className="note">{meta}</span>
          </div>
          <div className="card" style={{ marginTop: 14, maxHeight: 500, overflow: 'auto' }}>
            <h3>Results</h3>
            {error ? <p style={{ color: '#c0392b' }}>{error}</p> : result ? <ResultsTable columns={result.columns} rows={result.rows} /> : <span className="note">Select a query and click Run query.</span>}
          </div>
        </div>
      </div>
    </section>
  );
}
