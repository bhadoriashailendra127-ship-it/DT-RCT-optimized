import { useEffect, useMemo, useRef, useState } from 'react';
import { DataSet } from 'vis-data';
import { Network } from 'vis-network';
import { ChevronLeft, ChevronRight } from 'lucide-react';

// A hand-picked maximally-distinguishable categorical palette (avoids
// clustering multiple similar oranges/teals/greens next to each other,
// which was the problem with the previous palette).
const PALETTE = [
  '#E6194B', // red
  '#3CB44B', // green
  '#4363D8', // blue
  '#F58231', // orange
  '#911EB4', // purple
  '#42D4F4', // cyan
  '#F032E6', // magenta
  '#BFEF45', // lime
  '#469990', // teal
  '#9A6324', // brown
  '#800000', // maroon
  '#808000', // olive
  '#000075', // navy
  '#DAA520', // goldenrod
];

// Every node gets its OWN unique color, except: all UE:* nodes share one
// color, and all UPF nodes (original + newly-instantiated) share another.
// Everything else (AMF, SMF, PCF, NRF, UDM, UDR, NEF, UERANSIM, DN, ...)
// is its own individual group -- this matters because the underlying data
// mostly stores a generic node_label (e.g. "FiveGNode"), so grouping by
// label alone would collapse almost everything into one bucket.
function groupKeyForNode(node) {
  const id = (node.id || '').toLowerCase();
  const label = (node.label || '').toLowerCase();
  if (isUeNode(node)) return 'UE';
  if (id.includes('upf') || label.includes('upf')) return 'UPF';
  return node.id;
}

function groupDisplayName(node, groupKey) {
  if (groupKey === 'UE' || groupKey === 'UPF') return groupKey;
  return displayLabelForNode(node);
}

function isUeNode(node) {
  const id = (node.id || '').toLowerCase();
  const label = (node.label || '').toLowerCase();
  return id.startsWith('ue:') || id.includes('imsi') || label.includes('imsi');
}

function ueOrdinalForNode(nodes, node) {
  return nodes.filter(isUeNode).findIndex(candidate => candidate.id === node.id);
}

function shorten(t) { return (t || '').length > 26 ? t.slice(0, 25) + '…' : t; }

// UE, UERANSIM, and DN nodes keep their raw label as-is. Everything else
// (AMF, SMF, PCF, NRF, UDM, UDR, NEF, UPF, ...) gets an instance-number
// suffix, e.g. "oai-amf" -> "OAI-AMF-1", so multiple instances of the same
// NF type are distinguishable. If a label already ends in "-<number>"
// (e.g. the newly-instantiated "OAI-UPF-2"), it's left untouched rather
// than getting a second suffix appended.
function shouldSkipSuffix(node) {
  const id = (node.id || '').toLowerCase();
  const label = (node.label || '').toLowerCase();
  if (id.startsWith('ue:') || id.includes('imsi') || label.includes('imsi')) return true;
  if (id.includes('ueransim') || label.includes('ueransim')) return true;
  if (id.includes('ext-dn') || id.endsWith('-dn') || label.includes('ext-dn') || label.endsWith('-dn')) return true;
  return false;
}

function displayLabelForNode(node, ueOrdinal = 0) {
  const raw = node.label || node.id || '';
  if (isUeNode(node)) {
    return raw.replace(/-\d+$/, ueOrdinal === 0 ? '-1' : '-n');
  }
  if (shouldSkipSuffix(node)) return raw;
  const upper = raw.toUpperCase();
  return /-\d+$/.test(upper) ? upper : `${upper}-1`;
}

// Flags the newly-instantiated UPF (traffic_engine.py writes
// lifecycle_status: "NEW_IN_TARGET_STATE" onto exactly that node), so it
// can be visually called out instead of making the user hunt for it.
function isNewlyInstantiated(node) {
  return node.props?.lifecycle_status === 'NEW_IN_TARGET_STATE';
}

