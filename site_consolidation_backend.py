"""
Site Consolidation Backend
==========================

CURRENT DIGITAL TWIN
--------------------

GraphDB source graph:

    http://example.com/sct/graph/current

Current visualization contains:

Entities:
    - Site
    - Device
    - Service
    - PlanningCluster

Relationships:
    - Device  -- locatedAt --> Site
    - Device  -- connects --> Device
    - Service -- traverses --> Device
    - Site    -- assignedTo --> PlanningCluster


CURRENT BUSINESS LOGIC
----------------------

1. Read CURRENT Digital Twin.

2. Automatically create/update Saved Visual Graph:

       Site Consolidation - Current

3. Calculate geographic distance between every Site pair.

4. Continue only when:

       distance < 15 km

5. Count ALL Devices located at each Site.

6. Site with fewer Devices becomes SOURCE.

7. Site with more Devices becomes DESTINATION.

8. If both Sites have equal Device counts:

       MANUAL_REVIEW

9. Determine migration-state sequence from SOURCE Device count.

   SOURCE has 1 Device:

       CURRENT -> TARGET

   SOURCE has N > 1 Devices:

       CURRENT
          -> SCT_Planned_1
          -> SCT_Planned_2
          ...
          -> SCT_Planned_(N-1)
          -> TARGET

   The last Device migrates directly from the final
   Planned state into TARGET.


NOT IMPLEMENTED YET
-------------------

Business Check 2 is intentionally excluded for now.

Not yet checking:

    - CURRENT source Devices
    - Services traversing source Devices
    - Same-class destination Device
    - Destination capacity
    - Projected utilization < 70%
    - L3VPN / L2VPN / Multicast / Internet support
    - SRv6 compatibility

Not yet creating:

    - SCT_Planned_n RDF graphs
    - TARGET RDF graph


IMPORTANT
---------

- graph/current remains unchanged.
- No Site IDs are hardcoded.
- No Device IDs are hardcoded.
- No topology is hardcoded.
- Device state is NOT considered for Device count.
"""

import json
import math
import urllib.parse
import urllib.request

import requests


# ============================================================
# CONFIGURATION
# ============================================================

GRAPHDB_URL = "http://localhost:7200"

REPOSITORY = "site_consolidation"

SCT = "http://example.com/sct/"

CURRENT_GRAPH = (
    "http://example.com/sct/graph/current"
)

SAVED_CURRENT_GRAPH_NAME = (
    "Site Consolidation - Current"
)

SAVED_GRAPH_URL = (
    f"{GRAPHDB_URL}/rest/explore-graph/saved"
)

TARGET_GRAPH = "http://example.com/sct/graph/target"

SAVED_TARGET_GRAPH_NAME = (
    "Site Consolidation - Target"
)

TARGET_VIEW_GRAPH = (
    "http://example.com/sct/graph/target-view"
)

TARGET_VIEW_NS = (
    "http://example.com/sct/target-view/"
)

PLANNED_GRAPH_BASE = (
    "http://example.com/sct/graph/planned"
)

PLANNED_VIEW_BASE = (
    "http://example.com/sct/graph/planned-view"
)

PLANNED_VIEW_NS_BASE = (
    "http://example.com/sct/planned-view"
)

WORKING_GRAPH = (
    "http://example.com/sct/graph/working"
)


# ============================================================
# BUSINESS RULES
# ============================================================

DISTANCE_THRESHOLD_KM = 15.0

UTILIZATION_THRESHOLD_PERCENT = 70.0

ENFORCE_SRV6_COMPATIBILITY = False


# ============================================================
# SPARQL SELECT
# ============================================================

def run_sparql(query):
    """
    Execute a SPARQL SELECT query against GraphDB.
    """

    endpoint = (
        f"{GRAPHDB_URL}/repositories/{REPOSITORY}"
    )

    data = urllib.parse.urlencode({
        "query": query
    }).encode("utf-8")

    request = urllib.request.Request(
        endpoint,
        data=data,
        headers={
            "Accept":
                "application/sparql-results+json"
        }
    )

    with urllib.request.urlopen(
        request
    ) as response:

        result = json.loads(
            response.read().decode("utf-8")
        )

    return result["results"]["bindings"]
    
def run_sparql_update(update_query):
    """
    Execute SPARQL UPDATE against GraphDB.

    Used only for derived Planned/Target graphs.
    graph/current must remain unchanged.
    """

    endpoint = (
        f"{GRAPHDB_URL}/repositories/"
        f"{REPOSITORY}/statements"
    )

    data = urllib.parse.urlencode({
        "update": update_query
    }).encode("utf-8")

    request = urllib.request.Request(
        endpoint,
        data=data,
        method="POST",
        headers={
            "Content-Type":
                "application/x-www-form-urlencoded"
        }
    )

    with urllib.request.urlopen(
        request
    ) as response:

        return response.status


# ============================================================
# URI HELPER
# ============================================================

def local_name(uri):
    """
    Return local identifier from an IRI.
    """

    if not uri:
        return ""

    if "#" in uri:
        return uri.rsplit("#", 1)[-1]

    return uri.rsplit("/", 1)[-1]


# ============================================================
# CURRENT VISUAL ENTITIES
# ============================================================

def get_current_visual_entities():
    """
    Read the four entity types used by the
    Current Saved Visual Graph.
    """

    query = f"""
    PREFIX sct: <{SCT}>

    SELECT DISTINCT
        ?entity
        ?entityType
    WHERE {{
        GRAPH <{CURRENT_GRAPH}> {{

            VALUES ?entityType {{
                sct:Site
                sct:Device
                sct:Service
                sct:PlanningCluster
            }}

            ?entity a ?entityType .
        }}
    }}
    ORDER BY ?entityType ?entity
    """

    return run_sparql(query)


# ============================================================
# CURRENT VISUAL RELATIONSHIPS
# ============================================================

def get_current_visual_topology():
    """
    Read the four relationship types used by the
    Current Saved Visual Graph.
    """

    query = f"""
    PREFIX sct: <{SCT}>

    SELECT DISTINCT
        ?source
        ?predicate
        ?target
    WHERE {{
        GRAPH <{CURRENT_GRAPH}> {{

            # Device -> Site
            {{
                ?source
                    a sct:Device ;
                    sct:locatedAt ?target .

                ?target a sct:Site .

                BIND(
                    sct:locatedAt
                    AS ?predicate
                )
            }}

            UNION

            # Device -> Device
            {{
                ?source
                    a sct:Device ;
                    sct:connects ?target .

                ?target a sct:Device .

                BIND(
                    sct:connects
                    AS ?predicate
                )
            }}

            UNION

            # Service -> Device
            {{
                ?source
                    a sct:Service ;
                    sct:traverses ?target .

                ?target a sct:Device .

                BIND(
                    sct:traverses
                    AS ?predicate
                )
            }}

            UNION

            # Site -> PlanningCluster
            {{
                ?source
                    a sct:Site ;
                    sct:assignedTo ?target .

                ?target a sct:PlanningCluster .

                BIND(
                    sct:assignedTo
                    AS ?predicate
                )
            }}
        }}
    }}

    ORDER BY
        ?source
        ?predicate
        ?target
    """

    return run_sparql(query)


# ============================================================
# BUILD CURRENT SAVED VISUAL GRAPH
# ============================================================

def build_current_graph_state(
    entities,
    relationships
):
    """
    Convert CURRENT RDF data into GraphDB's
    Saved Visual Graph format.
    """

    nodes = []

    for index, row in enumerate(entities):

        iri = row["entity"]["value"]

        entity_type_iri = (
            row["entityType"]["value"]
        )

        label = local_name(iri)

        column = index % 8
        row_number = index // 8

        x = 80 + column * 150
        y = 80 + row_number * 140

        nodes.append({
            "iri": iri,
            "isTriple": False,
            "size": 48,

            "labels": [
                {
                    "lang": "",
                    "priority": 0,
                    "label": label
                }
            ],

            "types": [
                entity_type_iri
            ],

            "rdfRank": 0,
            "x": x,
            "y": y,
            "fixed": False
        })

    links = []

    for row in relationships:

        source = row["source"]["value"]
        target = row["target"]["value"]

        predicate_iri = (
            row["predicate"]["value"]
        )

        predicate = local_name(
            predicate_iri
        )

        links.append({
            "source": source,
            "isTripleSource": False,

            "target": target,
            "isTripleTarget": False,

            "predicates": [
                predicate
            ],

            "rawPredicates": [
                predicate_iri
            ]
        })

    return {
        "nodes": nodes,
        "links": links,

        "tripleNodes": "[]",
        "tripleLinksCopy": "[]",

        "colorIndex": 4,

        "type2color": {
            SCT + "Site": 0,
            SCT + "Device": 1,
            SCT + "Service": 2,
            SCT + "PlanningCluster": 3
        },

        "transform": {
            "k": 1,
            "x": 100,
            "y": 50
        }
    }


# ============================================================
# CREATE / UPDATE CURRENT SAVED VISUAL GRAPH
# ============================================================

def create_or_update_saved_current_graph(
    graph_state
):
    """
    Create or update:

        Site Consolidation - Current
    """

    response = requests.get(
        SAVED_GRAPH_URL,
        timeout=30
    )

    response.raise_for_status()

    saved_graphs = response.json()

    existing_graph = next(
        (
            graph
            for graph in saved_graphs
            if graph.get("name")
            == SAVED_CURRENT_GRAPH_NAME
        ),
        None
    )

    payload = {
        "name":
            SAVED_CURRENT_GRAPH_NAME,

        "data":
            json.dumps(
                graph_state
            ),

        "shared":
            False,

        "config":
            "default"
    }

    if existing_graph:

        graph_id = existing_graph["id"]

        payload["id"] = graph_id

        response = requests.put(
            (
                f"{SAVED_GRAPH_URL}/"
                f"{graph_id}"
            ),
            json=payload,
            timeout=30
        )

        if response.status_code not in (
            200,
            204
        ):
            raise RuntimeError(
                "Unable to update Saved Visual Graph: "
                f"HTTP {response.status_code}: "
                f"{response.text}"
            )

        print(
            "Saved Visual Graph updated: "
            f"{SAVED_CURRENT_GRAPH_NAME}"
        )

    else:

        response = requests.post(
            SAVED_GRAPH_URL,
            json=payload,
            timeout=30
        )

        if response.status_code not in (
            200,
            201
        ):
            raise RuntimeError(
                "Unable to create Saved Visual Graph: "
                f"HTTP {response.status_code}: "
                f"{response.text}"
            )

        print(
            "Saved Visual Graph created: "
            f"{SAVED_CURRENT_GRAPH_NAME}"
        )


