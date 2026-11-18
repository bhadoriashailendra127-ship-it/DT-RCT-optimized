/**
 * Thin REST client for the 5G Core backend (core_app.py) -- a completely
 * separate Cloud Run service / Spanner database from the Transport console.
 */
 export async function coreApiCall(baseUrl, path, opts) {
  const hasBody = opts && opts.body != null;
  const headers = hasBody ? { 'Content-Type': 'application/json' } : {};
  const res = await fetch(baseUrl + path, { headers, ...(opts || {}) });

  // Don't trust the Content-Type header (some corporate proxies rewrite it
  // in transit) -- try to parse the body as JSON directly instead.
  let json;
  try {
    json = await res.json();
  } catch (parseErr) {
    throw new Error(
      `Response from ${baseUrl}${path} wasn't valid JSON (status ${res.status}).`
    );
  }
  if (!res.ok) {
    throw new Error(json.error || res.statusText);
  }
  return json;
}

export async function connectToCoreBackend(baseUrl) {
  const cleanUrl = baseUrl.replace(/\/$/, '');
  try {
    const health = await coreApiCall(cleanUrl, '/api/health');
    if (health.status !== 'ok' || !health.instance || !health.database) {
      throw new Error(
        'Backend responded but not with the expected health payload.'
      );
    }
    return { ok: true, baseUrl: cleanUrl, health };
  } catch (e) {
    return { ok: false, baseUrl: cleanUrl, error: e.message };
  }
}

export const coreEndpoints = {
  graph: (state = 'current') => `/api/graph?state=${encodeURIComponent(state)}`,
  query: (sql) => `/api/query?sql=${encodeURIComponent(sql)}`,
  graphs: () => '/api/graphs',
  compare: () => '/api/compare',
  currentUpfs: () => '/api/current/upfs',
  targetUpfs: () => '/api/target/upfs',
  checkOverload: (sessions) =>
    `/api/traffic/check-overload?sessions=${encodeURIComponent(sessions)}`,
  previewPlan: (sessions) =>
    `/api/traffic/preview-plan?sessions=${encodeURIComponent(sessions)}`,
  executePlan: (sessions) =>
    `/api/traffic/execute-plan?sessions=${encodeURIComponent(sessions)}`,
};
