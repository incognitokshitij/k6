/**
 * Reads secrets/settings from (in order):
 *   1. -e KEY=VALUE or shell env vars (k6 puts both in __ENV)
 *   2. the project's .env file (optional, git-ignored)
 */
function loadDotEnv() {
  let raw = '';
  try {
    raw = open(import.meta.resolve('../../.env'));
  } catch (_) {
    return {}; // no .env file - fine
  }
  const out = {};
  for (const line of raw.split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (!m || line.trim().startsWith('#')) continue;
    out[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return out;
}

const dotEnv = loadDotEnv();

export function getEnv(name) {
  const v = __ENV[name];
  return v !== undefined && v !== '' ? v : dotEnv[name];
}
