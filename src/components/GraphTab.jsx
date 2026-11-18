import { useEffect, useMemo, useRef, useState } from 'react';
import { DataSet } from 'vis-data';
import { Network } from 'vis-network';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { TRANSPORT_GRAPH_NODE_LIMIT } from '../transportQueries';

const NODE_STYLE = {
  site: {
    shape: 'box',
    color: { background: '#231A60', border: '#231A60' },
    font: { color: '#fff', size: 12 },
  },
  device: {
    shape: 'dot',
    size: 13,
    color: { background: '#3B1E8F', border: '#2A1568' },
    font: { size: 10, color: '#1A1440' },
  },
  device_target: {
    shape: 'dot',
    size: 13,
    color: { background: '#2E5BFF', border: '#1E3FBF' },
    font: { size: 10, color: '#1A1440' },
  },
  service: {
    shape: 'diamond',
    size: 12,
    color: { background: '#E8A13D', border: '#B87B22' },
    font: { size: 10, color: '#1A1440' },
  },
  customer: {
    shape: 'triangle',
    size: 12,
    color: { background: '#1FA294', border: '#137468' },
    font: { size: 10, color: '#1A1440' },
  },
  cluster: {
    shape: 'hexagon',
    size: 22,
    color: { background: '#D64550', border: '#8F1D28' },
    font: { size: 11, color: '#fff' },
  },
};

function nodeStyleForGroup(group) {
  const normalizedGroup = String(group || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
  if (normalizedGroup === 'cluster' || normalizedGroup === 'planningcluster') {
    return NODE_STYLE.cluster;
  }
  return NODE_STYLE[group] || NODE_STYLE.device;
}

function nodeGroupLabel(group) {
  const normalizedGroup = String(group || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
  if (normalizedGroup === 'planningcluster') return 'Planning Cluster';
  return String(group || '')
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/^./, (character) => character.toUpperCase());
}

const TRANSPORT_CLUSTER_OPTIONS = [
  { value: 'NRW_EAST', label: 'NRW-East (Ruhr)', aliases: ['nrweast', 'ruhr'] },
  { value: 'NRW_WEST', label: 'NRW-West (Rheinland)', aliases: ['nrwwest', 'rheinland'] },
];

function edgeStyle(e) {
  switch (e.kind) {
    case 'LOCATED_AT':
      return { color: { color: '#C4C8E2' }, width: 1 };
    case 'CONNECTS':
      return e.state === 'TARGET'
        ? { color: { color: '#2E5BFF' }, width: 2, dashes: true }
        : { color: { color: '#3B1E8F' }, width: 2 };
    case 'TRAVERSES':
      return {
        color: { color: e.state === 'TARGET' ? '#8FB0FF' : '#C9A0E8' },
        width: 1,
        arrows: 'to',
      };
    case 'SUBSCRIBES':
    case 'SERVES':
      return { color: { color: '#1FA294' }, width: 1, arrows: 'to' };
    case 'MIGRATES_TO':
      return {
        color: { color: '#7C3AED' },
        width: 2,
        dashes: true,
        arrows: 'to',
      };
    case 'CONSOLIDATES_INTO':
      return {
        color: { color: '#D64550' },
        width: 2,
        dashes: true,
        arrows: 'to',
      };
    case 'ASSIGNED_TO':
      return { color: { color: '#D64550' }, width: 1.5, arrows: 'to' };
    default:
      return { color: { color: '#9AA0C0' }, width: 1 };
  }
}

function shorten(t) {
  return (t || '').length > 26 ? t.slice(0, 25) + '…' : t;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character]);
}