export default function CoreGraphTab({ active, graphRaw, graphState, onStateChange, onRefresh, targetUnlocked, overloaded }) {
  const containerRef = useRef(null);
  const networkRef = useRef(null);
  const [nodeInfoHtml, setNodeInfoHtml] = useState('Nothing selected.');
  const [inspectorExpanded, setInspectorExpanded] = useState(false);

  const nodes = graphRaw?.nodes || [];

  const colorByGroupKey = useMemo(() => {
    const keys = [...new Set(nodes.map(n => groupKeyForNode(n)))].sort();
    const map = {};
    keys.forEach((k, i) => { map[k] = PALETTE[i % PALETTE.length]; });
    return map;
  }, [nodes]);

  function showNode(id) {
    const n = nodes.find(x => x.id === id);
    if (!n) return;
    const groupKey = groupKeyForNode(n);
    const ueOrdinal = ueOrdinalForNode(nodes, n);
    let html = `<b>${displayLabelForNode(n, ueOrdinal)}</b><br><span class="note">${n.id} · ${groupDisplayName(n, groupKey)}</span>`;
    if (isNewlyInstantiated(n)) html += `<br><span class="badge ok">🆕 Newly instantiated (this session's plan)</span>`;
    html += `<hr>`;
    for (const [k, v] of Object.entries(n.props || {})) html += `<b>${k}</b>: ${JSON.stringify(v)}<br>`;
    const deg = graphRaw.edges.filter(e => e.from === id || e.to === id);
    html += `<hr><b>relationships</b>: ${deg.length}<br>`;
    const byKind = {};
    deg.forEach(e => byKind[e.kind] = (byKind[e.kind] || 0) + 1);
    for (const [k, v] of Object.entries(byKind)) html += `&nbsp;&nbsp;${k}: ${v}<br>`;
    setNodeInfoHtml(html);
  }

  const legendEntries = useMemo(() => {
    const seen = new Map();
    for (const n of nodes) {
      const key = groupKeyForNode(n);
      if (!seen.has(key)) seen.set(key, groupDisplayName(n, key));
    }
    return [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [nodes]);

  useEffect(() => {
    if (!graphRaw || !Array.isArray(graphRaw.nodes) || !Array.isArray(graphRaw.edges) || !containerRef.current) return;

    const visNodes = graphRaw.nodes.map(n => {
      const color = colorByGroupKey[groupKeyForNode(n)] || '#9AA0C0';
      const isNew = isNewlyInstantiated(n);
      const displayLabel = shorten(displayLabelForNode(n, ueOrdinalForNode(nodes, n)));
      return {
        id: n.id, label: isNew ? `${displayLabel} (NEW)` : displayLabel, title: n.id,
        shape: 'dot', size: 13,
        color: { background: color, border: isNew ? '#DAA520' : color },
        borderWidth: isNew ? 4 : 1,
        font: { size: 10, color: '#1A1440', bold: isNew }
      };
    });
    const nodeIds = new Set(visNodes.map(n => n.id));
    const edges = graphRaw.edges.filter(e => nodeIds.has(e.from) && nodeIds.has(e.to))
      .map(e => ({ from: e.from, to: e.to, arrows: 'to', color: { color: '#9AA0C0' }, width: 1 }));

    const dataSet = { nodes: new DataSet(visNodes), edges: new DataSet(edges) };
    const options = {
      physics: { solver: 'forceAtlas2Based', forceAtlas2Based: { gravitationalConstant: -60, springLength: 110 }, stabilization: { iterations: 180 } },
      interaction: { hover: true }
    };

    if (networkRef.current) networkRef.current.destroy();
    const network = new Network(containerRef.current, dataSet, options);
    network.on('click', p => { if (p.nodes.length) showNode(p.nodes[0]); });
    // Freeze physics once the initial layout settles -- otherwise vis-network
    // keeps the simulation running in the background, and clicking a
    // well-connected node (AMF, UPF) can trigger a subtle re-layout that
    // looks like an unwanted zoom/pan.
    network.once('stabilizationIterationsDone', () => {
      network.setOptions({ physics: false });
    });
    networkRef.current = network;

    return () => { network.destroy(); networkRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graphRaw, colorByGroupKey]);

  useEffect(() => {
    if (active && networkRef.current) setTimeout(() => networkRef.current.fit(), 60);
  }, [active]);

  return (
    <div id="tab-core-graph" className={`tab ${active ? 'active' : ''}`}>
      <div className="page-title">Ontology graph</div>

      {overloaded && !targetUnlocked && (
        <div className="card" style={{ marginBottom: 14, background: '#FBDDE1', border: '1px solid #D64550' }}>
          <span style={{ color: '#8F1D28', fontWeight: 600 }}>⚠ UPF overload detected</span>
          <span className="note" style={{ marginLeft: 8 }}>
            See Traffic Ingestion for details, or go to What-If to suggest a load-split plan.
          </span>
        </div>
      )}

      <div className="row" style={{ marginBottom: 14, alignItems: 'center' }}>
        <select className="pill-select" value={graphState} onChange={e => onStateChange(e.target.value)}>
          <option value="current">Current state</option>
          {targetUnlocked && <option value="target">Target state</option>}
        </select>
        {!targetUnlocked && (
          <span className="note"></span>
        )}
        <span style={{ flex: 1 }} />
        <button className="btn ghost" onClick={onRefresh}>&#8635; Refresh from source</button>
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="legend">
          {legendEntries.map(([key, displayName]) => (
            <span key={key}><span className="dot" style={{ background: colorByGroupKey[key] }}></span> {displayName}</span>
          ))}
          {graphState === 'target' && (
            <span><span className="dot" style={{ background: '#fff', border: '3px solid #DAA520' }}></span> Gold ring = newly instantiated NF</span>
          )}
        </div>
      </div>

      <div className="row">
        <div style={{ flex: inspectorExpanded ? 1 : 3, minWidth: 400 }}>
          <div id="graph" ref={containerRef}></div>
          </div>
        <div className="card" style={{ flex: inspectorExpanded ? 2 : 1, minWidth: 260, maxHeight: 560, overflow: 'auto', position: 'relative', paddingLeft: 42 }}>
          <button
            onClick={() => setInspectorExpanded(v => !v)}
            title={inspectorExpanded ? 'Collapse' : 'Expand'}
            aria-label={inspectorExpanded ? 'Collapse node inspector' : 'Expand node inspector'}
            style={{
              position: 'absolute', left: 8, top: 8, width: 28, height: 28, borderRadius: '50%',
              background: '#FCFCFA', border: '1px solid var(--line)', display: 'flex', alignItems: 'center',
              justifyContent: 'center', cursor: 'pointer', boxShadow: '0 1px 4px rgba(0,0,0,0.15)', zIndex: 2
            }}
          >
            {inspectorExpanded ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
          </button>
          <h3>Node inspector</h3>
          <div className="sub">Click any node in the graph</div>
          <div className="note inspector-content" dangerouslySetInnerHTML={{ __html: nodeInfoHtml }} />
        </div>
      </div>
    </div>
  );
}
