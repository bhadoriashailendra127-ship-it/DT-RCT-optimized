const REPOSITORY = import.meta.env.VITE_GRAPHDB_REPOSITORY || '5g_core';
const ROOT = '/graphdb/repositories/' + encodeURIComponent(REPOSITORY);
export const GRAPHDB = {
  repository: REPOSITORY,
  current: 'https://example.com/5g/graph/current',
  telemetry: 'https://example.com/5g/graph/telemetry',
  target: 'https://example.com/5g/graph/target',
  defaultGraph: 'http://www.openrdf.org/schema/sesame#nil',
};

export async function sparql(query) {
  const res = await fetch(ROOT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
      Accept: 'application/sparql-results+json',
    },
    body: new URLSearchParams({ query }).toString(),
  });
  const text = await res.text();
  if (!res.ok) {
    let message = text.trim();
    try {
      const errorData = JSON.parse(text);
      message = errorData.message || errorData.error || message;
    } catch {
      // GraphDB and its proxy may return plain-text or HTML error responses.
    }
    throw new Error(
      `GraphDB request failed (HTTP ${res.status})${
        message ? `: ${message.slice(0, 500)}` : ''
      }`
    );
  }

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(
      `GraphDB returned a non-JSON response (HTTP ${res.status}).`
    );
  }
  return data;
}
export async function checkGraphDB() {
  const data = await sparql('ASK { ?s ?p ?o }');
  return Boolean(data.boolean);
}
const local = (v = '') =>
  String(v)
    .split(/[\/#:]/)
    .filter(Boolean)
    .pop() || String(v);
const prettify = (v = '') =>
  local(v)
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/^./, (c) => c.toUpperCase());
const numeric = (v) =>
  v !== undefined && v !== null && v !== '' && Number.isFinite(Number(v))
    ? Number(v)
    : v;

const CONNECTION_PREDICATES = `
  tel:radioConnectedTo
  tel:n2ConnectsTo
  tel:n3ConnectsTo
  tel:n4ConnectsTo
  tel:n6ConnectsTo
  tel:n9ConnectsTo
  tel:n7ConnectsTo
  tel:n8ConnectsTo
  tel:n10ConnectsTo
  tel:n11ConnectsTo
  tel:n12ConnectsTo
  tel:n13ConnectsTo
  tel:n35ConnectsTo
  tel:n36ConnectsTo
  tel:sbiConnectsTo
  tel:scaleOutPeer
`;
const NODE_PROPERTIES = `
  tel:name,
  tel:status,
  tel:ip,
  tel:state,
  tel:currentPduSessions,
  tel:kpiMaxPduSessions,
  tel:cpuUtilization,
  tel:generatedAt
`;

export async function loadGraph(state = 'current') {
  const graph = state === 'target' ? GRAPHDB.target : GRAPHDB.current;
  const queryGraph = async (query) => {
    const data = await sparql(query);
    if (!Array.isArray(data?.results?.bindings)) {
      throw new Error(
        'GraphDB returned an unexpected SPARQL results response.'
      );
    }
    return data.results.bindings;
  };
  const prefix = 'PREFIX tel: <https://example.com/5g/ontology/> ';
  const inGraph = `GRAPH <${graph}>`;
  const [startingRows, expansionRows, basicsRows, extraRows] =
    await Promise.all([
      queryGraph(
        `${prefix}SELECT ?source ?relationship ?target WHERE { ${inGraph} { ?source ?relationship ?target . VALUES ?relationship { ${CONNECTION_PREDICATES} } } }`
      ),
      queryGraph(
        `${prefix}SELECT ?source ?predicate ?target WHERE { ${inGraph} { { ?node ?predicate ?out . FILTER(isIRI(?out)) VALUES ?predicate { ${CONNECTION_PREDICATES} } BIND(?node AS ?source) BIND(?out AS ?target) } UNION { ?in ?predicate ?node . FILTER(isIRI(?in)) VALUES ?predicate { ${CONNECTION_PREDICATES} } BIND(?in AS ?source) BIND(?node AS ?target) } } }`
      ),
      queryGraph(
        `PREFIX tel: <https://example.com/5g/ontology/> PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> SELECT ?node ?type ?label WHERE { ${inGraph} { ?node rdf:type ?type . OPTIONAL { ?node tel:name ?name . } BIND(COALESCE(?name, REPLACE(STR(?node), "^.*[/#]", "")) AS ?label) } }`
      ),
      queryGraph(
        `${prefix}SELECT ?node ?property ?value WHERE { ${inGraph} { ?node ?property ?value . FILTER(isLiteral(?value)) FILTER(?property IN (${NODE_PROPERTIES})) } } ORDER BY ?property`
      ),
    ]);

  const nodes = new Map();
  const edges = [];
  const getNode = (id) => {
    if (!nodes.has(id))
      nodes.set(id, {
        id,
        label: prettify(local(id)),
        group: 'device',
        props: {},
      });
    return nodes.get(id);
  };
  const edgeKeys = new Set();
  const addEdge = (sourceId, predicate, target) => {
    if (!sourceId || !predicate || !target || target.type === 'literal') return;
    const source = getNode(sourceId.value);
    const destination = getNode(target.value);
    const pred = local(predicate.value);
    const key = `${source.id}\u0000${predicate.value}\u0000${destination.id}`;
    if (edgeKeys.has(key)) return;
    edgeKeys.add(key);
    edges.push({
      from: source.id,
      to: destination.id,
      kind: pred.toUpperCase(),
      state: state.toUpperCase(),
      label: prettify(pred),
    });
  };

  for (const row of basicsRows) {
    const node = getNode(row.node.value);
    node.label = row.label.value;
    node.group = prettify(local(row.type.value)).toLowerCase();
    node.props.type = row.type.value;
  }
  for (const row of extraRows) {
    const node = getNode(row.node.value);
    const property = local(row.property.value);
    node.props[property] = numeric(row.value.value);
    if (property === 'name') node.label = row.value.value;
  }
  for (const row of startingRows) {
    addEdge(row.source, row.relationship, row.target);
  }
  for (const row of expansionRows) {
    addEdge(row.source, row.predicate, row.target);
  }

  for (const n of nodes.values()) {
    const id = n.id.toLowerCase();
    if (id.includes('upf')) n.group = 'upf';
    else if (id.includes('smf')) n.group = 'smf';
    else if (id.includes('amf')) n.group = 'amf';
    else if (id.includes('gnb') || id.includes('ueransim')) n.group = 'ran';
    else if (id.includes('dn') || id.includes('data-network'))
      n.group = 'network';
    n.label =
      n.props.nodeLabel || n.props.label || n.label || prettify(local(n.id));
    if (n.props.name) n.label = n.props.name;
  }
  const connectedNodeIds = new Set(
    edges.flatMap((edge) => [edge.from, edge.to])
  );
  const connectedNodes = [...nodes.values()].filter((node) =>
    connectedNodeIds.has(node.id)
  );
  return {
    nodes: connectedNodes,
    edges,
    rowCount:
      startingRows.length +
      expansionRows.length +
      basicsRows.length +
      extraRows.length,
    state,
  };
}
export async function loadMetrics() {
  const q = `PREFIX tel: <https://example.com/5g/ontology/> SELECT ?upf ?sessions ?capacity ?cpu WHERE { GRAPH <${GRAPHDB.current}> { ?upf a tel:UPF ; tel:kpiMaxPduSessions ?capacity . OPTIONAL { ?upf tel:currentPduSessions ?sessions } OPTIONAL { ?upf tel:cpuUtilization ?cpu } } }`;
  const data = await sparql(q);
  return (data?.results?.bindings || []).map((r) => ({
    id: r.upf.value,
    name: prettify(local(r.upf.value)),
    sessions: Number(r.sessions?.value || 0),
    capacity: Number(r.capacity?.value || 0),
    cpu: Number(r.cpu?.value || 0),
  }));
}

// Human-approved traffic simulation workflow. All writes are scoped to the
// named graphs used by upf_load_traffic_ingestion_user_input.py; the imported
// default graph is intentionally left untouched.
const TEL_NS = 'https://example.com/5g/ontology/';
const INST_NS = 'https://example.com/5g/instance/';
const SOURCE_ID = 'UPF:192.168.70.134';
const TARGET_ID = 'UPF:192.168.70.150';
const SOURCE_IRI = `${INST_NS}${encodeURIComponent(SOURCE_ID)}`;
const TARGET_IRI = `${INST_NS}${encodeURIComponent(TARGET_ID)}`;
const TARGET_VIEW = 'https://example.com/5g/graph/target-view';
const SESSION_THRESHOLD = 8000;
const CPU_THRESHOLD = 85;
const SPLIT_PERCENTAGE = 50;

async function sparqlUpdate(update) {
  const response = await fetch(`${ROOT}/statements`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
    },
    body: new URLSearchParams({ update }).toString(),
  });
  const text = await response.text();
  if (!response.ok)
    throw new Error(
      `GraphDB update failed (HTTP ${response.status}): ${text.slice(0, 500)}`
    );
  return true;
}