function nodeDisplayLabel(node) {
  if (!node) return '';
  if (node.group === 'site') {
    const siteName =
      node.site_id || node.props?.site_id || node.properties?.site_id || node.id;
    return String(siteName).split(/[/#:]/).filter(Boolean).pop() || siteName;
  }
  return node.label || node.id || '';
}

/** Nodes reachable from `clusterId` by walking edges in either direction
 * (small scoped graphs, so a simple multi-pass expansion is plenty). */
function nodesConnectedToCluster(nodes, edges, clusterId) {
  const keep = new Set([clusterId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const e of edges) {
      if (keep.has(e.from) && !keep.has(e.to)) {
        keep.add(e.to);
        changed = true;
      }
      if (keep.has(e.to) && !keep.has(e.from)) {
        keep.add(e.from);
        changed = true;
      }
    }
  }
  return keep;
}

function nodesInTransportCluster(nodes, edges, selection) {
  const option = TRANSPORT_CLUSTER_OPTIONS.find(
    (cluster) => cluster.value === selection
  );
  if (!option) return new Set();

  const matchesOption = (value) => {
    const normalized = String(value || '')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '');
    return option.aliases.some((alias) => normalized.includes(alias));
  };
  const assignmentNodeIds = new Set(
    edges
      .filter((edge) => edge.kind === 'ASSIGNED_TO')
      .flatMap((edge) => [edge.from, edge.to])
  );
  const clusterIds = new Set(
    nodes
      .filter(
        (node) =>
          (node.group === 'cluster' || assignmentNodeIds.has(node.id)) &&
          [
            node.id,
            node.label,
            ...Object.values(node.props || {}),
          ].some(matchesOption)
      )
      .map((node) => node.id)
  );
  const siteIds = new Set();
  for (const edge of edges) {
    if (edge.kind !== 'ASSIGNED_TO') continue;
    if (clusterIds.has(edge.to)) siteIds.add(edge.from);
    if (clusterIds.has(edge.from)) siteIds.add(edge.to);
  }
  for (const node of nodes) {
    if (
      node.group === 'site' &&
      Object.values(node.props || {}).some(matchesOption)
    ) {
      siteIds.add(node.id);
    }
  }
  if (!siteIds.size) return null;

  const deviceIds = new Set(
    edges
      .filter((edge) => edge.kind === 'LOCATED_AT' && siteIds.has(edge.to))
      .map((edge) => edge.from)
  );
  const serviceIds = new Set(
    edges
      .filter((edge) => edge.kind === 'TRAVERSES' && deviceIds.has(edge.to))
      .map((edge) => edge.from)
  );

  return new Set([...clusterIds, ...siteIds, ...deviceIds, ...serviceIds]);
}

export default function GraphTab({
  active,
  mode,
  graphRaw,
  graphState,
  statesUnlocked,
  siteIdsInput,
  onSiteIdsChange,
  onStateChange,
  onRefresh,
  clusterFilter,
  onClusterFilterChange,
  transportGraphDb = false,
  transportPlan,
  graphError = '',
  graphLoading = false,
}) {
  const containerRef = useRef(null);
  const networkRef = useRef(null);

  // Demo-mode-only client-side filter (kept for the offline embedded dataset,
  // which has a single combined graph with CURRENT/TARGET twin_state flags).
  const [demoStateFilter, setDemoStateFilter] = useState('ALL');

  const [edgeToggles, setEdgeToggles] = useState({});
  const [nodeInfoHtml, setNodeInfoHtml] = useState('Nothing selected.');
  const [inspectorExpanded, setInspectorExpanded] = useState(false);

  // (Re)initialize edge toggles whenever the set of edge kinds in the data changes,
  // preserving existing on/off choices and defaulting new kinds to visible.
  useEffect(() => {
    if (!graphRaw || !Array.isArray(graphRaw.edges)) return;
    const kinds = [...new Set(graphRaw.edges.map((e) => e.kind))];
    setEdgeToggles((prev) => {
      const next = {};
      kinds.forEach((k) => {
        next[k] = k in prev ? prev[k] : true;
      });
      return next;
    });
  }, [graphRaw]);

  function toggleEdge(kind) {
    setEdgeToggles((prev) => ({ ...prev, [kind]: !prev[kind] }));
  }

  function showNode(id) {
    const n = graphRaw.nodes.find((x) => x.id === id);
    if (!n) return;
    let html = `<b>${escapeHtml(n.label)}</b><br><span class="note">${escapeHtml(n.id)} · ${escapeHtml(n.group)}</span><hr>`;
    for (const [k, v] of Object.entries(n.props || {}))
      html += `<b>${escapeHtml(k)}</b>: ${escapeHtml(JSON.stringify(v))}<br>`;
    const deg = graphRaw.edges.filter((e) => e.from === id || e.to === id);
    html += `<hr><b>relationships</b>: ${deg.length}<br>`;
    const byKind = {};
    deg.forEach((e) => (byKind[e.kind] = (byKind[e.kind] || 0) + 1));
    for (const [k, v] of Object.entries(byKind))
      html += `&nbsp;&nbsp;${escapeHtml(k)}: ${v}<br>`;
    setNodeInfoHtml(html);
  }

  // Real cluster options, straight from whatever the currently-fetched graph
  // actually contains -- no hardcoded/guessed cluster IDs. Selecting one here
  // both scopes the graph view AND (via the shared clusterFilter prop) is what
  // "Run what-if analysis" / "Execute consolidation" on the What-If tab uses.
  const clusterOptions = (graphRaw?.nodes || []).filter((n) => n.group === 'cluster');

  const displayGraph = useMemo(() => {
    if (
      !graphRaw ||
      !Array.isArray(graphRaw.nodes) ||
      !Array.isArray(graphRaw.edges)
    )
      return { nodes: [], edges: [] };

    let allowedIds = null;
    if (mode === 'live' && transportGraphDb && clusterFilter !== 'ALL') {
      const clusterNodeIds = nodesInTransportCluster(
        graphRaw.nodes,
        graphRaw.edges,
        clusterFilter
      );
      if (clusterNodeIds) allowedIds = clusterNodeIds;
    } else if (
      mode === 'live' &&
      !transportGraphDb &&
      clusterFilter !== 'ALL'
    ) {
      allowedIds = nodesConnectedToCluster(
        graphRaw.nodes,
        graphRaw.edges,
        clusterFilter
      );
    }

    const filteredNodes = graphRaw.nodes
      .filter((node) => {
        if (allowedIds && !allowedIds.has(node.id)) return false;
        if (mode !== 'demo') return true;
        if (demoStateFilter === 'ALL') return true;
        if (node.group === 'device') return demoStateFilter === 'CURRENT';
        if (node.group === 'device_target') return demoStateFilter === 'TARGET';
        return true;
      });
    const visibleNodes = transportGraphDb
      ? filteredNodes.slice(0, TRANSPORT_GRAPH_NODE_LIMIT)
      : filteredNodes;
    const nodeIds = new Set(visibleNodes.map((node) => node.id));
    const edges = graphRaw.edges
      .filter((edge) => {
        if (edgeToggles[edge.kind] === false) return false;
        if (mode === 'demo') {
          if (
            (edge.kind === 'CONNECTS' || edge.kind === 'TRAVERSES') &&
            demoStateFilter !== 'ALL' &&
            edge.state !== demoStateFilter
          )
            return false;
          if (edge.kind === 'MIGRATES_TO' && demoStateFilter === 'CURRENT')
            return false;
        }
        return nodeIds.has(edge.from) && nodeIds.has(edge.to);
      })
      .map((edge) => ({
        from: edge.from,
        to: edge.to,
        ...edgeStyle(edge),
      }));

    if (!transportGraphDb) return { nodes: visibleNodes, edges };
    const connectedNodeIds = new Set(
      edges.flatMap((edge) => [edge.from, edge.to])
    );
    return {
      nodes: visibleNodes.filter((node) => connectedNodeIds.has(node.id)),
      edges,
    };
  }, [
    graphRaw,
    mode,
    clusterFilter,
    demoStateFilter,
    edgeToggles,
    transportGraphDb,
  ]);

  const legendEntries = useMemo(() => {
    const groups = [...new Set(displayGraph.nodes.map((node) => node.group))];
    return groups.map((group) => {
      const style = nodeStyleForGroup(group);
      return {
        group,
        label: nodeGroupLabel(group),
        shape: style.shape,
        color: style.color.background,
      };
    });
  }, [displayGraph.nodes]);

  useEffect(() => {
    if (
      !graphRaw ||
      !Array.isArray(graphRaw.nodes) ||
      !Array.isArray(graphRaw.edges) ||
      !containerRef.current
    )
      return;

    const nodes = displayGraph.nodes.map((n) => ({
      id: n.id,
      label: shorten(nodeDisplayLabel(n)),
      title: nodeDisplayLabel(n),
      ...nodeStyleForGroup(n.group),
    }));
    const edges = displayGraph.edges;

    const dataSet = { nodes: new DataSet(nodes), edges: new DataSet(edges) };
    const options = {
      physics: {
        solver: 'forceAtlas2Based',
        forceAtlas2Based: { gravitationalConstant: -60, springLength: 110 },
        stabilization: { iterations: 180 },
      },
      interaction: { hover: true },
    };

    if (networkRef.current) networkRef.current.destroy();
    const network = new Network(containerRef.current, dataSet, options);
    network.on('click', (p) => {
      if (p.nodes.length) showNode(p.nodes[0]);
    });
    // Freeze physics once the initial layout settles -- otherwise vis-network
    // keeps simulating in the background, and clicking a well-connected node
    // can trigger a subtle re-layout that looks like an unwanted zoom/pan.
    network.once('stabilizationIterationsDone', () => {
      network.setOptions({ physics: false });
    });
    networkRef.current = network;

    return () => {
      network.destroy();
      networkRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graphRaw, displayGraph]);

  useEffect(() => {
    if (active && networkRef.current)
      setTimeout(() => networkRef.current.fit(), 60);
  }, [active]);

  const edgeKinds = Object.keys(edgeToggles);

  return (
    <div id="tab-graph" className={`tab ${active ? 'active' : ''}`}>
      <div className="page-title">Ontology graph</div>
      {graphError && (
        <div className="card" role="alert" style={{ marginBottom: 14 }}>
          <b>GraphDB error:</b> {graphError}
        </div>
      )}
      {!graphError && graphLoading && (
        <div className="card" role="status" style={{ marginBottom: 14 }}>
          Loading graph from GraphDB…
        </div>
      )}
      {!graphError && !graphLoading && graphRaw.nodes.length === 0 && (
        <div className="card" role="status" style={{ marginBottom: 14 }}>
          No nodes were returned for this named graph. Confirm that the graph
          URI exists in the selected GraphDB repository.
        </div>
      )}
      <div className="row" style={{ marginBottom: 14, alignItems: 'center' }}>
        {mode === 'live' ? (
          <select
            className="pill-select"
            value={graphState}
            onChange={(e) => onStateChange(e.target.value)}
          >
            <option value="current">Current state</option>
            {statesUnlocked && (
              <option value="planned">
                {transportGraphDb ? 'Planned state' : 'Planned state (PS1)'}
              </option>
            )}
            {statesUnlocked && <option value="target">Target state</option>}
          </select>
        ) : (
          <select
            className="pill-select"
            value={demoStateFilter}
            onChange={(e) => setDemoStateFilter(e.target.value)}
          >
            <option value="ALL">All states</option>
            <option value="CURRENT">Current state</option>
            <option value="TARGET">Target state</option>
          </select>
        )}
        {transportGraphDb && (
          <select
            className="pill-select"
            value={clusterFilter}
            onChange={(event) => onClusterFilterChange(event.target.value)}
            aria-label="Filter graph by cluster"
          >
            <option value="ALL">Cluster: All</option>
            {TRANSPORT_CLUSTER_OPTIONS.map((cluster) => (
              <option key={cluster.value} value={cluster.value}>
                {cluster.label}
              </option>
            ))}
          </select>
        )}
        {mode === 'live' && !transportGraphDb && (
          <>
            <select
              className="pill-select"
              value={clusterFilter}
              onChange={(e) => onClusterFilterChange(e.target.value)}
            >
              <option value="ALL">Cluster: All</option>
              {clusterOptions.map((c) => (
                <option key={c.id} value={c.id}>
                  Cluster: {c.label}
                </option>
              ))}
            </select>
            <input
              type="text"
              style={{ width: 210 }}
              value={siteIdsInput}
              onChange={(e) => onSiteIdsChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') onRefresh();
              }}
              onBlur={onRefresh}
              placeholder="SITE-KOE-01,SITE-KOE-02"
              title="Comma-separated site_id values to scope the path query to — applies on Enter or when you click away"
            />
          </>
        )}
        {transportGraphDb && graphState === 'planned' && (
          <div className="row" style={{ flexBasis: '100%', gap: 8 }}>
            <label>
              Source site{' '}
              <input
                value={transportPlan.sourceSite}
                onChange={(event) =>
                  transportPlan.onChange('sourceSite', event.target.value)
                }
                aria-label="Source site"
              />
            </label>
            <label>
              Destination site{' '}
              <input
                value={transportPlan.destinationSite}
                onChange={(event) =>
                  transportPlan.onChange('destinationSite', event.target.value)
                }
                aria-label="Destination site"
              />
            </label>
            <label>
              Plan version{' '}
              <input
                value={transportPlan.version}
                onChange={(event) =>
                  transportPlan.onChange('version', event.target.value)
                }
                aria-label="Plan version"
              />
            </label>
            <button
              className="btn blue"
              onClick={transportPlan.onLoad}
              disabled={transportPlan.loading}
            >
              {transportPlan.loading ? 'Loading plan…' : 'Load planned graph'}
            </button>
            {graphRaw.graph && (
              <small style={{ flexBasis: '100%' }}>
                Named graph: <code>{graphRaw.graph}</code>
              </small>
            )}
          </div>
        )}
        <span style={{ flex: 1 }} />
        <button className="btn ghost" onClick={onRefresh}>
          &#8635; Refresh from source
        </button>
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="toggles" style={{ marginBottom: 8 }}>
          <b style={{ fontSize: 12.5, marginRight: 10 }}>Edges:</b>
          {edgeKinds.map((kind) => (
            <label key={kind}>
              <input
                type="checkbox"
                checked={edgeToggles[kind]}
                onChange={() => toggleEdge(kind)}
              />{' '}
              {kind}
            </label>
          ))}
        </div>
        <div className="legend">
          {legendEntries.map((entry) => (
            <span key={entry.group}>
              <span
                style={{
                  width: 13,
                  height: 13,
                  display: 'inline-block',
                  background: entry.color,
                  clipPath:
                    entry.shape === 'hexagon'
                      ? 'polygon(25% 0, 75% 0, 100% 50%, 75% 100%, 25% 100%, 0 50%)'
                      : entry.shape === 'diamond'
                        ? 'polygon(50% 0, 100% 50%, 50% 100%, 0 50%)'
                        : entry.shape === 'triangle'
                          ? 'polygon(50% 0, 100% 100%, 0 100%)'
                          : undefined,
                  borderRadius: entry.shape === 'dot' ? '50%' : undefined,
                }}
              ></span>{' '}
              {entry.label}
            </span>
          ))}
        </div>
      </div>

      <div className="row">
        <div style={{ flex: inspectorExpanded ? 1 : 3, minWidth: 400 }}>
          <div id="graph" ref={containerRef}></div>
        </div>
        <div
          className="card"
          style={{ flex: inspectorExpanded ? 2 : 1, minWidth: 260, maxHeight: 560, overflow: 'auto', position: 'relative', paddingLeft: 42 }}
        >
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
          <div
            id="nodeinfo"
            className="note inspector-content"
            dangerouslySetInnerHTML={{ __html: nodeInfoHtml }}
          />
        </div>
      </div>
    </div>
  );
}
