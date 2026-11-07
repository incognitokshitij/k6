import exec from 'k6/execution';
import { getEnv } from './env.js';

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const current = LEVELS[(getEnv('LOG_LEVEL') || 'info').toLowerCase()] || LEVELS.info;

function prefix(level) {
  let where = 'init';
  try {
    where = `vu=${exec.vu.idInTest} iter=${exec.vu.iterationInScenario}`;
  } catch (_) {
    /* not in VU context */
  }
  return `[${level.toUpperCase()}][${where}]`;
}

function emit(level, fn, args) {
  if (LEVELS[level] >= current) fn(prefix(level), ...args);
}

export const log = {
  debug: (...a) => emit('debug', console.log, a),
  info: (...a) => emit('info', console.log, a),
  warn: (...a) => emit('warn', console.warn, a),
  error: (...a) => emit('error', console.error, a),
};
