// Mirror of 02_data.sql — used when the app is in Demo Mode (backend unreachable).
export function demoData() {
  return {
    sites: [
      ['SITE-DLS-01', 'Düsseldorf DLS', 'Düsseldorf', 'DLS', 'MOBILE_FIXED', 'MODERNIZE_PLANNED', 'AGG', 120, 450],
      ['SITE-POS-01', 'Neuss POS', 'Neuss', 'POS', 'MOBILE_FIXED', 'MODERNIZE_PLANNED', 'PREAGG', 60, 220],
      ['SITE-MPOS-01', 'Krefeld MPOS', 'Krefeld', 'MPOS', 'MOBILE_FIXED', 'MODERNIZE_PLANNED', 'ACCESSAGG', 35, 140],
      ['SITE-BPOP-01', 'Köln B-POP (KDG)', 'Köln', 'B_POP', 'KDG', 'DISMANTLE_PLANNED', 'NONE', 80, 300],
      ['SITE-APOP-01', 'Leverkusen A-POP (KDG)', 'Leverkusen', 'A_POP', 'KDG', 'MODERNIZE_PLANNED', 'ACCESSAGG', 40, 160],
      ['SITE-HUB-01', 'Wuppertal HUB (UM)', 'Wuppertal', 'HUB', 'UM', 'DISMANTLE_PLANNED', 'NONE', 75, 280],
      ['SITE-DAAS-01', 'Solingen DAAS (UM)', 'Solingen', 'DAAS_SITE', 'UM', 'MODERNIZE_PLANNED', 'ACCESSAGG', 38, 150]
    ],
    devices: [
      ['DEV-DLS-01', 'dls01.dus MPLS core-edge', 'ROUTER_MPLS', 'MPLS', 'DECOM_PLANNED', 'CURRENT', false],
      ['DEV-POS-01', 'pos01.neu MPLS aggregation', 'ROUTER_MPLS', 'MPLS', 'DECOM_PLANNED', 'CURRENT', false],
      ['DEV-MPOS-01', 'mpos01.kre MPLS access-agg', 'ROUTER_MPLS', 'MPLS', 'DECOM_PLANNED', 'CURRENT', false],
      ['DEV-MBNG-01', 'mbng01.kre broadband GW', 'MBNG', 'MPLS', 'DECOM_PLANNED', 'CURRENT', false],
      ['DEV-BPOP-01', 'bpop01.cgn KDG backbone POP', 'ROUTER_MPLS', 'MPLS', 'DECOM_PLANNED', 'CURRENT', false],
      ['DEV-APOP-01', 'cmts01.lev KDG CMTS', 'CMTS', 'DOCSIS', 'DECOM_PLANNED', 'CURRENT', false],
      ['DEV-HUB-01', 'hub01.wup UM hub router', 'ROUTER_MPLS', 'MPLS', 'DECOM_PLANNED', 'CURRENT', false],
      ['DEV-DAAS-01', 'daas01.sol UM DAAS node', 'CMTS', 'DOCSIS', 'DECOM_PLANNED', 'CURRENT', false],
      ['DEV-CELL-01', 'Cell site Krefeld-Nord 5G', 'CELL_SITE', 'ACCESS', 'ACTIVE', 'CURRENT', false],
      ['DEV-CELL-02', 'Cell site Krefeld-Süd 5G', 'CELL_SITE', 'ACCESS', 'ACTIVE', 'CURRENT', false],
      ['DEV-DSLAM-01', 'DSLAM Krefeld-Mitte', 'DSLAM', 'ACCESS', 'ACTIVE', 'CURRENT', false],
      ['DEV-COAX-KDG-01', 'Coax segment Leverkusen', 'COAX_AGG', 'ACCESS', 'ACTIVE', 'CURRENT', false],
      ['DEV-COAX-UM-01', 'Coax segment Solingen', 'COAX_AGG', 'ACCESS', 'ACTIVE', 'CURRENT', false],
      ['DEV-AGG-N01', 'agg-n01.dus SRv6 Agg', 'ROUTER_SRV6', 'SRV6', 'PLANNED_NEW', 'TARGET', true],
      ['DEV-PREAGG-N01', 'preagg-n01.neu SRv6 PreAgg', 'ROUTER_SRV6', 'SRV6', 'PLANNED_NEW', 'TARGET', true],
      ['DEV-CAAS-01', 'caas01.kre CAAS AccessAgg', 'CAAS', 'SRV6', 'PLANNED_NEW', 'TARGET', true],
      ['DEV-CAAS-02', 'caas02.lev CAAS AccessAgg', 'CAAS', 'SRV6', 'PLANNED_NEW', 'TARGET', true],
      ['DEV-CAAS-03', 'caas03.sol CAAS AccessAgg', 'CAAS', 'SRV6', 'PLANNED_NEW', 'TARGET', true]
    ],
    locatedAt: [
      ['DEV-DLS-01', 'SITE-DLS-01'], ['DEV-POS-01', 'SITE-POS-01'], ['DEV-MPOS-01', 'SITE-MPOS-01'],
      ['DEV-MBNG-01', 'SITE-MPOS-01'], ['DEV-BPOP-01', 'SITE-BPOP-01'], ['DEV-APOP-01', 'SITE-APOP-01'],
      ['DEV-HUB-01', 'SITE-HUB-01'], ['DEV-DAAS-01', 'SITE-DAAS-01'], ['DEV-CELL-01', 'SITE-MPOS-01'],
      ['DEV-CELL-02', 'SITE-MPOS-01'], ['DEV-DSLAM-01', 'SITE-MPOS-01'], ['DEV-COAX-KDG-01', 'SITE-APOP-01'],
      ['DEV-COAX-UM-01', 'SITE-DAAS-01'], ['DEV-AGG-N01', 'SITE-DLS-01'], ['DEV-PREAGG-N01', 'SITE-POS-01'],
      ['DEV-CAAS-01', 'SITE-MPOS-01'], ['DEV-CAAS-02', 'SITE-APOP-01'], ['DEV-CAAS-03', 'SITE-DAAS-01']
    ],
    links: [
      ['LNK-C-001', 'DEV-DLS-01', 'DEV-POS-01', 'FIBER', 100, 'CURRENT'], ['LNK-C-002', 'DEV-POS-01', 'DEV-MPOS-01', 'FIBER', 40, 'CURRENT'],
      ['LNK-C-003', 'DEV-POS-01', 'DEV-MBNG-01', 'FIBER', 40, 'CURRENT'], ['LNK-C-004', 'DEV-CELL-01', 'DEV-MPOS-01', 'FIBER', 10, 'CURRENT'],
      ['LNK-C-005', 'DEV-CELL-02', 'DEV-MPOS-01', 'FIBER', 10, 'CURRENT'], ['LNK-C-006', 'DEV-DSLAM-01', 'DEV-MBNG-01', 'FIBER', 10, 'CURRENT'],
      ['LNK-C-007', 'DEV-BPOP-01', 'DEV-APOP-01', 'FIBER', 40, 'CURRENT'], ['LNK-C-008', 'DEV-COAX-KDG-01', 'DEV-APOP-01', 'COAX', 5, 'CURRENT'],
      ['LNK-C-009', 'DEV-HUB-01', 'DEV-DAAS-01', 'FIBER', 40, 'CURRENT'], ['LNK-C-010', 'DEV-COAX-UM-01', 'DEV-DAAS-01', 'COAX', 5, 'CURRENT'],
      ['LNK-T-001', 'DEV-AGG-N01', 'DEV-PREAGG-N01', 'FIBER', 400, 'TARGET'], ['LNK-T-002', 'DEV-PREAGG-N01', 'DEV-CAAS-01', 'FIBER', 100, 'TARGET'],
      ['LNK-T-003', 'DEV-PREAGG-N01', 'DEV-CAAS-02', 'FIBER', 100, 'TARGET'], ['LNK-T-004', 'DEV-PREAGG-N01', 'DEV-CAAS-03', 'FIBER', 100, 'TARGET'],
      ['LNK-T-005', 'DEV-CELL-01', 'DEV-CAAS-01', 'FIBER', 25, 'TARGET'], ['LNK-T-006', 'DEV-CELL-02', 'DEV-CAAS-01', 'FIBER', 25, 'TARGET'],
      ['LNK-T-007', 'DEV-DSLAM-01', 'DEV-CAAS-01', 'FIBER', 25, 'TARGET'], ['LNK-T-008', 'DEV-COAX-KDG-01', 'DEV-CAAS-02', 'COAX', 5, 'TARGET'],
      ['LNK-T-009', 'DEV-COAX-UM-01', 'DEV-CAAS-03', 'COAX', 5, 'TARGET']
    ],
    customers: [
      ['CUST-001', 'RheinBank AG (Enterprise)', 'ENTERPRISE', 1], ['CUST-002', 'AutoWerk GmbH (Enterprise)', 'ENTERPRISE', 1],
      ['CUST-003', 'Residential Leverkusen (KDG)', 'RESIDENTIAL_AGG', 12500], ['CUST-004', 'Residential Solingen (UM)', 'RESIDENTIAL_AGG', 9800],
      ['CUST-005', 'Residential Krefeld DSL', 'RESIDENTIAL_AGG', 6200], ['CUST-006', 'MobileCo Wholesale (5G)', 'ENTERPRISE', 1]
    ],
    services: [
      ['SVC-L3VPN-001', 'RheinBank L3VPN branch connect', 'L3VPN', 'ENTERPRISE', 'TARGET_PATH_PLANNED'],
      ['SVC-L2VPN-001', 'AutoWerk L2VPN plant link', 'L2VPN', 'ENTERPRISE', 'TARGET_PATH_PLANNED'],
      ['SVC-INET-KDG-01', 'Residential Internet KDG (DOCSIS)', 'INTERNET_DOCSIS', 'RESIDENTIAL', 'TARGET_PATH_PLANNED'],
      ['SVC-INET-UM-01', 'Residential Internet UM (DOCSIS)', 'INTERNET_DOCSIS', 'RESIDENTIAL', 'NOT_STARTED'],
      ['SVC-IPTV-UM-01', 'IPTV Multicast UM', 'MULTICAST_IPTV', 'RESIDENTIAL', 'NOT_STARTED'],
      ['SVC-MOB-001', '5G mobile backhaul Krefeld', 'MOBILE_BACKHAUL', 'ENTERPRISE', 'MIGRATED'],
      ['SVC-DSL-001', 'Residential DSL Krefeld', 'INTERNET_DSL', 'RESIDENTIAL', 'TARGET_PATH_PLANNED']
    ],
    subscribes: [
      ['CUST-001', 'SVC-L3VPN-001'], ['CUST-002', 'SVC-L2VPN-001'], ['CUST-003', 'SVC-INET-KDG-01'],
      ['CUST-004', 'SVC-INET-UM-01'], ['CUST-004', 'SVC-IPTV-UM-01'], ['CUST-005', 'SVC-DSL-001'], ['CUST-006', 'SVC-MOB-001']
    ],
    traverses: [
      ['SVC-L3VPN-001', 'DEV-MPOS-01', 'CURRENT', 1], ['SVC-L3VPN-001', 'DEV-POS-01', 'CURRENT', 2], ['SVC-L3VPN-001', 'DEV-DLS-01', 'CURRENT', 3],
      ['SVC-L2VPN-001', 'DEV-MPOS-01', 'CURRENT', 1], ['SVC-L2VPN-001', 'DEV-POS-01', 'CURRENT', 2], ['SVC-L2VPN-001', 'DEV-DLS-01', 'CURRENT', 3],
      ['SVC-INET-KDG-01', 'DEV-COAX-KDG-01', 'CURRENT', 1], ['SVC-INET-KDG-01', 'DEV-APOP-01', 'CURRENT', 2], ['SVC-INET-KDG-01', 'DEV-BPOP-01', 'CURRENT', 3],
      ['SVC-INET-UM-01', 'DEV-COAX-UM-01', 'CURRENT', 1], ['SVC-INET-UM-01', 'DEV-DAAS-01', 'CURRENT', 2], ['SVC-INET-UM-01', 'DEV-HUB-01', 'CURRENT', 3],
      ['SVC-IPTV-UM-01', 'DEV-DAAS-01', 'CURRENT', 1], ['SVC-IPTV-UM-01', 'DEV-HUB-01', 'CURRENT', 2],
      ['SVC-MOB-001', 'DEV-CELL-01', 'CURRENT', 1], ['SVC-MOB-001', 'DEV-CELL-02', 'CURRENT', 2], ['SVC-MOB-001', 'DEV-MPOS-01', 'CURRENT', 3],
      ['SVC-MOB-001', 'DEV-POS-01', 'CURRENT', 4], ['SVC-MOB-001', 'DEV-DLS-01', 'CURRENT', 5],
      ['SVC-DSL-001', 'DEV-DSLAM-01', 'CURRENT', 1], ['SVC-DSL-001', 'DEV-MBNG-01', 'CURRENT', 2], ['SVC-DSL-001', 'DEV-POS-01', 'CURRENT', 3], ['SVC-DSL-001', 'DEV-DLS-01', 'CURRENT', 4],
      ['SVC-L3VPN-001', 'DEV-CAAS-01', 'TARGET', 1], ['SVC-L3VPN-001', 'DEV-PREAGG-N01', 'TARGET', 2], ['SVC-L3VPN-001', 'DEV-AGG-N01', 'TARGET', 3],
      ['SVC-L2VPN-001', 'DEV-CAAS-01', 'TARGET', 1], ['SVC-L2VPN-001', 'DEV-PREAGG-N01', 'TARGET', 2], ['SVC-L2VPN-001', 'DEV-AGG-N01', 'TARGET', 3],
      ['SVC-INET-KDG-01', 'DEV-COAX-KDG-01', 'TARGET', 1], ['SVC-INET-KDG-01', 'DEV-CAAS-02', 'TARGET', 2], ['SVC-INET-KDG-01', 'DEV-PREAGG-N01', 'TARGET', 3], ['SVC-INET-KDG-01', 'DEV-AGG-N01', 'TARGET', 4],
      ['SVC-MOB-001', 'DEV-CELL-01', 'TARGET', 1], ['SVC-MOB-001', 'DEV-CELL-02', 'TARGET', 2], ['SVC-MOB-001', 'DEV-CAAS-01', 'TARGET', 3], ['SVC-MOB-001', 'DEV-PREAGG-N01', 'TARGET', 4], ['SVC-MOB-001', 'DEV-AGG-N01', 'TARGET', 5],
      ['SVC-DSL-001', 'DEV-DSLAM-01', 'TARGET', 1], ['SVC-DSL-001', 'DEV-CAAS-01', 'TARGET', 2], ['SVC-DSL-001', 'DEV-PREAGG-N01', 'TARGET', 3], ['SVC-DSL-001', 'DEV-AGG-N01', 'TARGET', 4]
    ],
    migrates: [
      ['DEV-DLS-01', 'DEV-AGG-N01', 'MVP', 'IN_PROGRESS'], ['DEV-POS-01', 'DEV-PREAGG-N01', 'MVP', 'IN_PROGRESS'],
      ['DEV-MPOS-01', 'DEV-CAAS-01', 'MVP', 'PLANNED'], ['DEV-MBNG-01', 'DEV-CAAS-01', 'MVP', 'PLANNED'],
      ['DEV-APOP-01', 'DEV-CAAS-02', 'MVP', 'PLANNED'], ['DEV-DAAS-01', 'DEV-CAAS-03', 'MVP', 'PLANNED']
    ],
    consolidates: [
      ['SITE-BPOP-01', 'SITE-DLS-01', 'KDG backbone POP functions absorbed by modernized Agg site'],
      ['SITE-HUB-01', 'SITE-POS-01', 'UM hub functions absorbed by modernized PreAgg site']
    ]
  };
}