# ============================================================
# PRINT CURRENT SUMMARY
# ============================================================

def print_summary(
    entities,
    relationships
):
    """
    Print Current visualization counts.
    """

    entity_counts = {}

    for row in entities:

        entity_type = local_name(
            row["entityType"]["value"]
        )

        entity_counts[entity_type] = (
            entity_counts.get(
                entity_type,
                0
            )
            + 1
        )

    relationship_counts = {}

    for row in relationships:

        predicate = local_name(
            row["predicate"]["value"]
        )

        relationship_counts[predicate] = (
            relationship_counts.get(
                predicate,
                0
            )
            + 1
        )

    print("\nCURRENT ENTITY COUNTS")
    print("=" * 70)

    for entity_type in sorted(
        entity_counts
    ):
        print(
            f"{entity_type:<20} "
            f"{entity_counts[entity_type]}"
        )

    print(
        "\nCURRENT RELATIONSHIP COUNTS"
    )

    print("=" * 70)

    for predicate in sorted(
        relationship_counts
    ):
        print(
            f"{predicate:<20} "
            f"{relationship_counts[predicate]}"
        )


# ============================================================
# READ SITE COORDINATES
# ============================================================

def get_current_sites():
    """
    Read Site coordinates from graph/current.
    """

    query = f"""
    PREFIX sct: <{SCT}>

    SELECT
        ?site
        ?latitude
        ?longitude
    WHERE {{
        GRAPH <{CURRENT_GRAPH}> {{

            ?site
                a sct:Site ;
                sct:latitude ?latitude ;
                sct:longitude ?longitude .
        }}
    }}

    ORDER BY ?site
    """

    rows = run_sparql(query)

    sites = []

    for row in rows:

        site_uri = row["site"]["value"]

        sites.append({
            "uri":
                site_uri,

            "site_id":
                local_name(
                    site_uri
                ),

            "latitude":
                float(
                    row[
                        "latitude"
                    ][
                        "value"
                    ]
                ),

            "longitude":
                float(
                    row[
                        "longitude"
                    ][
                        "value"
                    ]
                )
        })

    return sites


# ============================================================
# HAVERSINE DISTANCE
# ============================================================

def haversine_km(
    lat1,
    lon1,
    lat2,
    lon2
):
    """
    Calculate straight-line geographic distance
    between two Sites.
    """

    earth_radius_km = 6371.0

    lat1_rad = math.radians(lat1)
    lon1_rad = math.radians(lon1)

    lat2_rad = math.radians(lat2)
    lon2_rad = math.radians(lon2)

    delta_lat = (
        lat2_rad - lat1_rad
    )

    delta_lon = (
        lon2_rad - lon1_rad
    )

    a = (
        math.sin(
            delta_lat / 2
        ) ** 2

        +

        math.cos(
            lat1_rad
        )

        *

        math.cos(
            lat2_rad
        )

        *

        math.sin(
            delta_lon / 2
        ) ** 2
    )

    c = 2 * math.atan2(
        math.sqrt(a),
        math.sqrt(1 - a)
    )

    return (
        earth_radius_km
        *
        c
    )


# ============================================================
# DISTANCE BUSINESS CHECK
# ============================================================

def find_distance_eligible_pairs():
    """
    Return every unique Site pair satisfying:

        distance < 15 km
    """

    sites = get_current_sites()

    eligible_pairs = []

    for i in range(
        len(sites)
    ):

        for j in range(
            i + 1,
            len(sites)
        ):

            site_a = sites[i]
            site_b = sites[j]

            distance_km = haversine_km(
                site_a["latitude"],
                site_a["longitude"],
                site_b["latitude"],
                site_b["longitude"]
            )

            if (
                distance_km
                <
                DISTANCE_THRESHOLD_KM
            ):
                eligible_pairs.append({
                    "site_a":
                        site_a,

                    "site_b":
                        site_b,

                    "distance_km":
                        distance_km
                })

    eligible_pairs.sort(
        key=lambda pair:
            pair["distance_km"]
    )

    return eligible_pairs


# ============================================================
# DEVICE COUNT
# ============================================================

def get_site_device_count(
    site_uri
):
    """
    Count all Devices located at a Site.

    Device state is intentionally not filtered.
    """

    query = f"""
    PREFIX sct: <{SCT}>

    SELECT
        (
            COUNT(
                DISTINCT ?device
            )
            AS ?count
        )
    WHERE {{
        GRAPH <{CURRENT_GRAPH}> {{

            ?device
                a sct:Device ;
                sct:locatedAt
                <{site_uri}> .
        }}
    }}
    """

    rows = run_sparql(query)

    if not rows:
        return 0

    return int(
        rows[0][
            "count"
        ][
            "value"
        ]
    )


# ============================================================
# SOURCE / DESTINATION DECISION
# ============================================================

def determine_source_destination(
    site_a,
    count_a,
    site_b,
    count_b
):
    """
    Site with fewer Devices becomes SOURCE.

    Site with more Devices becomes DESTINATION.

    If counts are equal:
        MANUAL_REVIEW
    """

    if count_a < count_b:

        return {
            "status":
                "PASS",

            "source":
                site_a,

            "destination":
                site_b,

            "source_device_count":
                count_a,

            "destination_device_count":
                count_b
        }

    if count_b < count_a:

        return {
            "status":
                "PASS",

            "source":
                site_b,

            "destination":
                site_a,

            "source_device_count":
                count_b,

            "destination_device_count":
                count_a
        }

    return {
        "status":
            "MANUAL_REVIEW",

        "source":
            None,

        "destination":
            None,

        "source_device_count":
            count_a,

        "destination_device_count":
            count_b
    }


# ============================================================
# MIGRATION STATE SEQUENCE
# ============================================================

def get_state_sequence(
    source_device_count
):
    """
    Source has one Device:

        CURRENT -> TARGET

    Source has N Devices:

        CURRENT
        -> SCT_Planned_1
        ...
        -> SCT_Planned_(N-1)
        -> TARGET
    """

    if source_device_count <= 0:

        return [
            "CURRENT"
        ]

    if source_device_count == 1:

        return [
            "CURRENT",
            "TARGET"
        ]

    planned_states = [
        f"SCT_Planned_{index}"

        for index in range(
            1,
            source_device_count
        )
    ]

    return (
        ["CURRENT"]
        + planned_states
        + ["TARGET"]
    )

def get_source_device_dependencies(
    source_site_uri
):
    """
    Discover migration dependencies for every Device
    located at the selected SOURCE Site.

    Read-only:
    - Device
    - Services traversing Device
    - Incoming/outgoing connected Devices
    - Neighbor Sites

    No Target state is created here.
    """

    query = f"""
    PREFIX sct: <{SCT}>

    SELECT DISTINCT
        ?device
        ?service
        ?neighbor
        ?neighborSite
    WHERE {{
        GRAPH <{CURRENT_GRAPH}> {{

            ?device
                a sct:Device ;
                sct:locatedAt
                <{source_site_uri}> .

            OPTIONAL {{
                ?service
                    a sct:Service ;
                    sct:traverses
                    ?device .
            }}

            OPTIONAL {{
                {{
                    ?device
                        sct:connects
                        ?neighbor .
                }}
                UNION
                {{
                    ?neighbor
                        sct:connects
                        ?device .
                }}

                OPTIONAL {{
                    ?neighbor
                        sct:locatedAt
                        ?neighborSite .
                }}
            }}
        }}
    }}

    ORDER BY
        ?device
        ?service
        ?neighbor
    """

    return run_sparql(query)
    
def create_target_snapshot():
    """
    Create TARGET as a fresh snapshot of CURRENT.

    TARGET is recreated on every run.
    CURRENT remains unchanged.
    """

    update = f"""
    CLEAR SILENT GRAPH <{TARGET_GRAPH}>;

    COPY GRAPH <{CURRENT_GRAPH}>
    TO GRAPH <{TARGET_GRAPH}>
    """

    run_sparql_update(
        update
    )

    print(
        "TARGET snapshot created from CURRENT."
    )
    
def migrate_service_traversals_to_target(
    source_site_uri
):
    """
    In TARGET only:

    For each source Device:
    1. Find its existing migratesTo replacement.
    2. Move Service traverses relationships from
       source Device to replacement Device.

    CURRENT remains untouched.
    """

    query = f"""
    PREFIX sct: <{SCT}>

    SELECT DISTINCT
        ?sourceDevice
        ?replacementDevice
    WHERE {{
        GRAPH <{CURRENT_GRAPH}> {{

            ?sourceDevice
                a sct:Device ;
                sct:locatedAt
                <{source_site_uri}> ;
                sct:migratesTo
                ?replacementDevice .
        }}
    }}
    """

    mappings = run_sparql(query)

    if not mappings:
        print(
            "No migratesTo mapping found. "
            "Skipping service migration."
        )
        return

    for mapping in mappings:

        source_device = (
            mapping["sourceDevice"]["value"]
        )

        replacement_device = (
            mapping["replacementDevice"]["value"]
        )

        update = f"""
        PREFIX sct: <{SCT}>

        DELETE {{
            GRAPH <{TARGET_GRAPH}> {{

                ?service
                    sct:traverses
                    <{source_device}> .
            }}
        }}

        INSERT {{
            GRAPH <{TARGET_GRAPH}> {{

                ?service
                    sct:traverses
                    <{replacement_device}> .
            }}
        }}

        WHERE {{
            GRAPH <{TARGET_GRAPH}> {{

                ?service
                    sct:traverses
                    <{source_device}> .
            }}
        }}
        """

        run_sparql_update(update)

        print(
            "Service traversal migrated: "
            f"{local_name(source_device)} "
            "-> "
            f"{local_name(replacement_device)}"
        )
