// Site Intelligence queries for the Transport GraphDB repository.
// Query groups are deliberately numbered in sequence across stages 1–4.
const CURRENT = 'http://example.com/sct/graph/current';
const TARGET = 'http://example.com/sct/graph/target-view';
const SCT = 'http://example.com/sct/';

export const LIVE_PRESETS = [
  { id: 'Q1.1', stage: 'STAGE 1 — CURRENT STATE', title: 'Site inventory and planning cluster', gql: `PREFIX sct: <${SCT}> SELECT ?site ?cluster WHERE { GRAPH <${CURRENT}> { ?site a sct:Site . OPTIONAL { ?site sct:assignedTo ?cluster } } } ORDER BY ?site` },
  { id: 'Q1.2', stage: 'STAGE 1 — CURRENT STATE', title: 'Device inventory by site', gql: `PREFIX sct: <${SCT}> SELECT ?site (COUNT(DISTINCT ?device) AS ?device_count) WHERE { GRAPH <${CURRENT}> { ?device a sct:Device ; sct:locatedAt ?site . } } GROUP BY ?site ORDER BY DESC(?device_count)` },
  { id: 'Q1.3', stage: 'STAGE 1 — CURRENT STATE', title: 'Services traversing each site', gql: `PREFIX sct: <${SCT}> SELECT ?site (COUNT(DISTINCT ?service) AS ?service_count) WHERE { GRAPH <${CURRENT}> { ?service a sct:Service ; sct:traverses ?device . ?device sct:locatedAt ?site . } } GROUP BY ?site ORDER BY DESC(?service_count)` },
  { id: 'Q2.1', stage: 'STAGE 2 — WHAT-IF ANALYSIS', title: 'Geographic site coordinates', gql: `PREFIX sct: <${SCT}> SELECT ?site ?latitude ?longitude WHERE { GRAPH <${CURRENT}> { ?site a sct:Site ; sct:latitude ?latitude ; sct:longitude ?longitude . } } ORDER BY ?site` },
  { id: 'Q2.2', stage: 'STAGE 2 — WHAT-IF ANALYSIS', title: 'Potential source and destination sites', gql: `PREFIX sct: <${SCT}> SELECT ?site (COUNT(DISTINCT ?device) AS ?device_count) WHERE { GRAPH <${CURRENT}> { ?site a sct:Site . OPTIONAL { ?device a sct:Device ; sct:locatedAt ?site . } } } GROUP BY ?site ORDER BY ?device_count` },
  { id: 'Q2.3', stage: 'STAGE 2 — WHAT-IF ANALYSIS', title: 'Services currently using each site', gql: `PREFIX sct: <${SCT}> SELECT DISTINCT ?site ?service ?device WHERE { GRAPH <${CURRENT}> { ?service a sct:Service ; sct:traverses ?device . ?device sct:locatedAt ?site . } } ORDER BY ?site ?service` },
  { id: 'Q3.1', stage: 'STAGE 3 — PLANNED STATE', title: 'Planned graph inventory', gql: `PREFIX sct: <${SCT}> SELECT ?graph (COUNT(*) AS ?triple_count) WHERE { GRAPH ?graph { ?s ?p ?o . } FILTER(STRSTARTS(STR(?graph), "http://example.com/sct/graph/planned/")) } GROUP BY ?graph ORDER BY ?graph` },
  { id: 'Q3.2', stage: 'STAGE 3 — PLANNED STATE', title: 'Planned device migration relationships', gql: `PREFIX sct: <${SCT}> SELECT ?graph ?source ?destination WHERE { GRAPH ?graph { ?source sct:migratesTo ?destination . } FILTER(STRSTARTS(STR(?graph), "http://example.com/sct/graph/planned/")) } ORDER BY ?graph ?source` },
  { id: 'Q3.3', stage: 'STAGE 3 — PLANNED STATE', title: 'Planned site and service relationships', gql: `PREFIX sct: <${SCT}> SELECT ?graph ?service ?device ?site WHERE { GRAPH ?graph { ?service sct:traverses ?device . ?device sct:locatedAt ?site . } FILTER(STRSTARTS(STR(?graph), "http://example.com/sct/graph/planned/")) } ORDER BY ?graph ?service` },
  { id: 'Q4.1', stage: 'STAGE 4 — TARGET STATE', title: 'Target site and device inventory', gql: `PREFIX sct: <${SCT}> SELECT ?site (COUNT(DISTINCT ?device) AS ?device_count) WHERE { GRAPH <${TARGET}> { ?device a sct:Device ; sct:locatedAt ?site . } } GROUP BY ?site ORDER BY ?site` },
  { id: 'Q4.2', stage: 'STAGE 4 — TARGET STATE', title: 'Target service paths', gql: `PREFIX sct: <${SCT}> SELECT DISTINCT ?service ?device ?site WHERE { GRAPH <${TARGET}> { ?service a sct:Service ; sct:traverses ?device . ?device sct:locatedAt ?site . } } ORDER BY ?service` },
  { id: 'Q4.3', stage: 'STAGE 4 — TARGET STATE', title: 'Target topology consistency check', gql: `PREFIX sct: <${SCT}> SELECT ?device ?site WHERE { GRAPH <${TARGET}> { ?device a sct:Device . FILTER NOT EXISTS { ?device sct:locatedAt ?site } } } ORDER BY ?device` },
];
