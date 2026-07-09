// load-tests/smoke-test.js
import { sleep } from 'k6';
import { BASE_URL, ENDPOINTS } from './config.js';
import { executeRequest, authenticateUser } from './helpers.js';
import { handleSummary } from './custom-reporter.js';

// Options for a simple, low-load smoke test
export const options = {
  scenarios: {
    smoke: {
      executor: 'constant-vus',
      vus: 1,
      duration: '10s',
    }
  },
  summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(90)', 'p(95)', 'p(99)'],
  thresholds: {
    // Basic verification thresholds
    'http_req_failed': ['rate<0.01'], 
    'http_req_duration': ['p(95)<1000'], 
    
    // Dummy thresholds for metrics grouping
    ...ENDPOINTS.reduce((acc, ep) => {
      acc[`http_req_duration{endpoint:${ep.path}}`] = ['p(95)>=0'];
      acc[`http_req_failed{endpoint:${ep.path}}`] = ['rate>=0'];
      return acc;
    }, {}),
    
    'http_req_duration{stage:smoke}': ['p(95)>=0'],
    'http_req_failed{stage:smoke}': ['rate>=0'],
  },
};

/**
 * Run once before the test starts to register/authenticate and return user session data.
 */
export function setup() {
  return authenticateUser(BASE_URL);
}

/**
 * Main execution iteration loop.
 */
export default function (data) {
  // Execute each configured endpoint once per iteration
  for (const endpoint of ENDPOINTS) {
    executeRequest(endpoint, 'smoke', data);
    sleep(1); // 1-second pause to keep smoke test gentle
  }
}

// Export custom report generation hooks
export { handleSummary };
