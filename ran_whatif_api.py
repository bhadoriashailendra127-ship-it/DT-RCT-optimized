#!/usr/bin/env python3
"""Small HTTP adapter for scripts/graphdb_whatif.py.

Run this on the RAN GraphDB/application host (10.161.4.199), where the
backend/dtwin package and GraphDB are installed. Preview is --dry-run; execute
writes only the configured target graph, never current or ontology.
"""
from __future__ import annotations
import json
import os
import subprocess
import sys
import tempfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen

HOST = os.getenv("RAN_WHATIF_API_HOST", "0.0.0.0")
PORT = int(os.getenv("RAN_WHATIF_API_PORT", "8010"))
PROJECT_ROOT = Path(os.getenv("RAN_WHATIF_PROJECT_ROOT", Path(__file__).resolve().parent)).resolve()
SCRIPT = Path(os.getenv("RAN_WHATIF_SCRIPT", PROJECT_ROOT / "scripts" / "graphdb_whatif.py")).resolve()
PYTHON = os.getenv("RAN_WHATIF_PYTHON", sys.executable)
TIMEOUT = int(os.getenv("RAN_WHATIF_TIMEOUT", "600"))
GRAPHDB_URL = os.getenv("GRAPHDB_URL", "http://127.0.0.1:7200").rstrip("/")
GRAPHDB_REPOSITORY = os.getenv("GRAPHDB_REPOSITORY", "Traffic_Steering")
CURRENT_GRAPH = os.getenv("RAN_CURRENT_GRAPH", "http://example.com/ran-dt/graph/current")


def response(handler, status, payload):
    raw = json.dumps(payload).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(raw)))
    handler.send_header("Access-Control-Allow-Origin", "*")
    handler.end_headers()
    handler.wfile.write(raw)


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        print("[ran-whatif-api] " + fmt % args, flush=True)

    def do_GET(self):
        if self.path.rstrip("/") == "/health":
            graphdb_ok = False
            current_triples = None
            graphdb_error = None
            query = f"SELECT (COUNT(*) AS ?count) WHERE {{ GRAPH <{CURRENT_GRAPH}> {{ ?s ?p ?o }} }}"
            try:
                payload = urlencode({"query": query}).encode("utf-8")
                request = Request(
                    f"{GRAPHDB_URL}/repositories/{GRAPHDB_REPOSITORY}",
                    data=payload,
                    headers={"Content-Type": "application/x-www-form-urlencoded", "Accept": "application/sparql-results+json"},
                    method="POST",
                )
                with urlopen(request, timeout=5) as result:
                    data = json.loads(result.read().decode("utf-8"))
                current_triples = int(data["results"]["bindings"][0]["count"]["value"])
                graphdb_ok = True
            except Exception as exc:
                graphdb_error = str(exc)
            response(self, 200, {
                "status": "ok" if graphdb_ok and SCRIPT.is_file() else "degraded",
                "script_exists": SCRIPT.is_file(), "script": str(SCRIPT),
                "repository": GRAPHDB_REPOSITORY, "graphdb_url": GRAPHDB_URL,
                "graphdb_connected": graphdb_ok, "current_graph": CURRENT_GRAPH,
                "current_graph_triples": current_triples, "graphdb_error": graphdb_error,
            })
        else:
            response(self, 404, {"error": "Not found"})

    def do_POST(self):
        route = self.path.rstrip("/")
        if route not in ("/preview", "/execute"):
            return response(self, 404, {"error": "Unknown endpoint"})
        try:
            size = int(self.headers.get("Content-Length", "0"))
            if size <= 0 or size > 128 * 1024:
                return response(self, 400, {"error": "Request body must be between 1 byte and 128 KB"})
            body = json.loads(self.rfile.read(size))
            scenario = body.get("scenario")
            if not isinstance(scenario, dict) or not isinstance(scenario.get("steps"), list) or not scenario["steps"]:
                return response(self, 400, {"error": "A scenario object with a non-empty steps array is required"})
            if not SCRIPT.is_file():
                return response(self, 500, {"error": f"What-if script not found: {SCRIPT}"})
            # Only allow the documented operation types from the engine.
            for step in scenario["steps"]:
                if not isinstance(step, dict) or not ("surge" in step or "action" in step):
                    return response(self, 400, {"error": "Each step must contain surge or action"})
            fd, scenario_file = tempfile.mkstemp(prefix="ran-whatif-", suffix=".json")
            try:
                with os.fdopen(fd, "w", encoding="utf-8") as f:
                    json.dump(scenario, f)
                env = os.environ.copy()
                env.setdefault("GRAPHDB_URL", "http://127.0.0.1:7200")
                env.setdefault("GRAPHDB_REPOSITORY", "Traffic_Steering")
                command = [PYTHON, str(SCRIPT), scenario_file]
                source_graph = body.get("sourceGraph")
                target_graph = body.get("targetGraph")
                repository = body.get("repository")
                if repository:
                    command.extend(["--repository", str(repository)])
                if source_graph:
                    command.extend(["--source-graph", str(source_graph)])
                if target_graph:
                    command.extend(["--target-graph", str(target_graph)])
                if route == "/preview":
                    command.append("--dry-run")
                result = subprocess.run(command, cwd=str(PROJECT_ROOT), env=env, capture_output=True, text=True, timeout=TIMEOUT)
            finally:
                try: os.unlink(scenario_file)
                except OSError: pass
            payload = {"ok": result.returncode == 0, "mode": "preview" if route == "/preview" else "execute", "exitCode": result.returncode, "narration": (result.stdout or "")[-30000:], "stderr": (result.stderr or "")[-10000:], "targetGraph": target_graph or "configured by dtwin settings"}
            return response(self, 200 if result.returncode == 0 else 500, payload)
        except subprocess.TimeoutExpired as exc:
            return response(self, 504, {"error": f"What-if engine timed out after {TIMEOUT} seconds", "stdout": (exc.stdout or b"").decode(errors="replace")[-10000:] if isinstance(exc.stdout, bytes) else str(exc.stdout or "")[-10000:]})
        except (ValueError, OSError) as exc:
            return response(self, 400, {"error": str(exc)})


if __name__ == "__main__":
    print(f"RAN What-if API listening on http://{HOST}:{PORT}", flush=True)
    print(f"Project root: {PROJECT_ROOT}; engine: {SCRIPT}", flush=True)
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
