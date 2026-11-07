/**
 * Reads JSON config files (init context only) and builds the final config.
 *
 * config/test.json                                   -> the load (scenarios, think time)
 * ENV        -> config/environments/<ENV>.json        (default: uat)
 * API        -> config/endpoints/<API>.json            (default: environment.api or list-api)
 * THRESHOLDS -> config/thresholds/<THRESHOLDS>.json    (default: environment.thresholdSet / test.thresholdSet / default)
 */
import { buildConfig } from './builders.js';

function readJson(rel) {
  let raw;
  try {
    raw = open(import.meta.resolve(`../../config/${rel}`));
  } catch (e) {
    throw new Error(`[config] cannot read config/${rel} (${e.message})`);
  }
  try {
    return JSON.parse(raw);
  } catch (e) {
    throw new Error(`[config] invalid JSON in config/${rel}: ${e.message}`);
  }
}

function lower(v, fallback) {
  return (v || fallback).toString().trim().toLowerCase();
}

const envName = lower(__ENV.ENV, 'uat');
const environment = readJson(`environments/${envName}.json`);
const test = readJson('test.json');

const apiName = lower(__ENV.API, environment.api || 'list-api');
const apiFile = readJson(`endpoints/${apiName}.json`);

const thresholdsName = lower(__ENV.THRESHOLDS, environment.thresholdSet || test.thresholdSet || 'default');
const thresholdSet = readJson(`thresholds/${thresholdsName}.json`);

export const config = Object.freeze(
  buildConfig({
    environment,
    test,
    apiFile,
    thresholdSet,
    names: { env: envName, api: apiName, thresholds: thresholdsName },
    env: __ENV,
  })
);
