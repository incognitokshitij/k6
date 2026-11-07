/**
 * Pure config-building functions. No k6 imports here, so this file can be
 * tested with plain Node.
 */

export const KNOWN_EXECS = ['getApiFlow', 'journeyFlow', 'batchFlow', 'endpointFlow'];

const VU_FIELDS = ['vus', 'startVUs', 'preAllocatedVUs', 'maxVUs'];
const RATE_FIELDS = ['rate', 'startRate'];

export function deepClone(obj) {
  return obj === undefined ? undefined : JSON.parse(JSON.stringify(obj));
}

function splitList(value) {
  return value ? String(value).split(',').map((s) => s.trim()).filter(Boolean) : [];
}

/** Scale a positive number, never dropping a non-zero value to zero. */
function scale(value, factor) {
  if (typeof value !== 'number' || value <= 0) return value;
  return Math.max(1, Math.ceil(value * factor));
}

/**
 * CLI overrides (-e VUS=10 -e DURATION=1m ...). A value is only applied to
 * scenarios that already use that field, so executors stay valid.
 */
export function applyScenarioOverrides(scenarios, env) {
  const out = deepClone(scenarios);
  const overrides = {
    vus: env.VUS && Number(env.VUS),
    duration: env.DURATION,
    iterations: env.ITERATIONS && Number(env.ITERATIONS),
    rate: env.RATE && Number(env.RATE),
    maxVUs: env.MAX_VUS && Number(env.MAX_VUS),
  };
  for (const sc of Object.values(out)) {
    for (const [key, val] of Object.entries(overrides)) {
      if (val !== undefined && val !== '' && !Number.isNaN(val) && key in sc) sc[key] = val;
    }
  }
  return out;
}

/** Multiply every load-related field by `factor` (e.g. 0.5 for a smaller env). */
export function scaleScenarios(scenarios, factor) {
  const out = deepClone(scenarios);
  if (!factor || factor === 1) return out;
  for (const sc of Object.values(out)) {
    for (const f of [...VU_FIELDS, ...RATE_FIELDS]) if (f in sc) sc[f] = scale(sc[f], factor);
    if (Array.isArray(sc.stages)) {
      sc.stages = sc.stages.map((s) => ({ ...s, target: scale(s.target, factor) }));
    }
    // arrival-rate executors need maxVUs >= preAllocatedVUs
    if ('maxVUs' in sc && 'preAllocatedVUs' in sc && sc.maxVUs < sc.preAllocatedVUs) {
      sc.maxVUs = sc.preAllocatedVUs;
    }
  }
  return out;
}

/**
 * Global thresholds from the threshold set + per-endpoint SLOs from the endpoint file.
 * Every endpoint also gets a no-op threshold so k6 shows its own row in the summary.
 */
export function buildThresholds(thresholdSet, endpoints, extra = {}) {
  const out = deepClone(thresholdSet.thresholds || {});
  const add = (metric, rule) => {
    out[metric] = out[metric] || [];
    out[metric].push(rule);
  };

  for (const ep of endpoints) {
    const durKey = `http_req_duration{endpoint:${ep.name}}`;
    const slo = ep.slo || {};
    if (slo.p95) add(durKey, `p(95)<${slo.p95}`);
    if (slo.p99) add(durKey, `p(99)<${slo.p99}`);
    if (slo.avg) add(durKey, `avg<${slo.avg}`);
    if (!out[durKey]) add(durKey, 'max>=0');
    if (slo.errorRate !== undefined) add(`http_req_failed{endpoint:${ep.name}}`, `rate<${slo.errorRate}`);
    add(`http_reqs{endpoint:${ep.name}}`, 'count>=0');
  }

  for (const [metric, rules] of Object.entries(extra || {})) {
    for (const r of rules) add(metric, r);
  }
  return out;
}

export function filterEndpoints(endpoints, env) {
  const names = splitList(env.ENDPOINTS);
  const groups = splitList(env.GROUPS);
  return endpoints.filter((ep) => {
    if (ep.enabled === false) return false;
    if (names.length && !names.includes(ep.name)) return false;
    if (groups.length && !groups.includes(ep.group)) return false;
    return true;
  });
}

