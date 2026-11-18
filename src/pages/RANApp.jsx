import { useCallback, useEffect, useState } from 'react';
import { Antenna, Database, Network, Zap } from 'lucide-react';
import Header from '../components/Header';
import Sidebar from '../components/Sidebar';
import RANGraphTab from '../components/ran/RANGraphTab';
import RANWhatIfTab from '../components/ran/RANWhatIfTab';
import RANQueriesTab from '../components/ran/RANQueriesTab';
import RANTelemetryTab from '../components/ran/RANTelemetryTab';
import { loadRANTopology, RAN_GRAPHDB } from '../ranGraphdbApi';

const RAN_MENU = [
  { key: 'ingest', label: 'Data Ingestion', Icon: Database },
  { key: 'graph', label: 'Ontology Graph', Icon: Network },
  { key: 'whatif', label: 'What-If', Icon: Zap },
  { key: 'queries', label: 'RAN Intelligence', Icon: Database },
];

export default function RANApp() {
  const [activeTab, setActiveTab] = useState('graph');
  const [graph, setGraph] = useState(null);
  const [graphState, setGraphState] = useState('current');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const refresh = useCallback(async (state = graphState) => {
    setLoading(true); setError('');
    try { setGraph(await loadRANTopology(state)); setGraphState(state); }
    catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, [graphState]);

  useEffect(() => { refresh('current'); }, []);

  // Keep the visible Current graph aligned with the newest GraphDB telemetry.
  useEffect(() => {
    if (activeTab !== 'graph' || graphState !== 'current') return undefined;
    const timer = setInterval(() => refresh('current'), 10000);
    return () => clearInterval(timer);
  }, [activeTab, graphState, refresh]);

  return (
    <div className="app-shell">
      <Header
        apiUrl="http://10.161.4.199:7200"
        setApiUrl={() => {}}
        mode={graph ? 'live' : 'demo'}
        modeLabel={loading ? 'CONNECTING TO RAN GRAPHDB…' : graph ? `GRAPHDB · ${RAN_GRAPHDB.repository} · 10.161.4.199` : 'RAN GRAPHDB CONNECTION ISSUE'}
        onConnect={refresh}
        connecting={loading}
        hideConnectUI
        title={<><Antenna size={20} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 8 }} />RAN Digital Twin &middot; GraphDB</>}
        homeTo="/landing-page"
      />
      <div className="app-body">
        <Sidebar activeTab={activeTab} onSelect={setActiveTab} menu={RAN_MENU} />
        <div className="content">
          <RANTelemetryTab active={activeTab === 'ingest'} />
          <RANGraphTab active={activeTab === 'graph'} graph={graph} graphState={graphState} onStateChange={refresh} loading={loading} error={error} onRefresh={() => refresh(graphState)} />
          <RANWhatIfTab active={activeTab === 'whatif'} onRefreshGraph={refresh} />
          <RANQueriesTab active={activeTab === 'queries'} />
        </div>
      </div>
    </div>
  );
}
