#!/usr/bin/env python3
"""Standalone SIMULATED telemetry producer (separate process from the backend).

Reads the twin from GraphDB (read-only) to learn which entities exist and their current values, then emits samples:

  --sink http   POST to a running backend           (--url http://localhost:8000 --format native|ves|e2kpm)
  --sink file   drop NDJSON files for the watcher   (--out data/telemetry/inbox; start the watcher: POST /api/telemetry/sources/file_watcher/start)
  --sink kafka  produce to a topic                  (--bootstrap host:9092 --topic dtwin.telemetry; needs kafka-python + a broker, topic must exist)
                the backend (KAFKA_BOOTSTRAP + TELEMETRY_PIPELINE=graphdb) then consumes it, writes RDF to GraphDB and reads it back into the twin

Examples
  .venv/bin/python bin/telemetry_simulator.py --sink http --url http://localhost:8000 --backfill-days 14 --start 2026-01-15T19:30:00Z --speed 900 --period 900
  .venv/bin/python bin/telemetry_simulator.py --sink file --format ves --ticks 20 --period 60 --speed 600
Everything produced is SIMULATED (origin simulated_telemetry). This process only READS GraphDB (to learn the entities); it writes nothing to it.
"""
import argparse
import signal
import sys
import time
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
from dtwin.config import get_settings  # noqa: E402
from dtwin.telemetry import simulator as sim  # noqa: E402
from dtwin.twin.service import default_twin  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--sink", choices=["http", "file", "kafka"], required=True)
    ap.add_argument("--format", choices=["native", "ves", "e2kpm"], default="native")
    ap.add_argument("--url", default="http://localhost:8000")
    ap.add_argument("--out", default=None, help="file sink directory (default <DATA_DIR>/telemetry/inbox)")
    ap.add_argument("--bootstrap", default=None)
    ap.add_argument("--topic", default="dtwin.telemetry")
    ap.add_argument("--period", type=float, default=60.0, help="simulated seconds between samples")
    ap.add_argument("--speed", type=float, default=1.0, help="simulated seconds per real second")
    ap.add_argument("--start", default=None, help="simulated clock start, ISO-8601 (default now)")
    ap.add_argument("--backfill-days", type=int, default=0)
    ap.add_argument("--hold-hour", type=float, default=None, help="freeze time of day for live samples, e.g. 19.5 (Evening Peak)")
    ap.add_argument("--noise-scale", type=float, default=1.0)
    ap.add_argument("--no-plateau", action="store_true")
    ap.add_argument("--entities", default=None, help="comma-separated twin node ids (default all)")
    ap.add_argument("--ticks", type=int, default=0, help="stop after N live samples per entity (0 = run until Ctrl-C)")
    ap.add_argument("--seed", type=int, default=42)
    a = ap.parse_args()

    s = get_settings()
    twin, _client = default_twin(s)
    specs = sim.specs_from_state(twin.baseline, set(a.entities.split(",")) if a.entities else None, a.seed)
    if a.sink == "http":
        sink = sim.HttpSink(a.url, a.format)
    elif a.sink == "file":
        sink = sim.FileSink(a.out or s.data_path / "telemetry" / "inbox", a.format)
    else:
        sink = sim.KafkaSink(a.bootstrap or s.kafka_bootstrap, a.topic, a.format)
    start = datetime.fromisoformat(a.start.replace("Z", "+00:00")) if a.start else None
    t = sim.TelemetrySimulator(specs, [sink], a.seed, a.period, a.speed, start, a.backfill_days, a.hold_hour, a.noise_scale, not a.no_plateau)
    print(f"simulating {len(specs)} entities -> {sink.info()} (SIMULATED data)")
    if a.ticks:
        t.run_for(a.ticks)
    else:
        signal.signal(signal.SIGTERM, lambda *_: t.stop())
        t.start()
        try:
            while t._t and t._t.is_alive():
                time.sleep(1)
                print(t.status()["phase"], t.status()["sim_time"], "emitted", t.emitted, "errors", t.errors, end="\r")
        except KeyboardInterrupt:
            t.stop()
    print(f"\ndone: emitted {t.emitted} samples, {t.errors} sink errors" + (f" (last: {t.last_error})" if t.last_error else ""))
    return 1 if t.errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
