#!/usr/bin/env python3
"""What-if analysis on the digital twin's GraphDB graph.

    CURRENT graph  = the GraphDB graph `.../graph/current`: the network plus the live readings that arrive in it (one ran:Observation per reading). The script
                     takes the network from it and, for every series, the newest reading: the loads the twin shows right now. Nothing is read from a file or a database.
    scenario       = a JSON file: traffic surges and network changes, applied in order
    TARGET graph   = the network as it would look afterwards, written to GraphDB as the graph `.../graph/target` (replaced on every run: it is derived)
    TARGET-VIEW    = a saved SPARQL query in GraphDB (Workbench > SPARQL > Saved queries, name `target-view`) that joins `current` and `target`:
                     per element and KPI, the current value, the target value and the change. Installed or refreshed by every run (or with --install-view alone).

The graphs of the repository are: ontology (schema), current, target, and that saved query. The report of current against target is printed too.

The analysis is done by the application's own engine (backend/dtwin: the twin loader, `Working`, `apply_intent`, the ML what-if model, the CU/DU
demand model of the simulator), so the answer is the same one the application would give. Nothing the application owns is ever modified: the script
refuses to write into `current` or `ontology`, and it never touches the live twin or the running backend (it only reads the current graph).

Usage
    python scripts/graphdb_whatif.py scripts/whatif_scenario.example.json --dry-run     # analysis only: print the report, write nothing
    python scripts/graphdb_whatif.py my_scenario.json                                    # ... and write the target graph into GraphDB (and refresh the target-view query)
    python scripts/graphdb_whatif.py my_scenario.json --out target.ttl --no-load         # ... or only into a Turtle file
    python scripts/graphdb_whatif.py --install-view                                      # only (re)install the saved query

Scenario file
    {"name": "ocu229-evening-surge",
     "steps": [
       {"surge":  {"entities": ["OCU229"], "factor": 1.3}},
       {"action": {"kind": "SCALE_UP", "elements": [{"id": "OCU229_CP", "to_cores": 24}, {"id": "OCU229_UP", "to_cores": 24}]}},
       {"action": {"kind": "REHOME_F1", "du": "DU913", "from_cu": "OCU229", "to_cu": "OCU230"}}
     ]}
    surge   entities: DU, cell, CU or CU plane ids (a CU or plane is surged through the DUs it serves, a DU also loads its cells, as in a real network);
            factor: 1.3 = +30 % traffic. The CUs then follow the traffic their DUs carry (a saturated DU carries no more; the control plane also sees retries).
    action  kinds: STEER {source_cell, target_cell, fraction} | SCALE_UP / SCALE_DOWN {elements: [{id, to_cores}]} |
            SCALE_OUT {source, new_id, host, cores, move_cells} | REHOME_F1 {du, from_cu, to_cu}

What is in the target graph: the current network (structure copied from `generated`, changed where the scenario changes it: cores, re-homed DUs, new
instances) plus the projected KPIs of every element (cpu / load / users / throughput / p5 / latency ...) after the scenario. A small description of
the scenario and of where the loads came from is attached to the graph IRI itself.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))


def _load_dotenv() -> None:
    """The application reads its settings from the environment; the shell scripts source `.env`. Do the same here (values already set win)."""
    f = ROOT / ".env"
    if not f.exists():
        return
    for line in f.read_text().splitlines():
        m = re.match(r"^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$", line)
        if m and not line.lstrip().startswith("#"):
            v = re.sub(r"\s+#.*$", "", m.group(2)).strip().strip('"').strip("'")
            os.environ.setdefault(m.group(1), v)


if __name__ == "__main__":      # only when run as a script: importing this file (tests) must not change the environment
    _load_dotenv()

import requests                                      # noqa: E402
from rdflib import RDF, RDFS, XSD, Graph, Literal, URIRef  # noqa: E402

from dtwin.actions.kpi import Working, diff_states   # noqa: E402
from dtwin.actions.ops import apply_intent           # noqa: E402
from dtwin.config import get_settings                # noqa: E402
from dtwin.ml import world                           # noqa: E402
from dtwin.ml.service import MLService               # noqa: E402
from dtwin.telemetry.model import ORIGIN             # noqa: E402
from dtwin.telemetry.service import METRIC_ATTR      # noqa: E402
from dtwin.telemetry.simulator import demand_units   # noqa: E402
from dtwin.twin.loader import ATTR_MAP, RdfGraphTripleSource, build_state  # noqa: E402
from dtwin.twin.state import CELL, CU, CUCP, CUUP, DU, F1, LINK, HOST, TwinState  # noqa: E402

SUPPORTED = {"STEER", "SCALE_UP", "SCALE_DOWN", "SCALE_OUT", "REHOME_F1"}
KPI = {"cpu_percent": "cpuPercent", "load_percent": "loadPercent", "users": "activeUsers", "throughput_mbps": "throughputMbps",
       "p5_throughput_mbps": "p5ThroughputMbps", "latency_ms": "latencyMs", "session_load_percent": "sessionLoadPercent",
       "ho_failure_pct": "handoverFailureRate", "ping_pong_pct": "pingPongRate", "utilisation_percent": "utilisationPercent"}
INTEGER_ATTRS = {"users", "allocated_cores", "total_cores", "licensed_cores"}
# attribute -> predicate(s) for the structural attributes a scenario can change; (kind, attr) -> [predicates]; "<hasCell" = the reverse edge DU -> Cell
RELATIONS = {(DU, "host"): ["hostedOn"], (DU, "site"): ["locatedAt"], (DU, "cu"): ["connectsToCUCP"], (DU, "ru"): ["connectsTo"],
             (F1, "du"): ["actionSource", "f1Du"], (F1, "cu"): ["actionTarget", "f1Cu"], (F1, "path"): ["viaLink"],
             (CU, "host"): ["hostedOn"], (CU, "site"): ["locatedAt"], (CU, "cp"): ["hasCUCP"], (CU, "up"): ["hasCUUP"],
             (CUCP, "cu"): ["partOfCU"], (CUUP, "cu"): ["partOfCU"], (CUCP, "host"): ["hostedOn"], (CUUP, "host"): ["hostedOn"],
             (CUCP, "site"): ["locatedAt"], (CUUP, "site"): ["locatedAt"], (HOST, "site"): ["locatedAt"], (CELL, "du"): ["<hasCell"]}
INV_ATTR = {}
for _p, _a in ATTR_MAP.items():
    INV_ATTR.setdefault(_a, []).append(_p)
INTERNAL = {"synthetic_entity", "hold_minutes_remaining", "cu_derived", "neighbours_graph", "overlaps", "cp_instances", "up_instances", "plane", "legacy", "notes", "spare", "role"}
APP_GRAPHS_SUFFIX = ("current", "ontology", "generated", "simulation", "decisions", "ontology-ext", "telemetry")      # never a what-if output (the old names stay protected too)


def die(msg: str) -> "None":
    sys.exit(f"graphdb_whatif: {msg}")


# ------------------------------------------------------------------------------------------------------------------ reading the current state
def read_graph(s, graph_iri: str) -> Graph:
    """The network of a graph, as N-Triples. The live readings (subjects under ``ran:obs/``) that share the current graph are left out: only the network is wanted."""
    q = f'CONSTRUCT {{ ?s ?p ?o }} WHERE {{ GRAPH <{graph_iri}> {{ ?s ?p ?o . FILTER(!STRSTARTS(STR(?s), "{s.obs_prefix}")) }} }}'
    r = requests.post(f"{s.graphdb_url}/repositories/{s.graphdb_repository}", data={"query": q}, headers={"Accept": "application/n-triples"},
                      auth=(s.graphdb_user, s.graphdb_password) if s.graphdb_user else None, timeout=(30, 3600))
    if r.status_code == 404:
        die(f"repository {s.graphdb_repository!r} not found at {s.graphdb_url}")
    if r.status_code >= 400:
        die(f"GraphDB export of <{graph_iri}> failed: HTTP {r.status_code} {r.text[:200]}")
    g = Graph()
    g.parse(data=r.text, format="nt")
    if not len(g):
        die(f"graph <{graph_iri}> holds no network (empty or missing) in repository {s.graphdb_repository!r}; start the backend once, or run scripts/seed.py")
    return g


LATEST_PER_SERIES = """PREFIX ran: <{ns}>
PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>
SELECT ?e ?m ?v WHERE {{ GRAPH <{graph}> {{
  {{ SELECT ?e ?m (MAX(?t0) AS ?t) WHERE {{ ?o0 a ran:Observation ; ran:observes ?e ; ran:metric ?m ; ran:observedAt ?t0 . FILTER(?t0 >= "{cut}"^^xsd:dateTime) }} GROUP BY ?e ?m }}
  ?o a ran:Observation ; ran:observes ?e ; ran:metric ?m ; ran:observedAt ?t ; ran:value ?v . }} }}"""
HEAD_OF_STREAM = "PREFIX ran: <{ns}> SELECT (MAX(?t) AS ?h) WHERE {{ GRAPH <{graph}> {{ ?o a ran:Observation ; ran:observedAt ?t }} }}"


def overlay_loads(state: TwinState, s, source: str) -> dict:
    """Put the loads on the twin: what the application shows right now = the NEWEST telemetry reading of each series (same rule as TelemetryService.overlay),
    read from the GraphDB telemetry graph."""
    if source == "generated":
        from dtwin.gen.build import generate
        from dtwin.gen.profile import default_profile
        rows = [(x.entity, x.metric, x.value) for x in generate(default_profile(s)).snapshot()]
        info = {"source": "generated busy-hour snapshot (no noise)", "series": len(rows)}
    else:
        from dtwin.graphdb.client import GraphDBClient
        from dtwin.telemetry.model import parse_ts
        client = GraphDBClient(s)
        try:
            h = client.select(HEAD_OF_STREAM.format(ns=s.ran_ns, graph=s.current_graph))
        except Exception as e:
            die(f"cannot read the live readings in <{s.current_graph}>: {e}")
        head_s = (h[0].get("h") or {}).get("value") if h else None
        if not head_s:
            die(f"<{s.current_graph}> holds no live readings yet; start the simulator (it feeds GraphDB through Kafka), or use --loads generated")
        head = parse_ts(head_s)
        cut = datetime.fromtimestamp(head - float(s.telemetry_max_age_s), timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        try:
            got = client.select(LATEST_PER_SERIES.format(ns=s.ran_ns, graph=s.current_graph, cut=cut))
        except Exception as e:
            die(f"reading the newest readings from <{s.current_graph}> failed: {e}")
        rows = []
        for r in got:
            try:
                e = r["e"]["value"]
                rows.append((e[len(s.ran_ns):] if e.startswith(s.ran_ns) else e, r["m"]["value"], float(r["v"]["value"])))
            except (KeyError, ValueError):
                continue
        info = {"source": f"newest live readings in the GraphDB graph <{s.current_graph}>", "as_of": datetime.fromtimestamp(head, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "series": len(rows)}
    n = 0
    for e, m, v in rows:
        node = state.nodes.get(e)
        if node is None or m not in KPI and METRIC_ATTR.get(m, m) not in KPI:
            continue
        attr = METRIC_ATTR.get(m, m)
        node.set(attr, round(v) if attr == "users" else round(v, 3), ORIGIN)
        n += 1
    info["applied"] = n
    return info


# ------------------------------------------------------------------------------------------------------------------ the what-if
def reach(state: TwinState, entities: list[str]) -> tuple[set[str], set[str]]:
    """The DUs and cells a surge on these entities loads: CU / plane -> the DUs it serves -> their cells; DU -> its cells; cell -> itself."""
    dus: set[str] = set()
    cells: set[str] = set()
    for e in entities:
        n = state.get(e)
        if n is None:
            die(f"surge entity {e!r} is not in the graph")
        cu_id = e if n.kind == CU else (n.get("cu") if n.kind in (CUCP, CUUP) else None)
        if cu_id:
            dus |= {d.id for d in state.dus_of_cu(cu_id)}
        elif n.kind == DU:
            dus.add(n.id)
        elif n.kind == CELL:
            cells.add(n.id)
        else:
            die(f"surge entity {e!r} is a {n.kind}; use a DU, cell, CU or CU plane")
    for d in dus:
        cells |= {c.id for c in state.cells_of(d)}
    return dus, cells


def apply_surge(w: Working, entities: list[str], factor: float) -> dict:
    """Traffic enters at the radio edge and travels up: DU demand and cell load rise, then each CU plane follows the traffic its DUs carry (see telemetry/simulator.py)."""
    st = w.s
    dus, cells = reach(st, entities)
    cpu0 = {d: float(st.get(d).get("cpu_percent") or 0.0) for d in dus}
    for d in dus:
        w.demand[d] = w.demand.get(d, 0.0) * factor
        w.dirty.add(d)
    for c in cells:
        n = st.get(c)
        for f in ("load_percent", "users"):
            if n.get(f) is not None:
                n.set(f, min(99.9, n.get(f) * factor) if f == "load_percent" else n.get(f) * factor, "simulated")
    w.finalize()                                                  # DUs first: what each DU really carries (saturates at 100 %)
    cus = {st.get(d).get("cu") for d in dus if st.get(d).get("cu")}
    for cu_id in sorted(cus):
        served = [d.id for d in st.dus_of_cu(cu_id)]
        base = sum(float((w.before.get(d).get("cpu_percent") or 0.0)) for d in served)
        if base <= 0:
            continue
        carried = sum(float(st.get(d).get("cpu_percent") or 0.0) for d in served)               # user plane: carried traffic
        cp_units = sum(demand_units(CUCP, float((w.before.get(d).get("cpu_percent") or 0.0)) * (factor if d in dus else 1.0), 1.0, 1.0, factor if d in dus else 1.0) for d in served)
        for plane_id, ratio in ((st.get(cu_id).get("up"), carried / base), (st.get(cu_id).get("cp"), cp_units / base)):
            p = st.get(plane_id) if plane_id else None
            if p is None or p.get("cpu_percent") is None or not p.get("allocated_cores"):
                continue
            target = min(99.9, float(w.before.get(plane_id).get("cpu_percent")) * ratio)
            w.demand[plane_id] = world.demand_from_cpu(target, float(p.get("allocated_cores")))
            w.dirty.add(plane_id)
    w.finalize()
    return {"dus": len(dus), "cells": len(cells), "cus": len(cus)}


def run_scenario(state: TwinState, scenario: dict, ml, engine: str) -> tuple[TwinState, list[str]]:
    w = Working(state, ml if engine == "predict" else None, "predict" if engine == "predict" else "simulate", key=scenario.get("name", "whatif"))
    log = []
    for i, step in enumerate(scenario.get("steps") or [], 1):
        if "surge" in step:
            sg = step["surge"]
            if not sg.get("entities") or not float(sg.get("factor", 0)) > 0:
                die(f"step {i}: a surge needs 'entities' and a positive 'factor'")
            r = apply_surge(w, list(sg["entities"]), float(sg["factor"]))
            log.append(f"step {i}: surge x{sg['factor']} on {', '.join(sg['entities'])} -> {r['dus']} DU(s), {r['cells']} cell(s), {r['cus']} CU(s) affected")
        elif "action" in step:
            it = dict(step["action"])
            if it.get("kind") not in SUPPORTED:
                die(f"step {i}: action kind {it.get('kind')!r} is not supported here (supported: {', '.join(sorted(SUPPORTED))})")
            try:
                info = apply_intent(w, it)
                w.finalize()
            except (KeyError, ValueError, TypeError) as e:
                die(f"step {i}: {it.get('kind')} could not be applied ({type(e).__name__}: {e}); check the ids and fields against the graph")
            log.append(f"step {i}: {it['kind']} {json.dumps({k: v for k, v in it.items() if k != 'kind'})[:150]}")
        else:
            die(f"step {i}: a step is either {{'surge': ...}} or {{'action': ...}}")
    return w.s, log


# ------------------------------------------------------------------------------------------------------------------ the report
def report(before: TwinState, after: TwinState, trigger: float) -> dict:
    rows = []
    for n in after.nodes.values():
        b = before.get(n.id)
        if b is None:
            continue
        for a in ("cpu_percent", "load_percent", "session_load_percent", "utilisation_percent"):
            x, y = b.get(a), n.get(a)
            if x is not None and y is not None and abs(float(y) - float(x)) >= 0.05:
                rows.append((n.id, n.kind, a, float(x), float(y)))
    by_kind: dict[str, int] = {}
    for r in rows:
        by_kind[r[1]] = by_kind.get(r[1], 0) + 1
    crossed = sorted([r for r in rows if r[2] == "cpu_percent" and r[3] < trigger <= r[4]], key=lambda r: -r[4])
    healed = sorted([r for r in rows if r[2] == "cpu_percent" and r[3] >= trigger > r[4]], key=lambda r: r[4])
    top = sorted([r for r in rows if r[2] == "cpu_percent"], key=lambda r: -abs(r[4] - r[3]))[:12]
    new = [n.id for n in after.nodes.values() if before.get(n.id) is None]
    return {"changed": len(rows), "by_kind": by_kind, "crossed": crossed, "healed": healed, "top": top, "new": new}


def print_report(rep: dict, trigger: float, steps: list[str], loads: dict) -> None:
    print("\nCURRENT state: network graph + " + loads["source"] + (f" (as of {loads['as_of']})" if "as_of" in loads else "") + f", {loads['applied']:,} readings applied")
    print("\nSCENARIO"); [print("  " + x) for x in steps]
    print(f"\nRESULT  {rep['changed']:,} load figures changed " + "(" + ", ".join(f"{k} {v:,}" for k, v in sorted(rep["by_kind"].items())) + ")")
    if rep["new"]:
        print(f"        new elements: {', '.join(rep['new'][:10])}{' ...' if len(rep['new']) > 10 else ''}")
    f = lambda rs: [print(f"        {r[0]:<18}{r[1]:<6} {r[3]:5.1f} %  ->  {r[4]:5.1f} %") for r in rs[:15]]
    print(f"\n  CPU that CROSSES the overload trigger ({trigger:.0f} %): {len(rep['crossed'])}"); f(rep["crossed"])
    print(f"\n  CPU that falls BACK under the trigger: {len(rep['healed'])}"); f(rep["healed"])
    print("\n  Biggest CPU changes:"); f(rep["top"])


# ------------------------------------------------------------------------------------------------------------------ the target graph
def lit(attr: str, v):
    if isinstance(v, bool):
        return Literal(v)
    if attr in INTEGER_ATTRS:
        return Literal(int(round(float(v))), datatype=XSD.integer)
    if isinstance(v, (int, float)):
        return Literal(f"{round(float(v), 3)}", datatype=XSD.decimal)
    return Literal(str(v))


def build_target(cur: Graph, before: TwinState, after: TwinState, ns: str, graph_iri: str, scenario: dict, loads: dict, trigger: float,
                 source_iri: str | None = None) -> tuple[Graph, list[str]]:
    U = lambda x: URIRef(ns + x)
    t = Graph()
    for tr in cur:
        t.add(tr)
    unmapped: set[str] = set()

    def set_attr(node_id: str, kind: str, attr: str, value, existing_only: bool = False) -> bool:
        s_ = U(node_id)
        rel = RELATIONS.get((kind, attr))
        if rel:
            vals = [value] if not isinstance(value, (list, tuple)) else list(value)
            if rel[0] == "<hasCell":                                      # Cell.du = the DU that has this cell
                for old in list(t.subjects(U("hasCell"), s_)):
                    t.remove((old, U("hasCell"), s_))
                if value:
                    t.add((U(str(value)), U("hasCell"), s_))
                return True
            for p in rel:
                for o in list(t.objects(s_, U(p))):
                    t.remove((s_, U(p), o))
                for v in vals:
                    if v is not None:
                        t.add((s_, U(p), U(str(v))))
            return True
        if attr == "label" and value is not None:
            t.set((s_, RDFS.label, Literal(str(value))))
            return True
        if attr == "scaled_from":
            t.add((s_, U("scaledFrom"), U(str(value))))
            return True
        cands = ([KPI[attr]] if attr in KPI else []) + INV_ATTR.get(attr, [])
        if kind == LINK and attr == "latency_ms":
            cands = ["linkLatencyMs"]
        if not cands:
            unmapped.add(attr)
            return False
        have = [p for p in cands if (s_, U(p), None) in t]
        pred = have[0] if have else cands[0]
        for p in set(cands):
            for o in list(t.objects(s_, U(p))):
                t.remove((s_, U(p), o))
        t.add((s_, U(pred), lit(attr, value)))
        return True

    # 1. structure: new elements are clones of the element they were split from, then every attribute they carry is applied
    changes = diff_states(before, after)
    created = [c for c in changes if c.create is not None]
    for c in created:
        nid, src = c.node, (c.create["attrs"].get("scaled_from") or None)
        if src is None:                                                  # F1 links of a scaled-out DU: same id with the new DU's id replaced by the old one's
            du_new = c.create["attrs"].get("du")
            sd = after.get(du_new).get("scaled_from") if du_new and after.get(du_new) else None
            src = nid.replace(du_new, sd) if sd and du_new else None
        if src and (U(src), None, None) in t:
            for p, o in list(t.predicate_objects(U(src))):
                t.add((U(nid), p, U(nid) if o == U(src) else o))
    for c in created:
        for a, v in c.create["attrs"].items():
            if a in KPI or v is None or a in INTERNAL:
                continue                                             # KPIs are written for every element in step 3; INTERNAL attributes have no graph form
            set_attr(c.node, c.create["kind"], a, v)
    # 2. structure of existing elements: only the attributes the scenario changed, and not the KPIs (those are written for everything below)
    for c in changes:
        if c.create is not None or c.field in KPI or c.field in INTERNAL:
            continue
        n = after.get(c.node)
        if n is not None:
            set_attr(c.node, n.kind, c.field, c.after)
    # 3. the KPIs of every element, after the scenario
    for n in after.nodes.values():
        for a in KPI:
            if n.get(a) is not None:
                set_attr(n.id, n.kind, a, n.get(a))
    # 4. what this graph is
    g = URIRef(graph_iri)
    t.add((g, RDF.type, U("WhatIfGraph")))
    t.add((g, U("derivedFrom"), URIRef(source_iri or ns + "graph/current")))
    t.add((g, RDFS.label, Literal(f"what-if target: {scenario.get('name', 'unnamed')}")))
    t.add((g, U("graphRole"), Literal("target")))
    t.add((g, U("scenarioJson"), Literal(json.dumps(scenario, separators=(",", ":")))))
    t.add((g, U("loadsFrom"), Literal(loads["source"] + (f" as of {loads['as_of']}" if "as_of" in loads else ""))))
    t.add((g, U("overloadTriggerPercent"), Literal(f"{trigger}", datatype=XSD.decimal)))
    t.add((g, U("createdAt"), Literal(datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), datatype=XSD.dateTime)))
    return t, sorted(unmapped)


def target_size(s, graph_iri: str) -> int:
    r = requests.get(f"{s.graphdb_url}/repositories/{s.graphdb_repository}/size", params={"context": f"<{graph_iri}>"},
                     auth=(s.graphdb_user, s.graphdb_password) if s.graphdb_user else None, timeout=120)
    if r.status_code >= 400:
        die(f"GraphDB refused the size request: HTTP {r.status_code} {r.text[:200]} (repository {s.graphdb_repository!r} at {s.graphdb_url})")
    return int(r.text.strip() or 0)


def write_graphdb(s, graph_iri: str, t: Graph, replace: bool) -> int:
    base = f"{s.graphdb_url}/repositories/{s.graphdb_repository}"
    auth = (s.graphdb_user, s.graphdb_password) if s.graphdb_user else None
    ctx = {"context": f"<{graph_iri}>"}
    n = target_size(s, graph_iri)
    if n and not replace:
        die(f"the graph <{graph_iri}> already holds {n:,} triples; use --replace to overwrite it, or --target-graph for another name")
    if n:
        r = requests.delete(f"{base}/statements", params=ctx, auth=auth, timeout=(30, 900))
        if r.status_code >= 400:
            die(f"could not clear <{graph_iri}>: HTTP {r.status_code} {r.text[:200]}")
    with tempfile.SpooledTemporaryFile(max_size=64 << 20) as buf:
        buf.write(t.serialize(format="nt").encode("utf-8"))
        buf.seek(0)
        r = requests.post(f"{base}/statements", params=ctx, data=buf, headers={"Content-Type": "application/n-triples;charset=UTF-8"}, auth=auth, timeout=(30, 3600))
    if r.status_code >= 400:
        die(f"loading the target graph failed: HTTP {r.status_code} {r.text[:300]}")
    return target_size(s, graph_iri)


# ------------------------------------------------------------------------------------------------------------------ the saved query: target-view
VIEW_NAME = "target-view"
# telemetry metric -> predicate of the same KPI in the target graph
VIEW_METRICS = [("cpu_percent", "cpuPercent"), ("load_percent", "loadPercent"), ("session_load_percent", "sessionLoadPercent"), ("utilisation_percent", "utilisationPercent"),
                ("active_users", "activeUsers"), ("throughput_mbps", "throughputMbps"), ("p5_throughput_mbps", "p5ThroughputMbps"), ("latency_ms", "latencyMs"),
                ("ping_pong_pct", "pingPongRate"), ("ho_failure_pct", "handoverFailureRate")]


def target_view_query(s, current_iri: str | None = None, target_iri: str | None = None) -> str:
    """The saved SPARQL query `target-view`: for every element and KPI in the target graph, the CURRENT value (the newest live reading of that series in the current
    graph), the TARGET value and the change. Biggest increase first. "Newest reading" is found with FILTER NOT EXISTS (no later reading of the same series), which GraphDB
    answers with index lookups; a nested aggregate inside OPTIONAL did not finish on the real graph."""
    cur, tgt = current_iri or s.current_graph, target_iri or s.target_graph
    values = " ".join(f'("{m}" ran:{p})' for m, p in VIEW_METRICS)
    return f"""# target-view: current against target, per element and KPI (written by scripts/graphdb_whatif.py)
