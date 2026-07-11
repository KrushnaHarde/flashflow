// load-tests/helpers.js
import { check } from 'k6';
import http from 'k6/http';
import exec from 'k6/execution';
import { SharedArray } from 'k6/data';
import { Trend, Rate, Counter } from 'k6/metrics';
import { BASE_URL, ENDPOINTS } from './config.js';

// Custom metrics to show breakdown by endpoint and by stage
export const endpointTrend = new Trend('endpoint_duration');
export const errorRate = new Rate('endpoint_error_rate');
export const requestCounter = new Counter('endpoint_requests');
export const rateLimitCounter = new Counter('rate_limit_blocks');

// Load user pool using SharedArray to optimize VM memory and init boot time
export const usersPool = new SharedArray('users pool', function () {
  try {
    return JSON.parse(open('./users_pool.json'));
  } catch (e) {
    // Graceful fallback when the user pool file has not been pre-generated yet
    return [];
  }
});

/**
 * Authenticates a test session by dynamically registering and logging in a user,
 * then fetching their userId profile.
 * Runs once during the setup phase of the load tests.
 */
export function authenticateUser(baseUrl) {
  const email = `loadtest_${Math.floor(Math.random() * 1000000)}@example.com`;
  const password = 'Password123!';

  // 1. Register User
  const regPayload = JSON.stringify({
    name: 'Load Test User',
    email: email,
    password: password
  });
  
  const regHeaders = { 'Content-Type': 'application/json' };
  const regRes = http.post(`${baseUrl}/api/v1/auth/register`, regPayload, { headers: regHeaders });
  
  if (regRes.status !== 201) {
    console.warn(`Registration returned status ${regRes.status}. Body: ${regRes.body}`);
  }

  // 2. Login User
  const loginPayload = JSON.stringify({
    email: email,
    password: password
  });
  const loginRes = http.post(`${baseUrl}/api/v1/auth/login`, loginPayload, { headers: regHeaders });
  
  if (loginRes.status !== 200) {
    throw new Error(`Login failed with status ${loginRes.status}. Body: ${loginRes.body}`);
  }

  const authData = JSON.parse(loginRes.body);
  const token = authData.accessToken;

  // 3. Get User ID via GET /api/v1/auth/me
  const authHeaders = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`
  };
  const meRes = http.get(`${baseUrl}/api/v1/auth/me`, { headers: authHeaders });
  
  if (meRes.status !== 200) {
    throw new Error(`Failed to fetch /me profile. Status ${meRes.status}. Body: ${meRes.body}`);
  }
  
  const meData = JSON.parse(meRes.body);
  const userId = meData.id;

  // 4. Seeded product ID (from seed-data.sql)
  const productId = '5169a9b2-3b2d-4bf8-a46c-7e61e06cd2df';

  console.log(`[Setup] User authenticated successfully: email=${email}, userId=${userId}`);

  // 5. Startup Assertion: test POST /purchase endpoint status and response shape
  const testPayload = JSON.stringify({
    userId: userId,
    productId: productId,
    quantity: 1,
    idempotencyKey: `startup-check-${Date.now()}-${Math.random().toString(36).substring(2)}`
  });
  
  const testRes = http.post(`${baseUrl}/purchase`, testPayload, { headers: authHeaders });
  if (testRes.status !== 202) {
    throw new Error(`Startup Assertion Failed: POST /purchase returned status ${testRes.status} instead of 202. Body: ${testRes.body}`);
  }
  
  let testData;
  try {
    testData = JSON.parse(testRes.body);
  } catch (e) {
    throw new Error(`Startup Assertion Failed: POST /purchase response is not valid JSON. Body: ${testRes.body}`);
  }
  
  if (!testData.reservationId || !testData.expiresAt) {
    throw new Error(`Startup Assertion Failed: POST /purchase response shape did not match {reservationId, expiresAt}. Body: ${testRes.body}`);
  }
  
  console.log(`[Setup] Startup assertion passed: POST /purchase returned expected 202 Accepted and payload with {reservationId, expiresAt}.`);

  return {
    token: token,
    userId: userId,
    productId: productId
  };
}

let myUserIndex = null;

/**
 * Executes a single API request, validating the response and recording custom metrics.
 */
export function executeRequest(endpoint, stageName, fallbackAuthData) {
  // Resolve user session from the pool if populated and endpoint requires auth
  let authData = fallbackAuthData;
  if (endpoint.requiresAuth && usersPool && usersPool.length > 0) {
    if (myUserIndex === null) {
      myUserIndex = exec.vu.idInTest % usersPool.length;
    }
    authData = usersPool[myUserIndex];
    myUserIndex = (myUserIndex + 1) % usersPool.length;
  }

  const url = `${BASE_URL}${endpoint.path}`;
  
  // 1. Build headers, injecting Authorization token if required
  const headers = Object.assign({}, endpoint.headers || {});
  if (endpoint.requiresAuth && authData && authData.token) {
    headers['Authorization'] = `Bearer ${authData.token}`;
  }

  // 2. Construct dynamic body for purchases
  let body = endpoint.body;
  if (endpoint.dynamicBody && authData) {
    body = JSON.stringify({
      userId: authData.userId,
      productId: authData.productId,
      quantity: 1,
      idempotencyKey: `idem-${Math.random().toString(36).substring(2)}-${Date.now()}`
    });
  }

  const params = {
    headers: headers,
    tags: {
      stage: stageName,
      endpoint: endpoint.path,
    },
  };

  // Execute request
  const response = http.request(endpoint.method, url, body, params);

  // Perform checks
  const checksPassed = check(response, {
    'status code is expected': (r) => r.status === (endpoint.expectedStatus || 200),
    'response body is not empty': (r) => r.body && r.body.length > 0,
    'response is valid JSON': (r) => {
      const contentType = r.headers['Content-Type'] || r.headers['content-type'] || '';
      if (contentType.includes('application/json') || (r.body && (r.body.trim().startsWith('{') || r.body.trim().startsWith('[')))) {
        try {
          const parsed = JSON.parse(r.body);
          return typeof parsed === 'object';
        } catch (e) {
          return false;
        }
      }
      return true; // Pass if content is not JSON (like plain text "/health")
    },
    'response shape is correct': (r) => {
      if (endpoint.path === '/purchase' && r.status === 202) {
        try {
          const parsed = JSON.parse(r.body);
          return parsed.reservationId && parsed.expiresAt;
        } catch (e) {
          return false;
        }
      }
      return true;
    }
  }, { stage: stageName, endpoint: endpoint.path });

  const isError = !checksPassed;

  // Update custom trends and counters
  endpointTrend.add(response.timings.duration, { stage: stageName, endpoint: endpoint.path });
  errorRate.add(isError, { stage: stageName, endpoint: endpoint.path });
  requestCounter.add(1, { stage: stageName, endpoint: endpoint.path });

  if (response.status === 429) {
    rateLimitCounter.add(1, { stage: stageName });
  }

  return response;
}

/**
 * Simulates a single iteration of user traffic by randomly selecting and executing
 * one of the configured endpoints.
 */
export function runRandomEndpoint(stageName, authData) {
  if (!ENDPOINTS || ENDPOINTS.length === 0) {
    throw new Error('No endpoints defined in config.js');
  }
  const index = Math.floor(Math.random() * ENDPOINTS.length);
  const endpoint = ENDPOINTS[index];
  executeRequest(endpoint, stageName, authData);
}