function validateEndpoints(endpoints) {
  const seen = new Set();
  for (const ep of endpoints) {
    if (!ep.name || !ep.path) throw new Error(`[config] every endpoint needs "name" and "path": ${JSON.stringify(ep)}`);
    if (seen.has(ep.name)) throw new Error(`[config] duplicate endpoint name "${ep.name}"`);
    seen.add(ep.name);
    if (ep.weight !== undefined && !(ep.weight > 0)) throw new Error(`[config] endpoint "${ep.name}" weight must be > 0`);
    const text = ep.path + JSON.stringify(ep.query || {}) + JSON.stringify(ep.body || {});
    const placeholders = [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
    for (const p of placeholders) {
      if (!ep.params || !(p in ep.params)) throw new Error(`[config] endpoint "${ep.name}" uses {${p}} but has no params.${p}`);
    }
  }
}

function validateScenarios(scenarios, endpointsByName) {
  if (!scenarios || !Object.keys(scenarios).length) throw new Error('[config] config/test.json has no scenarios');
  for (const [name, sc] of Object.entries(scenarios)) {
    if (!sc.executor) throw new Error(`[config] scenario "${name}" has no executor`);
    if (!KNOWN_EXECS.includes(sc.exec)) {
      throw new Error(`[config] scenario "${name}" exec "${sc.exec}" is unknown. Use one of: ${KNOWN_EXECS.join(', ')}`);
    }
    if (sc.exec === 'endpointFlow') {
      const target = sc.env && sc.env.ENDPOINT;
      if (!target || !endpointsByName[target]) {
        throw new Error(`[config] scenario "${name}" runs endpointFlow but env.ENDPOINT "${target}" is not an enabled endpoint`);
      }
    }
  }
}

/**
 * Merge order (later wins):
 *   environment file -> config/test.json -> threshold set -> CLI env vars (-e KEY=VALUE)
 */
export function buildConfig({ environment, test, apiFile, thresholdSet, names, env }) {
  validateEndpoints(apiFile.endpoints || []);
  const endpoints = filterEndpoints(apiFile.endpoints || [], env).map((ep) => ({ method: 'GET', weight: 1, group: 'default', ...ep }));
  if (!endpoints.length) throw new Error('[config] no endpoints left after filters (enabled / ENDPOINTS / GROUPS)');
  const endpointsByName = Object.fromEntries(endpoints.map((e) => [e.name, e]));

  const journeys = (apiFile.journeys || []).filter((j) => j.steps.every((s) => endpointsByName[s.endpoint]));

  const loadFactor = Number(env.LOAD_FACTOR || environment.loadFactor || 1);
  let scenarios = deepClone(test.scenarios);
  for (const sc of Object.values(scenarios)) sc.exec = sc.exec || 'getApiFlow';
  scenarios = applyScenarioOverrides(scenarios, env);
  scenarios = scaleScenarios(scenarios, loadFactor);

  if (Object.values(scenarios).some((s) => s.exec === 'journeyFlow') && !journeys.length) {
    throw new Error('[config] a scenario uses journeyFlow but no journey has all its endpoints enabled');
  }
  validateScenarios(scenarios, endpointsByName);

  let thinkTime = test.thinkTime || environment.thinkTime || { min: 0, max: 0 };
  if (env.THINK_TIME !== undefined && env.THINK_TIME !== '') {
    const t = Number(env.THINK_TIME);
    thinkTime = { min: t, max: t };
  }

  const retry = { maxRetries: 0, backoffMs: 0, retryOn: [], ...(environment.retry || {}) };
  if (env.MAX_RETRIES !== undefined && env.MAX_RETRIES !== '') retry.maxRetries = Number(env.MAX_RETRIES);

  return {
    envName: names.env,
    apiName: names.api,
    thresholdSetName: names.thresholds,
    description: test.description,
    baseUrl: (env.BASE_URL || environment.baseUrl).replace(/\/+$/, ''),
    timeout: env.TIMEOUT || environment.timeout || '30s',
    headers: environment.headers || {},
    auth: environment.auth || { type: 'none' },
    healthCheck: environment.healthCheck,
    insecureSkipTLSVerify: !!environment.insecureSkipTLSVerify,
    retry,
    thinkTime,
    loadFactor,
    datasets: apiFile.datasets || {},
    endpoints,
    endpointsByName,
    journeys,
    scenarios,
    thresholds: buildThresholds(thresholdSet, endpoints, test.thresholds),
    tags: {
      ...(environment.tags || {}),
      env: names.env,
      api: names.api,
      ...(env.TEST_ID ? { testid: env.TEST_ID } : {}),
    },
  };
}