PREFIX ran: <{s.ran_ns}>
SELECT ?element ?metric ?current ?target (?target - ?current AS ?change) WHERE {{
  VALUES (?metric ?pred) {{ {values} }}
  GRAPH <{tgt}> {{ ?element ?pred ?target }}
  OPTIONAL {{
    GRAPH <{cur}> {{
      ?o ran:observes ?element ; ran:metric ?metric ; ran:observedAt ?at ; ran:value ?current .
      FILTER NOT EXISTS {{ ?o2 ran:observes ?element ; ran:metric ?metric ; ran:observedAt ?at2 . FILTER(?at2 > ?at) }}
    }}
  }}
}} ORDER BY DESC(?change)
"""


def install_target_view(s, current_iri: str | None = None, target_iri: str | None = None) -> str:
    """Create or refresh the saved query in GraphDB (Workbench > SPARQL > Saved queries). Returns what it did."""
    base = f"{s.graphdb_url}/rest/sparql/saved-queries"
    auth = (s.graphdb_user, s.graphdb_password) if s.graphdb_user else None
    body = {"name": VIEW_NAME, "body": target_view_query(s, current_iri, target_iri), "shared": True}
    try:
        have = requests.get(base, auth=auth, timeout=60)
        have.raise_for_status()
        exists = any(q.get("name") == VIEW_NAME for q in have.json())
        if exists:                                           # GraphDB 11: an update names the query it replaces
            r = requests.put(base, params={"oldQueryName": VIEW_NAME}, json=body, auth=auth, timeout=60)
        else:
            r = requests.post(base, json=body, auth=auth, timeout=60)
        r.raise_for_status()
    except (requests.RequestException, ValueError) as e:
        return f"could not install the saved query {VIEW_NAME!r}: {e}"
    return f"saved query {VIEW_NAME!r} {'updated' if exists else 'created'} in GraphDB (Workbench > SPARQL > Saved queries)"


def main() -> int:
    ap = argparse.ArgumentParser(description="What-if analysis: current GraphDB graph + scenario -> target graph (+ the target-view saved query).", formatter_class=argparse.RawDescriptionHelpFormatter, epilog=__doc__.split("Usage")[1])
    ap.add_argument("scenario", nargs="?", help="scenario JSON file (see scripts/whatif_scenario.example.json); not needed with --install-view")
    ap.add_argument("--graphdb-url", help="default: GRAPHDB_URL from .env")
    ap.add_argument("--repository", help="default: GRAPHDB_REPOSITORY from .env")
    ap.add_argument("--source-graph", help="the CURRENT graph (default: the application's current graph)")
    ap.add_argument("--target-graph", help="the TARGET graph to write (default: the application's target graph, <ns>graph/target; replaced on every run)")
    ap.add_argument("--loads", choices=("telemetry", "generated"), default="telemetry", help="where the current loads come from: the newest live readings in the current graph (default) or the generator's busy-hour snapshot")
    ap.add_argument("--engine", choices=("predict", "world"), default="predict", help="predict = the application's ML what-if model (default); world = its analytic model")
    ap.add_argument("--trigger", type=float, help="overload trigger in %% for the report (default: scaleOutThresholdPercent from the graph, else 85)")
    ap.add_argument("--out", help="also write the target graph to this file (.ttl or .nt)")
    ap.add_argument("--no-load", action="store_true", help="do not write to GraphDB (use with --out)")
    ap.add_argument("--install-view", action="store_true", help="only (re)install the target-view saved query in GraphDB, then stop")
    ap.add_argument("--replace", action="store_true", help=argparse.SUPPRESS)      # the target graph is always replaced now; the flag is accepted so old command lines keep working
    ap.add_argument("--dry-run", action="store_true", help="analysis and report only; write nothing anywhere")
    a = ap.parse_args()

    if a.graphdb_url:
        os.environ["GRAPHDB_URL"] = a.graphdb_url
    if a.repository:
        os.environ["GRAPHDB_REPOSITORY"] = a.repository
    os.environ.setdefault("GRAPHDB_REPOSITORY", "Traffic_Steering")
    s = get_settings()
    if a.install_view:
        print(install_target_view(s))
        return 0
    if not a.scenario:
        die("give a scenario file (or --install-view)")
    try:
        scenario = json.loads(Path(a.scenario).read_text())
    except (OSError, ValueError) as e:
        die(f"cannot read the scenario file: {e}")
    name = re.sub(r"[^A-Za-z0-9_.-]+", "-", str(scenario.get("name") or Path(a.scenario).stem)).strip("-") or "scenario"
    scenario["name"] = name
    src_iri = a.source_graph or s.current_graph
    tgt_iri = a.target_graph or s.target_graph
    if tgt_iri == src_iri or tgt_iri in {s.current_graph, s.ontology_graph} or tgt_iri.rsplit("/", 1)[-1] in APP_GRAPHS_SUFFIX:
        die(f"refusing to write into <{tgt_iri}>: it is the current or the ontology graph (or the source). The target defaults to <{s.target_graph}>")

    t0 = time.time()
    print(f"reading the current graph <{src_iri}> from {s.graphdb_url} repository {s.graphdb_repository} ...")
    cur = read_graph(s, src_iri)
    before = build_state(RdfGraphTripleSource(cur, ns=s.ran_ns))
    loads = overlay_loads(before, s, a.loads)
    print(f"  {len(cur):,} triples, {len(before.nodes):,} elements, {loads['applied']:,} load readings ({time.time() - t0:.0f}s)")
    ml = None
    if a.engine == "predict":
        ml = MLService(s)
        if not ml.trained:
            print("  note: the ML what-if model is not trained here; using the analytic model (--engine world)")
            a.engine = "world"
    trigger = a.trigger
    if trigger is None:
        v = list(cur.objects(None, URIRef(s.ran_ns + "scaleOutThresholdPercent")))
        trigger = float(v[0]) if v else 85.0

    after, steps = run_scenario(before, scenario, ml, a.engine)
    print_report(report(before, after, trigger), trigger, steps, loads)
    if a.dry_run:
        print("\ndry run: nothing was written")
        return 0
    if a.no_load and not a.out:
        die("--no-load without --out would write nothing; add --out FILE or drop --no-load")

    target, unmapped = build_target(cur, before, after, s.ran_ns, tgt_iri, scenario, loads, trigger, src_iri)
    if unmapped:
        print(f"\nnote: these attributes changed but have no graph predicate and were left out: {', '.join(unmapped)}")
    if a.out:
        target.serialize(destination=a.out, format="nt" if a.out.endswith(".nt") else "turtle")
        print(f"\nwrote {len(target):,} triples to {a.out}")
    if not a.no_load:
        n = write_graphdb(s, tgt_iri, target, True)
        ok = "OK" if n == len(target) else "DIFF"
        print(f"\n{ok}  target graph <{tgt_iri}> in {s.graphdb_repository}: {n:,} triples written ({len(target):,} expected)")
        print(install_target_view(s, src_iri, tgt_iri))
        print("     run it in the Workbench (SPARQL > Saved queries > target-view), or from ui/sparql/target_view.rq")
        if n != len(target):
            return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
