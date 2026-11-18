import { useState } from 'react';
import { apiCall, endpoints } from '../api';

export default function IngestTab({ active, mode, apiUrl, data }) {
  const [log, setLog] = useState(['Ready.']);

  function ilog(msg) {
    setLog(prev => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`]);
  }

  const live = mode === 'live';

  // async function verify() {
  //   try {
  //     if (live) {
  //       const r = await apiCall(apiUrl, endpoints.ingestVerify());
  //       ilog('Row counts: ' + Object.entries(r).map(([k, v]) => `${k}=${v}`).join('  '));
  //     } else {
  //       const d = data;
  //       ilog(`DEMO counts: Site=${d.sites.length} Device=${d.devices.length} Service=${d.services.length} ` +
  //         `Customer=${d.customers.length} Link=${d.links.length} Traverses=${d.traverses.length}`);
  //     }
  //   } catch (e) {
  //     ilog('ERROR: ' + e.message);
  //   }
  // }
  async function verify() {
  try {
    if (live) {
      const r = await apiCall(apiUrl, endpoints.ingestVerify());
      ilog('Row counts: ' + Object.entries(r).map(([k, v]) => `${k}=${v}`).join('  '));

      // Per-cluster breakdown (Sites / Devices / Services / Connections)
      const siteQ = `GRAPH SctTwin\nMATCH (s:Site)-[:ASSIGNED_TO]->(c:Cluster)\nRETURN c.cluster_id AS cluster, c.name AS cluster_name, COUNT(DISTINCT s.site_id) AS sites\nORDER BY cluster`;
      const devQ = `GRAPH SctTwin\nMATCH (d:Device)-[:LOCATED_AT]->(s:Site)-[:ASSIGNED_TO]->(c:Cluster)\nRETURN c.cluster_id AS cluster, COUNT(DISTINCT d.device_id) AS devices\nORDER BY cluster`;
      const svcQ = `GRAPH SctTwin\nMATCH (svc:Service)-[:TRAVERSES]->(d:Device)-[:LOCATED_AT]->(s:Site)-[:ASSIGNED_TO]->(c:Cluster)\nRETURN c.cluster_id AS cluster, COUNT(DISTINCT svc.service_id) AS services\nORDER BY cluster`;
      const connQ = `GRAPH SctTwin\nMATCH (a:Device)-[:CONNECTS]->(b:Device), (a)-[:LOCATED_AT]->(s:Site)-[:ASSIGNED_TO]->(c:Cluster)\nRETURN c.cluster_id AS cluster, COUNT(*) AS connections\nORDER BY cluster`;

      const [siteRes, devRes, svcRes, connRes] = await Promise.all([
        apiCall(apiUrl, endpoints.query(siteQ), { method: 'GET' }),
        apiCall(apiUrl, endpoints.query(devQ), { method: 'GET' }),
        apiCall(apiUrl, endpoints.query(svcQ), { method: 'GET' }),
        apiCall(apiUrl, endpoints.query(connQ), { method: 'GET' }),
      ]);

      const clusters = {};
      siteRes.rows.forEach(([cluster, name, sites]) => {
        clusters[cluster] = { name, sites, devices: 0, services: 0, connections: 0 };
      });
      devRes.rows.forEach(([cluster, devices]) => { if (clusters[cluster]) clusters[cluster].devices = devices; });
      svcRes.rows.forEach(([cluster, services]) => { if (clusters[cluster]) clusters[cluster].services = services; });
      connRes.rows.forEach(([cluster, connections]) => { if (clusters[cluster]) clusters[cluster].connections = connections; });

      Object.entries(clusters).forEach(([id, c]) => {
        // ilog(`Cluster: ${c.name} [${id}]`);
        // ilog(`  • Sites : ${c.sites}`);
        // ilog(`  • Devices : ${c.devices}`);
        // ilog(`  • Services : ${c.services}`);
        // ilog(`  • Connections : ${c.connections}`);
        ilog(`Cluster: ${c.name} [${id}]`);
        ilog(`  Sites : ${c.sites}`);
        ilog(`  Devices : ${c.devices}`);
        ilog(`  Services : ${c.services}`);
        ilog(`  Connections : ${c.connections}`);
        
      });
    } else {
      const d = data;
      ilog(`DEMO counts: Site=${d.sites.length} Device=${d.devices.length} Service=${d.services.length} ` +
        `Customer=${d.customers.length} Link=${d.links.length} Traverses=${d.traverses.length}`);
    }
  } catch (e) {
    ilog('ERROR: ' + e.message);
  }
}

  return (
    <div id="tab-ingest" className={`tab ${active ? 'active' : ''}`}>
      <div className="page-title">Data ingestion</div>
      <div className="row">
        <div className="card" style={{ flex: 1, minWidth: 330 }}>
          <h3>Verify</h3>
          <div className="sub">Row counts per table across all three graphs (Current / PS1 / Target) — confirms the twin is populated.</div>
          <button className="btn green" onClick={verify}>Verify counts</button>
        </div>
      </div>      
      <div className="row" style={{ marginTop: 16 }}>
        <div className="card" style={{ flex: 1 }}>
          <h3>Ingestion log</h3>
          <div className="log">{log.join('\n')}</div>
        </div>
      </div>
      <div className="row" style={{ marginTop: 16 }}>
        <div className="card" style={{ flex: 1 }}>
          <h3>Custom DML</h3>
          <div className="sub">Single INSERT / UPDATE / DELETE against the twin — e.g. onboard a new site/device.</div>
          <textarea style={{height:"85px"}} type='text' value="INSERT INTO `Device` (`device_id`, `hostname`, `class_name`, `vendor_model`, `sw_version`, `srv6_capable`, `state`, `disposition`, `max_bandwidth_mbps`, `current_bandwidth_mbps`, `supports_l3vpn`, `supports_l2vpn`, `supports_multicast`, `supports_internet`) VALUES ('D_001', 'router-01.net', 'Router', 'VendorX-ModelY', 'v1.0.0', TRUE, 'Active', 'Production', 10000, 2500, TRUE, TRUE, FALSE, TRUE)"></textarea>
          <button class="btn" onclick="" style={{marginTop:'8px'}} disabled={true}>Execute DML</button>         
        </div>
      </div>
    </div>
  );
}