async function ask(query) {
  const result = await sparql(query);
  return Boolean(result.boolean);
}

async function graphCount(graph) {
  const result = await sparql(
    `SELECT (COUNT(DISTINCT ?s) AS ?count) WHERE { GRAPH <${graph}> { ?s ?p ?o } }`
  );
  return Number(result.results?.bindings?.[0]?.count?.value || 0);
}

export async function getTrafficState() {
  const query = `PREFIX tel: <${TEL_NS}> SELECT ?sessions ?capacity ?cpu WHERE { GRAPH <${GRAPHDB.current}> { <${SOURCE_IRI}> a tel:UPF ; tel:kpiMaxPduSessions ?capacity . OPTIONAL { <${SOURCE_IRI}> tel:currentPduSessions ?sessions } OPTIONAL { <${SOURCE_IRI}> tel:cpuUtilization ?cpu } } } LIMIT 1`;
  const data = await sparql(query);
  const row = data.results?.bindings?.[0];
  if (!row)
    throw new Error(
      `UPF-01 was not found in GraphDB named graph ${GRAPHDB.current}. Check that the baseline graph was initialized by the Python ingestion script.`
    );
  return {
    sessions: Number(row.sessions?.value || 0),
    capacity: Number(row.capacity?.value || 10000),
    cpu: Number(row.cpu?.value || 0),
  };
}

