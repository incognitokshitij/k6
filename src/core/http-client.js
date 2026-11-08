/**
 * Thin wrapper over k6/http:
 *  - base URL, default headers, auth, timeout
 *  - tags every request with endpoint + group, and groups URLs by template (low cardinality)
 *  - marks the endpoint's expected status as "not failed" (e.g. negative 404 tests)
 *  - optional retries with linear backoff
 */
import http from 'k6/http';
import { sleep } from 'k6';
import { resolveRequest } from './params.js';
import { expectedStatuses } from './checks.js';
import { apiRetries } from './metrics.js';
import { buildUrl } from './utils.js';

export class ApiClient {
  constructor(config, extraHeaders = {}) {
    this.baseUrl = config.baseUrl;
    this.timeout = config.timeout;
    this.retry = config.retry;
    this.headers = { ...config.headers, ...extraHeaders };
    this.paramsCache = {};
  }

  params(endpoint) {
    if (!this.paramsCache[endpoint.name]) {
      this.paramsCache[endpoint.name] = {
        headers: {
          ...this.headers,
          ...(endpoint.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...(endpoint.headers || {}),
        },
        timeout: endpoint.timeout || this.timeout,
        tags: {
          endpoint: endpoint.name,
          endpoint_group: endpoint.group,
          name: `${endpoint.method} ${endpoint.path}`,
        },
        responseCallback: http.expectedStatuses(...expectedStatuses(endpoint)),
      };
    }
    return this.paramsCache[endpoint.name];
  }

  prepare(endpoint) {
    const req = resolveRequest(endpoint);
    return {
      method: endpoint.method,
      url: buildUrl(this.baseUrl, req.path, req.query),
      body: req.body === undefined ? null : JSON.stringify(req.body),
      params: this.params(endpoint),
    };
  }

  shouldRetry(res, endpoint) {
    if (expectedStatuses(endpoint).includes(res.status)) return false;
    return res.status === 0 || this.retry.retryOn.includes(res.status);
  }

  call(endpoint) {
    const { method, url, body, params } = this.prepare(endpoint);
    let res = http.request(method, url, body, params);
    for (let attempt = 1; attempt <= this.retry.maxRetries && this.shouldRetry(res, endpoint); attempt++) {
      apiRetries.add(1, { endpoint: endpoint.name });
      sleep((this.retry.backoffMs * attempt) / 1000);
      res = http.request(method, url, body, params);
    }
    return res;
  }

  /** Sends all endpoints in parallel (http.batch). Responses keep the same order. */
  batch(endpoints) {
    return http.batch(endpoints.map((ep) => this.prepare(ep)));
  }
}