def migrate_device_connectivity_to_target(
    source_site_uri
):
    """
    Re-home source Device connectivity to its migratesTo
    replacement Device inside TARGET only.

    CURRENT remains untouched.
    """

    query = f"""
    PREFIX sct: <{SCT}>

    SELECT DISTINCT
        ?sourceDevice
        ?replacementDevice
    WHERE {{
        GRAPH <{CURRENT_GRAPH}> {{

            ?sourceDevice
                a sct:Device ;
                sct:locatedAt
                <{source_site_uri}> ;
                sct:migratesTo
                ?replacementDevice .
        }}
    }}
    """

    mappings = run_sparql(query)

    for mapping in mappings:

        source_device = (
            mapping["sourceDevice"]["value"]
        )

        replacement_device = (
            mapping["replacementDevice"]["value"]
        )

        # --------------------------------------------
        # Outgoing connections
        # source -> neighbor
        # becomes
        # replacement -> neighbor
        # --------------------------------------------

        outgoing_update = f"""
        PREFIX sct: <{SCT}>

        DELETE {{
            GRAPH <{TARGET_GRAPH}> {{
                <{source_device}>
                    sct:connects
                    ?neighbor .
            }}
        }}

        INSERT {{
            GRAPH <{TARGET_GRAPH}> {{
                <{replacement_device}>
                    sct:connects
                    ?neighbor .
            }}
        }}

        WHERE {{
            GRAPH <{TARGET_GRAPH}> {{

                <{source_device}>
                    sct:connects
                    ?neighbor .

                FILTER(
                    ?neighbor !=
                    <{replacement_device}>
                )
            }}
        }}
        """

        run_sparql_update(
            outgoing_update
        )

        # --------------------------------------------
        # Incoming connections
        # neighbor -> source
        # becomes
        # neighbor -> replacement
        # --------------------------------------------

        incoming_update = f"""
        PREFIX sct: <{SCT}>

        DELETE {{
            GRAPH <{TARGET_GRAPH}> {{
                ?neighbor
                    sct:connects
                    <{source_device}> .
            }}
        }}

        INSERT {{
            GRAPH <{TARGET_GRAPH}> {{
                ?neighbor
                    sct:connects
                    <{replacement_device}> .
            }}
        }}

        WHERE {{
            GRAPH <{TARGET_GRAPH}> {{

                ?neighbor
                    sct:connects
                    <{source_device}> .

                FILTER(
                    ?neighbor !=
                    <{replacement_device}>
                )
            }}
        }}
        """

        run_sparql_update(
            incoming_update
        )

        print(
            "Connectivity migrated: "
            f"{local_name(source_device)} "
            "-> "
            f"{local_name(replacement_device)}"
        )
        
def remove_source_devices_from_target(
    source_site_uri
):
    """
    Remove migrated source Devices from active TARGET topology.

    Service TRAVERSES and CONNECTS relationships must already
    have been migrated before this function is called.

    CURRENT remains unchanged.
    """

    query = f"""
    PREFIX sct: <{SCT}>

    SELECT DISTINCT ?device
    WHERE {{
        GRAPH <{TARGET_GRAPH}> {{

            ?device
                a sct:Device ;
                sct:locatedAt
                <{source_site_uri}> .
        }}
    }}
    """

    devices = run_sparql(query)

    for row in devices:

        device_uri = row["device"]["value"]

        update = f"""
        DELETE {{
            GRAPH <{TARGET_GRAPH}> {{

                <{device_uri}>
                    ?p
                    ?o .

                ?s
                    ?p2
                    <{device_uri}> .
            }}
        }}

        WHERE {{
            GRAPH <{TARGET_GRAPH}> {{

                OPTIONAL {{
                    <{device_uri}>
                        ?p
                        ?o .
                }}

                OPTIONAL {{
                    ?s
                        ?p2
                        <{device_uri}> .
                }}
            }}
        }}
        """

        run_sparql_update(update)

        print(
            "Source Device removed from TARGET: "
            f"{local_name(device_uri)}"
        )
def remove_empty_source_site_from_target(
    source_site_uri
):
    """
    Remove SOURCE Site from TARGET only when
    no Devices remain located at that Site.

    Shared objects such as PlanningCluster are NOT deleted.
    """

    check_query = f"""
    PREFIX sct: <{SCT}>

    SELECT (COUNT(?device) AS ?count)
    WHERE {{
        GRAPH <{TARGET_GRAPH}> {{

            ?device
                a sct:Device ;
                sct:locatedAt
                <{source_site_uri}> .
        }}
    }}
    """

    rows = run_sparql(
        check_query
    )

    remaining_devices = int(
        rows[0]["count"]["value"]
    )

    if remaining_devices != 0:

        print(
            "Source Site cannot be removed. "
            f"Remaining Devices: {remaining_devices}"
        )

        return False

    update = f"""
    DELETE {{
        GRAPH <{TARGET_GRAPH}> {{

            <{source_site_uri}>
                ?p
                ?o .

            ?s
                ?p2
                <{source_site_uri}> .
        }}
    }}

    WHERE {{
        GRAPH <{TARGET_GRAPH}> {{

            OPTIONAL {{
                <{source_site_uri}>
                    ?p
                    ?o .
            }}

            OPTIONAL {{
                ?s
                    ?p2
                    <{source_site_uri}> .
            }}
        }}
    }}
    """

    run_sparql_update(
        update
    )

    print(
        "Source Site removed from TARGET: "
        f"{local_name(source_site_uri)}"
    )

    return True
    
def get_visual_entities_from_graph(
    graph_iri
):
    """
    Read visualization entities from any state graph.
    """

    query = f"""
    PREFIX sct: <{SCT}>

    SELECT DISTINCT
        ?entity
        ?entityType
    WHERE {{
        GRAPH <{graph_iri}> {{

            VALUES ?entityType {{
                sct:Site
                sct:Device
                sct:Service
                sct:PlanningCluster
            }}

            ?entity a ?entityType .
        }}
    }}

    ORDER BY ?entityType ?entity
    """

    return run_sparql(query)


def get_visual_topology_from_graph(
    graph_iri
):
    """
    Read visualization relationships from any state graph.
    """

    query = f"""
    PREFIX sct: <{SCT}>

    SELECT DISTINCT
        ?source
        ?predicate
        ?target
    WHERE {{
        GRAPH <{graph_iri}> {{

            {{
                ?source
                    a sct:Device ;
                    sct:locatedAt ?target .

                ?target a sct:Site .

                BIND(
                    sct:locatedAt
                    AS ?predicate
                )
            }}

            UNION

            {{
                ?source
                    a sct:Device ;
                    sct:connects ?target .

                ?target a sct:Device .

                BIND(
                    sct:connects
                    AS ?predicate
                )
            }}

            UNION

            {{
                ?source
                    a sct:Service ;
                    sct:traverses ?target .

                ?target a sct:Device .

                BIND(
                    sct:traverses
                    AS ?predicate
                )
            }}

            UNION

            {{
                ?source
                    a sct:Site ;
                    sct:assignedTo ?target .

                ?target a sct:PlanningCluster .

                BIND(
                    sct:assignedTo
                    AS ?predicate
                )
            }}
        }}
    }}

    ORDER BY ?source ?predicate ?target
    """

    return run_sparql(query)
    
def create_or_update_saved_target_graph():
    """
    Build the TARGET visualization directly from graph/target
    and create/update the Saved Visual Graph.
    """

    target_entities = (
        get_visual_entities_from_graph(
            TARGET_VIEW_GRAPH
        )
    )

    target_relationships = (
        get_visual_topology_from_graph(
            TARGET_VIEW_GRAPH
        )
    )

    graph_state = build_current_graph_state(
        target_entities,
        target_relationships
    )

    # Reuse the same Saved Graph create/update mechanism
    response = requests.get(
        SAVED_GRAPH_URL,
        timeout=30
    )

    response.raise_for_status()

    saved_graphs = response.json()

    existing_graph = next(
        (
            graph
            for graph in saved_graphs
            if graph.get("name")
            == SAVED_TARGET_GRAPH_NAME
        ),
        None
    )

    payload = {
        "name": SAVED_TARGET_GRAPH_NAME,
        "data": json.dumps(graph_state),
        "shared": False,
        "config": "default"
    }

    if existing_graph:

        graph_id = existing_graph["id"]

        payload["id"] = graph_id

        response = requests.put(
            f"{SAVED_GRAPH_URL}/{graph_id}",
            json=payload,
            timeout=30
        )

        if response.status_code not in (
            200,
            204
        ):
            raise RuntimeError(
                "Unable to update Target Saved Visual Graph: "
                f"HTTP {response.status_code}: "
                f"{response.text}"
            )

        print(
            "Saved Visual Graph updated: "
            f"{SAVED_TARGET_GRAPH_NAME}"
        )

    else:

        response = requests.post(
            SAVED_GRAPH_URL,
            json=payload,
            timeout=30
        )

        if response.status_code not in (
            200,
            201
        ):
            raise RuntimeError(
                "Unable to create Target Saved Visual Graph: "
                f"HTTP {response.status_code}: "
                f"{response.text}"
            )

        print(
            "Saved Visual Graph created: "
            f"{SAVED_TARGET_GRAPH_NAME}"
        )

    print(
        f"Target visual entities      : "
        f"{len(target_entities)}"
    )

    print(
        f"Target visual relationships : "
        f"{len(target_relationships)}"
    )
    
def relocate_source_devices_to_destination(
    source_site_uri,
    destination_site_uri,
):
    """
    Move the same source Devices from SOURCE Site
    to DESTINATION Site inside TARGET.

    Device identity remains unchanged.

    Example:

    BEFORE:
        DEV-NEU-CMTS1
            locatedAt
        SITE-NEU-01

    AFTER:
        DEV-NEU-CMTS1
            locatedAt
        SITE-DUS-01

    Services and Device connectivity remain attached
    to the same Device.
    """

    update = f"""
    PREFIX sct: <{SCT}>

    DELETE {{
        GRAPH <{TARGET_GRAPH}> {{

            ?device
                sct:locatedAt
                <{source_site_uri}> .
        }}
    }}

    INSERT {{
        GRAPH <{TARGET_GRAPH}> {{

            ?device
                sct:locatedAt
                <{destination_site_uri}> .
        }}
    }}

    WHERE {{
        GRAPH <{TARGET_GRAPH}> {{

            ?device
                a sct:Device ;
                sct:locatedAt
                <{source_site_uri}> .
        }}
    }}
    """

    run_sparql_update(update)

    print(
        "Source Devices relocated in TARGET: "
        f"{local_name(source_site_uri)} "
        "-> "
        f"{local_name(destination_site_uri)}"
    )
    
