# k6 API Performance Test

Tests the response time of the Skeps UAT **application list API**. All settings are JSON files in `config/`.

## Setup

```bash
brew install k6
```

Add your token to `.env`:
```
ACCESS_TOKEN=eyJhbGciOi...
```
Get it from the browser: DevTools → Network → any API call → `access_token` header. It expires. On **401**, copy a new one.

## Run

```bash
npm run test                       # sends 2 requests
npm run test -- -e ITERATIONS=5    # sends 5 requests
```

The output is a results table only (the API response is not printed):

```
endpoint         | method | requests | failed | checks | avg_ms | p95_ms | max_ms | server_ms | size_kb | result
application_list | POST   | 2        | 0.0%   | 66.7%  | 5710   | 7900   | 8140   | 1380      | 1649    | FAIL
```

## Where to change things

| Change | File |
|---|---|
| Number of requests / users | `config/test.json` |
| API path, body, checks, time limits | `config/endpoints/list-api.json` |
| Base URL, headers | `config/environments/uat.json` |
| Pass/fail rules | `config/thresholds/default.json` |
| Token | `.env` |

## How it works

```
npm run test → k6 run tests/api.test.js
  1. load config/*.json + .env
  2. setup()          once
  3. getApiFlow()     per request: build → call API → check → wait 1s
  4. handleSummary()  print table
  5. exit 0 = PASS, 99 = FAIL
```

> This hits the shared UAT server. Ask the team before running large tests.