function modeledCpu(sessions, capacity) {
  return Math.min(100, 12 + 0.86 * ((100 * sessions) / capacity));
}

export async function writeCurrentTraffic(sessions, capacity) {
  const cpu = modeledCpu(sessions, capacity);
  const now = new Date().toISOString();
  const update = `PREFIX tel: <${TEL_NS}> PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>
    DELETE { GRAPH <${
      GRAPHDB.current
    }> { <${SOURCE_IRI}> tel:currentPduSessions ?oldSessions ; tel:cpuUtilization ?oldCpu ; tel:generatedAt ?oldTime ; tel:state ?oldState . } }
    INSERT { GRAPH <${
      GRAPHDB.current
    }> { <${SOURCE_IRI}> tel:currentPduSessions "${Math.round(
    sessions
  )}"^^xsd:integer ; tel:cpuUtilization "${cpu.toFixed(
    2
  )}"^^xsd:decimal ; tel:generatedAt "${now}"^^xsd:dateTime ; tel:state "CURRENT" . } }
    WHERE { OPTIONAL { GRAPH <${
      GRAPHDB.current
    }> { <${SOURCE_IRI}> tel:currentPduSessions ?oldSessions } } OPTIONAL { GRAPH <${
    GRAPHDB.current
  }> { <${SOURCE_IRI}> tel:cpuUtilization ?oldCpu } } OPTIONAL { GRAPH <${
    GRAPHDB.current
  }> { <${SOURCE_IRI}> tel:generatedAt ?oldTime } } OPTIONAL { GRAPH <${
    GRAPHDB.current
  }> { <${SOURCE_IRI}> tel:state ?oldState } } }`;
  await sparqlUpdate(update);
  return { sessions, capacity, cpu };
}