// Index helpers over a demoData()-shaped object -- mirror of the original `bySite`, `byDev`, etc.
export function makeHelpers(data) {
  const bySite = id => data.sites.find(s => s[0] === id);
  const byDev = id => data.devices.find(d => d[0] === id);
  const bySvc = id => data.services.find(v => v[0] === id);
  const devsAt = site => data.locatedAt.filter(l => l[1] === site).map(l => l[0]);
  const siteOf = dev => (data.locatedAt.find(l => l[0] === dev) || [])[1];
  const hasTargetPath = svc => data.traverses.some(t => t[0] === svc && t[2] === 'TARGET');
  const T = state => data.traverses.filter(t => t[2] === state);
  return { bySite, byDev, bySvc, devsAt, siteOf, hasTargetPath, T };
}

export function demoGraph(data) {
  const g = { nodes: [], edges: [] };
  data.sites.forEach(s => g.nodes.push({ id: s[0], label: s[1], group: 'site', props: { type: s[3], domain: s[4], lifecycle: s[5], target_role: s[6], power_kw: s[7], sqm: s[8] } }));
  data.devices.forEach(d => g.nodes.push({ id: d[0], label: d[1], group: d[5] === 'TARGET' ? 'device_target' : 'device', props: { type: d[2], plane: d[3], lifecycle: d[4], twin_state: d[5], sdn: d[6] } }));
  data.services.forEach(v => g.nodes.push({ id: v[0], label: v[1], group: 'service', props: { type: v[2], sla: v[3], migration_status: v[4] } }));
  data.customers.forEach(c => g.nodes.push({ id: c[0], label: c[1], group: 'customer', props: { segment: c[2], subscribers: c[3] } }));
  data.locatedAt.forEach(l => g.edges.push({ from: l[0], to: l[1], kind: 'LOCATED_AT' }));
  data.links.forEach(l => g.edges.push({ from: l[1], to: l[2], kind: 'CONNECTS', state: l[5], gbps: l[4] }));
  data.traverses.forEach(t => g.edges.push({ from: t[0], to: t[1], kind: 'TRAVERSES', state: t[2], seq: t[3] }));
  data.subscribes.forEach(x => g.edges.push({ from: x[0], to: x[1], kind: 'SUBSCRIBES' }));
  data.migrates.forEach(m => g.edges.push({ from: m[0], to: m[1], kind: 'MIGRATES_TO', status: m[3] }));
  data.consolidates.forEach(c => g.edges.push({ from: c[0], to: c[1], kind: 'CONSOLIDATES_INTO' }));
  return g;
}
