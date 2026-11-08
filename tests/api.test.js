/**
 * Config-driven API test.
 *
 *   npm run test            (or: k6 run tests/api.test.js)
 *
 * Everything (target, load, endpoints, data, SLOs) comes from /config.
 * Scenario "exec" values in config/test.json map to the exported flows below.
 */
import { group, sleep } from 'k6';
import http from 'k6/http';
import exec from 'k6/execution';

import { config } from '../src/config/loader.js';
import { ApiClient } from '../src/core/http-client.js';
import { validateResponse } from '../src/core/checks.js';
import { staticAuthHeaders, fetchOAuthToken } from '../src/core/auth.js';
import { journeyDuration } from '../src/core/metrics.js';
import { createWeightedPicker, thinkTime, randomInt } from '../src/core/utils.js';
import { buildResults, failedThresholds, toTable } from '../src/core/results.js';

export const options = {
  scenarios: config.scenarios,
  thresholds: config.thresholds,
  tags: config.tags,
  summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(90)', 'p(95)', 'p(99)'],
  insecureSkipTLSVerify: config.insecureSkipTLSVerify,
  userAgent: `k6-perf/${config.apiName} (${config.envName})`,
  setupTimeout: '2m',
};

// ---------- init (once per VU) ----------
const pickEndpoint = createWeightedPicker(config.endpoints);
const batchEndpoints = config.endpoints.filter((e) => e.batchable);
const authHeaders = staticAuthHeaders(config.auth);
let client;

function getClient(data) {
  if (!client) {
    const oauth = data && data.accessToken ? { Authorization: `Bearer ${data.accessToken}` } : {};
    client = new ApiClient(config, { ...authHeaders, ...oauth });
  }
  return client;
}

function callEndpoint(endpoint, data) {
  return group(endpoint.group, () => {
    const res = getClient(data).call(endpoint);
    return { res, ok: validateResponse(res, endpoint) };
  });
}

// ---------- lifecycle ----------
export function setup() {
  const data = {};
  if (config.auth.type === 'oauth2_client_credentials') data.accessToken = fetchOAuthToken(config.auth);

  const hc = config.healthCheck;
  if (hc && hc.path) {
    const headers = { ...config.headers, ...authHeaders, ...(data.accessToken ? { Authorization: `Bearer ${data.accessToken}` } : {}) };
    const res = http.get(`${config.baseUrl}${hc.path}`, {
      headers,
      timeout: config.timeout,
      tags: { name: 'healthcheck', endpoint: 'setup' },
      responseCallback: http.expectedStatuses(hc.expectedStatus || 200),
    });
    if (res.status !== (hc.expectedStatus || 200)) {
      const msg = `health check ${hc.path} returned ${res.status}`;
      if (hc.required) exec.test.abort(`${msg} - aborting (healthCheck.required=true)`);
      console.warn(`${msg} - continuing`);
    }
  }
  return data;
}

// ---------- flows (referenced by "exec" in config/test.json) ----------

/** One weighted-random endpoint per iteration. Main traffic model. */
export function getApiFlow(data) {
  callEndpoint(pickEndpoint(), data);
  thinkTime(config.thinkTime);
}

/** Ordered multi-step user journeys from the endpoint file's "journeys". */
export function journeyFlow(data) {
  const journey = config.journeys[randomInt(0, config.journeys.length - 1)];
  let total = 0;
  group(`journey::${journey.name}`, () => {
    for (const step of journey.steps) {
      const { res, ok } = callEndpoint(config.endpointsByName[step.endpoint], data);
      total += res.timings.duration;
      if (!ok && journey.stopOnFailure !== false) break;
      if (step.thinkTime) sleep(step.thinkTime);
    }
  });
  journeyDuration.add(total, { journey: journey.name });
}

/** All "batchable" endpoints fired in parallel, like a page loading several APIs at once. */
export function batchFlow(data) {
  if (!batchEndpoints.length) exec.test.abort('batchFlow needs at least one endpoint with "batchable": true');
  group('batch', () => {
    const responses = getClient(data).batch(batchEndpoints);
    responses.forEach((res, i) => validateResponse(res, batchEndpoints[i]));
  });
  thinkTime(config.thinkTime);
}

/** One fixed endpoint, chosen per scenario with "env": { "ENDPOINT": "<name>" }. */
export function endpointFlow(data) {
  callEndpoint(config.endpointsByName[__ENV.ENDPOINT], data);
  thinkTime(config.thinkTime);  
}

export default function (data) {
  getApiFlow(data);
}

/** Replaces k6's long default summary with a results table (one row per endpoint). */
export function handleSummary(data) {
  const results = buildResults(data, config.endpoints);
  const failed = failedThresholds(data);
  const text = [
    '',
    `RESULTS  api=${config.apiName}  env=${config.envName}  baseUrl=${config.baseUrl}`,
    '',
    toTable(results),
    '',
    failed.length ? `FAILED thresholds (${failed.length}):\n  ${failed.join('\n  ')}` : 'All thresholds passed',
    '',
  ].join('\n');
  return { stdout: text };
}
