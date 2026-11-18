import {
  plannedTransportGraph,
  transportQueries,
  TRANSPORT_GRAPHS,
  TRANSPORT_GRAPH_NODE_LIMIT,
} from './transportQueries';

const REPOSITORY =
  import.meta.env.VITE_GRAPHDB_TRANSPORT_REPOSITORY || 'site_consolidation';
const ROOT = `/graphdb/repositories/${encodeURIComponent(REPOSITORY)}`;
const RDF_TYPE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type';

export const TRANSPORT_GRAPHDB = { repository: REPOSITORY };

function localName(value = '') {
  return String(value).split(/[/#:]/).filter(Boolean).pop() || String(value);
}

function prettify(value = '') {
  return localName(value)
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/^./, (character) => character.toUpperCase());
}

export async function runTransportSparql(query) {
  const response = await fetch(ROOT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
      Accept: 'application/sparql-results+json',
    },
    body: new URLSearchParams({ query }).toString(),
  });
  const text = await response.text();

  if (!response.ok) {
    throw new Error(
      `Transport GraphDB request failed (HTTP ${response.status})${
        text.trim() ? `: ${text.trim().slice(0, 500)}` : ''
      }`
    );
  }

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(
      `Transport GraphDB returned a non-JSON response (HTTP ${response.status}).`
    );
  }
  if (!Array.isArray(data?.results?.bindings)) {
    throw new Error('Transport GraphDB returned an unexpected SPARQL response.');
  }
  return data.results.bindings;
}

function graphForState(state, plan) {
  if (state === 'current') return TRANSPORT_GRAPHS.current;
  if (state === 'target') return TRANSPORT_GRAPHS.target;
  if (state === 'planned') {
    return plannedTransportGraph(
      plan.sourceSite,
      plan.destinationSite,
      plan.version
    );
  }
  throw new Error(`Unsupported Transport graph state: ${state}`);
}

export async function loadTransportGraph(state, plan) {
  const graph = graphForState(state, plan);
  const [startRows, expansionRows] = await Promise.all([
    runTransportSparql(transportQueries.startPoint(graph)),
    runTransportSparql(transportQueries.expansion(graph)),
  ]);

  const nodes = new Map();
  const edges = new Map();
  for (const row of [...startRows, ...expansionRows]) {
    const subject = row.subject.value;
    const predicate = row.predicate.value;
    const object = row.object.value;
    if (predicate === RDF_TYPE) continue;

    const newNodeIds = new Set(
      [subject, object].filter((id) => !nodes.has(id))
    );
    if (nodes.size + newNodeIds.size > TRANSPORT_GRAPH_NODE_LIMIT) continue;

    for (const id of newNodeIds) {
      nodes.set(id, {
        id,
        label: prettify(id),
        group: 'device',
        props: {},
      });
    }

    const key = `${subject}\u0000${predicate}\u0000${object}`;
    if (edges.has(key)) continue;
    const kind = localName(predicate)
      .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
      .toUpperCase();
    edges.set(key, {
      from: subject,
      to: object,
      kind,
      state: state.toUpperCase(),
      label: prettify(kind),
    });
  }

  const selectedNodeIds = [...nodes.keys()];
  if (selectedNodeIds.length) {
    const [basicsRows, propertyRows] = await Promise.all([
      runTransportSparql(transportQueries.nodeBasics(graph, selectedNodeIds)),
      runTransportSparql(transportQueries.literalProperties(graph, selectedNodeIds)),
    ]);

    for (const row of basicsRows) {
      const node = nodes.get(row.node.value);
      if (!node) continue;
      const type = row.type.value;
      node.props.type = type;
      node.group = localName(type).toLowerCase();
      node.label = row.label?.value || node.label;
    }

    for (const row of propertyRows) {
      const node = nodes.get(row.node.value);
      if (!node) continue;
      const property = localName(row.property.value);
      const value = row.value.value;
      const parsed = value !== '' && Number.isFinite(Number(value))
        ? Number(value)
        : value;
      node.props[property] = parsed;
      if (property === 'label' || property === 'name') node.label = value;
    }
  }

  return {
    nodes: [...nodes.values()],
    edges: [...edges.values()],
    state,
    graph,
  };
}
