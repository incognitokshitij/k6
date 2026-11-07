/**
 * Test data from the endpoint file's "datasets" map. Each file is loaded once into a
 * SharedArray (read-only, shared between VUs, so memory stays low).
 * Files must be JSON arrays, paths relative to project root.
 */
import { SharedArray } from 'k6/data';
import { config } from '../config/loader.js';

function load(name, rel) {
  return new SharedArray(name, () => {
    const raw = open(import.meta.resolve(`../../${rel}`));
    if (!rel.endsWith('.json')) throw new Error(`[data] ${rel} must be a .json file`);
    const data = JSON.parse(raw);
    if (!Array.isArray(data)) throw new Error(`[data] ${rel} must contain a JSON array`);
    return data;
  });
}

const datasets = {};
for (const [name, rel] of Object.entries(config.datasets)) datasets[name] = load(name, rel);

export function getDataset(name) {
  const ds = datasets[name];
  if (!ds) throw new Error(`[data] unknown dataset "${name}". Declared: ${Object.keys(datasets).join(', ')}`);
  if (!ds.length) throw new Error(`[data] dataset "${name}" is empty`);
  return ds;
}
