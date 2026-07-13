// load-tests/config.js

// BASE_URL defaults to http://localhost:8080 but can be overridden by environment variable
export const BASE_URL = __ENV.BASE_URL || 'http://localhost:8080';

// Configurable SLA thresholds
export const SLA = {
  P95_LATENCY_MS: parseInt(__ENV.SLA_P95_LATENCY_MS || '500', 10),
  P99_LATENCY_MS: parseInt(__ENV.SLA_P99_LATENCY_MS || '1000', 10),
  MAX_ERROR_RATE: parseFloat(__ENV.SLA_MAX_ERROR_RATE || '0.01'), // 1%
};

// Real API endpoints configuration for the FlashFlow application
export const ENDPOINTS = [
  {
    method: 'GET',
    path: '/health',
    body: null,
    headers: { 'Accept': 'text/plain' },
    expectedStatus: 200,
    requiresAuth: false,
  },
  {
    method: 'GET',
    path: '/products',
    body: null,
    headers: { 'Accept': 'application/json' },
    expectedStatus: 200,
    requiresAuth: true,
  },
  {
    method: 'POST',
    path: '/purchase',
    body: null,
    headers: { 'Content-Type': 'application/json' },
    expectedStatus: 202, // 202 Accepted is returned by the async checkout endpoint
    requiresAuth: true,
    dynamicBody: true,
  }
];

// Load stages definition
// In a full run, this is a 20-minute test.
// Chaining is handled via scenario startTime offsets.
export const STAGES = [
  { name: '1_rps', target: 1, durationRamp: '30s', durationHold: '1m', preAllocatedVUs: 2, maxVUs: 10 },
  { name: '10_rps', target: 10, durationRamp: '30s', durationHold: '1m', preAllocatedVUs: 10, maxVUs: 50 },
  { name: '100_rps', target: 100, durationRamp: '30s', durationHold: '2m', preAllocatedVUs: 50, maxVUs: 300 },
  { name: '500_rps', target: 500, durationRamp: '30s', durationHold: '2m', preAllocatedVUs: 200, maxVUs: 1500 },
  { name: '1k_rps', target: 1000, durationRamp: '1m', durationHold: '3m', preAllocatedVUs: 500, maxVUs: 3000 },
  { name: '5k_rps', target: 5000, durationRamp: '1m', durationHold: '3m', preAllocatedVUs: 1500, maxVUs: 4000 },
  { name: '10k_rps', target: 10000, durationRamp: '1m', durationHold: '3m', preAllocatedVUs: 3000, maxVUs: 6000 },
];

// Helper to determine if we are running a short debugging test
export const IS_SHORT_RUN = __ENV.SHORT_RUN === 'true';

// Adjust stage durations if running a quick debug validation
export const STAGES_CONFIGURED = STAGES.map(stage => {
  if (IS_SHORT_RUN) {
    return {
      ...stage,
      durationRamp: '5s',
      durationHold: '10s',
    };
  }
  return stage;
});
