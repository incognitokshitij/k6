# k6 Performance Tests (config-driven)

Performance tests for the Skeps UAT APIs. The target, load, endpoints, request bodies and SLOs all live in JSON under `config/`. The test code does not change between runs.

Currently set up for one API: **contractor dashboard → application list v2** (`config/endpoints/list-api.json`).

Requires **k6 v1.x** (or ≥ 0.53). npm is only used for the `npm run test` shortcut.

## Run

```bash
brew install k6
cd k6
# put ACCESS_TOKEN=<your access_token> in .env (see "Auth token" below)
npm run test
```

That's the only command. It runs `k6 run tests/api.test.js`. Extra k6 args go after `--`:

```bash
npm run test -- -e VUS=2 -e DURATION=30s      # smaller run
npm run test -- -e LOG_LEVEL=debug            # print failing response bodies
```

## Layout

```
k6/
├── config/
│   ├── test.json             the load: scenarios (users, duration, ramp-up), think time
│   ├── environments/uat.json base URL, headers, auth, retries
│   ├── endpoints/list-api.json  endpoints: method, path, body, checks, SLOs
│   └── thresholds/           default | strict | relaxed | breakpoint  -> pass/fail SLOs
├── src/
│   ├── config/               loader.js (reads JSON) + builders.js (merge, scale, validate)
│   └── core/                 http-client, checks, params, auth, env (.env reader), metrics, data, logger, utils, results (end table)
├── tests/api.test.js         entry point: options + flows
├── .env                      your access token (git-ignored)
└── .github/workflows/k6.yml
```

## Auth token

The API needs the `access_token` header. Set it in `.env`:

```
ACCESS_TOKEN=eyJhbGciOi...
```

The token is a JWT copied from the browser (DevTools → Network → any dashboard API call → `access_token` request header). It expires, so if every request fails with 401, copy a fresh one. You can also pass it per run: `npm run test -- -e ACCESS_TOKEN=...`.

Browser-only headers from the original curl (cookies, `sec-ch-*`, sentry, user-agent) are not sent. They aren't needed for the API.

## How config is merged

```
environments/<ENV>.json  ->  test.json  ->  thresholds/<set>.json  ->  -e CLI overrides
```

Defaults: `ENV=uat`, `API` = the environment's `api` field (`list-api`).
Threshold set: `-e THRESHOLDS` > `environment.thresholdSet` > `test.thresholdSet` > `default`.

## The endpoint file (`config/endpoints/list-api.json`)

```json
{
  "name": "application_list",
  "group": "contractor_dashboard",
  "method": "POST",
  "path": "/partner/api/cygnus/v2/dashboard/lender/contractor/dashboard/application/list/v2",
  "body": {
    "data": { "contractor_ids": ["1", "RSPQSR3Q", "GDBEBVHA", "VCRHHH"] },
    "agent_id": "c9434eae-b080-4920-832c-b172967d6167"
  },
  "expect": { "status": 200, "maxDurationMs": 2000, "contentType": "application/json" },
  "slo": { "p95": 1500, "p99": 3000, "errorRate": 0.01 }
}
```

To add another API, add an entry to `endpoints` (they're picked by `weight`), or create a new file `config/endpoints/<name>.json` and run it with `npm run test -- -e API=<name>`.

Fields:

- **method**: `GET`, `POST`, ... (default `GET`). `body` is sent as JSON.
- **params** (optional): dynamic values used as `{name}` in `path`, `query` or `body`:
  `data:<dataset>[.field]` (random row from a data file), `seq:<dataset>[.field]` (in order), `range:1-100`, `pick:a,b,c`, `env:VAR`, or a literal.
  Example: `"params": { "agentId": "env:AGENT_ID" }` + `"agent_id": "{agentId}"` in the body.
- **datasets** (top level): `{ "contractors": "data/contractors.json" }`, a JSON array (create a `data/` folder when you need one).
- **expect**: `status` (number or list), `maxDurationMs`, `contentType`, `isArray`, `minItems`, `jsonFields`, `bodyContains`.
- **slo**: becomes thresholds on `http_req_duration{endpoint:<name>}` / `http_req_failed{endpoint:<name>}`.
- `"enabled": false` turns an endpoint off.

## Changing the load (`config/test.json`)

`scenarios` uses k6's own scenario format, so any executor works. The default sends **2 requests in total** (1 user, `shared-iterations`, 1s pause between them). Change `iterations` for more requests, or use one of the examples below for real load. The environment's `loadFactor` scales user counts and rates.

Examples to paste in instead:

```json
"constant": { "executor": "constant-vus", "exec": "getApiFlow", "vus": 5, "duration": "2m" }
```
```json
"fixed_rps": { "executor": "constant-arrival-rate", "exec": "getApiFlow",
               "rate": 20, "timeUnit": "1s", "duration": "5m", "preAllocatedVUs": 20, "maxVUs": 100 }
```

`exec` picks the flow:

- `getApiFlow` – one endpoint per iteration, picked by `weight`
- `journeyFlow` – runs a `journeys` entry step by step
- `batchFlow` – fires all `batchable` endpoints in parallel
- `endpointFlow` – one endpoint only, set with `"env": { "ENDPOINT": "<name>" }` on the scenario

## CLI overrides (`npm run test -- -e KEY=VALUE`)

| Var | Effect |
|---|---|
| `ENV`, `API`, `THRESHOLDS` | choose config files |
| `BASE_URL`, `TIMEOUT` | override target |
| `VUS`, `DURATION`, `ITERATIONS`, `RATE`, `MAX_VUS` | override scenario fields (only where the field exists) |
| `LOAD_FACTOR` | scale the whole load |
| `ENDPOINTS=a,b` / `GROUPS=x` | run a subset of endpoints |
| `THINK_TIME=0` | fixed think time (seconds) |
| `MAX_RETRIES` | override retry count |
| `ACCESS_TOKEN` | override the token from `.env` |
| `LOG_LEVEL` | debug / info / warn / error |

Use `-e VUS=...` rather than `--vus`: k6's own `--vus/--duration` flags replace the configured scenarios.

## Results

At the end of the run a table prints in the terminal, one row per endpoint (built in `src/core/results.js` as an array of objects):

```
endpoint         | method | requests | failed | checks | avg_ms | p95_ms | max_ms | server_ms | size_kb | result
-----------------|--------|----------|--------|--------|--------|--------|--------|-----------|---------|-------
application_list | POST   | 2        | 0.0%   | 66.7%  | 5710   | 7900   | 8140   | 1380      | 1649    | FAIL
```

- `failed` – share of requests with an unexpected status
- `checks` – share of checks passed (status, duration, content-type)
- `server_ms` – time until the server started answering (excludes download)
- `result` – PASS only if all checks and the endpoint's SLOs passed

Below it, any failed thresholds are listed. Exit code `99` means thresholds failed. Nothing is written to disk.

## Custom metrics

`api_errors`, `api_retries`, `api_success_rate`, `api_payload_bytes`, `journey_duration` – all usable in threshold files. Every request is tagged with `endpoint`, `endpoint_group` and `name` (`POST /partner/...`).

## CI

`.github/workflows/k6.yml` runs `npm run test` on weekdays and on demand (with optional extra k6 args); the result is in the job log. Add `ACCESS_TOKEN` as a repo secret. Because the token expires, a long-lived service token is better for CI. If `k6/` is the repo root, remove the `working-directory` default and the `k6/` path prefixes.

## Notes

- This load hits a shared UAT environment. Check with the team before raising users or duration.
