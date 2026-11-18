#!/usr/bin/env bash
# Single development startup path: seeds named graphs (idempotent), starts backend :8000 and frontend :5173.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PY="$ROOT/.venv/bin/python"
[ -x "$PY" ] || { echo "missing $ROOT/.venv - create it: python3 -m venv .venv && .venv/bin/pip install -r backend/requirements.txt"; exit 1; }
[ -f "$ROOT/.env" ] && set -a && . "$ROOT/.env" && set +a
"$PY" "$ROOT/scripts/seed.py" || echo "WARNING: seeding failed - is GraphDB up? (backend will report INSUFFICIENT_DATA)"
[ -d "$ROOT/frontend/node_modules" ] || (cd "$ROOT/frontend" && npm install --no-audit --no-fund)
cleanup() { kill "${BE:-}" "${FE:-}" 2>/dev/null || true; }
trap cleanup EXIT INT TERM
(cd "$ROOT/backend" && "$PY" -m uvicorn dtwin.api.main:app --host 0.0.0.0 --port 8000) & BE=$!
(cd "$ROOT/frontend" && CHOKIDAR_USEPOLLING=1 npx vite --host 0.0.0.0 --port 5173) & FE=$!
echo "Backend  http://localhost:8000/docs   Dashboard  http://localhost:5173"
wait
