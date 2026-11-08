/**
 * Builds k6 checks from the endpoint's "expect" block:
 *   status, maxDurationMs, contentType, isArray, minItems, jsonFields, bodyContains
 */
import { check } from 'k6';
import { apiErrors, apiPayloadBytes, apiSuccessRate } from './metrics.js';

const cache = {};

export function expectedStatuses(endpoint) {
  const s = (endpoint.expect && endpoint.expect.status) || 200;
  return Array.isArray(s) ? s : [s];
}

function rules(endpoint) {
  if (cache[endpoint.name]) return cache[endpoint.name];
  const e = endpoint.expect || {};
  const n = endpoint.name;
  const statuses = expectedStatuses(endpoint);
  const firstItem = (body) => (Array.isArray(body) ? body[0] : body);
  const list = [];

  list.push([`${n}: status is ${statuses.join('|')}`, (r) => statuses.includes(r.status)]);
  if (e.maxDurationMs) list.push([`${n}: duration < ${e.maxDurationMs}ms`, (r) => r.timings.duration < e.maxDurationMs]);
  if (e.contentType) {
    list.push([`${n}: content-type ${e.contentType}`, (r) => String(r.headers['Content-Type'] || '').includes(e.contentType)]);
  }
  if (e.isArray) list.push([`${n}: body is array`, (r, body) => Array.isArray(body())]);
  if (e.minItems) list.push([`${n}: at least ${e.minItems} items`, (r, body) => (body() || []).length >= e.minItems]);
  if (e.jsonFields && e.jsonFields.length) {
    list.push([
      `${n}: has fields ${e.jsonFields.join(',')}`,
      (r, body) => {
        const obj = firstItem(body());
        return !!obj && e.jsonFields.every((f) => obj[f] !== undefined);
      },
    ]);
  }
  if (e.bodyContains) list.push([`${n}: body contains "${e.bodyContains}"`, (r) => String(r.body || '').includes(e.bodyContains)]);

  cache[endpoint.name] = list;
  return list;
}

/** Runs checks, records custom metrics, returns true when all checks pass. */
export function validateResponse(res, endpoint) {
  let parsed;
  let done = false;
  const body = () => {
    if (!done) {
      done = true;
      try {
        parsed = res.json();
      } catch (_) {
        parsed = undefined;
      }
    }
    return parsed;
  };

  const tags = { endpoint: endpoint.name };
  const checks = {};
  for (const [name, fn] of rules(endpoint)) checks[name] = (r) => fn(r, body);

  const ok = check(res, checks, tags);
  apiSuccessRate.add(ok, tags);
  if (res.body) apiPayloadBytes.add(res.body.length, tags);
  if (!ok) apiErrors.add(1, tags);
  return ok;
}
