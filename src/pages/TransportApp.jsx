import { useCallback, useEffect, useMemo, useState } from 'react';
import Header from '../components/Header';
import Sidebar from '../components/Sidebar';
import GraphTab from '../components/GraphTab';
import IngestTab from '../components/IngestTab';
import QueriesTab from '../components/QueriesTab';
import WhatIfTab from '../components/WhatIfTab';
import { connectToBackend } from '../api';
import { demoData, makeHelpers } from '../data/demoData';
import { buildPresets } from '../data/presets';
import { LIVE_PRESETS } from '../data/livePresets';
import { loadTransportGraph, TRANSPORT_GRAPHDB } from '../transportGraphdbApi';

const LEGACY_API_URL = 'https://sct-twin-api-430394800984.asia-south2.run.app';
const DEFAULT_SITES =
  'SITE-KOE-01,SITE-KOE-02,SITE-DTM-01,SITE-ESS-01,SITE-WUP-01';
const DEFAULT_PLAN = {
  sourceSite: 'SITE-KOE-02',
  destinationSite: 'SITE-KOE-01',
  version: '1',
};

export default function TransportApp() {
  const [apiUrl, setApiUrl] = useState(LEGACY_API_URL);
  const [mode, setMode] = useState('demo');
  const [connecting, setConnecting] = useState(false);
  const [activeTab, setActiveTab] = useState('graph');
  const [graphState, setGraphState] = useState('current');
  const [siteIdsInput, setSiteIdsInput] = useState(DEFAULT_SITES);
  const [plan, setPlan] = useState(DEFAULT_PLAN);
  const [transportClusterFilter, setTransportClusterFilter] = useState('ALL');
  const [unlockedClusters, setUnlockedClusters] = useState(() => new Set());
  const [graphRaw, setGraphRaw] = useState({ nodes: [], edges: [] });
  const [graphError, setGraphError] = useState('');
  const [loading, setLoading] = useState(false);
  const [connected, setConnected] = useState(false);

  const data = useMemo(() => demoData(), []);
  const helpers = useMemo(() => makeHelpers(data), [data]);
  const demoPresets = useMemo(
    () => buildPresets(data, helpers),
    [data, helpers]
  );

  const connectLegacyBackend = useCallback(async (url) => {
    setConnecting(true);
    try {
      const result = await connectToBackend(url);
      if (result.ok) {
        setMode('live');
        setApiUrl(result.baseUrl);
      } else {
        setMode('demo');
      }
    } catch (error) {
      setMode('demo');
      console.warn('Transport backend connection failed:', error.message);
    } finally {
      setConnecting(false);
    }
  }, []);

  const loadGraph = useCallback(async (state, selectedPlan) => {
    setLoading(true);
    setGraphError('');
    try {
      const graph = await loadTransportGraph(state, selectedPlan);
      setGraphRaw(graph);
      setConnected(true);
    } catch (error) {
      setConnected(false);
      setGraphError(error.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadGraph('current', DEFAULT_PLAN);
    connectLegacyBackend(LEGACY_API_URL);
  }, [connectLegacyBackend, loadGraph]);

  function handleGraphStateChange(state) {
    setGraphState(state);
    loadGraph(state, plan);
  }

  const refreshGraph = () => loadGraph(graphState, plan);
  const loadPlannedGraph = () => {
    setGraphState('planned');
    loadGraph('planned', plan);
  };
  const updatePlan = (field, value) => {
    setPlan((current) => ({ ...current, [field]: value }));
  };
  const transportPlan = {
    ...plan,
    onChange: updatePlan,
    onLoad: loadPlannedGraph,
    loading,
  };

  return (
    <div className="app-shell">
      <Header
        apiUrl={apiUrl}
        setApiUrl={setApiUrl}
        mode={connected ? 'live' : 'demo'}
        modeLabel={
          loading
            ? 'CONNECTING TO GRAPHDB…'
            : connected
            ? `GRAPHDB · ${TRANSPORT_GRAPHDB.repository} · API ${
                mode === 'live' ? 'LIVE' : 'DEMO'
              }`
            : 'GRAPHDB CONNECTION ISSUE'
        }
        onConnect={refreshGraph}
        connecting={loading || connecting}
        hideConnectUI
        title={<>Network Digital Twin Transport &middot; GraphDB</>}
      />
      <div className="app-body">
        <Sidebar activeTab={activeTab} onSelect={setActiveTab} />
        <div className="content">
          <GraphTab
            active={activeTab === 'graph'}
            mode="live"
            graphRaw={graphRaw}
            graphState={graphState}
            statesUnlocked
            siteIdsInput={siteIdsInput}
            onSiteIdsChange={setSiteIdsInput}
            onStateChange={handleGraphStateChange}
            onRefresh={refreshGraph}
            clusterFilter={transportClusterFilter}
            onClusterFilterChange={setTransportClusterFilter}
            transportGraphDb
            transportPlan={transportPlan}
            graphError={graphError}
            graphLoading={loading}
          />
          <IngestTab
            active={activeTab === 'ingest'}
            mode={mode}
            apiUrl={apiUrl}
            data={data}
          />
          <QueriesTab
            active={activeTab === 'queries'}
            mode="live"
            apiUrl={apiUrl}
            siteIdsInput={siteIdsInput}
            statesUnlocked={unlockedClusters.has(transportClusterFilter)}
            demoPresets={demoPresets}
            livePresets={LIVE_PRESETS}
          />
          <WhatIfTab
            active={activeTab === 'whatif'}
            mode="live"
            apiUrl={apiUrl}
            siteIdsInput={siteIdsInput}
            clusterFilter={transportClusterFilter}
            data={data}
            helpers={helpers}
            onUnlockStates={() =>
              setUnlockedClusters((previous) =>
                new Set(previous).add(transportClusterFilter)
              )
            }
            transportGraphDb
            onRefreshGraph={() => { setGraphState('target'); loadGraph('target', plan); }}
          />
        </div>
      </div>
    </div>
  );
}
