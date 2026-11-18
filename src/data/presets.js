// Preset GQL scenarios. `gql` runs verbatim against Spanner in live mode.
// `local(data, helpers)` computes the equivalent result against the demo dataset.
export function buildPresets(data, helpers) {
  const { bySite, byDev, bySvc, siteOf, hasTargetPath, T } = helpers;

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

  return [
    {
      id: 'Q1.1',
      stage: 'STAGE 1 — CURRENT STATE',
      title: 'Inventory by network domain',
      gql: `GRAPH SCTTwin\nMATCH (d:Device {twin_state: 'CURRENT'})-[:LOCATED_AT]->(s:Site)\nRETURN s.network_domain, COUNT(DISTINCT s.site_id) AS sites,\n       COUNT(DISTINCT d.device_id) AS devices\nORDER BY s.network_domain`,
      local() {
        const m = {};
        data.locatedAt.forEach((l) => {
          const d = byDev(l[0]);
          if (d[5] !== 'CURRENT') return;
          const s = bySite(l[1]);
          m[s[4]] = m[s[4]] || { sites: new Set(), devs: new Set() };
          m[s[4]].sites.add(s[0]);
          m[s[4]].devs.add(d[0]);
        });
        return {
          columns: ['network_domain', 'sites', 'devices'],
          rows: Object.entries(m)
            .sort()
            .map(([k, v]) => [k, v.sites.size, v.devs.size]),
        };
      },
    },
    {
      id: 'Q1.2',
      stage: 'STAGE 1 — CURRENT STATE',
      title: 'End-to-end chain: RheinBank L3VPN',
      gql: `GRAPH SCTTwin\nMATCH (c:Customer {customer_id: 'CUST-001'})-[:SUBSCRIBES]->(sv:Service)\n      -[t:TRAVERSES {twin_state: 'CURRENT'}]->(d:Device)-[:LOCATED_AT]->(s:Site)\nRETURN c.name, sv.name, t.hop_seq, d.name AS device, s.name AS site\nORDER BY t.hop_seq`,
      local() {
        const svcs = data.subscribes
          .filter((x) => x[0] === 'CUST-001')
          .map((x) => x[1]);
        const rows = [];
        T('CURRENT')
          .filter((t) => svcs.includes(t[0]))
          .sort((a, b) => a[3] - b[3])
          .forEach((t) =>
            rows.push([
              'RheinBank AG',
              bySvc(t[0])[1],
              t[3],
              byDev(t[1])[1],
              bySite(siteOf(t[1]))[1],
            ])
          );
        return {
          columns: ['customer', 'service', 'hop_seq', 'device', 'site'],
          rows,
        };
      },
    },
    {
      id: 'Q1.3',
      stage: 'STAGE 1 — CURRENT STATE',
      title: 'Service load per site',
      gql: `GRAPH SCTTwin\nMATCH (sv:Service)-[:TRAVERSES {twin_state: 'CURRENT'}]->(d:Device)\n      -[:LOCATED_AT]->(s:Site)\nRETURN s.name AS site, s.lifecycle_state,\n       COUNT(DISTINCT sv.service_id) AS services_touching_site\nORDER BY services_touching_site DESC`,
      local() {
        const m = {};
        T('CURRENT').forEach((t) => {
          const s = siteOf(t[1]);
          m[s] = m[s] || new Set();
          m[s].add(t[0]);
        });
        return {
          columns: ['site', 'lifecycle_state', 'services'],
          rows: Object.entries(m)
            .map(([s, v]) => [bySite(s)[1], bySite(s)[5], v.size])
            .sort((a, b) => b[2] - a[2]),
        };
      },
    },
    {
      id: 'Q2.1',
      stage: 'STAGE 2 — WHAT-IF',
      title: 'Blast radius: dismantle Wuppertal HUB',
      gql: `GRAPH SCTTwin\nMATCH (c:Customer)-[:SUBSCRIBES]->(sv:Service)\n      -[:TRAVERSES {twin_state: 'CURRENT'}]->(d:Device)\n      -[:LOCATED_AT]->(s:Site {site_id: 'SITE-HUB-01'})\nRETURN s.name, sv.name AS impacted_service, sv.sla_class,\n       c.name AS impacted_customer, c.subscriber_count\nORDER BY c.subscriber_count DESC`,
      local() {
        return blastLocal('SITE-HUB-01');
      },
    },
    {
      id: 'Q2.2',
      stage: 'STAGE 2 — WHAT-IF',
      title: 'Migration blockers (no target path)',
      gql: `GRAPH SCTTwin\nMATCH (sv:Service)-[:TRAVERSES {twin_state: 'CURRENT'}]->(d:Device)\n      -[:LOCATED_AT]->(s:Site {lifecycle_state: 'DISMANTLE_PLANNED'})\nWHERE NOT EXISTS { MATCH (sv)-[:TRAVERSES {twin_state: 'TARGET'}]->(:Device) }\nRETURN DISTINCT s.name AS blocking_site, sv.name AS unmigrated_service,\n       sv.migration_status`,
      local() {
        const rows = [];
        const seen = new Set();
        T('CURRENT').forEach((t) => {
          const s = bySite(siteOf(t[1]));
          if (s[5] !== 'DISMANTLE_PLANNED') return;
          if (hasTargetPath(t[0])) return;
          const k = s[0] + t[0];
          if (seen.has(k)) return;
          seen.add(k);
          rows.push([s[1], bySvc(t[0])[1], bySvc(t[0])[4]]);
        });
        return {
          columns: ['blocking_site', 'unmigrated_service', 'migration_status'],
          rows,
        };
      },
    },
    {
      id: 'Q2.3',
      stage: 'STAGE 2 — WHAT-IF',
      title: 'Safe-to-dismantle check: Köln B-POP',
      gql: `GRAPH SCTTwin\nMATCH (sv:Service)-[:TRAVERSES {twin_state: 'CURRENT'}]->(d:Device)\n      -[:LOCATED_AT]->(s:Site {site_id: 'SITE-BPOP-01'})\nRETURN DISTINCT sv.name AS service, sv.migration_status,\n       EXISTS { MATCH (sv)-[:TRAVERSES {twin_state: 'TARGET'}]->(:Device) }\n       AS target_path_ready`,
      local() {
        const rows = [];
        const seen = new Set();
        T('CURRENT').forEach((t) => {
          if (siteOf(t[1]) !== 'SITE-BPOP-01' || seen.has(t[0])) return;
          seen.add(t[0]);
          rows.push([bySvc(t[0])[1], bySvc(t[0])[4], hasTargetPath(t[0])]);
        });
        return {
          columns: ['service', 'migration_status', 'target_path_ready'],
          rows,
        };
      },
    },
    {
      id: 'Q2.4',
      stage: 'STAGE 2 — WHAT-IF',
      title: 'OPEX release from dismantles',
      gql: `GRAPH SCTTwin\nMATCH (s:Site {lifecycle_state: 'DISMANTLE_PLANNED'})\nRETURN COUNT(s.site_id) AS sites_to_dismantle,\n       SUM(s.power_kw) AS power_kw_released,\n       SUM(s.floor_space_sqm) AS sqm_released`,
      local() {
        const d = data.sites.filter((s) => s[5] === 'DISMANTLE_PLANNED');
        return {
          columns: ['sites_to_dismantle', 'power_kw_released', 'sqm_released'],
          rows: [
            [
              d.length,
              d.reduce((a, s) => a + s[7], 0),
              d.reduce((a, s) => a + s[8], 0),
            ],
          ],
        };
      },
    },
    {
      id: 'Q3.1',
      stage: 'STAGE 3 — PLANNED STATE',
      title: 'Device migration map',
      gql: `GRAPH SCTTwin\nMATCH (old:Device)-[m:MIGRATES_TO]->(new:Device)\nRETURN old.name AS legacy_device, old.routing_plane AS from_plane,\n       new.name AS target_device, new.routing_plane AS to_plane,\n       m.cutover_status\nORDER BY m.cutover_status`,
      local() {
        return {
          columns: [
            'legacy_device',
            'from_plane',
            'target_device',
            'to_plane',
            'cutover_status',
          ],
          rows: data.migrates
            .map((m) => [
              byDev(m[0])[1],
              byDev(m[0])[3],
              byDev(m[1])[1],
              byDev(m[1])[3],
              m[3],
            ])
            .sort((a, b) => a[4].localeCompare(b[4])),
        };
      },
    },
    {
      id: 'Q3.2',
      stage: 'STAGE 3 — PLANNED STATE',
      title: 'Site consolidation map',
      gql: `GRAPH SCTTwin\nMATCH (a:Site)-[c:CONSOLIDATES_INTO]->(b:Site)\nRETURN a.name AS dismantled_site, b.name AS absorbing_site, c.rationale`,
      local() {
        return {
          columns: ['dismantled_site', 'absorbing_site', 'rationale'],
          rows: data.consolidates.map((c) => [
            bySite(c[0])[1],
            bySite(c[1])[1],
            c[2],
          ]),
        };
      },
    },
    {
      id: 'Q3.3',
      stage: 'STAGE 3 — PLANNED STATE',
      title: 'Before/after path: 5G backhaul',
      gql: `GRAPH SCTTwin\nMATCH (sv:Service {service_id: 'SVC-MOB-001'})-[t:TRAVERSES]->(d:Device)\nRETURN t.twin_state, t.hop_seq, d.name AS hop_device, d.routing_plane\nORDER BY t.twin_state, t.hop_seq`,
      local() {
        return {
          columns: ['twin_state', 'hop_seq', 'hop_device', 'routing_plane'],
          rows: data.traverses
            .filter((t) => t[0] === 'SVC-MOB-001')
            .sort((a, b) => a[2].localeCompare(b[2]) || a[3] - b[3])
            .map((t) => [t[2], t[3], byDev(t[1])[1], byDev(t[1])[3]]),
        };
      },
    },
    {
      id: 'Q4.1',
      stage: 'STAGE 4 — TARGET STATE',
      title: 'Consolidation KPI: sites by lifecycle',
      gql: `GRAPH SCTTwin\nMATCH (s:Site)\nRETURN s.lifecycle_state, COUNT(s.site_id) AS sites\nORDER BY s.lifecycle_state`,
      local() {
        const m = {};
        data.sites.forEach((s) => (m[s[5]] = (m[s[5]] || 0) + 1));
        return {
          columns: ['lifecycle_state', 'sites'],
          rows: Object.entries(m).sort(),
        };
      },
    },
    {
      id: 'Q4.2',
      stage: 'STAGE 4 — TARGET STATE',
      title: 'Consistency gate (0 rows = clean)',
      gql: `GRAPH SCTTwin\nMATCH (sv:Service)-[:TRAVERSES {twin_state: 'TARGET'}]->(d:Device)\n      -[:LOCATED_AT]->(s:Site {lifecycle_state: 'DISMANTLE_PLANNED'})\nRETURN sv.name AS violating_service, d.name AS device, s.name AS site`,
      local() {
        const rows = [];
        T('TARGET').forEach((t) => {
          const s = bySite(siteOf(t[1]));
          if (s[5] === 'DISMANTLE_PLANNED')
            rows.push([bySvc(t[0])[1], byDev(t[1])[1], s[1]]);
        });
        return { columns: ['violating_service', 'device', 'site'], rows };
      },
    },
    {
      id: 'Q4.3',
      stage: 'STAGE 4 — TARGET STATE',
      title: 'Target chain: customer to rack',
      gql: `GRAPH SCTTwin\nMATCH (c:Customer)-[:SUBSCRIBES]->(sv:Service {service_id: 'SVC-MOB-001'})\n      -[t:TRAVERSES {twin_state: 'TARGET'}]->(d:Device)-[:LOCATED_AT]->(s:Site)\nRETURN c.name, sv.name, t.hop_seq, d.name AS device, s.name AS site,\n       s.target_role\nORDER BY t.hop_seq`,
      local() {
        const cust = data.subscribes.find((x) => x[1] === 'SVC-MOB-001')[0];
        return {
          columns: [
            'customer',
            'service',
            'hop_seq',
            'device',
            'site',
            'target_role',
          ],
          rows: T('TARGET')
            .filter((t) => t[0] === 'SVC-MOB-001')
            .sort((a, b) => a[3] - b[3])
            .map((t) => {
              const s = bySite(siteOf(t[1]));
              return [
                data.customers.find((c) => c[0] === cust)[1],
                '5G mobile backhaul',
                t[3],
                byDev(t[1])[1],
                s[1],
                s[6],
              ];
            }),
        };
      },
    },
  ];
}