export async function suggestLoadSplit(sessions, capacity) {
  const currentNodes = await graphCount(GRAPHDB.current);
  const cpu = modeledCpu(sessions, capacity);
  const eligible = sessions > SESSION_THRESHOLD && cpu > CPU_THRESHOLD;
  const targetExists = await ask(
    `ASK { GRAPH <${GRAPHDB.target}> { ?s ?p ?o } }`
  );
  const moved = Math.round((sessions * SPLIT_PERCENTAGE) / 100);
  const upf1Sessions = sessions - moved;
  const upf2Sessions = moved;
  const targetNodes = targetExists
    ? await graphCount(GRAPHDB.target)
    : currentNodes + 1;
  const log = [
    `Received ${sessions.toLocaleString()} active PDU sessions.`,
    `Calculated UPF load: ${((100 * sessions) / capacity).toFixed(
      2
    )}% of the maximum capacity of ${capacity.toLocaleString()} sessions.`,
    eligible
      ? `UPF overload threshold exceeded: ${cpu.toFixed(
          2
        )}% is above the configured threshold of ${CPU_THRESHOLD.toFixed(2)}%.`
      : `UPF overload criteria not both met (sessions must exceed ${SESSION_THRESHOLD.toLocaleString()} and calculated CPU must exceed ${CPU_THRESHOLD.toFixed(
          2
        )}%).`,
    eligible
      ? 'PREVIEW ONLY — no changes have been written to TARGET yet.'
      : 'No scale-out action is recommended at this load.',
  ];
  if (eligible) {
    log.push(
      `Proposed action: provision a new UPF node (${TARGET_ID} / OAI-UPF-2), clone 3 existing UPF connection edges, and redistribute ${sessions.toLocaleString()} sessions:`
    );
    log.push(
      `  Original UPF (${SOURCE_ID} / OAI-UPF-1): ${upf1Sessions.toLocaleString()} sessions, ${(
        (100 * upf1Sessions) /
        capacity
      ).toFixed(2)}% capacity`
    );
    log.push(
      `  New UPF (${TARGET_ID} / OAI-UPF-2): ${upf2Sessions.toLocaleString()} sessions, ${(
        (100 * upf2Sessions) /
        capacity
      ).toFixed(2)}% capacity`
    );
    log.push(
      `Current topology remains unchanged. Target graph: ${GRAPHDB.target}`
    );
    if (targetExists)
      log.push(
        'WARNING: a Target graph already exists; start a fresh simulation/reset the named graphs before executing another plan.'
      );
  }
  return {
    eligible,
    targetExists,
    sessions,
    capacity,
    loadPercent: (100 * sessions) / capacity,
    cpu,
    cpuThreshold: CPU_THRESHOLD,
    message: eligible
      ? ''
      : `Received ${sessions.toLocaleString()} sessions. Scale-out requires sessions > ${SESSION_THRESHOLD.toLocaleString()} and CPU > ${CPU_THRESHOLD}%.`,
    log: log.join('\n'),
    plan: eligible
      ? {
          originalUpfId: SOURCE_ID,
          originalUpfName: 'OAI-UPF-1',
          newUpfId: TARGET_ID,
          newUpfName: 'OAI-UPF-2',
          upf1Sessions,
          upf2Sessions,
          upf1LoadPercent: (100 * upf1Sessions) / capacity,
          upf2LoadPercent: (100 * upf2Sessions) / capacity,
          clonedConnections: 3,
          targetGraph: 'https://example.com/5g/graph/target',
          currentNodeCount: currentNodes,
          targetNodeCount: targetNodes,
        }
      : null,
  };
}

