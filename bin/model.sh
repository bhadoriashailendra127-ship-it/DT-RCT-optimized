#!/usr/bin/env bash
# One command for the WORKING MODEL: backend (:8000) + UI (:5173) + trained ML + SIMULATED telemetry streaming into the twin.
#   bin/model.sh start     (re)start everything and wait until it is ready     bin/model.sh stop     bin/model.sh status
# Safe to re-run. GraphDB is only READ (the seed step writes only the application's own named graphs). Logs: data/logs/
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PY="$ROOT/.venv/bin/python"
LOG="$ROOT/data/logs"; mkdir -p "$LOG"
API=http://localhost:8000
[ -f "$ROOT/.env" ] && set -a && . "$ROOT/.env" && set +a

pid_on() { ss -ltnp 2>/dev/null | grep -E ":$1 " | sed -n 's/.*pid=\([0-9]*\).*/\1/p' | head -1 || true; }
stop_port() { local p; p="$(pid_on "$1")"; [ -n "$p" ] && kill "$p" 2>/dev/null && for _ in $(seq 20); do [ -z "$(pid_on "$1")" ] && break; sleep 0.25; done || true; }
j() { "$PY" -c "import json,sys; d=json.load(sys.stdin); print($1)" 2>/dev/null; }
# wait (up to ~3 min) until /api/ready returns valid JSON; the first call after a restart can take 30s+
wait_ready() { for _ in $(seq 36); do curl -s -m 30 $API/api/ready 2>/dev/null | "$PY" -c "import json,sys; json.load(sys.stdin)" 2>/dev/null && return 0; sleep 5; done; echo "backend did not become ready (see $LOG/backend.log)"; return 1; }

status() {
  echo "GraphDB : $(curl -s -m 3 -o /dev/null -w '%{http_code}' localhost:7200/rest/repositories || echo down)"
  curl -s -m 40 $API/api/ready | j "'backend : ready=%s ml_trained=%s scenarios=%s' % (d.get('ready'), d.get('ml_trained'), d.get('scenarios_found'))" 2>/dev/null || echo "backend : down"
  curl -s -m 40 $API/api/telemetry/status | j "'telemetry: simulator=%s samples=%s twin_overlay=%s' % (d['simulator'].get('phase'), d['samples'], d['twin_overlay']['enabled'])" 2>/dev/null || true
  echo "UI      : $(curl -s -m 3 -o /dev/null -w '%{http_code}' localhost:5173/ || echo down)  http://localhost:5173   (API docs $API/docs)"
}

start() {
  [ -x "$PY" ] || { echo "missing $ROOT/.venv"; exit 1; }
  stop_port 8000
  (cd "$ROOT/backend" && setsid nohup "$PY" -m uvicorn dtwin.api.main:app --host 0.0.0.0 --port 8000 >"$LOG/backend.log" 2>&1 </dev/null &)
  for _ in $(seq 60); do curl -s -m 2 $API/api/health >/dev/null 2>&1 && break; sleep 1; done
  wait_ready || exit 1
  # the backend generates the network (ontology graph) and seeds a busy-hour telemetry sample itself when GraphDB holds none for the current GEN_* size
  curl -s -m 60 $API/api/ready | j "'backend : ready' if d['ready'] else 'NOT READY: %s' % d['problems']" || echo "backend : ready check failed"
  curl -s -m 600 -X POST $API/api/ml/train | j "'ML      : %s' % d.get('status')" || echo "ML      : train call failed"
  docker start ran-dt-kafka graphdb >/dev/null 2>&1 || true       # no-op when already running
  curl -s -X POST $API/api/telemetry/simulator/stop >/dev/null || true
  # telemetry in GraphDB is KEPT across restarts; clear it explicitly with: bin/model.sh clear-telemetry
  # Scenario clocks are "today (UTC) + the scenario's time of day" (Evening Peak = 19:30), so anchor the telemetry timeline to today 19:30.
  START="$(date -u +%Y-%m-%d)T19:30:00Z"
  curl -s -m 600 -X POST $API/api/telemetry/simulator/start -H 'content-type: application/json' \
    -d "{\"sinks\":[\"${SINK:-kafka}\"],\"kafka_topic\":\"${KAFKA_TOPIC:-dtwin.telemetry}\",\"start\":\"$START\",\"backfill_days\":1,\"sample_period_s\":300,\"speed\":1,\"hold_hour\":19.5,\"noise_scale\":0.3}" \
    | j "'telemetry: simulator %s, %s entities' % (d['phase'], d['entities'])" || echo "telemetry: simulator start failed"
  for _ in $(seq 120); do curl -s $API/api/telemetry/status | j "d['simulator']['phase']" | grep -q live && break; sleep 1; done
  (cd "$ROOT/frontend" && { [ -d node_modules ] || npm ci --no-audit --no-fund; } && npm run build >"$LOG/frontend-build.log" 2>&1) && echo "UI built"
  [ -n "$(pid_on 5173)" ] || (cd "$ROOT/frontend" && setsid nohup npx vite preview --host 0.0.0.0 --port 5173 >"$LOG/frontend.log" 2>&1 </dev/null &)
  sleep 2; status
}

stop() { curl -s -X POST $API/api/telemetry/simulator/stop >/dev/null 2>&1 || true; stop_port 8000; stop_port 5173; echo stopped; }

clear_tel() { curl -s -X POST $API/api/telemetry/reset >/dev/null && echo "telemetry cleared (telemetry graph only; baseline and simulation state untouched)"; }

case "${1:-status}" in clear-telemetry) clear_tel;; start) start;; stop) stop;; status) status;; *) echo "usage: $0 start|stop|status|clear-telemetry"; exit 2;; esac
