// load-tests/ramp-test.js
import exec from 'k6/execution';
import { BASE_URL, STAGES_CONFIGURED, SLA, ENDPOINTS } from './config.js';
import { runRandomEndpoint, authenticateUser } from './helpers.js';
import { handleSummary } from './custom-reporter.js';

// Initialize k6 options object
export const options = {
  scenarios: {},
  thresholds: {},
  summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(90)', 'p(95)', 'p(99)'],
};

/**
 * Parses k6 duration strings (e.g. '30s', '2m') to seconds.
 */
function parseDuration(durationStr) {
  const match = durationStr.match(/^(\d+)(s|m)$/);
  if (!match) return 0;
  const value = parseInt(match[1], 10);
  const unit = match[2];
  if (unit === 's') return value;
  if (unit === 'm') return value * 60;
  return 0;
}

// 1. Programmatically assemble sequential scenarios for each stage
let currentStartTimeSec = 0;
const maxVusOverride = __ENV.MAX_VUS_OVERRIDE ? parseInt(__ENV.MAX_VUS_OVERRIDE, 10) : null;

STAGES_CONFIGURED.forEach((stage) => {
  const scenarioName = `stage_${stage.name}`;
  
  let preAllocatedVUs = stage.preAllocatedVUs;
  let maxVUs = stage.maxVUs;

  if (maxVusOverride) {
    if (preAllocatedVUs > maxVusOverride) {
      preAllocatedVUs = maxVusOverride;
    }
    if (maxVUs > maxVusOverride) {
      maxVUs = maxVusOverride;
    }
  }

  // Define scenario configuration
  options.scenarios[scenarioName] = {
    executor: 'ramping-arrival-rate',
    startRate: 0,
    timeUnit: '1s',
    stages: [
      { target: stage.target, duration: stage.durationRamp }, // Ramp-up period
      { target: stage.target, duration: stage.durationHold }, // Hold load period
    ],
    preAllocatedVUs: preAllocatedVUs,
    maxVUs: maxVUs,
    tags: { stage: stage.name },
    startTime: `${currentStartTimeSec}s`, // Offsets scenario start so they run sequentially
    exec: 'runTest', // Function to execute
  };
  
  // Accumulate offset start time for the next scenario
  const durationSec = parseDuration(stage.durationRamp) + parseDuration(stage.durationHold);
  currentStartTimeSec += durationSec;

  // 2. Configure SLA thresholds for this stage
  options.thresholds[`http_req_duration{stage:${stage.name}}`] = [
    `p(95)<${SLA.P95_LATENCY_MS}`, // p95 latency threshold
    `p(99)<${SLA.P99_LATENCY_MS}`  // p99 latency threshold
  ];
  options.thresholds[`http_req_failed{stage:${stage.name}}`] = [
    `rate<${SLA.MAX_ERROR_RATE}`   // SLA failure rate threshold (e.g. < 1%)
  ];
});

// 3. Register dummy thresholds for endpoints to force k6 to expose their sub-metrics in handleSummary
ENDPOINTS.forEach((endpoint) => {
  options.thresholds[`http_req_duration{endpoint:${endpoint.path}}`] = ['p(95)>=0'];
  options.thresholds[`http_req_failed{endpoint:${endpoint.path}}`] = ['rate>=0'];
});

/**
 * Runs once at the start of the test to prepare authentication credentials.
 */
export function setup() {
  return authenticateUser(BASE_URL);
}

/**
 * The execution handler invoked by each scenario tick.
 * Picks a random endpoint from configuration and instruments it.
 */
export function runTest(data) {
  const scenarioName = exec.scenario.name;
  const stageName = scenarioName.replace(/^stage_/, '');
  runRandomEndpoint(stageName, data);
}

// Export custom report generation hooks
export { handleSummary };
