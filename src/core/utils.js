import { sleep } from 'k6';

export function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export function randomFloat(min, max) {
  return Math.random() * (max - min) + min;
}

/** Sleep for a random time between thinkTime.min and thinkTime.max seconds. */
export function thinkTime(tt) {
  if (!tt) return;
  const s = tt.min === tt.max ? tt.min : randomFloat(tt.min, tt.max);
  if (s > 0) sleep(s);
}

/** Returns a function that picks an item based on its `weight` field. */
export function createWeightedPicker(items) {
  const cumulative = [];
  let total = 0;
  for (const it of items) {
    total += it.weight || 1;
    cumulative.push(total);
  }
  return () => {
    const r = Math.random() * total;
    for (let i = 0; i < cumulative.length; i++) if (r < cumulative[i]) return items[i];
    return items[items.length - 1];
  };
}

export function buildUrl(baseUrl, path, query) {
  const qs = Object.entries(query || {})
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
  return `${baseUrl}${path}${qs ? `?${qs}` : ''}`;
}