def remove_migrates_to_from_target(
    destination_site_uri
):
    """
    Remove obsolete migratesTo relationships from Devices
    that have been physically relocated to the destination Site.

    TARGET only.
    CURRENT remains unchanged.
    """

    update = f"""
    PREFIX sct: <{SCT}>

    DELETE {{
        GRAPH <{TARGET_GRAPH}> {{
            ?device
                sct:migratesTo
                ?replacement .
        }}
    }}
    WHERE {{
        GRAPH <{TARGET_GRAPH}> {{

            ?device
                a sct:Device ;
                sct:locatedAt
                <{destination_site_uri}> ;
                sct:migratesTo
                ?replacement .
        }}
    }}
    """

    run_sparql_update(update)

    print(
        "Obsolete migratesTo relationships "
        "removed from TARGET."
    )
    
def create_target_view_graph(
    completed_workflows
):
    """
    Create an isolated TARGET visualization containing only
    PlanningCluster(s) affected by completed consolidation
    workflows.

    Important:

    - TARGET_GRAPH remains the complete authoritative Target.
    - TARGET_VIEW_GRAPH is visualization-only.
    - Unaffected clusters are not copied into target-view.
    - Cluster IDs, Site IDs, Device IDs and Service IDs are
      discovered dynamically.
    - No topology IDs are hardcoded.
    """

    # --------------------------------------------------------
    # 1. Discover unique affected PlanningClusters
    # --------------------------------------------------------

    affected_clusters = (
        get_target_affected_clusters(
            completed_workflows
        )
    )

    if not affected_clusters:

        print(
            "No affected PlanningClusters found "
            "for TARGET visualization."
        )

        return

    print()
    print(
        "TARGET affected clusters:"
    )

    for cluster in affected_clusters:

        print(
            f"  {cluster['cluster_id']}"
        )

    # --------------------------------------------------------
    # 2. Collect resources belonging to affected clusters
    # --------------------------------------------------------

    allowed_resources = set()

    for cluster in affected_clusters:

        cluster_uri = cluster["uri"]

        allowed_resources.add(
            cluster_uri
        )

        entities, relationships = (
            get_cluster_scoped_visual_data(
                TARGET_GRAPH,
                cluster_uri,
            )
        )

        for row in entities:

            allowed_resources.add(
                row["entity"]["value"]
            )

    if not allowed_resources:

        print(
            "No TARGET resources found for "
            "affected clusters."
        )

        return

    # --------------------------------------------------------
    # 3. Clear previous Target visualization
    # --------------------------------------------------------

    clear_query = f"""
    CLEAR SILENT GRAPH <{TARGET_VIEW_GRAPH}>
    """

    run_sparql_update(
        clear_query
    )

    # --------------------------------------------------------
    # 4. Read complete properties for allowed resources
    #
    #    This includes:
    #    - Device attributes
    #    - Site attributes
    #    - Service attributes
    #    - Cluster attributes
    #    - relationships between allowed resources
    #
    #    Relationships leading outside the affected cluster
    #    visualization are excluded.
    # --------------------------------------------------------

    values = " ".join(
        f"<{iri}>"
        for iri in sorted(
            allowed_resources
        )
    )

    query = f"""
    SELECT
        ?s
        ?p
        ?o
    WHERE {{
        GRAPH <{TARGET_GRAPH}> {{

            VALUES ?s {{
                {values}
            }}

            ?s ?p ?o .
        }}
    }}
    """

    rows = run_sparql(
        query
    )

    # --------------------------------------------------------
    # RDF type predicate
    # --------------------------------------------------------

    rdf_type = (
        "http://www.w3.org/"
        "1999/02/22-rdf-syntax-ns#type"
    )

    triples = []

    # --------------------------------------------------------
    # 5. Convert TARGET resources to isolated Target-view IRIs
    # --------------------------------------------------------

    for row in rows:

        subject_iri = (
            row["s"]["value"]
        )

        predicate_iri = (
            row["p"]["value"]
        )

        obj = row["o"]

        # ----------------------------------------------------
        # Remap Target instance subject
        # ----------------------------------------------------

        mapped_subject = (
            TARGET_VIEW_NS
            + local_name(
                subject_iri
            )
        )

        # ----------------------------------------------------
        # URI object
        # ----------------------------------------------------

        if obj["type"] == "uri":

            object_iri = (
                obj["value"]
            )

            # Keep ontology class IRIs unchanged.
            #
            # Example:
            #
            # target-view/DEV-X
            #     rdf:type
            # sct:Device
            #
            if predicate_iri == rdf_type:

                mapped_object = (
                    object_iri
                )

            # If the object belongs to the affected
            # visualization scope, remap it.
            elif object_iri in allowed_resources:

                mapped_object = (
                    TARGET_VIEW_NS
                    + local_name(
                        object_iri
                    )
                )

            # Relationship points outside affected clusters.
            # Do not include it in Target visualization.
            else:

                continue

            object_value = (
                f"<{mapped_object}>"
            )

        # ----------------------------------------------------
        # Literal object
        # ----------------------------------------------------

        else:

            literal = (
                obj["value"]
                .replace(
                    "\\",
                    "\\\\"
                )
                .replace(
                    '"',
                    '\\"'
                )
                .replace(
                    "\n",
                    "\\n"
                )
                .replace(
                    "\r",
                    "\\r"
                )
            )

            datatype = obj.get(
                "datatype"
            )

            language = obj.get(
                "xml:lang"
            )

            if datatype:

                object_value = (
                    f'"{literal}"'
                    f"^^<{datatype}>"
                )

            elif language:

                object_value = (
                    f'"{literal}"'
                    f"@{language}"
                )

            else:

                object_value = (
                    f'"{literal}"'
                )

        # ----------------------------------------------------
        # Build Turtle/SPARQL triple
        # ----------------------------------------------------

        triples.append(
            f"<{mapped_subject}> "
            f"<{predicate_iri}> "
            f"{object_value} ."
        )

    # --------------------------------------------------------
    # 6. Insert Target-view triples
    # --------------------------------------------------------

    batch_size = 500

    for start in range(
        0,
        len(triples),
        batch_size
    ):

        batch = triples[
            start:
            start + batch_size
        ]

        insert_query = f"""
        INSERT DATA {{
            GRAPH <{TARGET_VIEW_GRAPH}> {{
                {" ".join(batch)}
            }}
        }}
        """

        run_sparql_update(
            insert_query
        )

    # --------------------------------------------------------
    # 7. Summary
    # --------------------------------------------------------

    print(
        "Affected-cluster TARGET visualization created."
    )

    print(
        "  Clusters:"
    )

    for cluster in affected_clusters:

        print(
            f"    {cluster['cluster_id']}"
        )

    print(
        f"  Resources : "
        f"{len(allowed_resources)}"
    )

    print(
        f"  Triples   : "
        f"{len(triples)}"
    )
    
def remove_migrates_to_from_relocated_devices(
    source_site_uri
):
    """
    Remove migratesTo only from Devices that originally
    belonged to the selected SOURCE Site.

    CURRENT is read only to identify the Devices.
    Only TARGET is modified.
    """

    query = f"""
    PREFIX sct: <{SCT}>

    SELECT DISTINCT ?device
    WHERE {{
        GRAPH <{CURRENT_GRAPH}> {{

            ?device
                a sct:Device ;
                sct:locatedAt
                <{source_site_uri}> .
        }}
    }}
    """

    devices = run_sparql(query)

    for row in devices:

        device_uri = row["device"]["value"]

        update = f"""
        PREFIX sct: <{SCT}>

        DELETE {{
            GRAPH <{TARGET_GRAPH}> {{

                <{device_uri}>
                    sct:migratesTo
                    ?replacement .
            }}
        }}
        WHERE {{
            GRAPH <{TARGET_GRAPH}> {{

                <{device_uri}>
                    sct:migratesTo
                    ?replacement .
            }}
        }}
        """

        run_sparql_update(update)

        print(
            "Removed obsolete migratesTo from TARGET: "
            f"{local_name(device_uri)}"
        )
        
def get_planned_graph_iri(
    source_site_id,
    destination_site_id,
    planned_index,
):
    """
    Generate a unique Planned graph IRI dynamically.

    Example:
        graph/planned/SITE-B-to-SITE-A/1
    """

    source_token = urllib.parse.quote(
        source_site_id,
        safe="-_",
    )

    destination_token = urllib.parse.quote(
        destination_site_id,
        safe="-_",
    )

    return (
        f"{PLANNED_GRAPH_BASE}/"
        f"{source_token}-to-{destination_token}/"
        f"{planned_index}"
    )


def get_planned_view_graph_iri(
    source_site_id,
    destination_site_id,
    planned_index,
):
    """
    Generate isolated Planned visualization graph IRI.
    """

    source_token = urllib.parse.quote(
        source_site_id,
        safe="-_",
    )

    destination_token = urllib.parse.quote(
        destination_site_id,
        safe="-_",
    )

    return (
        f"{PLANNED_VIEW_BASE}/"
        f"{source_token}-to-{destination_token}/"
        f"{planned_index}"
    )
    
def clone_graph(
    source_graph_iri,
    destination_graph_iri,
):
    """
    Create a fresh snapshot of one state graph into another.

    Examples:

        CURRENT
            -> Planned 1

        Planned 1
            -> Planned 2

        Final Planned
            -> TARGET

    The source graph is never modified.
    """

    update = f"""
    CLEAR SILENT GRAPH <{destination_graph_iri}>;

    COPY GRAPH <{source_graph_iri}>
    TO GRAPH <{destination_graph_iri}>
    """

    run_sparql_update(update)

    print(
        "Graph snapshot created:"
    )

    print(
        f"  FROM : {source_graph_iri}"
    )

    print(
        f"  TO   : {destination_graph_iri}"
    )
    
def relocate_one_device(
    graph_iri,
    device_uri,
    source_site_uri,
    destination_site_uri,
):
    """
    Relocate exactly one Device inside the supplied state graph.

    The Device identity remains unchanged.

    Only locatedAt changes:

        Device -> SOURCE

    becomes:

        Device -> DESTINATION

    Services, traversals, links and connectivity remain
    attached to the same Device.

    The source graph used to create this state is untouched.
    """

    update = f"""
    PREFIX sct: <{SCT}>

    DELETE {{
        GRAPH <{graph_iri}> {{

            <{device_uri}>
                sct:locatedAt
                <{source_site_uri}> .
        }}
    }}

    INSERT {{
        GRAPH <{graph_iri}> {{

            <{device_uri}>
                sct:locatedAt
                <{destination_site_uri}> .
        }}
    }}

    WHERE {{
        GRAPH <{graph_iri}> {{

            <{device_uri}>
                a sct:Device ;
                sct:locatedAt
                <{source_site_uri}> .
        }}
    }}
    """

    run_sparql_update(update)

    print(
        "Device relocated:"
    )

    print(
        f"  Device      : {local_name(device_uri)}"
    )

    print(
        f"  From Site   : {local_name(source_site_uri)}"
    )

    print(
        f"  To Site     : {local_name(destination_site_uri)}"
    )

    print(
        f"  State Graph : {graph_iri}"
    )
    
