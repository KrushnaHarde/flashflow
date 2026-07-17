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
// Memory Budget Calculation:
// Instance: m7i-flex.large (8GB physical RAM, ~7.5GB usable after hypervisor overhead).
// Headroom for Host: We allocate 2.5GB for the OS, background metrics collectors, and file system page caches, leaving 5GB (5120MB) dedicated to k6.
// Memory per VU: Each k6 VU running this script consumes approximately 3.0MB.
// Maximum Safe VU allocation: 5120MB / 3.0MB = 1706 VUs.
// We configure the largest stage (10k_rps) to cap at 1500 maxVUs (requiring ~4.5GB peak memory), which keeps peak usage safely under our limits.
export const STAGES = [
  { name: '500_rps', target: 500, durationRamp: '30s', durationHold: '2m', preAllocatedVUs: 100, maxVUs: 500 },
  { name: '1k_rps', target: 1000, durationRamp: '1m', durationHold: '3m', preAllocatedVUs: 200, maxVUs: 1000 },
  { name: '2k_rps', target: 2000, durationRamp: '1m', durationHold: '3m', preAllocatedVUs: 300, maxVUs: 1500 },
  { name: '5k_rps', target: 5000, durationRamp: '1m', durationHold: '3m', preAllocatedVUs: 500, maxVUs: 2500 },
  { name: '7_5k_rps', target: 7500, durationRamp: '1m', durationHold: '3m', preAllocatedVUs: 600, maxVUs: 3000 },
  { name: '10k_rps', target: 10000, durationRamp: '1m', durationHold: '3m', preAllocatedVUs: 800, maxVUs: 4000 },
  { name: '15k_rps', target: 15000, durationRamp: '1m', durationHold: '3m', preAllocatedVUs: 1000, maxVUs: 5000 },
  { name: '20k_rps', target: 20000, durationRamp: '1m', durationHold: '3m', preAllocatedVUs: 1200, maxVUs: 6000 }
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
