#!/usr/bin/env bash
# Production-style POC start: build the UI once and serve UI + API from the single FastAPI process on :8000 is NOT done;
# instead: API via uvicorn (2 workers) on :8000 and the static build via `vite preview` on :5173 (proxying /api).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PY="$ROOT/.venv/bin/python"
[ -f "$ROOT/.env" ] && set -a && . "$ROOT/.env" && set +a
"$PY" "$ROOT/scripts/seed.py" || echo "WARNING: seeding failed"
(cd "$ROOT/frontend" && { [ -d node_modules ] || npm ci --no-audit --no-fund; } && npm run build)
trap 'kill ${BE:-} ${FE:-} 2>/dev/null || true' EXIT INT TERM
(cd "$ROOT/backend" && "$PY" -m uvicorn dtwin.api.main:app --host 0.0.0.0 --port 8000 --workers 1) & BE=$!
(cd "$ROOT/frontend" && npx vite preview --host 0.0.0.0 --port 5173) & FE=$!
echo "Dashboard http://localhost:5173  API docs http://localhost:8000/docs"
wait