def get_source_devices(
    source_site_uri
):
    """
    Get all Devices currently located at the SOURCE Site.

    No Device IDs are hardcoded.

    Devices are ordered by IRI so migration order is
    deterministic and repeatable.
    """

    query = f"""
    PREFIX sct: <{SCT}>

    SELECT DISTINCT ?device
    WHERE {{
        GRAPH <{CURRENT_GRAPH}> {{

            ?device
                a sct:Device ;
                sct:locatedAt
                <{source_site_uri}> .
        }}
    }}
    ORDER BY ?device
    """

    rows = run_sparql(query)

    devices = []

    for row in rows:

        device_uri = (
            row["device"]["value"]
        )

        devices.append({
            "uri": device_uri,
            "device_id": local_name(
                device_uri
            )
        })

    return devices
def generate_multi_device_states(
    source,
    destination,
):
    """
    Generate pair-specific immutable Planned states for a
    SOURCE Site containing more than one Device.

    Example: 2 source Devices

        CURRENT
            |
            | user confirms
            v
        SCT_Planned_1
            |
            | user confirms
            v
        completed workflow in WORKING

    Example: 3 source Devices

        CURRENT
            |
            v
        SCT_Planned_1
            |
            v
        SCT_Planned_2
            |
            v
        completed workflow in WORKING

    Important:

    - CURRENT never changes.
    - Completed Planned states never change.
    - Planned states are pair-specific.
    - The final cumulative TARGET is created later,
      after all approved site-pair workflows complete.
    """

    # --------------------------------------------------------
    # Discover source Devices dynamically
    # --------------------------------------------------------

    source_devices = get_source_devices(
        source["uri"]
    )

    device_count = len(
        source_devices
    )

    if device_count <= 1:

        return {
            "completed": False,
            "reason": (
                "Multi-device workflow requires "
                "more than one source Device."
            ),
        }

    print()
    print("=" * 70)
    print("MULTI-DEVICE MIGRATION")
    print("=" * 70)

    print(
        f"SOURCE      : {source['site_id']}"
    )

    print(
        f"DESTINATION : {destination['site_id']}"
    )

    print(
        f"Devices     : {device_count}"
    )

    # --------------------------------------------------------
    # Pair-specific Planned history always begins from CURRENT.
    #
    # This is important:
    # another independent workflow must not appear inside this
    # workflow's Planned history.
    # --------------------------------------------------------

    previous_graph = CURRENT_GRAPH

    # --------------------------------------------------------
    # Create N - 1 Planned states
    # --------------------------------------------------------

    for index in range(
        1,
        device_count
    ):

        planned_graph = get_planned_graph_iri(
            source["site_id"],
            destination["site_id"],
            index,
        )

        device = source_devices[
            index - 1
        ]

        # ----------------------------------------------------
        # USER CONFIRMATION
        # ----------------------------------------------------

        approved = confirm_action(
            f"CREATE SCT_PLANNED_{index}",
            f"""
            Source Site      : {source['site_id']}
            Destination Site : {destination['site_id']}
            Device to move   : {device['device_id']}
            
            The backend will create:
            
            SCT_Planned_{index}
            
            The new Planned state will be a snapshot of the
            previous immutable state.
            
            Only this Device will be relocated:
            
            {device['device_id']}
            
            from:
            
            {source['site_id']}
            
            to:
            
            {destination['site_id']}
            
            CURRENT and previously completed Planned states
            will remain unchanged.
                        """
        )

        if not approved:

            print(
                f"SCT_Planned_{index} "
                "was not created."
            )

            return {
                "completed": False,
                "reason": (
                    f"Stopped before "
                    f"SCT_Planned_{index}"
                ),
            }

        # ----------------------------------------------------
        # Snapshot previous state
        # ----------------------------------------------------

        clone_graph(
            previous_graph,
            planned_graph,
        )

        # ----------------------------------------------------
        # Relocate exactly one Device
        # ----------------------------------------------------

        relocate_one_device(
            planned_graph,
            device["uri"],
            source["uri"],
            destination["uri"],
        )

        print()
        print(
            f"SCT_Planned_{index} completed."
        )

        print(
            f"Migrated Device: "
            f"{device['device_id']}"
        )

        # ----------------------------------------------------
        # Isolated Planned visualization
        # ----------------------------------------------------

        planned_view_graph = (
            get_planned_view_graph_iri(
                source["site_id"],
                destination["site_id"],
                index,
            )
        )

        planned_view_namespace = (
            get_planned_view_namespace(
                source["site_id"],
                destination["site_id"],
                index,
            )
        )

        create_planned_view_graph(
            planned_graph,
            planned_view_graph,
            planned_view_namespace,
            source["uri"],
            destination["uri"],
        )

        # ----------------------------------------------------
        # Create/update Saved Planned visualization
        # ----------------------------------------------------

        create_or_update_saved_planned_graph(
            planned_view_graph,
            source["site_id"],
            destination["site_id"],
            index,
        )

        # ----------------------------------------------------
        # Freeze this state.
        #
        # The next Planned state copies this graph,
        # but this graph itself is never modified again.
        # ----------------------------------------------------

        previous_graph = planned_graph

    # ========================================================
    # FINAL DEVICE
    # ========================================================

    final_device = (
        source_devices[-1]
    )

    approved = confirm_action(
        "PROCEED TO TARGET STATE",
        f"""
        Planned state generation for this workflow is complete.
        
        Source Site      : {source['site_id']}
        Destination Site : {destination['site_id']}
        
        Final remaining Device:
        
        {final_device['device_id']}
        
        If confirmed, the backend will complete this
        site-pair migration in the cumulative WORKING state.
        
        The final Device will be relocated from:
        
        {source['site_id']}
        
        to:
        
        {destination['site_id']}
        
        Completed Planned states will remain unchanged.
        
        The final cumulative TARGET will be created later,
        after every approved consolidation workflow has
        finished.
        """
    )

    if not approved:

        print(
            "Stopped after Planned state."
        )

        return {
            "completed": False,
            "reason": (
                "User stopped before final Device migration."
            ),
        }

    # ========================================================
    # APPLY COMPLETE WORKFLOW TO CUMULATIVE WORKING
    # ========================================================

    # WORKING may already contain completed migrations from
    # other site pairs.
    #
    # Therefore DO NOT overwrite WORKING with this pair's
    # Planned graph.
    #
    # Instead, apply every Device relocation for this pair
    # directly to the cumulative WORKING state.

    for device in source_devices:

        relocate_one_device(
            WORKING_GRAPH,
            device["uri"],
            source["uri"],
            destination["uri"],
        )

    print()
    print(
        "Multi-device workflow completed "
        "in cumulative WORKING state."
    )

    print(
        f"Final Device migrated: "
        f"{final_device['device_id']}"
    )

    return {
        "completed": True,
        "reason": "",
    }    
def get_planned_view_namespace(
    source_site_id,
    destination_site_id,
    planned_index,
):
    """
    Generate a unique namespace for one Planned visualization.

    Example:

        http://example.com/sct/planned-view/
        SITE-B-to-SITE-A/1/
    """

    source_token = urllib.parse.quote(
        source_site_id,
        safe="-_",
    )

    destination_token = urllib.parse.quote(
        destination_site_id,
        safe="-_",
    )

    return (
        f"{PLANNED_VIEW_NS_BASE}/"
        f"{source_token}-to-{destination_token}/"
        f"{planned_index}/"
    )


def create_planned_view_graph(
    planned_graph_iri,
    planned_view_graph_iri,
    planned_view_namespace,
    source_site_uri,
    destination_site_uri,
):
    """
    Create an isolated Planned visualization containing
    only the PlanningCluster affected by this workflow.

    The authoritative Planned graph remains unchanged.
    """

    # --------------------------------------------------------
    # Find affected cluster from authoritative Planned graph
    # --------------------------------------------------------

    affected_clusters = get_affected_clusters(
        planned_graph_iri,
        [
            source_site_uri,
            destination_site_uri,
        ],
    )

    if not affected_clusters:

        print(
            "No affected PlanningCluster found "
            "for Planned visualization."
        )
        return

    affected_cluster = affected_clusters[0]

    cluster_uri = affected_cluster["uri"]

    print(
        "Planned root cluster: "
        f"{affected_cluster['cluster_id']}"
    )

    # --------------------------------------------------------
    # Get only resources belonging to affected cluster
    # --------------------------------------------------------

    entities, relationships = (
        get_cluster_scoped_visual_data(
            planned_graph_iri,
            cluster_uri,
        )
    )

    # Collect IRIs that belong in this visualization
    allowed_resources = set()

    allowed_resources.add(
        cluster_uri
    )

    for row in entities:
        allowed_resources.add(
            row["entity"]["value"]
        )

    # --------------------------------------------------------
    # Clear old Planned-view graph
    # --------------------------------------------------------

    run_sparql_update(
        f"""
        CLEAR SILENT GRAPH <{planned_view_graph_iri}>
        """
    )

    # --------------------------------------------------------
    # Read complete properties for allowed resources
    # --------------------------------------------------------

    values = " ".join(
        f"<{iri}>"
        for iri in sorted(
            allowed_resources
        )
    )

    query = f"""
    SELECT ?s ?p ?o
    WHERE {{
        GRAPH <{planned_graph_iri}> {{

            VALUES ?s {{
                {values}
            }}

            ?s ?p ?o .
        }}
    }}
    """

    rows = run_sparql(query)

    rdf_type = (
        "http://www.w3.org/1999/02/22-rdf-syntax-ns#type"
    )

    triples = []

    for row in rows:

        subject_iri = row["s"]["value"]
        predicate_iri = row["p"]["value"]

        obj = row["o"]

        # Remap instance subject
        mapped_subject = (
            planned_view_namespace
            + local_name(
                subject_iri
            )
        )

        if obj["type"] == "uri":

            object_iri = obj["value"]

            # Keep rdf:type classes unchanged
            if predicate_iri == rdf_type:

                mapped_object = object_iri

            # Remap relationships only when target resource
            # belongs to affected cluster visualization
            elif object_iri in allowed_resources:

                mapped_object = (
                    planned_view_namespace
                    + local_name(
                        object_iri
                    )
                )

            else:
                # Ignore relationships leading outside
                # the affected visualization scope.
                continue

            object_value = (
                f"<{mapped_object}>"
            )

        else:

            literal = (
                obj["value"]
                .replace("\\", "\\\\")
                .replace('"', '\\"')
                .replace("\n", "\\n")
                .replace("\r", "\\r")
            )

            datatype = obj.get(
                "datatype"
            )

            language = obj.get(
                "xml:lang"
            )

            if datatype:

                object_value = (
                    f'"{literal}"'
                    f"^^<{datatype}>"
                )

            elif language:

                object_value = (
                    f'"{literal}"'
                    f"@{language}"
                )

            else:

                object_value = (
                    f'"{literal}"'
                )

        triples.append(
            f"<{mapped_subject}> "
            f"<{predicate_iri}> "
            f"{object_value} ."
        )

    # --------------------------------------------------------
    # Insert isolated visualization triples
    # --------------------------------------------------------

    batch_size = 500

    for start in range(
        0,
        len(triples),
        batch_size,
    ):

        batch = triples[
            start:start + batch_size
        ]

        update = f"""
        INSERT DATA {{
            GRAPH <{planned_view_graph_iri}> {{
                {" ".join(batch)}
            }}
        }}
        """

        run_sparql_update(
            update
        )

    print(
        "Affected-cluster Planned visualization created."
    )

    print(
        f"  Cluster : "
        f"{affected_cluster['cluster_id']}"
    )

    print(
        f"  Triples : {len(triples)}"
    )
    
