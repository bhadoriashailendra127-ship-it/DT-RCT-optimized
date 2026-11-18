#!/usr/bin/env python3
"""Closed-loop Evening Peak demonstration against a RUNNING backend (default http://localhost:8000).

reset -> fault/rollback demo -> reset -> dry-run -> simulate (steer auto-executes, scale-outs wait) -> approve -> re-run loop
-> duplicate check -> fault-injected rollback demo -> baseline-untouched proof.
Only the isolated simulation state is changed. Use --keep to skip the initial reset.
"""
import argparse
import json
import sys
import urllib.error
import urllib.request

BASE = "http://localhost:8000/api"


def call(method, path, body=None):
    req = urllib.request.Request(BASE + path, method=method, data=json.dumps(body).encode() if body is not None else None,
                                 headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=180) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        return {"error": json.loads(e.read() or b"{}").get("error", {"message": str(e)})}
    except urllib.error.URLError as e:
        sys.exit(f"backend not reachable at {BASE}: {e.reason}")


def line(a):
    v = (a.get("verification") or {}).get("status", "-")
    return f"  {a['id']} {a['type']:<10} {a['source']}->{a['target']}  status={a['status']:<20} verdict={a['evaluation']['verdict']:<18} verification={v}"


def main():
    global BASE
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default=BASE)
    ap.add_argument("--keep", action="store_true")
    a = ap.parse_args()
    BASE = a.base
    h = call("GET", "/health")
    print("1. health:", h)
    ready = call("GET", "/ready")
    print("   ready:", ready.get("ready"), ready.get("problems"))
    cmp0 = call("GET", "/state/compare")
    if not a.keep:
        print("2. reset simulation state:", call("POST", "/simulation/reset", {"reset_calibration": True})["cleared_actions"], "actions cleared")
    print("2b. failure path first: steering with an injected KPI regression -> verification FAILS -> automatic simulated rollback")
    f = call("POST", "/scenarios/1/simulate", {"fault": "kpi_regression"})
    for x in f["actions"]:
        if x["status"] in ("ROLLED_BACK", "VERIFICATION_FAILED"):
            print(line(x), "| failed checks:", x["verification"]["failed"], "| rollback restored_verified:", (x.get("rollback") or {}).get("restored_verified"))
    print("    reset again for the normal run:", call("POST", "/simulation/reset", {"reset_calibration": True})["cleared_actions"], "records cleared")
    print("3. dry-run evaluation (no state change)")
    ev = call("POST", "/scenarios/1/evaluate", {})
    for it in ev["items"]:
        e = it["evaluation"]
        print(f"  {it['plan']['id']:<32} {e['plan']['type']:<9} {e['verdict']:<18} {e['disposition']}")
        for alt in it["alternatives"]:
            print(f"      alt {alt['plan']['id']:<34} {alt['evaluation']['verdict']}{'  <- selected' if alt['selected'] else ''}")
    print("4. simulate Evening Peak (mode:", call("GET", "/simulation/status")["mode"] + ")")
    sim = call("POST", "/scenarios/1/simulate", {})
    for x in sim["actions"]:
        print(line(x))
    pend = [x for x in sim["actions"] if x["status"] == "AWAITING_APPROVAL"]
    print(f"5. approval queue: {len(pend)} pending (scale-out needs human approval)")
    for p in pend[:1]:
        r = call("POST", f"/approvals/{p['id']}/approve", {"approver": "demo-operator", "comment": "approved by demo script"})
        print("   approved ->", line(r) if "id" in r else r)
        d = call("POST", "/capacity/scale-out/simulate", {"target": p["source"], "scenario": "Scenario01"})
        print("   duplicate scale-out attempt ->", (d.get("action") or {}).get("status"), "-", (d.get("action") or {}).get("evaluation", {}).get("summary"))
    print("6. re-evaluate (next monitoring cycle sees the simulated result)")
    ev2 = call("POST", "/scenarios/1/evaluate", {})
    for it in ev2["items"]:
        print(f"  {it['plan']['id']:<32} {it['evaluation']['verdict']:<18} {it['evaluation']['summary'][:90]}")
    print("8. learning:", {k: v for k, v in call("GET", "/ml/calibration").items() if k in ("records", "min_samples")})
    cmp1 = call("GET", "/state/compare")
    print("9. baseline untouched:", not cmp1["baseline_modified"], "| simulated field changes:", cmp1["simulated_changes"])
    print("Open the dashboard (http://localhost:5173) -> Approval queue / Agent workflow / Verification history.")


if __name__ == "__main__":
    main()
