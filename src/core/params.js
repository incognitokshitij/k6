/**
 * Resolves dynamic values used in endpoint "params" (usable in path, query and body).
 *
 *   "data:postIds"      random row from dataset (uses row.id, or first column)
 *   "data:users.name"   random row, field "name"
 *   "seq:users.id"      rows in order across the whole test (unique until wrap-around)
 *   "range:1-100"       random integer in range
 *   "pick:a,b,c"        random item from list
 *   "env:VAR"           value of -e VAR=... or VAR in .env
 *   anything else       used as-is
 */
import exec from 'k6/execution';
import { getDataset } from './data.js';
import { randomInt } from './utils.js';
import { getEnv } from './env.js';

function fromDataset(arg, sequential) {
  const [name, field] = arg.split('.');
  const ds = getDataset(name);
  const idx = sequential ? exec.scenario.iterationInTest % ds.length : randomInt(0, ds.length - 1);
  const row = ds[idx];
  if (field) return row[field];
  if (row !== null && typeof row === 'object') return row.id !== undefined ? row.id : Object.values(row)[0];
  return row;
}

export function resolveValue(spec) {
  if (typeof spec !== 'string') return spec;
  const i = spec.indexOf(':');
  if (i < 0) return spec;
  const kind = spec.slice(0, i);
  const arg = spec.slice(i + 1);
  switch (kind) {
    case 'data':
      return fromDataset(arg, false);
    case 'seq':
      return fromDataset(arg, true);
    case 'range': {
      const [min, max] = arg.split('-').map(Number);
      return randomInt(min, max);
    }
    case 'pick': {
      const items = arg.split(',');
      return items[randomInt(0, items.length - 1)];
    }
    case 'env':
      return getEnv(arg);
    default:
      return spec;
  }
}

const PLACEHOLDER = /\{(\w+)\}/g;

/** Returns the concrete path + query for one request to this endpoint. */
export function resolveRequest(endpoint) {
  const values = {};
  for (const [k, spec] of Object.entries(endpoint.params || {})) values[k] = resolveValue(spec);

  const fill = (str) => str.replace(PLACEHOLDER, (_, k) => (k in values ? values[k] : `{${k}}`));
  const path = endpoint.path.replace(PLACEHOLDER, (_, k) => encodeURIComponent(values[k]));

  const query = {};
  for (const [k, v] of Object.entries(endpoint.query || {})) query[k] = typeof v === 'string' ? fill(v) : v;

  // body: a value that is exactly "{x}" keeps x's type; "{x}" inside other text is string-replaced
  const fillDeep = (v) => {
    if (typeof v === 'string') {
      const whole = /^\{(\w+)\}$/.exec(v);
      return whole && whole[1] in values ? values[whole[1]] : fill(v);
    }
    if (Array.isArray(v)) return v.map(fillDeep);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fillDeep(x)]));
    return v;
  };
  const body = endpoint.body === undefined ? undefined : fillDeep(endpoint.body);

  return { path, query, body, values };
}
