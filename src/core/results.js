/**
 * End-of-test results: one object per endpoint, printed as a table.
 */

const ms = (v) => (v === undefined ? '-' : Math.round(v));
const pct = (v) => (v === undefined ? '-' : `${(v * 100).toFixed(1)}%`);
const kb = (v) => (v === undefined ? '-' : Math.round(v / 1024));

function passed(metric) {
  return !metric || !metric.thresholds || Object.values(metric.thresholds).every((t) => t.ok);
}

/** Array of result objects, one per endpoint. */
export function buildResults(data, endpoints) {
  return endpoints.map((ep) => {
    const m = (name) => data.metrics[`${name}{endpoint:${ep.name}}`];
    const val = (name, key) => (m(name) ? m(name).values[key] : undefined);

    return {
      endpoint: ep.name,
      method: ep.method,
      requests: val('http_reqs', 'count') || 0,
      failed: pct(val('http_req_failed', 'rate')),
      checks: pct(val('checks', 'rate')),
      avg_ms: ms(val('http_req_duration', 'avg')),
      p95_ms: ms(val('http_req_duration', 'p(95)')),
      max_ms: ms(val('http_req_duration', 'max')),
      server_ms: ms(val('http_req_waiting', 'avg')),
      size_kb: kb(val('api_payload_bytes', 'avg')),
      result: passed(m('http_req_duration')) && passed(m('http_req_failed')) && val('checks', 'rate') === 1 ? 'PASS' : 'FAIL',
    };
  });
}

/** Thresholds that failed, e.g. "http_req_duration p(95)<1500". */
export function failedThresholds(data) {
  const out = [];
  for (const [name, metric] of Object.entries(data.metrics)) {
    for (const [rule, t] of Object.entries(metric.thresholds || {})) if (!t.ok) out.push(`${name}  ${rule}`);
  }
  return out;
}

/** Plain-text table from an array of objects. */
export function toTable(rows) {
  if (!rows.length) return '(no results)';
  const cols = Object.keys(rows[0]);
  const width = cols.map((c) => Math.max(c.length, ...rows.map((r) => String(r[c]).length)));
  const line = (cells) => cells.map((c, i) => String(c).padEnd(width[i])).join(' | ');
  return [line(cols), width.map((w) => '-'.repeat(w)).join('-|-'), ...rows.map((r) => line(cols.map((c) => r[c])))].join('\n');
}