export async function executeLoadSplit(preview) {
  if (!preview?.eligible || !preview.plan)
    throw new Error('Suggest an eligible load-split plan before executing it.');
  if (
    preview.targetExists ||
    (await ask(`ASK { GRAPH <${GRAPHDB.target}> { ?s ?p ?o } }`))
  ) {
    throw new Error(
      'The Target graph already exists. Refresh/reinitialize the simulation before executing another scale-out plan.'
    );
  }
  const connectionsValid = await ask(
    `PREFIX tel: <${TEL_NS}> ASK { GRAPH <${GRAPHDB.current}> { ?gnb tel:n3ConnectsTo <${SOURCE_IRI}> . ?smf tel:n4ConnectsTo <${SOURCE_IRI}> . <${SOURCE_IRI}> tel:n6ConnectsTo ?dn . } }`
  );
  if (!connectionsValid)
    throw new Error(
      'Required N3/N4/N6 connections were not found in the Current graph; no Target graph was created.'
    );

  await sparqlUpdate(
    `COPY GRAPH <${GRAPHDB.current}> TO GRAPH <${GRAPHDB.target}>`
  );
  await sparqlUpdate(
    `PREFIX tel: <${TEL_NS}> PREFIX xsd: <http://www.w3.org/2001/XMLSchema#> INSERT DATA { GRAPH <${GRAPHDB.target}> { <${TARGET_IRI}> a tel:UPF ; tel:name "OAI-UPF-2" ; tel:ip "192.168.70.150" ; tel:sourceNodeId "${TARGET_ID}" ; tel:status "PROPOSED" ; tel:kpiMaxPduSessions "${preview.capacity}"^^xsd:integer ; tel:currentPduSessions "0"^^xsd:integer ; tel:cpuUtilization "12.00"^^xsd:decimal . <${SOURCE_IRI}> tel:n9ConnectsTo <${TARGET_IRI}> ; tel:scaleOutPeer <${TARGET_IRI}> . } }`
  );

  const edgeUpdates = [
    `INSERT { GRAPH <${GRAPHDB.target}> { ?gnb tel:n3ConnectsTo <${TARGET_IRI}> . } } WHERE { GRAPH <${GRAPHDB.target}> { ?gnb tel:n3ConnectsTo <${SOURCE_IRI}> . } }`,
    `INSERT { GRAPH <${GRAPHDB.target}> { ?smf tel:n4ConnectsTo <${TARGET_IRI}> . } } WHERE { GRAPH <${GRAPHDB.target}> { ?smf tel:n4ConnectsTo <${SOURCE_IRI}> . } }`,
    `INSERT { GRAPH <${GRAPHDB.target}> { <${TARGET_IRI}> tel:n6ConnectsTo ?dn . } } WHERE { GRAPH <${GRAPHDB.target}> { <${SOURCE_IRI}> tel:n6ConnectsTo ?dn . } }`,
  ];
  for (const update of edgeUpdates)
    await sparqlUpdate(`PREFIX tel: <${TEL_NS}> ${update}`);

  const targetValid = await ask(
    `PREFIX tel: <${TEL_NS}> ASK { GRAPH <${GRAPHDB.target}> { ?gnb tel:n3ConnectsTo <${TARGET_IRI}> . ?smf tel:n4ConnectsTo <${TARGET_IRI}> . <${TARGET_IRI}> tel:n6ConnectsTo ?dn . <${SOURCE_IRI}> tel:n9ConnectsTo <${TARGET_IRI}> . } }`
  );
  if (!targetValid)
    throw new Error(
      'Target relationships failed validation. The Target graph was created but did not pass connection validation.'
    );

  await sparqlUpdate(
    `PREFIX tel: <${TEL_NS}> CLEAR SILENT GRAPH <${TARGET_VIEW}>; INSERT { GRAPH <${TARGET_VIEW}> { ?s ?p ?o } } WHERE { GRAPH <${GRAPHDB.target}> { ?s ?p ?o . VALUES ?p { tel:n3ConnectsTo tel:n4ConnectsTo tel:n6ConnectsTo tel:n9ConnectsTo tel:scaleOutPeer } } }`
  );

  const p = preview.plan;
  await writeMetricsInGraph(
    GRAPHDB.target,
    SOURCE_IRI,
    p.upf1Sessions,
    preview.capacity,
    'TARGET'
  );
  await writeMetricsInGraph(
    GRAPHDB.target,
    TARGET_IRI,
    p.upf2Sessions,
    preview.capacity,
    'TARGET'
  );
  await writeMetricsInGraph(
    GRAPHDB.current,
    SOURCE_IRI,
    Math.min(preview.sessions, preview.capacity),
    preview.capacity,
    'CURRENT'
  );

  const finalCount = await graphCount(GRAPHDB.target);
  return {
    ...preview,
    targetExists: true,
    plan: { ...p, targetNodeCount: finalCount },
    log: `${preview.log}\n\nTarget topology created and validated after explicit approval.\nCreated target graph: ${GRAPHDB.target}\nCreated target-view graph: ${TARGET_VIEW}\nCurrent graph remains a single-UPF view; the imported default graph was not modified.`,
  };
}

async function writeMetricsInGraph(graph, node, sessions, capacity, state) {
  const cpu = modeledCpu(sessions, capacity);
  const now = new Date().toISOString();
  await sparqlUpdate(`PREFIX tel: <${TEL_NS}> PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>
    DELETE { GRAPH <${graph}> { <${node}> tel:currentPduSessions ?oldSessions ; tel:cpuUtilization ?oldCpu ; tel:generatedAt ?oldTime ; tel:state ?oldState . } }
    INSERT { GRAPH <${graph}> { <${node}> tel:currentPduSessions "${Math.round(
    sessions
  )}"^^xsd:integer ; tel:cpuUtilization "${cpu.toFixed(
    2
  )}"^^xsd:decimal ; tel:generatedAt "${now}"^^xsd:dateTime ; tel:state "${state}" . } }
    WHERE { OPTIONAL { GRAPH <${graph}> { <${node}> tel:currentPduSessions ?oldSessions } } OPTIONAL { GRAPH <${graph}> { <${node}> tel:cpuUtilization ?oldCpu } } OPTIONAL { GRAPH <${graph}> { <${node}> tel:generatedAt ?oldTime } } OPTIONAL { GRAPH <${graph}> { <${node}> tel:state ?oldState } } }`);
}
