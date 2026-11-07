/** Custom metrics. Each one can be used in config/thresholds/*.json. */
import { Counter, Rate, Trend } from 'k6/metrics';

export const apiErrors = new Counter('api_errors'); // responses that failed any check
export const apiRetries = new Counter('api_retries'); // retried requests
export const apiSuccessRate = new Rate('api_success_rate'); // share of responses passing all checks
export const apiPayloadBytes = new Trend('api_payload_bytes'); // response body size
export const journeyDuration = new Trend('journey_duration', true); // sum of request times in a journey
