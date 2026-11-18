"""Local HTTP bridge for the Site Consolidation Python engine.

Run beside site_consolidation_backend.py:
    python3 site_consolidation_api.py
The preview endpoint is read-only. Execute invokes the supplied engine script.
"""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse
from pathlib import Path
import contextlib
import importlib.util
import io
import json
import subprocess
import sys

HERE = Path(__file__).resolve().parent
ENGINE_PATH = HERE / 'site_consolidation_backend.py'
PORT = 5001

spec = importlib.util.spec_from_file_location('site_consolidation_engine', ENGINE_PATH)
engine = importlib.util.module_from_spec(spec)
spec.loader.exec_module(engine)


def preview_plan():
    pairs = engine.find_distance_eligible_pairs()
    diagnostics = []
    for pair in pairs:
        a, b = pair['site_a'], pair['site_b']
        count_a = engine.get_site_device_count(a['uri'])
        count_b = engine.get_site_device_count(b['uri'])
        decision = engine.determine_source_destination(a, count_a, b, count_b)
        diagnostics.append({
            'site_a': a['site_id'], 'site_b': b['site_id'],
            'distance_km': round(pair['distance_km'], 2),
            'device_count_a': count_a, 'device_count_b': count_b,
            'decision': decision['status'],
        })
        if decision['status'] != 'PASS':
            continue
        source, destination = decision['source'], decision['destination']
        source_devices = engine.get_site_devices_with_class(source['uri'])
        destination_devices = engine.get_site_devices_with_class(destination['uri'])
        # Read the current services that traverse devices at the source site.
        query = f'''PREFIX sct: <{engine.SCT}> SELECT DISTINCT ?service ?serviceId ?serviceType ?bandwidth ?device ?deviceId ?deviceClass WHERE {{
          GRAPH <{engine.CURRENT_GRAPH}> {{
            ?service a sct:Service ; sct:traverses ?device .
            ?device sct:locatedAt <{source['uri']}> .
            OPTIONAL {{ ?service sct:serviceId ?serviceId }}
            OPTIONAL {{ ?service sct:serviceType ?serviceType }}
            OPTIONAL {{ ?service sct:bandwidthMbps ?bandwidth }}
            OPTIONAL {{ ?device sct:deviceId ?deviceId }}
            OPTIONAL {{ ?device sct:deviceClass ?deviceClass }}
          }} }} ORDER BY ?service'''
        rows = engine.run_sparql(query)
        services, seen = [], set()
        for row in rows:
            uri = row['service']['value']
            if uri in seen: continue
            seen.add(uri)
            services.append({
                'service_id': row.get('serviceId', {}).get('value', engine.local_name(uri)),
                'service_type': row.get('serviceType', {}).get('value', '—'),
                'bandwidth_mbps': row.get('bandwidth', {}).get('value', '—'),
                'from_device': row.get('deviceId', {}).get('value', engine.local_name(row['device']['value'])),
                'to_device': 'planned replacement',
            })
        device_rows = []
        for item in source_devices:
            device_rows.append({
                'role': 'source', 'device_id': item.get('device_id', item.get('id', '—')),
                'device_class': item.get('device_class', item.get('class_name', '—')),
                'hostname': item.get('hostname', '—'), 'status': 'RETIRE', 'site_id': source['site_id'],
            })
        for item in destination_devices:
            device_rows.append({
                'role': 'destination', 'device_id': item.get('device_id', item.get('id', '—')),
                'device_class': item.get('device_class', item.get('class_name', '—')),
                'hostname': item.get('hostname', '—'), 'status': 'RETAIN', 'site_id': destination['site_id'],
            })
        log = '\n'.join([
            'SITE CONSOLIDATION — READ-ONLY DISCOVERY',
            '=' * 64,
            '1. Select consolidation planning cluster / eligible site pair',
            f"   Candidate: {source['site_id']} → {destination['site_id']}",
            f"2. Geographic feasibility: PASS ({pair['distance_km']:.2f} km; limit {engine.DISTANCE_THRESHOLD_KM} km)",
            f"3. Source device inventory: {len(source_devices)} device(s)",
            f"4. Destination inventory: {len(destination_devices)} device(s)",
            f"5. Services identified for migration: {len(services)}",
            '6. Full compatibility / capacity / provisioning validation is performed by Execute.',
            '', 'Preview is read-only. No GraphDB statements were modified.'
        ])
        return {
            'eligible': True,
            'cluster': {'name': 'Planning cluster'},
            'plan': {
                'source_site': source['site_id'], 'target_site': destination['site_id'],
                'distance_km': pair['distance_km'], 'services': services,
                'devices': device_rows,
            },
            'diagnostics': {'candidates': diagnostics}, 'log': log,
        }
    return {
        'eligible': False, 'cluster': {'name': 'Planning cluster'}, 'plan': None,
        'diagnostics': {'candidates': diagnostics},
        'log': 'SITE CONSOLIDATION — READ-ONLY DISCOVERY\n' +
               ('No site pair passed the geographic / source-destination discovery rules.' if pairs else 'No site pair was found within the configured geographic threshold.') +
               '\nNo GraphDB statements were modified.'
    }


class Handler(BaseHTTPRequestHandler):
    def _send(self, status, payload):
        body = json.dumps(payload, default=str).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self): self._send(200, {'ok': True})

    def do_GET(self):
        path = urlparse(self.path).path
        if path == '/health': return self._send(200, {'status': 'ok', 'repository': engine.REPOSITORY})
        if path == '/preview':
            try: return self._send(200, preview_plan())
            except Exception as exc: return self._send(500, {'error': str(exc)})
        return self._send(404, {'error': 'Not found'})

    def do_POST(self):
        if urlparse(self.path).path != '/execute': return self._send(404, {'error': 'Not found'})
        try:
            # Execute the same production workflow as the supplied backend script.
            completed = subprocess.run([sys.executable, str(ENGINE_PATH)], cwd=str(HERE),
                capture_output=True, text=True, input='\n' * 100, timeout=900)
            output = (completed.stdout or '') + ('\n' + completed.stderr if completed.stderr else '')
            if completed.returncode:
                return self._send(500, {'error': output[-12000:] or 'Engine execution failed', 'log': output[-12000:]})
            return self._send(200, {'ok': True, 'log': output[-16000:], 'eligible': True})
        except subprocess.TimeoutExpired:
            return self._send(504, {'error': 'Consolidation engine timed out after 15 minutes.'})
        except Exception as exc:
            return self._send(500, {'error': str(exc)})

    def log_message(self, fmt, *args): print('[transport-api]', fmt % args)

if __name__ == '__main__':
    print(f'Site Consolidation API listening on http://127.0.0.1:{PORT}')
    ThreadingHTTPServer(('127.0.0.1', PORT), Handler).serve_forever()
