import { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  Waypoints,
  Zap,
  RefreshCw,
  Database,
  CircleCheck,
  CircleAlert,
  Gauge,
  Network,
} from 'lucide-react';
import Header from '../components/Header';
import Sidebar from '../components/Sidebar';
import CoreGraphTab from '../components/core/CoreGraphTab';
import TrafficIngestionTab from '../components/core/TrafficIngestionTab';
import WhatIfCoreTab from '../components/core/WhatIfCoreTab';
import { checkGraphDB, loadGraph, loadMetrics, GRAPHDB } from '../graphdbApi';

const MENU = [
  { key: 'graph', label: 'Ontology Graph', Icon: Waypoints },
  { key: 'traffic', label: 'Traffic Ingestion', Icon: Activity },
  { key: 'whatif', label: 'What-If', Icon: Zap },
];
const EMPTY = { nodes: [], edges: [] };
function Metric({ icon: Icon, label, value, sub, tone = 'blue' }) {
  return (
    <div className="gdb-metric">
      <div className={`gdb-metric-icon ${tone}`}>
        <Icon size={19} />
      </div>
      <div>
        <div className="gdb-metric-label">{label}</div>
        <div className="gdb-metric-value">{value}</div>
        <div className="gdb-metric-sub">{sub}</div>
      </div>
    </div>
  );
}
function TrafficPanel({ metrics, loading, refresh }) {
  const total = metrics.reduce((a, m) => a + m.sessions, 0);
  const cap = metrics.reduce((a, m) => a + m.capacity, 0);
  const cpu = metrics.length ? Math.max(...metrics.map((m) => m.cpu)) : 0;
  return (
    <section className="tab active gdb-panel">
      <div className="gdb-title-row">
        <div>
          <div className="page-title">UPF traffic telemetry</div>
          <p className="gdb-muted">
            Live values queried from the GraphDB telemetry named graph.
          </p>
        </div>
        <button className="gdb-refresh" onClick={refresh}>
          <RefreshCw size={15} /> Refresh
        </button>
      </div>
      <div className="gdb-metrics">
        <Metric
          icon={Activity}
          label="Active PDU sessions"
          value={total.toLocaleString()}
          sub={
            cap
              ? `${Math.round((total / cap) * 100)}% of total capacity`
              : 'Capacity not found'
          }
          tone="blue"
        />
        <Metric
          icon={Gauge}
          label="Peak UPF CPU"
          value={`${cpu.toFixed(1)}%`}
          sub={
            cpu > 85
              ? 'Above configured 85% threshold'
              : 'Below configured 85% threshold'
          }
          tone={cpu > 85 ? 'red' : 'teal'}
        />
        <Metric
          icon={Network}
          label="UPF instances"
          value={metrics.length}
          sub="Discovered from repository data"
          tone="purple"
        />
      </div>
      <div className="gdb-card">
        <div className="gdb-card-heading">
          <div>
            <h3>UPF instances</h3>
            <p>Current graph baseline with telemetry overlays</p>
          </div>
          <span className="gdb-live-dot">
            {loading ? 'Refreshing…' : 'GraphDB data'}
          </span>
        </div>
        {metrics.length ? (
          <div className="gdb-table-wrap">
            <table className="gdb-table">
              <thead>
                <tr>
                  <th>Network function</th>
                  <th>CPU utilization</th>
                  <th>Active sessions</th>
                  <th>Max capacity</th>
                  <th>Capacity usage</th>
                </tr>
              </thead>
              <tbody>
                {metrics.map((m) => (
                  <tr key={m.id}>
                    <td>
                      <strong>{m.name}</strong>
                      <small>{m.id}</small>
                    </td>
                    <td>
                      <span
                        className={`gdb-pill ${
                          m.cpu > 85 ? 'danger' : 'normal'
                        }`}
                      >
                        {m.cpu.toFixed(2)}%
                      </span>
                    </td>
                    <td>{m.sessions.toLocaleString()}</td>
                    <td>{m.capacity.toLocaleString()}</td>
                    <td>
                      <div className="gdb-progress">
                        <span
                          style={{
                            width: `${Math.min(
                              100,
                              m.capacity ? (m.sessions / m.capacity) * 100 : 0
                            )}%`,
                          }}
                        />
                      </div>
                      <small>
                        {m.capacity
                          ? ((m.sessions / m.capacity) * 100).toFixed(1)
                          : '0.0'}
                        %
                      </small>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="gdb-empty">
            No UPF session/capacity records were found in the default graph.
            Check that the ingestion script has populated the expected
            repository.
          </div>
        )}
      </div>
      <div className="gdb-note">
        <Database size={17} />
        <div>
          <strong>Data behavior</strong>
          <p>
            The Python ingestion script writes changing session and CPU values
            to the <code>telemetry</code> named graph. It creates a separate{' '}
            <code>target</code> snapshot when its CPU threshold is crossed; it
            does not continuously overwrite the default topology.
          </p>
        </div>
      </div>
    </section>
  );
}
function SnapshotPanel({ graph, targetGraph, refresh }) {
  return (
    <section className="tab active gdb-panel">
      <div className="gdb-title-row">
        <div>
          <div className="page-title">What-if snapshot</div>
          <p className="gdb-muted">
            Compare graph size for the current topology and the target scenario.
          </p>
        </div>
        <button className="gdb-refresh" onClick={refresh}>
          <RefreshCw size={15} /> Refresh
        </button>
      </div>
      <div className="gdb-metrics">
        <Metric
          icon={Database}
          label="Current nodes"
          value={graph.nodes.length}
          sub={`${graph.edges.length} relationships`}
          tone="blue"
        />
        <Metric
          icon={Waypoints}
          label="Target nodes"
          value={targetGraph.nodes.length}
          sub={`${targetGraph.edges.length} relationships`}
          tone="purple"
        />
        <Metric
          icon={Zap}
          label="Added target nodes"
          value={Math.max(0, targetGraph.nodes.length - graph.nodes.length)}
          sub="Difference in discovered node count"
          tone="teal"
        />
      </div>
      <div className="gdb-card">
        <h3>Target snapshot status</h3>
        <p className="gdb-muted">
          The target graph is created by{' '}
          <code>upf_load_traffic_ingestion.py</code> after the CPU threshold is
          breached. If it has not triggered yet, target counts may be empty or
          unchanged.
        </p>
        <div className="gdb-status-line">
          {targetGraph.nodes.length ? (
            <>
              <CircleCheck size={18} color="#16a085" /> Target graph contains{' '}
              {targetGraph.nodes.length} nodes.
            </>
          ) : (
            <>
              <CircleAlert size={18} color="#e5a13d" /> No target graph nodes
              returned. The Python ingestion process may not have reached its
              threshold yet.
            </>
          )}
        </div>
      </div>
    </section>
  );
}
export default function CoreApp() {
  const [activeTab, setActiveTab] = useState('graph');
  const [graphState, setGraphState] = useState('current');
  const [graphRaw, setGraphRaw] = useState(EMPTY);
  const [targetGraph, setTargetGraph] = useState(EMPTY);
  const [metrics, setMetrics] = useState([]);
  const [status, setStatus] = useState('Connecting to GraphDB…');
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(false);
  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      await checkGraphDB();
      const [current, target, upfs] = await Promise.all([
        loadGraph('current'),
        loadGraph('target'),
        loadMetrics(),
      ]);
      setGraphRaw(current);
      setTargetGraph(target);
      setMetrics(upfs);
      setConnected(true);
      setStatus(`CONNECTED · ${GRAPHDB.repository}`);
    } catch (e) {
      setConnected(false);
      setStatus(`CONNECTION ISSUE · ${e.message}`);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 30000);
    return () => clearInterval(id);
  }, [refresh]);
  const shownGraph = graphState === 'target' ? targetGraph : graphRaw;
  return (
    <div className="app-shell gdb-shell">
      <Header
        apiUrl="SSH tunnel → localhost:7200"
        setApiUrl={() => {}}
        mode={connected ? 'live' : 'demo'}
        modeLabel={status}
        onConnect={refresh}
        connecting={loading}
        title={
          <>
            5G Core Digital Twin{' '}
            <span className="gdb-header-sub">· GraphDB</span>
          </>
        }
        hideConnectUI        
      />
      <div className="app-body">
        <Sidebar activeTab={activeTab} onSelect={setActiveTab} menu={MENU} />
        <main className="content gdb-content">
          <div className="gdb-topline">
            <div>
              <div className="gdb-eyebrow">NETWORK INTELLIGENCE / CORE</div>
              <h1>GraphDB Operations Console</h1>
              <p>
                Explore your 5G core topology, inspect live UPF traffic, and
                review the what-if target snapshot.
              </p>
            </div>
            <div
              className={`gdb-connection ${connected ? 'online' : 'offline'}`}
            >
              <span />
              {connected ? 'GraphDB connected' : 'Waiting for GraphDB'}
            </div>
          </div>
          {activeTab === 'graph' && (
            <>
              {/* <div className="gdb-statebar">
                <div>
                  <strong>Ontology graph</strong>
                  <span>Repository: {GRAPHDB.repository}</span>
                </div>
                <div className="gdb-state-switch">
                  <button
                    className={graphState === 'current' ? 'selected' : ''}
                    onClick={() => setGraphState('current')}
                  >
                    Current graph
                  </button>
                  <button
                    className={graphState === 'target' ? 'selected' : ''}
                    onClick={() => setGraphState('target')}
                  >
                    Target snapshot
                  </button>
                  <button onClick={refresh} title="Refresh data">
                    <RefreshCw size={15} />
                  </button>
                </div>
              </div>
              <div className="gdb-metrics compact">
                <Metric
                  icon={Database}
                  label="Graph nodes"
                  value={shownGraph.nodes.length}
                  sub={
                    graphState === 'target'
                      ? 'Target snapshot'
                      : 'Default + telemetry'
                  }
                  tone="blue"
                />
                <Metric
                  icon={Waypoints}
                  label="Relationships"
                  value={shownGraph.edges.length}
                  sub="RDF relationships discovered"
                  tone="purple"
                />
                <Metric
                  icon={Activity}
                  label="Max UPF CPU"
                  value={`${Math.max(0, ...metrics.map((m) => m.cpu)).toFixed(
                    1
                  )}%`}
                  sub="Telemetry graph"
                  tone="teal"
                />
              </div> */}
              <CoreGraphTab
                active
                graphRaw={shownGraph}
                graphState={graphState}
                onStateChange={setGraphState}
                onRefresh={refresh}
                targetUnlocked={targetGraph.nodes.length > 0}
                overloaded={metrics.some((m) => m.cpu > 85)}
              />
            </>
          )}
          {activeTab === 'traffic' && (
            <TrafficIngestionTab
              active={activeTab === 'traffic'}
              onRefresh={refresh}
            />
          )}
          {activeTab === 'whatif' && (
            <WhatIfCoreTab
              active={activeTab === 'whatif'}
              onTargetCreated={refresh}
            />
          )}
          <footer className="gdb-footer">
            <span>
              GraphDB repository: <strong>{GRAPHDB.repository}</strong>
            </span>
            <span>
              Auto-refresh: every 30 seconds · {loading ? 'Updating…' : 'Ready'}
            </span>
          </footer>
        </main>
      </div>
    </div>
  );
}