def create_or_update_saved_planned_graph(
    planned_view_graph_iri,
    source_site_id,
    destination_site_id,
    planned_index,
):
    """
    Create or update the Saved Visual Graph for one Planned state.

    Important:
    - planned_view_graph_iri is already filtered to the
      affected PlanningCluster.
    - Do NOT rediscover/filter the cluster here.
    - This function only reads the prepared Planned-view graph
      and converts it into GraphDB Saved Visual Graph format.
    """

    # --------------------------------------------------------
    # Read entities from already cluster-scoped Planned view
    # --------------------------------------------------------

    entities = get_visual_entities_from_graph(
        planned_view_graph_iri
    )

    # --------------------------------------------------------
    # Read relationships from already cluster-scoped
    # Planned view
    # --------------------------------------------------------

    relationships = get_visual_topology_from_graph(
        planned_view_graph_iri
    )

    # --------------------------------------------------------
    # Build GraphDB Visual Graph state
    # --------------------------------------------------------

    graph_state = build_current_graph_state(
        entities,
        relationships
    )

    # --------------------------------------------------------
    # Dynamic Saved Graph name
    # --------------------------------------------------------

    saved_graph_name = (
        f"Site Consolidation - "
        f"{source_site_id} to "
        f"{destination_site_id} - "
        f"Planned {planned_index}"
    )

    # --------------------------------------------------------
    # Read existing Saved Graphs
    # --------------------------------------------------------

    response = requests.get(
        SAVED_GRAPH_URL,
        timeout=30
    )

    response.raise_for_status()

    saved_graphs = response.json()

    existing_graph = next(
        (
            graph
            for graph in saved_graphs
            if graph.get("name")
            == saved_graph_name
        ),
        None
    )

    # --------------------------------------------------------
    # Saved Graph payload
    # --------------------------------------------------------

    payload = {
        "name": saved_graph_name,
        "data": json.dumps(
            graph_state
        ),
        "shared": False,
        "config": "default"
    }

    # --------------------------------------------------------
    # UPDATE existing Saved Graph
    # --------------------------------------------------------

    if existing_graph:

        graph_id = existing_graph[
            "id"
        ]

        payload[
            "id"
        ] = graph_id

        response = requests.put(
            (
                f"{SAVED_GRAPH_URL}/"
                f"{graph_id}"
            ),
            json=payload,
            timeout=30
        )

        if response.status_code not in (
            200,
            204
        ):

            raise RuntimeError(
                "Unable to update "
                "Planned Saved Visual Graph: "
                f"HTTP "
                f"{response.status_code}: "
                f"{response.text}"
            )

        print(
            "Saved Visual Graph updated: "
            f"{saved_graph_name}"
        )

    # --------------------------------------------------------
    # CREATE new Saved Graph
    # --------------------------------------------------------

    else:

        response = requests.post(
            SAVED_GRAPH_URL,
            json=payload,
            timeout=30
        )

        if response.status_code not in (
            200,
            201
        ):

            raise RuntimeError(
                "Unable to create "
                "Planned Saved Visual Graph: "
                f"HTTP "
                f"{response.status_code}: "
                f"{response.text}"
            )

        print(
            "Saved Visual Graph created: "
            f"{saved_graph_name}"
        )

    # --------------------------------------------------------
    # Summary
    # --------------------------------------------------------

    print(
        f"Planned visual entities      : "
        f"{len(entities)}"
    )

    print(
        f"Planned visual relationships : "
        f"{len(relationships)}"
    )
        
def initialize_working_graph():
    """
    Create one cumulative working state from CURRENT.

    CURRENT remains immutable.

    All consolidation workflows in this execution
    progressively transform WORKING_GRAPH.
    """

    clone_graph(
        CURRENT_GRAPH,
        WORKING_GRAPH,
    )

    print(
        "Cumulative WORKING graph initialized from CURRENT."
    )
    
def finalize_cumulative_target(
    completed_workflows
):
    """
    Create the final cumulative TARGET after all
    consolidation workflows have completed.

    CURRENT and completed Planned graphs remain unchanged.
    """

    if not completed_workflows:
        print(
            "No completed workflows. "
            "TARGET was not created."
        )
        return

    # --------------------------------------------------------
    # 1. Copy cumulative WORKING state into TARGET
    # --------------------------------------------------------

    clone_graph(
        WORKING_GRAPH,
        TARGET_GRAPH,
    )

    # --------------------------------------------------------
    # 2. Remove obsolete migratesTo metadata only for
    #    Devices originally belonging to completed SOURCE Sites
    # --------------------------------------------------------

    for workflow in completed_workflows:

        source = workflow["source"]

        remove_migrates_to_from_relocated_devices(
            source["uri"]
        )

    # --------------------------------------------------------
    # 3. Remove every now-empty consolidated SOURCE Site
    #    from TARGET only
    # --------------------------------------------------------

    for workflow in completed_workflows:

        source = workflow["source"]

        remove_empty_source_site_from_target(
            source["uri"]
        )

    # --------------------------------------------------------
    # 4. Rebuild isolated Target visualization
    # --------------------------------------------------------

    create_target_view_graph(completed_workflows)

    # --------------------------------------------------------
    # 5. Refresh Saved Target Visual Graph
    # --------------------------------------------------------

    create_or_update_saved_target_graph()

    print()
    print("=" * 70)
    print("FINAL CUMULATIVE TARGET CREATED")
    print("=" * 70)

    for workflow in completed_workflows:

        print(
            f"{workflow['source']['site_id']} "
            f"-> "
            f"{workflow['destination']['site_id']}"
        )
        
def confirm_action(
    title,
    details,
):
    """
    Require explicit confirmation before creating or
    changing a derived topology state.

    Read-only business checks do not require confirmation.
    """

    print()
    print("=" * 70)
    print(title)
    print("=" * 70)
    print(details.strip())

    response = input(
        "\nPress Enter to continue "
        "(or type q to stop): "
    ).strip().lower()

    if response == "q":

        print(
            f"Stopped before: {title}"
        )

        return False

    return True
    
def get_site_devices_with_class(
    site_uri
):
    """
    Get all Devices at a Site with their device class.

    No Device IDs or class names are hardcoded.
    """

    query = f"""
    PREFIX sct: <{SCT}>

    SELECT DISTINCT
        ?device
        ?deviceClass
    WHERE {{
        GRAPH <{CURRENT_GRAPH}> {{

            ?device
                a sct:Device ;
                sct:locatedAt
                <{site_uri}> ;
                sct:class_name
                ?deviceClass .
        }}
    }}
    ORDER BY ?device
    """

    rows = run_sparql(query)

    devices = []

    for row in rows:

        device_uri = row["device"]["value"]

        devices.append({
            "uri":
                device_uri,

            "device_id":
                local_name(
                    device_uri
                ),

            "device_class":
                row[
                    "deviceClass"
                ][
                    "value"
                ],
        })

    return devices

def check_device_class_compatibility(
    source,
    destination,
):
    """
    BUSINESS CHECK 2

    Every Device class present at SOURCE must have at least
    one matching Device class at DESTINATION.

    Example:

        SOURCE:
            AggRouter
            CMTS

        DESTINATION:
            AggRouter
            CMTS

        Result:
            PASS

    If even one SOURCE Device class has no destination match,
    the complete site consolidation workflow fails.
    """

    source_devices = (
        get_site_devices_with_class(
            source["uri"]
        )
    )

    destination_devices = (
        get_site_devices_with_class(
            destination["uri"]
        )
    )

    results = []

    overall_pass = True

    for source_device in source_devices:

        matching_devices = [
            destination_device

            for destination_device
            in destination_devices

            if (
                destination_device[
                    "device_class"
                ]
                ==
                source_device[
                    "device_class"
                ]
            )
        ]

        passed = bool(
            matching_devices
        )

        if not passed:
            overall_pass = False

        results.append({
            "source_device":
                source_device,

            "matching_devices":
                matching_devices,

            "status":
                (
                    "PASS"
                    if passed
                    else "FAIL"
                ),
        })

    return {
        "status":
            (
                "PASS"
                if overall_pass
                else "FAIL"
            ),

        "results":
            results,
    }
    
