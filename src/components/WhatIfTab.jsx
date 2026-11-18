import { useState, useEffect } from 'react';
import { apiCall, endpoints } from '../api';
import ResultsTable from './ResultsTable';
import { loadTransportGraph } from '../transportGraphdbApi';

const SIM_PATHS = {
  'SVC-INET-UM-01': [
    ['DEV-COAX-UM-01', 1],
    ['DEV-CAAS-03', 2],
    ['DEV-PREAGG-N01', 3],
    ['DEV-AGG-N01', 4],
  ],
  'SVC-IPTV-UM-01': [
    ['DEV-CAAS-03', 1],
    ['DEV-PREAGG-N01', 2],
    ['DEV-AGG-N01', 3],
  ],
};

export default function WhatIfTab({
  active,
  mode,
  apiUrl,
  siteIdsInput,
  clusterFilter,
  data,
  helpers,
  onUnlockStates,
  transportGraphDb = false,
  onRefreshGraph,
}) {
  const { bySite, bySvc, devsAt, siteOf, hasTargetPath, T } = helpers;

  // ---------------- live mode: real consolidation engine ----------------
  const [previewing, setPreviewing] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [preview, setPreview] = useState(null); // { eligible, cluster, plan, log }
  const [executed, setExecuted] = useState(null); // { plan, log }
  const [liveError, setLiveError] = useState(null);
  const [targetGraphDevices, setTargetGraphDevices] = useState([]);

  const [lastRunAt, setLastRunAt] = useState(null);

  // Clear stale preview/execute results whenever the selected cluster changes
  // (via the Ontology Graph's Cluster dropdown) -- otherwise the previous
  // cluster's results stay on screen looking like they belong to the new
  // selection until the user clicks Run/Execute again.
  useEffect(() => {
    setPreview(null);
    setExecuted(null);
    setLiveError(null);
    setLastRunAt(null);
  }, [clusterFilter]);

  function stampLog(log) {
    return log;
  }

  // The blue circles in the ontology graph represent TARGET devices. The
  // what-if API may return only the primary replacement device, so load the
  // target graph as well and retain the full inventory shown in that graph.
  async function loadTargetGraphDevices() {
    try {
      const graph = transportGraphDb
        ? await loadTransportGraph('target', { sourceSite: 'source', destinationSite: 'destination', version: '1' })
        : await apiCall(apiUrl, endpoints.graph('target', siteIdsInput));
      const devices = (graph?.nodes || [])
        .filter((node) => {
          const state = String(node.props?.twin_state || node.state || '').toUpperCase();
          return node.group === 'device_target' || node.group === 'device' || state === 'TARGET';
        })
        .map((node) => {
          const props = node.props || {};
          const state = String(props.twin_state || node.state || '').toLowerCase();
          const siteEdge = (graph?.edges || []).find(
            (edge) => edge.kind === 'LOCATED_AT' && edge.from === node.id
          );
          return {
            role: 'planned',
            device_id: props.device_id || node.device_id || node.id,
            device_class:
              props.device_class ||
              props.class_name ||
              props.type ||
              node.type ||
              '—',
            hostname: props.hostname || props.host || node.label || '—',
            status: props.status || props.lifecycle_state || props.lifecycle || state || 'target',
            site_id: props.site_id || props.site || siteEdge?.to || '—',
          };
        });
      setTargetGraphDevices(devices);
    } catch (error) {
      // The plan remains usable if the graph endpoint is temporarily unavailable.
      console.warn(
        'Unable to load target devices for the proposed plan:',
        error.message
      );
      setTargetGraphDevices([]);
    }
  }

  async function runPreview() {
    setLiveError(null);
    setPreviewing(true);
    setExecuted(null);
    try {
      const res = transportGraphDb
        ? await fetch('/transport-api/preview').then(async (response) => {
            const payload = await response.json();
            if (!response.ok) throw new Error(payload.error || 'Site consolidation preview failed.');
            return payload;
          })
        : await apiCall(apiUrl, endpoints.whatifPreview(clusterFilter), { method: 'GET' });
      setPreview({ ...res, log: stampLog(res.log) });
      await loadTargetGraphDevices();
      setLastRunAt({ action: 'Preview', at: new Date() });
      // NOTE: intentionally not calling onUnlockStates() here -- Planned/Target
      // views should only unlock after Execute actually writes them, not just
      // after a read-only Preview.
    } catch (e) {
      setLiveError(e.message);
      setPreview(null);
    }
    setPreviewing(false);
  }

  async function runExecute() {
    setLiveError(null);
    setExecuting(true);
    try {
      const res = transportGraphDb
        ? await fetch('/transport-api/execute', { method: 'POST' }).then(async (response) => {
            const payload = await response.json();
            if (!response.ok) throw new Error(payload.error || 'Consolidation execution failed.');
            return payload;
          })
        : await apiCall(apiUrl, endpoints.whatifExecute(clusterFilter), { method: 'GET' });
      setExecuted({ ...res, log: stampLog(res.log) });
      await loadTargetGraphDevices();
      if (transportGraphDb) onRefreshGraph?.();
      setLastRunAt({ action: 'Execute', at: new Date() });
      onUnlockStates?.();
    } catch (e) {
      setLiveError(e.message);
    }
    setExecuting(false);
  }

  // ---------------- demo mode: original local simulation (unchanged) ----------------
  const [site, setSite] = useState(
    () =>
      data.sites.find((candidate) => candidate[0] === 'SITE-HUB-01')?.[0] ||
      data.sites[0]?.[0] ||
      ''
  );
  const [stats, setStats] = useState(null);
  const [blast, setBlast] = useState(null);
  const [ready, setReady] = useState(null);
  const [demoError, setDemoError] = useState('');
  const [simLog, setSimLog] = useState(['Simulation idle.']);

  function slog(m) {
    setSimLog((prev) => [...prev, `[${new Date().toLocaleTimeString()}] ${m}`]);
  }

  function blastLocal(siteId) {
    const rows = [];
    const seen = new Set();
    T('CURRENT').forEach((t) => {
      if (siteOf(t[1]) !== siteId) return;
      data.subscribes
        .filter((x) => x[1] === t[0])
        .forEach((x) => {
          const k = x[0] + t[0];
          if (seen.has(k)) return;
          seen.add(k);
          const c = data.customers.find((c) => c[0] === x[0]);
          rows.push([
            bySite(siteId)[1],
            bySvc(t[0])[1],
            bySvc(t[0])[3],
            c[1],
            c[3],
          ]);
        });
    });
    rows.sort((a, b) => b[4] - a[4]);
    return {
      columns: [
        'site',
        'impacted_service',
        'sla_class',
        'impacted_customer',
        'subscribers',
      ],
      rows,
    };
  }

  function runWhatIfDemo() {
    setDemoError('');
    setStats(null);
    setBlast(null);
    setReady(null);
    try {
      if (!site) throw new Error('Select a site before running the analysis.');
      const selectedSite = bySite(site);
      if (!selectedSite) {
        throw new Error(`The selected site "${site}" was not found.`);
      }

      const blastRes = blastLocal(site);
      const rows = [];
      const seen = new Set();
      T('CURRENT').forEach((traversal) => {
        if (siteOf(traversal[1]) !== site || seen.has(traversal[0])) return;
        const service = bySvc(traversal[0]);
        if (!service) return;
        seen.add(traversal[0]);
        rows.push([service[1], service[4], hasTargetPath(traversal[0])]);
      });
      const readyRes = {
        columns: ['service', 'migration_status', 'ready'],
        rows,
      };

      const devices = devsAt(site);
      const gbps = data.links
        .filter(
          (link) =>
            link[5] === 'CURRENT' &&
            (devices.includes(link[2]) || devices.includes(link[1]))
        )
        .reduce((total, link) => total + link[4], 0);
      const subsHit = blastRes.rows.reduce(
        (total, row) =>
          total + (typeof row[4] === 'number' ? row[4] : parseInt(row[4]) || 0),
        0
      );
      const allReady =
        readyRes.rows.length > 0 &&
        readyRes.rows.every((row) => row[2] === true || row[2] === 'true');

      setStats({
        pairs: blastRes.rows.length,
        subsHit,
        gbps,
        powerKw: selectedSite[7],
        sqm: selectedSite[8],
        readyCount: readyRes.rows.length,
        allReady,
      });
      setBlast(blastRes);
      setReady(readyRes);
    } catch (error) {
      setDemoError(error.message);
    }
  }

  function simCutover() {
    for (const [svc, hops] of Object.entries(SIM_PATHS)) {
      hops.forEach(([d, q]) => {
        if (
          !data.traverses.some(
            (t) => t[0] === svc && t[1] === d && t[2] === 'TARGET'
          )
        ) {
          data.traverses.push([svc, d, 'TARGET', q]);
        }
      });
      bySvc(svc)[4] = 'TARGET_PATH_PLANNED';
    }
    slog(
      'Demo cutover simulated: TARGET paths added for SVC-INET-UM-01 and SVC-IPTV-UM-01.'
    );
    runWhatIfDemo();
  }

  function simReset() {
    data.traverses = data.traverses.filter(
      (t) => !(t[0] in SIM_PATHS && t[2] === 'TARGET')
    );
    Object.keys(SIM_PATHS).forEach((svc) => (bySvc(svc)[4] = 'NOT_STARTED'));
    slog('Demo simulation reset to blocked baseline.');
    runWhatIfDemo();
  }

  useEffect(() => {
    if (active && mode !== 'live' && site) runWhatIfDemo();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, site, mode]);

  const statColor = stats
    ? stats.readyCount === 0
      ? '#5A5A7A'
      : stats.allReady
      ? '#2E9E6B'
      : '#D64550'
    : '#5A5A7A';

  const siteOptions = data.sites.map((s) => ({
    value: s[0],
    label: s[1] + (s[5] === 'DISMANTLE_PLANNED' ? '  [dismantle-planned]' : ''),
  }));

  // ============================================================ LIVE MODE ==
  if (mode === 'live') {
    const plan = executed?.plan || preview?.plan;
    const eligible = preview?.eligible;
    const log = executed?.log || preview?.log;

    const devicePlanEntries = (() => {
      let planDevices = [];
      if (Array.isArray(plan?.devices) && plan.devices.length) {
        planDevices = plan.devices.map((device, index) => ({
          role: device.role || (index === 0 ? 'source' : 'planned'),
          device_id: device.device_id || device.id || device.name || '—',
          device_class:
            device.device_class || device.class_name || device.type || '—',
          hostname: device.hostname || device.host || '—',
          status: device.status || device.state || '—',
          site_id: device.site_id || device.site || plan?.source_site || '—',
        }));
      } else if (plan?.source_device || plan?.new_device) {
        const fallback = [];
        if (plan.source_device) {
          fallback.push({
            role: 'source',
            device_id: plan.source_device,
            device_class: plan.source_device_class || '—',
            hostname: plan.source_device_hostname || '—',
            status: plan.source_device_status || '—',
            site_id: plan.source_site || '—',
          });
        }
        if (plan.new_device) {
          fallback.push({
            role: 'planned',
            device_id: plan.new_device,
            device_class: plan.new_device_class || '—',
            hostname: plan.new_device_hostname || '—',
            status: 'planned',
            site_id: plan.target_site || '—',
          });
        }
        planDevices = fallback;
      }

      // Prefer the graph metadata for target devices and remove duplicates
      // where the same device also appears in the plan response.
      const byDeviceId = new Map();
      [...planDevices, ...targetGraphDevices].forEach((device) => {
        const existing = byDeviceId.get(device.device_id);
        byDeviceId.set(device.device_id, {
          ...existing,
          ...device,
          role: existing?.role === 'source' ? 'source' : device.role,
        });
      });
      return [...byDeviceId.values()];
    })();

    return (
      <div
        id="tab-whatif"
        className={`tab ${active ? 'active' : ''} gdb-panel whatif-simulation`}
      >
        <div className="page-title">What-if simulation</div>

        <div className="card whatif-intro">
          <h3>Site consolidation — automated discovery</h3>
          <p className="sub">
            Reads the current transport topology from GraphDB and discovers a potential source-to-destination site pair. <b>Run what-if analysis</b> is read-only. <b>Execute consolidation</b> runs the supplied Python engine, which performs the full business validation and writes the planned and target RDF graphs in GraphDB.
          </p>
          <div className="whatif-actions">
            <button
              className="btn blue"
              onClick={runPreview}
              disabled={previewing}
            >
              {previewing ? 'Running checks…' : '▶ Run what-if analysis'}
            </button>
            <button
              className="btn green"
              onClick={runExecute}
              disabled={!eligible || executing}
            >
              {executing
                ? 'Executing consolidation engine…'
                : '⚡ Execute consolidation'}
            </button>
          </div>
          <div className="note" style={{ marginTop: 8 }}>
            Planning candidates are discovered from the current GraphDB topology using the Python engine's geographic and device-inventory rules.
          </div>
        </div>

        {liveError && (
          <div className="card" style={{ marginBottom: 14 }}>
            <span className="badge no">ERROR</span> {liveError}
          </div>
        )}

        {preview && (
          <div className="row" style={{ marginBottom: 14 }}>
            <div
              className={eligible ? 'stat green' : 'stat'}
              style={eligible ? {} : { background: '#D64550' }}
            >
              <div className="v">{eligible ? 'ELIGIBLE' : 'NOT ELIGIBLE'}</div>
              <div className="l">
                {eligible
                  ? 'candidate discovered; final checks run on execute'
                  : 'no site passed all checks'}
              </div>
            </div>
            <div className="stat">
              <div className="v">{preview.cluster?.name || '—'}</div>
              <div className="l">cluster</div>
            </div>
            {plan ? (
              <>
                <div className="stat">
                  <div className="v">{plan.distance_km?.toFixed(1)} km</div>
                  <div className="l">source → target distance</div>
                </div>
                <div className="stat">
                  <div className="v">{plan.services?.length ?? 0}</div>
                  <div className="l">services to migrate</div>
                </div>
              </>
            ) : (
              preview.diagnostics && (
                <>
                  {preview.diagnostics.distance_km != null ? (
                    <div className="stat">
                      <div className="v">
                        {preview.diagnostics.distance_km.toFixed(1)} km
                      </div>
                      <div className="l">
                        source → target distance
                        <br />({preview.diagnostics.source_site} →{' '}
                        {preview.diagnostics.target_site})
                      </div>
                    </div>
                  ) : (
                    <div className="stat">
                      <div className="v">—</div>
                      <div className="l">source → target distance</div>
                    </div>
                  )}
                  {preview.diagnostics.services != null ? (
                    <div className="stat">
                      <div className="v">
                        {preview.diagnostics.services.length}
                      </div>
                      <div className="l">services to migrate</div>
                    </div>
                  ) : (
                    <div className="stat">
                      <div className="v">—</div>
                      <div className="l">
                        services to migrate (check not reached)
                      </div>
                    </div>
                  )}
                </>
              )
            )}
            {executed && (
              <div className="stat green">
                <div className="v">WRITTEN</div>
                <div className="l">planned and target GraphDB graphs updated</div>
              </div>
            )}
          </div>
        )}

        {preview && (
          <div className="row" style={{ marginBottom: 14 }}>
            {plan ? (
              <div className="card" style={{ flex: 1, minWidth: 440 }}>
                <h3>Proposed plan</h3>
                <div className="sub">
                  <b>{plan.source_site}</b> → <b>{plan.target_site}</b>
                  <br />
                  {devicePlanEntries.length > 0 ? (
                    devicePlanEntries.map((device, index) => (
                      <div
                        key={`${device.device_id}-${index}`}
                        style={{ marginTop: 6 }}
                      >
                        {device.role === 'source'
                          ? 'Source device'
                          : device.role === 'destination'
                          ? 'Destination device'
                          : 'Planned device'}
                        : <code>{device.device_id}</code> ({device.device_class}
                        ) — status: {device.status}
                        {device.hostname && device.hostname !== '—' ? (
                          <span>
                            , hostname <code>{device.hostname}</code>
                          </span>
                        ) : null}
                        {device.site_id ? (
                          <span>
                            {' '}
                            (site: <code>{device.site_id}</code>)
                          </span>
                        ) : null}
                      </div>
                    ))
                  ) : (
                    <span>
                      No device details available in the plan payload.
                    </span>
                  )}
                </div>

                <ResultsTable
                  columns={[
                    'role',
                    'device_id',
                    'device_class',
                    'hostname',
                    'status',
                    'site_id',
                  ]}
                  rows={devicePlanEntries.map((device) => [
                    device.role,
                    device.device_id,
                    device.device_class,
                    device.hostname,
                    device.status,
                    device.site_id,
                  ])}
                />

                <ResultsTable
                  columns={[
                    'service_id',
                    'service_type',
                    'bandwidth_mbps',
                    'from_device',
                    'to_device',
                  ]}
                  rows={(plan.services || []).map((s) => [
                    s.service_id,
                    s.service_type,
                    s.bandwidth_mbps,
                    s.from_device,
                    s.to_device,
                  ])}
                />
              </div>
            ) : (
              <div className="card" style={{ flex: 1, minWidth: 440 }}>
                <h3>Proposed plan</h3>
                <span className="note">
                  No dismantle site in{' '}
                  <b>{preview.cluster?.name || 'this cluster'}</b> passed all 6
                  business checks
                  {preview.diagnostics?.source_site &&
                    preview.diagnostics?.target_site && (
                      <>
                        {' '}
                        — last candidate evaluated was{' '}
                        <b>{preview.diagnostics.source_site}</b> →{' '}
                        <b>{preview.diagnostics.target_site}</b>
                      </>
                    )}
                  . See the Engine narration for exactly which check failed.
                </span>
              </div>
            )}
            <div className="card" style={{ flex: 1, minWidth: 440 }}>
              <h3>Engine narration</h3>
              {lastRunAt && (
                <div className="sub" style={{ marginTop: -4 }}>
                  Last run: <b>{lastRunAt.action}</b> at{' '}
                  {lastRunAt.at.toLocaleString()}
                </div>
              )}
              <div className="log" style={{ height: 260 }}>
                {log}
              </div>
            </div>
          </div>
        )}

        {!preview && !liveError && (
          <div className="card">
            <span className="note">
              Click "Run what-if analysis" to discover the consolidation
              candidate.
            </span>
          </div>
        )}
      </div>
    );
  }

  // ============================================================ DEMO MODE ==
  return (
    <div
      id="tab-whatif"
      className={`tab ${active ? 'active' : ''} gdb-panel whatif-simulation`}
    >
      <div className="page-title">What-if simulation</div>
      <div className="card whatif-intro">
        <h3>Site consolidation - automation discovery</h3>
        <p className="sub">
          Review impacted services and customers, migration readiness, capacity
          to re-home, and operating costs released for the selected site.
        </p>
        <div className="whatif-actions">
          {/* <select
            className="pill-select"
            value={site || ''}
            onChange={(e) => setSite(e.target.value)}
            aria-label="Select site for consolidation analysis"
          >
            {siteOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select> */}
          <button className="btn blue" onClick={runWhatIfDemo}>
            ▶ Run what-if analysis
          </button>
          <button
            className="btn green"
            onClick={simCutover}
            title="Demo only: simulate the consolidation cutover using local Transport data"
          >
            &#9889; Execute consolidation
          </button>
        </div>
      </div>

      {demoError && (
        <div className="card whatif-error" role="alert">
          <b>Analysis error:</b> {demoError}
        </div>
      )}

      {stats && (
        <div className="row">
          <div className="stat">
            <div className="v">{stats.pairs}</div>
            <div className="l">impacted service-customer pairs</div>
          </div>
          <div className="stat">
            <div className="v">{stats.subsHit.toLocaleString()}</div>
            <div className="l">subscribers in blast radius</div>
          </div>
          <div className="stat">
            <div className="v">{stats.gbps} Gbps</div>
            <div className="l">capacity to re-home</div>
          </div>
          <div className="stat">
            <div className="v">
              {stats.powerKw} kW &middot; {stats.sqm} m&sup2;
            </div>
            <div className="l">OPEX released at this site</div>
          </div>
          <div className="stat" style={{ background: statColor }}>
            <div className="v">
              {stats.readyCount === 0 ? 'N/A' : stats.allReady ? 'GO' : 'NO-GO'}
            </div>
            <div className="l">
              {stats.readyCount === 0
                ? 'no services at site'
                : stats.allReady
                ? 'all services have target paths'
                : 'blockers present'}
            </div>
          </div>
        </div>
      )}

      <div className="row" style={{ marginTop: 14 }}>
        <div className="card" style={{ flex: 1, minWidth: 440 }}>
          <h3>Blast radius — impacted services &amp; customers</h3>
          {blast ? (
            <ResultsTable columns={blast.columns} rows={blast.rows} />
          ) : (
            <div className="note">Run an analysis.</div>
          )}
        </div>
        <div className="card" style={{ flex: 1, minWidth: 440 }}>
          <h3>Migration readiness — go / no-go</h3>
          {ready ? (
            <ResultsTable columns={ready.columns} rows={ready.rows} />
          ) : (
            <div className="note">Run an analysis.</div>
          )}
        </div>
      </div>

      <div className="row" style={{ marginTop: 14 }}>
        <div className="card" style={{ flex: 1 }}>
          <h3>Simulation — UM cutover</h3>
          <div className="sub">
            The two UM services block the Wuppertal dismantle. Simulate planning
            their SRv6 target paths (writes TARGET hops into the twin), then
            re-run the analysis: the blockers disappear and the decision flips
            to GO.
          </div>
          <button className="btn red" onClick={simReset}>
            Reset simulation
          </button>
          <div className="log" style={{ height: 110, marginTop: 10 }}>
            {simLog.join('\n')}
          </div>
        </div>
      </div>
    </div>
  );
}
