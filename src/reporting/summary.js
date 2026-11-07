/**
 * handleSummary output:
 *   stdout                          normal k6 text summary
 *   reports/<api>_<env>_<time>-summary.json   raw summary data
 *   reports/<api>_<env>_<time>-junit.xml      thresholds as JUnit (CI test results)
 *   reports/<api>_<env>_<time>-endpoints.md   per-endpoint latency table
 * HTML dashboard comes from k6's built-in web dashboard (see package.json).
 */
import { textSummary, jUnit } from 'https://jslib.k6.io/k6-summary/0.1.0/index.js';
import { timestamp } from '../core/utils.js';

function fmt(v) {
  return v === undefined ? '-' : Number(v).toFixed(1);
}

function thresholdsOk(metric) {
  if (!metric || !metric.thresholds) return true;
  return Object.values(metric.thresholds).every((t) => t.ok);
}

function endpointTable(data, cfg) {
  const rows = [
    `# ${cfg.apiName} | env: ${cfg.envName}`,
    '',
    `Base URL: ${cfg.baseUrl}`,
    '',
    '| Endpoint | Requests | avg ms | p95 ms | p99 ms | max ms | SLO |',
    '|---|---:|---:|---:|---:|---:|:---:|',
  ];
  for (const ep of cfg.endpoints) {
    const d = data.metrics[`http_req_duration{endpoint:${ep.name}}`];
    const c = data.metrics[`http_reqs{endpoint:${ep.name}}`];
    const f = data.metrics[`http_req_failed{endpoint:${ep.name}}`];
    const v = (d && d.values) || {};
    const ok = thresholdsOk(d) && thresholdsOk(f);
    rows.push(
      `| ${ep.name} | ${c ? c.values.count : 0} | ${fmt(v.avg)} | ${fmt(v['p(95)'])} | ${fmt(v['p(99)'])} | ${fmt(v.max)} | ${ok ? 'PASS' : 'FAIL'} |`
    );
  }
  return rows.join('\n') + '\n';
}

export function buildSummary(data, cfg) {
  // REPORT_DIR (optional) must already exist; default writes into reports/
  const prefix = __ENV.REPORT_DIR
    ? `${__ENV.REPORT_DIR.replace(/\/+$/, '')}/`
    : `reports/${cfg.apiName}_${cfg.envName}_${timestamp()}-`;
  return {
    stdout: textSummary(data, { indent: ' ', enableColors: true }),
    [`${prefix}summary.json`]: JSON.stringify(data, null, 2),
    [`${prefix}junit.xml`]: jUnit(data, { name: `k6 ${cfg.apiName} ${cfg.envName}` }),
    [`${prefix}endpoints.md`]: endpointTable(data, cfg),
  };
}