def get_services_for_device(
    device_uri
):
    """
    Find Services traversing a Device and return
    the bandwidth associated with each Service.
    """

    query = f"""
    PREFIX sct: <{SCT}>

    SELECT DISTINCT
        ?service
        ?bandwidth
    WHERE {{
        GRAPH <{CURRENT_GRAPH}> {{

            ?service
                a sct:Service ;
                sct:traverses
                <{device_uri}> .

            OPTIONAL {{
                ?service
                    sct:bandwidth_mbps
                    ?bandwidth .
            }}
        }}
    }}
    ORDER BY ?service
    """

    rows = run_sparql(query)

    services = []

    for row in rows:

        service_uri = (
            row["service"]["value"]
        )

        bandwidth = (
            float(
                row["bandwidth"]["value"]
            )
            if "bandwidth" in row
            else 0.0
        )

        services.append({
            "uri":
                service_uri,

            "service_id":
                local_name(
                    service_uri
                ),

            "bandwidth_mbps":
                bandwidth,
        })

    return services

def get_device_bandwidth_capacity(
    device_uri
):
    """
    Read a Device's current bandwidth and maximum capacity.
    """

    query = f"""
    PREFIX sct: <{SCT}>

    SELECT
        ?bandwidth
        ?capacity
    WHERE {{
        GRAPH <{CURRENT_GRAPH}> {{

            <{device_uri}>
                a sct:Device ;
                sct:bandwidth_mbps
                ?bandwidth ;
                sct:capacity_mbps
                ?capacity .
        }}
    }}
    """

    rows = run_sparql(query)

    if not rows:

        return None

    return {
        "bandwidth_mbps":
            float(
                rows[0][
                    "bandwidth"
                ][
                    "value"
                ]
            ),

        "capacity_mbps":
            float(
                rows[0][
                    "capacity"
                ][
                    "value"
                ]
            ),
    }

def check_capacity_compatibility(
    class_check
):
    """
    BUSINESS CHECK 3

    For every SOURCE Device:

    1. Find Services traversing SOURCE Device.
    2. Sum migrating Service bandwidth.
    3. Use the same-class destination Device found
       during Business Check 2.
    4. Calculate:

       projected bandwidth =
           destination current bandwidth
           + migrating bandwidth

       projected utilization =
           projected bandwidth
           / destination capacity
           * 100

    5. PASS only when projected utilization < 70%.
    """

    results = []

    overall_pass = True

    for class_result in class_check[
        "results"
    ]:

        source_device = (
            class_result[
                "source_device"
            ]
        )

        matching_devices = (
            class_result[
                "matching_devices"
            ]
        )

        if not matching_devices:

            overall_pass = False

            results.append({
                "source_device":
                    source_device,

                "destination_device":
                    None,

                "status":
                    "FAIL",

                "reason":
                    "NO_SAME_CLASS_DESTINATION",
            })

            continue

        # For now take first same-class destination Device.
        # Later, if several matches exist, we can choose
        # the one with lowest projected utilization.
        destination_device = (
            matching_devices[0]
        )

        services = get_services_for_device(
            source_device["uri"]
        )

        migrating_bandwidth = sum(
            service[
                "bandwidth_mbps"
            ]
            for service in services
        )

        destination_capacity = (
            get_device_bandwidth_capacity(
                destination_device[
                    "uri"
                ]
            )
        )

        if not destination_capacity:

            overall_pass = False

            results.append({
                "source_device":
                    source_device,

                "destination_device":
                    destination_device,

                "services":
                    services,

                "status":
                    "FAIL",

                "reason":
                    "DESTINATION_CAPACITY_DATA_MISSING",
            })

            continue

        current_bandwidth = (
            destination_capacity[
                "bandwidth_mbps"
            ]
        )

        capacity = (
            destination_capacity[
                "capacity_mbps"
            ]
        )

        if capacity <= 0:

            overall_pass = False

            results.append({
                "source_device":
                    source_device,

                "destination_device":
                    destination_device,

                "services":
                    services,

                "status":
                    "FAIL",

                "reason":
                    "INVALID_DESTINATION_CAPACITY",
            })

            continue

        projected_bandwidth = (
            current_bandwidth
            + migrating_bandwidth
        )

        projected_utilization = (
            projected_bandwidth
            / capacity
            * 100.0
        )

        passed = (
            projected_utilization
            <
            UTILIZATION_THRESHOLD_PERCENT
        )

        if not passed:
            overall_pass = False

        results.append({
            "source_device":
                source_device,

            "destination_device":
                destination_device,

            "services":
                services,

            "current_bandwidth_mbps":
                current_bandwidth,

            "migrating_bandwidth_mbps":
                migrating_bandwidth,

            "projected_bandwidth_mbps":
                projected_bandwidth,

            "capacity_mbps":
                capacity,

            "projected_utilization_percent":
                projected_utilization,

            "status":
                (
                    "PASS"
                    if passed
                    else "FAIL"
                ),

            "reason":
                (
                    ""
                    if passed
                    else "PROJECTED_UTILIZATION_THRESHOLD_EXCEEDED"
                ),
        })

    return {
        "status":
            (
                "PASS"
                if overall_pass
                else "FAIL"
            ),

        "results":
            results,
    }  
    
def get_affected_clusters(
    graph_iri,
    site_uris,
):
    """
    Find PlanningCluster(s) associated with the supplied Sites.

    No cluster ID is hardcoded.
    """

    if not site_uris:
        return []

    values = " ".join(
        f"<{site_uri}>"
        for site_uri in site_uris
    )

    query = f"""
    PREFIX sct: <{SCT}>

    SELECT DISTINCT ?cluster
    WHERE {{
        GRAPH <{graph_iri}> {{

            VALUES ?site {{
                {values}
            }}

            ?site
                sct:assignedTo
                ?cluster .

            ?cluster
                a sct:PlanningCluster .
        }}
    }}
    ORDER BY ?cluster
    """

    rows = run_sparql(query)

    return [
        {
            "uri": row["cluster"]["value"],
            "cluster_id": local_name(
                row["cluster"]["value"]
            ),
        }
        for row in rows
    ]
    
def get_cluster_visual_scope(
    graph_iri,
    cluster_uri,
):
    """
    Return all Sites, Devices and Services belonging to
    one affected PlanningCluster in the supplied state graph.

    Used only for visualization filtering.
    """

    query = f"""
    PREFIX sct: <{SCT}>

    SELECT DISTINCT
        ?site
        ?device
        ?service
    WHERE {{
        GRAPH <{graph_iri}> {{

            # Sites belonging to affected cluster
            ?site
                a sct:Site ;
                sct:assignedTo
                <{cluster_uri}> .

            # Devices located at those Sites
            OPTIONAL {{
                ?device
                    a sct:Device ;
                    sct:locatedAt
                    ?site .

                # Services traversing those Devices
                OPTIONAL {{
                    ?service
                        a sct:Service ;
                        sct:traverses
                        ?device .
                }}
            }}
        }}
    }}
    """

    return run_sparql(query)
    
def get_cluster_scoped_visual_data(
    graph_iri,
    cluster_uri,
):
    """
    Build visualization data only for one affected cluster.

    Includes:
        PlanningCluster
        Sites assigned to that cluster
        Devices located at those Sites
        Services traversing those Devices

    Relationships:
        assignedTo
        locatedAt
        connects
        traverses

    The authoritative graph is NOT modified.
    """

    entity_query = f"""
    PREFIX sct: <{SCT}>

    SELECT DISTINCT
        ?entity
        ?entityType
    WHERE {{
        GRAPH <{graph_iri}> {{

            {{
                BIND(
                    <{cluster_uri}>
                    AS ?entity
                )

                BIND(
                    sct:PlanningCluster
                    AS ?entityType
                )
            }}

            UNION

            {{
                ?entity
                    a sct:Site ;
                    sct:assignedTo
                    <{cluster_uri}> .

                BIND(
                    sct:Site
                    AS ?entityType
                )
            }}

            UNION

            {{
                ?site
                    a sct:Site ;
                    sct:assignedTo
                    <{cluster_uri}> .

                ?entity
                    a sct:Device ;
                    sct:locatedAt
                    ?site .

                BIND(
                    sct:Device
                    AS ?entityType
                )
            }}

            UNION

            {{
                ?site
                    a sct:Site ;
                    sct:assignedTo
                    <{cluster_uri}> .

                ?device
                    a sct:Device ;
                    sct:locatedAt
                    ?site .

                ?entity
                    a sct:Service ;
                    sct:traverses
                    ?device .

                BIND(
                    sct:Service
                    AS ?entityType
                )
            }}
        }}
    }}
    ORDER BY ?entityType ?entity
    """

    relationship_query = f"""
    PREFIX sct: <{SCT}>

    SELECT DISTINCT
        ?source
        ?predicate
        ?target
    WHERE {{
        GRAPH <{graph_iri}> {{

            # Site -> affected Cluster
            {{
                ?source
                    a sct:Site ;
                    sct:assignedTo
                    <{cluster_uri}> .

                BIND(
                    sct:assignedTo
                    AS ?predicate
                )

                BIND(
                    <{cluster_uri}>
                    AS ?target
                )
            }}

            UNION

            # Device -> Site
            {{
                ?target
                    a sct:Site ;
                    sct:assignedTo
                    <{cluster_uri}> .

                ?source
                    a sct:Device ;
                    sct:locatedAt
                    ?target .

                BIND(
                    sct:locatedAt
                    AS ?predicate
                )
            }}

            UNION

            # Device -> Device, both inside affected Cluster
            {{
                ?source
                    a sct:Device ;
                    sct:locatedAt
                    ?sourceSite ;
                    sct:connects
                    ?target .

                ?sourceSite
                    sct:assignedTo
                    <{cluster_uri}> .

                ?target
                    a sct:Device ;
                    sct:locatedAt
                    ?targetSite .

                ?targetSite
                    sct:assignedTo
                    <{cluster_uri}> .

                BIND(
                    sct:connects
                    AS ?predicate
                )
            }}

            UNION

            # Service -> Device inside affected Cluster
            {{
                ?target
                    a sct:Device ;
                    sct:locatedAt
                    ?site .

                ?site
                    sct:assignedTo
                    <{cluster_uri}> .

                ?source
                    a sct:Service ;
                    sct:traverses
                    ?target .

                BIND(
                    sct:traverses
                    AS ?predicate
                )
            }}
        }}
    }}
    ORDER BY ?source ?predicate ?target
    """

    entities = run_sparql(
        entity_query
    )

    relationships = run_sparql(
        relationship_query
    )

    return (
        entities,
        relationships,
    )
    
