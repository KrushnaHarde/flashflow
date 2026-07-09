// load-tests/spike-test.js
import { BASE_URL, IS_SHORT_RUN, SLA, ENDPOINTS } from './config.js';
import { runRandomEndpoint, authenticateUser } from './helpers.js';
import { handleSummary } from './custom-reporter.js';

// If short run is enabled, scale down the spike target and durations for debugging
const spikeStages = IS_SHORT_RUN
  ? [
      { target: 10, duration: '3s' },     // fast ramp
      { target: 100, duration: '5s' },    // spike target
      { target: 100, duration: '10s' },   // hold period
      { target: 0, duration: '3s' },      // ramp down
    ]
  : [
      { target: 100, duration: '10s' },   // warm up
      { target: 10000, duration: '10s' }, // sudden spike to 10k rps
      { target: 10000, duration: '1m' },  // hold at 10k rps
      { target: 0, duration: '10s' },     // ramp down
    ];

const maxVUsConfig = IS_SHORT_RUN ? 300 : 15000;
const preAllocatedVUsConfig = IS_SHORT_RUN ? 50 : 2000;

export const options = {
  summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(90)', 'p(95)', 'p(99)'],
  scenarios: {
    spike: {
      executor: 'ramping-arrival-rate',
      startRate: 0,
      timeUnit: '1s',
      stages: spikeStages,
      preAllocatedVUs: preAllocatedVUsConfig,
      maxVUs: maxVUsConfig,
      tags: { stage: 'spike_10k' },
    },
  },
  thresholds: {
    // Validate SLA constraints during the spike
    'http_req_duration{stage:spike_10k}': [
      `p(95)<${SLA.P95_LATENCY_MS}`,
      `p(99)<${SLA.P99_LATENCY_MS}`
    ],
    'http_req_failed{stage:spike_10k}': [
      `rate<${SLA.MAX_ERROR_RATE}`
    ],
    // Dummy endpoint thresholds for report extraction
    ...ENDPOINTS.reduce((acc, ep) => {
      acc[`http_req_duration{endpoint:${ep.path}}`] = ['p(95)>=0'];
      acc[`http_req_failed{endpoint:${ep.path}}`] = ['rate>=0'];
      return acc;
    }, {}),
  },
};

/**
 * Runs once at the start of the test to prepare authentication credentials.
 */
export function setup() {
  return authenticateUser(BASE_URL);
}

/**
 * Main execution iteration loop.
 */
export default function (data) {
  runRandomEndpoint('spike_10k', data);
}

// Export custom report generation hooks
export { handleSummary };
