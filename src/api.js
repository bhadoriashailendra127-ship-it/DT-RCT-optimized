/**
 * Thin REST client for the Flask/Spanner proxy (app.py).
 * The browser never talks to Spanner directly -- it always goes through
 * this backend, exactly as in the original index.html.
 */
export async function apiCall(baseUrl, path, opts) {
  // Only attach a Content-Type header when we're actually sending a JSON
  // body (POST calls). Simple GETs without custom headers don't trigger a
  // CORS preflight (OPTIONS) request, so this avoids relying on the backend
  // handling preflight correctly for read-only calls like /api/health and
  // /api/graph.
  const hasBody = opts && opts.body != null;
  const headers = hasBody ? { 'Content-Type': 'application/json' } : {};
  const res = await fetch(baseUrl + path, {
    headers,
    ...(opts || {}),
  });

  // Deliberately NOT checking the response's Content-Type header here.
  // Corporate web-isolation/inspection proxies (e.g. Symantec/Broadcom
  // "Fire.glass") can rewrite it in transit -- e.g. to text/html -- even
  // when the actual body is still valid JSON underneath. Trusting that
  // header caused false failures on networks with such a proxy. Instead,
  // just try to parse the body as JSON directly and only fail if that
  // genuinely doesn't work.
  let json;
  try {
    json = await res.json();
  } catch (parseErr) {
    throw new Error(
      `Response from ${baseUrl}${path} wasn't valid JSON (status ${res.status}). ` +
        `If you're on a corporate network, a web-isolation/inspection proxy may be altering ` +
        `the response. Check that the Connect field points at your app.py server, not a browser page.`
    );
  }

  if (!res.ok) {
    throw new Error(json.error || res.statusText);
  }
  return json;
}

/**
 * Attempts to connect to the backend proxy at `baseUrl` by hitting /api/health.
 * Returns { ok: true, health } on success, or { ok: false, error } on failure.
 * This is what the Connect button in <Header/> calls.
 */
export async function connectToBackend(baseUrl) {
  const cleanUrl = baseUrl.replace(/\/$/, '');
  try {
    const health = await apiCall(cleanUrl, '/api/health');
    // app.py's /api/health always returns {status, project, instance, database}
    // on success. Require that shape so a stray 200-with-HTML response can't
    // masquerade as a working connection.
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

export const endpoints = {
  graph: (state = 'current', sitesCsv = '') => {
    const q = new URLSearchParams({ state });
    if (sitesCsv) q.set('sites', sitesCsv);
    return `/api/graph?${q.toString()}`;
  },
  query: (sql) => `/api/query?sql=${encodeURIComponent(sql)}`,
  sites: () => '/api/sites',
  whatifPreview: (clusterId) =>
    clusterId && clusterId !== 'ALL'
      ? `/api/whatif/preview?cluster_id=${encodeURIComponent(clusterId)}`
      : '/api/whatif/preview',
  whatifExecute: (clusterId) =>
    clusterId && clusterId !== 'ALL'
      ? `/api/whatif/execute?cluster_id=${encodeURIComponent(clusterId)}`
      : '/api/whatif/execute',
  ingestVerify: () => '/api/ingest/verify',
  ingestCustom: (sql) => `/api/ingest/custom?sql=${encodeURIComponent(sql)}`,
};