def get_target_affected_clusters(
    completed_workflows
):
    """
    Find unique PlanningClusters affected by all
    successfully completed consolidation workflows.

    The cluster information is discovered dynamically
    from CURRENT.

    No Site IDs or Cluster IDs are hardcoded.
    """

    clusters = {}

    for workflow in completed_workflows:

        source = workflow["source"]
        destination = workflow["destination"]

        workflow_clusters = get_affected_clusters(
            CURRENT_GRAPH,
            [
                source["uri"],
                destination["uri"],
            ],
        )

        for cluster in workflow_clusters:

            clusters[
                cluster["uri"]
            ] = cluster

    return list(
        clusters.values()
    )  
# ============================================================
# MAIN
# ============================================================

def main():

    print("=" * 70)

    print(
        "SITE CONSOLIDATION - "
        "CURRENT DIGITAL TWIN"
    )

    print("=" * 70)

    print(
        f"\nRepository    : "
        f"{REPOSITORY}"
    )

    print(
        f"Current graph : "
        f"{CURRENT_GRAPH}"
    )

    # --------------------------------------------------------
    # CURRENT SAVED VISUALIZATION
    # --------------------------------------------------------

    entities = (
        get_current_visual_entities()
    )

    relationships = (
        get_current_visual_topology()
    )

    print_summary(
        entities,
        relationships
    )

    graph_state = (
        build_current_graph_state(
            entities,
            relationships
        )
    )

    create_or_update_saved_current_graph(
        graph_state
    )

    print(
        "\nTotal visual entities      : "
        f"{len(entities)}"
    )

    print(
        "Total visual relationships : "
        f"{len(relationships)}"
    )

    print(
        "\nCURRENT graph was read only."
    )

    print(
        "No RDF data was modified."
    )
    
    # --------------------------------------------------------
    # Initialize cumulative migration state ONCE
    # --------------------------------------------------------

    initialize_working_graph()

    eligible_pairs = (
        find_distance_eligible_pairs()
    )

    # --------------------------------------------------------
    # DISTANCE CHECK
    # --------------------------------------------------------

    eligible_pairs = (
        find_distance_eligible_pairs()
    )

    print(
        "\nELIGIBLE SITE PAIRS "
        f"(< {DISTANCE_THRESHOLD_KM} km)"
    )

    print("=" * 70)

    if not eligible_pairs:

        print(
            "No Site pairs passed "
            "the distance check."
        )

        return
        
    # --------------------------------------------------------
    # Track every consolidation workflow completed
    # during this execution.
    # --------------------------------------------------------

    completed_workflows = []

    for pair in eligible_pairs:

        site_a = (
            pair["site_a"]
        )

        site_b = (
            pair["site_b"]
        )

        count_a = (
            get_site_device_count(
                site_a["uri"]
            )
        )

        count_b = (
            get_site_device_count(
                site_b["uri"]
            )
        )

        decision = (
            determine_source_destination(
                site_a,
                count_a,
                site_b,
                count_b
            )
        )

        print()
        print("-" * 70)

        print(
            f"{site_a['site_id']} "
            f"<-> "
            f"{site_b['site_id']}"
        )

        print(
            f"Distance : "
            f"{pair['distance_km']:.2f} km"
        )

        print(
            f"{site_a['site_id']} "
            f"Devices : "
            f"{count_a}"
        )

        print(
            f"{site_b['site_id']} "
            f"Devices : "
            f"{count_b}"
        )

        print(
            "Distance Business Check : PASS"
        )

        if (
            decision["status"]
            ==
            "PASS"
        ):

            source = (
                decision["source"]
            )

            destination = (
                decision[
                    "destination"
                ]
            )

            source_device_count = (
                decision[
                    "source_device_count"
                ]
            )

            sequence = (
                get_state_sequence(
                    source_device_count
                )
            )

            print(
                f"SOURCE      : "
                f"{source['site_id']}"
            )

            print(
                f"DESTINATION : "
                f"{destination['site_id']}"
            )

            print(
                f"Source Device count : "
                f"{source_device_count}"
            )

            print(
                "Migration states : "
                + " -> ".join(
                    sequence
                )
            )
            
            # ------------------------------------------------
            # BUSINESS CHECK 2
            # Same Device class must exist at DESTINATION
            # ------------------------------------------------

            class_check = (
                check_device_class_compatibility(
                    source,
                    destination,
                )
            )

            print()
            print(
                "BUSINESS CHECK 2 - DEVICE CLASS"
            )

            print("=" * 70)

            for result in class_check[
                "results"
            ]:

                source_device = (
                    result[
                        "source_device"
                    ]
                )

                print(
                    f"Source Device : "
                    f"{source_device['device_id']}"
                )

                print(
                    f"Device Class  : "
                    f"{source_device['device_class']}"
                )

                if result[
                    "matching_devices"
                ]:

                    for match in result[
                        "matching_devices"
                    ]:

                        print(
                            f"Destination Match : "
                            f"{match['device_id']}"
                        )

                else:

                    print(
                        "Destination Match : NONE"
                    )

                print(
                    f"Result        : "
                    f"{result['status']}"
                )

                print()

            print(
                f"Business Check 2 Overall : "
                f"{class_check['status']}"
            )

            # Stop this pair before any confirmation/state creation
            if class_check[
                "status"
            ] != "PASS":

                print(
                      "Site consolidation blocked. "
                    "Required Device class is not "
                    "available at destination."
                )

                continue
                
            # ------------------------------------------------
            # BUSINESS CHECK 3
            # Destination capacity / projected utilization
            # ------------------------------------------------

            capacity_check = (
                check_capacity_compatibility(
                    class_check
                )
            )

            print()
            print(
                "BUSINESS CHECK 3 - DEVICE CAPACITY"
            )

            print("=" * 70)

            for result in capacity_check[
                "results"
            ]:

                source_device = (
                    result[
                        "source_device"
                    ]
                )

                destination_device = (
                    result.get(
                        "destination_device"
                    )
                )

                print(
                    f"Source Device      : "
                    f"{source_device['device_id']}"
                )

                if destination_device:

                    print(
                        f"Destination Device : "
                        f"{destination_device['device_id']}"
                    )

                if (
                    "projected_utilization_percent"
                    in result
                ):

                    print(
                        f"Destination BW     : "
                        f"{result['current_bandwidth_mbps']:.0f} Mbps"
                    )

                    print(
                        f"Migrating BW       : "
                        f"{result['migrating_bandwidth_mbps']:.0f} Mbps"
                    )

                    print(
                        f"Projected BW       : "
                        f"{result['projected_bandwidth_mbps']:.0f} Mbps"
                    )

                    print(
                        f"Capacity           : "
                        f"{result['capacity_mbps']:.0f} Mbps"
                    )

                    print(
                        f"Projected Util.    : "
                        f"{result['projected_utilization_percent']:.2f}%"
                    )

                print(
                    f"Result             : "
                    f"{result['status']}"
                )

                if result.get("reason"):

                    print(
                        f"Reason             : "
                        f"{result['reason']}"
                    )

                print()

            print(
                f"Business Check 3 Overall : "
                f"{capacity_check['status']}"
            )

            if capacity_check[
                "status"
            ] != "PASS":

                print(
                    "Site consolidation blocked."
                )

                print(
                    "Reason: Destination Device "
                    "capacity check failed."
                )

                continue
            # ------------------------------------------------
            # DIRECT CURRENT -> TARGET
            # Only when SOURCE has exactly 1 Device
            # ------------------------------------------------

            if source_device_count == 1:

                print(
                    "\nDirect migration workflow detected:"
                )

                print(
                    "CURRENT -> TARGET"
                )

                approved = confirm_action(
                    "PROCEED TO TARGET STATE",
                    f"""
                    Source Site      : {source['site_id']}
                    Destination Site : {destination['site_id']}
                    Source Devices   : {source_device_count}
                    
                    No Planned state is required because the
                    SOURCE Site has only one Device.
                    
                    If confirmed, the backend will relocate the
                    Device from SOURCE to DESTINATION.
                    
                    CURRENT will remain unchanged.
                    
                    Transition:
                    
                    CURRENT -> TARGET
                                        """
                )

                if not approved:

                    print(
                        "Target migration not executed."
                    )

                    continue

                source_devices = get_source_devices(
                    source["uri"]
                )

                for device in source_devices:

                    relocate_one_device(
                        WORKING_GRAPH,
                        device["uri"],
                        source["uri"],
                        destination["uri"],
                    )

                print(
                    "Direct migration applied "
                    "to cumulative WORKING state."
                )

            elif source_device_count > 1:

                  print(
                      "\nMulti-device migration workflow detected:"
                  )
  
                  print(
                      " -> ".join(
                          sequence
                      )
                  )
  
                  result = generate_multi_device_states(
                      source,
                      destination,
                  )
  
                  if not result["completed"]:
  
                      print(
                          result["reason"]
                      )

                      continue
            # ------------------------------------------------
            # Record completed workflow
            # ------------------------------------------------

            completed_workflows.append({
                "source": source,
                "destination": destination,
            })
            dependencies = (
                get_source_device_dependencies(
                    source["uri"]
                )
            )

            print(
                "\nMigration dependencies:"
            )

            seen = set()

            for row in dependencies:

                device_id = local_name(
                    row["device"]["value"]
                )

                service_id = (
                    local_name(
                        row["service"]["value"]
                    )
                    if "service" in row
                    else "NONE"
                )

                neighbor_id = (
                    local_name(
                        row["neighbor"]["value"]
                    )
                    if "neighbor" in row
                    else "NONE"
                )

                neighbor_site = (
                    local_name(
                        row["neighborSite"]["value"]
                    )
                    if "neighborSite" in row
                    else "NONE"
                )

                item = (
                    device_id,
                    service_id,
                    neighbor_id,
                    neighbor_site,
                )

                if item in seen:
                    continue

                seen.add(item)

                print(
                    f"  Device={device_id}"
                    f" | Service={service_id}"
                    f" | Neighbor={neighbor_id}"
                    f" | NeighborSite={neighbor_site}"
                )

        else:

            print(
                "Decision : MANUAL_REVIEW"
            )

            print(
                "Reason   : "
                "Both Sites contain "
                "the same number of Devices."
            )

    # --------------------------------------------------------
    # FINALIZE CUMULATIVE TARGET
    # Run ONCE after every eligible workflow has completed
    # --------------------------------------------------------

    finalize_cumulative_target(
        completed_workflows
    )

if __name__ == "__main__":
    main()