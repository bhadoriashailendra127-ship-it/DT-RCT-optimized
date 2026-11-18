const SCT_NS = 'http://example.com/sct/';
const RDF_NS = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#';
const RDFS_NS = 'http://www.w3.org/2000/01/rdf-schema#';

export const TRANSPORT_GRAPH_NODE_LIMIT = 100;

export const TRANSPORT_GRAPHS = {
  current: 'http://example.com/sct/graph/current',
  target: 'http://example.com/sct/graph/target-view',
  plannedView: 'http://example.com/sct/graph/planned-view',
};

function graphBlock(graph, body) {
  return `GRAPH <${graph}> { ${body} }`;
}

export const transportQueries = {
  startPoint(graph) {
    return `PREFIX sct: <${SCT_NS}>
      SELECT DISTINCT ?subject ?predicate ?object
      WHERE {
        ${graphBlock(
          graph,
          `{
            ?device a sct:Device; sct:locatedAt ?site .
            BIND(?device AS ?subject)
            BIND(sct:locatedAt AS ?predicate)
            BIND(?site AS ?object)
          }
          UNION
          {
            ?device a sct:Device; sct:connects ?connectedDevice .
            BIND(?device AS ?subject)
            BIND(sct:connects AS ?predicate)
            BIND(?connectedDevice AS ?object)
          }
          UNION
          {
            ?service a sct:Service; sct:traverses ?device .
            BIND(?service AS ?subject)
            BIND(sct:traverses AS ?predicate)
            BIND(?device AS ?object)
          }
          UNION
          {
            ?site a sct:Site; sct:assignedTo ?cluster .
            BIND(?site AS ?subject)
            BIND(sct:assignedTo AS ?predicate)
            BIND(?cluster AS ?object)
          }`
        )}
      }
      ORDER BY DESC(?predicate = sct:assignedTo)
      LIMIT ${TRANSPORT_GRAPH_NODE_LIMIT}`;
  },

  expansion(graph) {
    return `SELECT DISTINCT ?subject ?predicate ?object
      WHERE {
        ${graphBlock(
          graph,
          `{
            ?node ?predicate ?outNode .
            FILTER(isIRI(?node))
            FILTER(isIRI(?outNode))
            BIND(?node AS ?subject)
            BIND(?outNode AS ?object)
          }
          UNION
          {
            ?inNode ?predicate ?node .
            FILTER(isIRI(?node))
            FILTER(isIRI(?inNode))
            BIND(?inNode AS ?subject)
            BIND(?node AS ?object)
          }`
        )}
      }
      LIMIT ${TRANSPORT_GRAPH_NODE_LIMIT}`;
  },

  nodeBasics(graph, nodeIds) {
    const nodeValues = sparqlIriValues(nodeIds);
    return `PREFIX rdf: <${RDF_NS}>
      PREFIX rdfs: <${RDFS_NS}>
      SELECT DISTINCT ?node ?type ?label
      WHERE {
        ${graphBlock(
          graph,
          `VALUES ?node { ${nodeValues} }
          ?node rdf:type ?type .
          OPTIONAL { ?node rdfs:label ?rdfLabel . }`
        )}
        BIND(
          COALESCE(
            ?rdfLabel,
            REPLACE(STR(?node), "^.*/", "")
          )
          AS ?label
        )
      }`;
  },

  literalProperties(graph, nodeIds) {
    const nodeValues = sparqlIriValues(nodeIds);
    return `SELECT ?node ?property ?value
      WHERE {
        ${graphBlock(
          graph,
          `VALUES ?node { ${nodeValues} }
          ?node ?property ?value .
          FILTER(isLiteral(?value))`
        )}
      }`;
  },
};

function sparqlIriValues(nodeIds) {
  const invalidIriCharacters = '<>"{}|\\^`';
  return nodeIds
    .map((id) => {
      if (
        !/^[A-Za-z][A-Za-z0-9+.-]*:/.test(id) ||
        Array.from(id).some(
          (character) =>
            character.charCodeAt(0) <= 0x20 ||
            invalidIriCharacters.includes(character)
        )
      ) {
        throw new Error('GraphDB returned an invalid node IRI.');
      }
      return `<${id}>`;
    })
    .join(' ');
}

export function plannedTransportGraph(sourceSite, destinationSite, version) {
  const validPart = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
  const source = sourceSite.trim();
  const destination = destinationSite.trim();
  const revision = version.trim();

  if (!validPart.test(source) || !validPart.test(destination)) {
    throw new Error('Site IDs may contain only letters, numbers, dots, _ and -.');
  }
  if (source === destination) {
    throw new Error('Source and destination sites must be different.');
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(revision)) {
    throw new Error('Plan version may contain only letters, numbers, dots, _ and -.');
  }

  return `${TRANSPORT_GRAPHS.plannedView}/${source}-to-${destination}/${revision}`;
}
