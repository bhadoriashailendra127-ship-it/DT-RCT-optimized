import { useState } from 'react';
import { Check, Zap } from 'lucide-react';
import {
  executeLoadSplit,
  getTrafficState,
  suggestLoadSplit,
} from '../../graphdbApi';

const number = (value) => Number(value || 0).toLocaleString();
const pct = (value) => `${Number(value || 0).toFixed(2)}%`;

export default function WhatIfCoreTab({ active, onTargetCreated }) {
  const [sessions, setSessions] = useState(null);
  const [capacity, setCapacity] = useState(10000);
  const [preview, setPreview] = useState(null);
  const [executed, setExecuted] = useState(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [lastRunAt, setLastRunAt] = useState(null);

  async function runSuggest() {
    setBusy('suggest');
    setError('');
    setExecuted(null);
    try {
      const state = await getTrafficState();
      setSessions(state.sessions);
      setCapacity(state.capacity);
      const result = await suggestLoadSplit(state.sessions, state.capacity);
      setPreview(result);
      setLastRunAt({ action: 'Suggest', at: new Date() });
    } catch (e) {
      setPreview(null);
      setError(e.message);
    } finally {
      setBusy('');
    }
  }

  async function runExecute() {
    if (!preview?.eligible) return;
    setBusy('execute');
    setError('');
    try {
      const result = await executeLoadSplit(preview);
      setExecuted(result);
      setLastRunAt({ action: 'Execute', at: new Date() });
      onTargetCreated?.();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy('');
    }
  }

  const result = executed || preview;
  const plan = result?.plan;
  return (
    <section
      className={`tab ${active ? 'active' : ''} gdb-panel whatif-simulation`}
    >
      <div className="page-title">What-if simulation</div>
      <div className="card whatif-intro">
        <h3>UPF load-split — automated suggestion</h3>
        <p className="sub">
          Uses the active session flow currently set on Traffic Ingestion (
          {number(sessions ?? 0)} sessions). <b>Suggest plan</b> computes the
          proposed numbers and writes nothing. <b>Execute plan</b> creates the{' '}
          <code>https://example.com/5g/graph/target</code> graph.
        </p>
        <div className="whatif-actions">
          <button
            className="btn blue"
            onClick={runSuggest}
            disabled={busy !== ''}
          >
            {busy === 'suggest' ? 'Analyzing…' : '▶ Suggest plan'}
          </button>
          <button
            className="btn green"
            onClick={runExecute}
            disabled={!preview?.eligible || busy !== '' || !!executed}
            title={
              executed
                ? 'Already executed; run Suggest plan to evaluate a fresh plan'
                : !preview?.eligible
                ? 'Suggest an eligible plan first'
                : 'Write the proposed Target graph to GraphDB'
            }
          >
            {busy === 'execute' ? (
              'Writing target graph…'
            ) : executed ? (
              '✓ Plan already executed'
            ) : (
              <>
                <Zap size={14} fill="currentColor" /> Execute plan
              </>
            )}
          </button>
        </div>
        {executed && (
          <p className="whatif-executed-note">
            <Check size={15} /> This plan has already been executed. Run
            “Suggest plan” again to evaluate a fresh instance before executing
            another change.
          </p>
        )}
      </div>

      {error && (
        <div className="card whatif-error">
          <b>GraphDB error:</b> {error}
        </div>
      )}
      {!result && !error && (
        <div className="card whatif-placeholder">
          <i>Click “Suggest plan” to run the analysis.</i>
        </div>
      )}

      {result && !result.eligible && (
        <div className="card whatif-placeholder">
          <b>NO SCALE-OUT REQUIRED</b>
          <p>
            {result.message ||
              `Received ${number(result.sessions)} sessions (${pct(
                result.loadPercent
              )} capacity). The configured overload thresholds have not both been exceeded.`}
          </p>
          <div className="whatif-log">{result.log}</div>
        </div>
      )}

      {result?.eligible && plan && (
        <>
          <div className="whatif-kpis">
            <div className={`whatif-kpi ${executed ? 'created' : ''}`}>
              <b>{executed ? 'PLAN CREATED' : 'ELIGIBLE'}</b>
              <small>
                {executed
                  ? 'Target graph and UPF-02 written'
                  : 'Plan ready — click Execute to write it'}
              </small>
            </div>
            <div className="whatif-kpi">
              <b>{number(plan.upf1Sessions)}</b>
              <small>sessions on original UPF</small>
            </div>
            <div className="whatif-kpi">
              <b>{number(plan.upf2Sessions)}</b>
              <small>sessions on newly instantiated UPF</small>
            </div>
            <div className="whatif-kpi">
              <b>{plan.clonedConnections}</b>
              <small>connections cloned</small>
            </div>
          </div>
          <div className="whatif-detail-grid">
            <div className="card whatif-detail-card">
              <h3>Proposed plan</h3>
              <div className="whatif-detail-content">
                <b>Trigger</b>
                <br />
                Received sessions: <b>{number(result.sessions)}</b>
                <br />
                Load at trigger: <b>{pct(result.loadPercent)}</b> of{' '}
                {number(capacity)} capacity (threshold{' '}
                {pct(result.cpuThreshold)})
                <br />
                <br />
                <b>UPF nodes</b>
                <br />
                Original UPF: <code>{plan.originalUpfId}</code> (
                {plan.originalUpfName})<br />
                &nbsp;&nbsp;→ {number(plan.upf1Sessions)} sessions,{' '}
                {pct(plan.upf1LoadPercent)} capacity
                <br />
                Newly Instantiated UPF: <code>{plan.newUpfId}</code> (
                {plan.newUpfName})<br />
                &nbsp;&nbsp;→ {number(plan.upf2Sessions)} sessions,{' '}
                {pct(plan.upf2LoadPercent)} capacity
                <br />
                <br />
                <b>Topology impact</b>
                <br />
                Connections cloned to new UPF: <b>{plan.clonedConnections}</b>
                <br />
                Target graph: <code>{plan.targetGraph}</code>
                <br />
                Node count — current: <b>{plan.currentNodeCount}</b>, target:{' '}
                <b>{plan.targetNodeCount}</b>
                {executed && lastRunAt && (
                  <>
                    <br />
                    <br />
                    Executed at: <b>{lastRunAt.at.toLocaleString()}</b>
                  </>
                )}
              </div>
              <div
                className={`whatif-recommendation ${executed ? 'done' : ''}`}
              >
                <b>Recommendation:</b>{' '}
                {executed
                  ? `This load-split has been applied — sessions are now redistributed across both UPF instances, each running at roughly ${pct(
                      plan.upf1LoadPercent
                    )} of capacity, safely below the ${pct(
                      result.cpuThreshold
                    )} overload threshold.`
                  : `Deploy the proposed new UPF node and clone the ${
                      plan.clonedConnections
                    } connection edge(s) to split the current ${number(
                      result.sessions
                    )} sessions roughly evenly across both UPF instances — this brings each UPF's load down to about ${pct(
                      plan.upf1LoadPercent
                    )}, below the ${pct(
                      result.cpuThreshold
                    )} overload threshold. Click “Execute plan” to apply it.`}
              </div>
            </div>
            <div className="card whatif-detail-card">
              <h3>Engine narration</h3>
              {lastRunAt && (
                <div className="sub whatif-last-run">
                  Last run: <b>{lastRunAt.action}</b> at{' '}
                  {lastRunAt.at.toLocaleString()}
                </div>
              )}
              <pre className="whatif-engine-log">
                {result.log || '(no narration output)'}
              </pre>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
