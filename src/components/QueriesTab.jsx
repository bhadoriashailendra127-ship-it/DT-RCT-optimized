import { useState, useEffect } from 'react';
import { apiCall, endpoints } from '../api';
import ResultsTable from './ResultsTable';
import { runTransportSparql } from '../transportGraphdbApi';

function buildSiteList(siteIdsCsv) {
  return (siteIdsCsv || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
    .map(s => `'${s.replace(/'/g, "\\'")}'`)
    .join(', ');
}

export default function QueriesTab({ active, mode, apiUrl, siteIdsInput, statesUnlocked, demoPresets, livePresets }) {
  const presets = mode === 'live' ? livePresets : demoPresets;
  const [selected, setSelected] = useState(0);
  const [result, setResult] = useState(null);
  const [meta, setMeta] = useState('');
  const [error, setError] = useState(null);

  // Reset selection if the preset list itself changes (e.g. mode flips).
  useEffect(() => { setSelected(0); setResult(null); setMeta(''); setError(null); }, [presets]);

  const p = presets[selected];

  // Substitute the {{SITES}} token (if present) with the same site scope
  // currently set in the Ontology Graph tab, so results line up.
  const resolvedGql = (mode === 'live' && p.siteScoped)
    ? p.gql.replace('{{SITES}}', buildSiteList(siteIdsInput))
    : p.gql;

  async function runSelected() {
    setError(null);
    const t0 = performance.now();
    let res;
    try {
      if (mode === 'live' && p.requiresTargetState && !statesUnlocked) {
        // Tied to the same "statesUnlocked" flag that controls whether
        // Planned/Target appear in the Ontology Graph's View dropdown --
        // not a live DB check. If Target hasn't been unlocked in THIS
        // session (via What-If -> Execute consolidation), block here even
        // if Target data happens to already exist in Spanner from before.
        setError('Target state has not been created yet in this session. Go to What-If → "Execute consolidation" first, then re-run this query.');
        setResult(null);
        return;
      }
      if (mode === 'live') {
        const bindings = await runTransportSparql(resolvedGql);
        const columns = bindings.length ? Object.keys(bindings[0]) : [];
        res = { columns, rows: bindings.map((binding) => columns.map((key) => binding[key]?.value ?? '')) };
      } else {
        res = p.local();
      }
    } catch (e) {
      setError(e.message);
      setResult(null);
      return;
    }
    const ms = (performance.now() - t0).toFixed(0);
    setMeta(`${res.rows.length} row(s) · ${ms} ms · ${mode === 'live' ? 'GraphDB · site_consolidation' : 'local demo engine'}`);
    setResult(res);
  }

  function select(i) {
    setSelected(i);
    setResult(null);
    setMeta('');
    setError(null);
  }

  let lastStage = '';

  return (
    <div id="tab-queries" className={`tab ${active ? 'active' : ''}`}>
      <div className="page-title">Site Intelligence</div>
      <div className="row">
        <div className="qlist">
          {presets.map((preset, i) => {
            const showHeader = preset.stage !== lastStage;
            lastStage = preset.stage;
            return (
              <div key={preset.id}>
                {showHeader && <div className="stageh">{preset.stage}</div>}
                <div className={`qitem ${selected === i ? 'sel' : ''}`} role="button" tabIndex={0} onClick={() => select(i)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); select(i); } }}>
                  <div className="qid">{preset.id}</div>
                  <div className="qt">{preset.title}</div>
                </div>
              </div>
            );
          })}
        </div>
        <div style={{ flex: 1, minWidth: 520 }}>
          <div className="card">
            <h3>{p.id} — {p.title}</h3>
            <div className="sub">{p.stage}</div>
            <div className="gqlbox">{resolvedGql};</div>
            <div style={{ marginTop: 10 }}>
              <button className="btn blue" onClick={runSelected}>&#9654; Run</button>
              <span className="note">{meta}</span>
            </div>
          </div>
          <div className="card" style={{ marginTop: 14, maxHeight: 420, overflow: 'auto' }}>
            <h3>Results</h3>
            {error ? (
              <div><span className="badge no">ERROR</span> {error}</div>
            ) : result ? (
              <ResultsTable
                columns={result.columns}
                rows={result.rows}
                emptyNode={p.id === 'T1' ? <span className="badge ok">0 rows — clean</span> : undefined}
              />
            ) : (
              <span className="note">No results yet.</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
