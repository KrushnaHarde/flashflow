// load-tests/custom-reporter.js
import { SLA, STAGES_CONFIGURED, ENDPOINTS, BASE_URL } from './config.js';

/**
 * Parses k6 time duration strings (e.g. '30s', '1m', '2m') to seconds.
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

/**
 * Builds the stages and endpoint results matrices from k6 raw metrics data.
 */
function processMetrics(data) {
  const matrix = [];
  let breakdownStage = null;

  // 1. Identify which stages ran by searching metrics tags
  const ranStages = [];
  const allMetricKeys = Object.keys(data.metrics);
  allMetricKeys.forEach(key => {
    const match = key.match(/^http_req_duration{stage:(.+)}$/);
    if (match) {
      const stageName = match[1];
      if (!ranStages.includes(stageName)) {
        ranStages.push(stageName);
      }
    }
  });

  // If no stages found in metrics, fallback to configured stages
  if (ranStages.length === 0) {
    STAGES_CONFIGURED.forEach(s => ranStages.push(s.name));
  } else {
    // Sort ran stages according to STAGES_CONFIGURED order, or put custom ones at the end
    ranStages.sort((a, b) => {
      const idxA = STAGES_CONFIGURED.findIndex(s => s.name === a);
      const idxB = STAGES_CONFIGURED.findIndex(s => s.name === b);
      if (idxA === -1 && idxB === -1) return 0;
      if (idxA === -1) return 1;
      if (idxB === -1) return -1;
      return idxA - idxB;
    });
  }

  for (const stageTag of ranStages) {
    // Find if it's a configured stage to get its target/durations
    const stageConf = STAGES_CONFIGURED.find(s => s.name === stageTag);
    const durationRamp = stageConf ? stageConf.durationRamp : '0s';
    const durationHold = stageConf ? stageConf.durationHold : '10s'; // default 10s for ad-hoc stage like 'smoke'
    const targetRps = stageConf ? stageConf.target : 1; // default 1 for ad-hoc stage

    const durationSec = parseDuration(durationRamp) + parseDuration(durationHold);
    
    // In k6, tagged metric variants are keyed as name{tagKey:tagValue} in data.metrics
    const durationKey = `http_req_duration{stage:${stageTag}}`;
    const failedKey = `http_req_failed{stage:${stageTag}}`;
    
    const durationMetric = data.metrics[durationKey];
    const failedMetric = data.metrics[failedKey];
    
    let totalRequests = 0;
    let p95 = 0;
    let p99 = 0;
    let avg = 0;
    let errorRate = 0;
    
    if (durationMetric && durationMetric.values) {
      p95 = durationMetric.values['p(95)'] || 0;
      p99 = durationMetric.values['p(99)'] || 0;
      avg = durationMetric.values.avg || 0;
    }
    
    if (failedMetric && failedMetric.values) {
      errorRate = failedMetric.values.rate !== undefined ? failedMetric.values.rate : (failedMetric.values.value || 0);
      totalRequests = (failedMetric.values.passes || 0) + (failedMetric.values.fails || 0);
    }
    
    const actualRps = durationSec > 0 ? (totalRequests / durationSec) : 0;
    
    // SLA thresholds validation
    const p95Violated = p95 > SLA.P95_LATENCY_MS;
    const p99Violated = p99 > SLA.P99_LATENCY_MS;
    const errorRateViolated = errorRate > SLA.MAX_ERROR_RATE;
    const slaPassed = !p95Violated && !p99Violated && !errorRateViolated;
    
    if (!slaPassed && !breakdownStage && totalRequests > 0) {
      breakdownStage = {
        name: stageTag,
        targetRps: targetRps,
        p95,
        p99,
        errorRate,
        reason: [
          p95Violated ? `p95 latency (${p95.toFixed(1)}ms > ${SLA.P95_LATENCY_MS}ms)` : '',
          p99Violated ? `p99 latency (${p99.toFixed(1)}ms > ${SLA.P99_LATENCY_MS}ms)` : '',
          errorRateViolated ? `Error rate (${(errorRate * 100).toFixed(2)}% > ${(SLA.MAX_ERROR_RATE * 100).toFixed(2)}%)` : ''
        ].filter(Boolean).join(', ')
      };
    }
    
    matrix.push({
      stage: stageTag,
      targetRps: targetRps,
      actualRps: parseFloat(actualRps.toFixed(2)),
      totalRequests,
      avgLatency: parseFloat(avg.toFixed(2)),
      p95Latency: parseFloat(p95.toFixed(2)),
      p99Latency: parseFloat(p99.toFixed(2)),
      errorRate: parseFloat((errorRate * 100).toFixed(4)),
      slaPassed,
      p95Violated,
      p99Violated,
      errorRateViolated
    });
  }

  // Process Endpoint Matrix
  const endpointMatrix = [];
  for (const endpoint of ENDPOINTS) {
    const path = endpoint.path;
    const durationMetric = data.metrics[`http_req_duration{endpoint:${path}}`];
    const failedMetric = data.metrics[`http_req_failed{endpoint:${path}}`];
    
    let p95 = 0;
    let p99 = 0;
    let avg = 0;
    let totalRequests = 0;
    let errorRate = 0;
    
    if (durationMetric && durationMetric.values) {
      p95 = durationMetric.values['p(95)'] || 0;
      p99 = durationMetric.values['p(99)'] || 0;
      avg = durationMetric.values.avg || 0;
    }
    
    if (failedMetric && failedMetric.values) {
      errorRate = failedMetric.values.rate !== undefined ? failedMetric.values.rate : (failedMetric.values.value || 0);
      totalRequests = (failedMetric.values.passes || 0) + (failedMetric.values.fails || 0);
    }
    
    endpointMatrix.push({
      path,
      method: endpoint.method,
      totalRequests,
      avgLatency: parseFloat(avg.toFixed(2)),
      p95Latency: parseFloat(p95.toFixed(2)),
      p99Latency: parseFloat(p99.toFixed(2)),
      errorRate: parseFloat((errorRate * 100).toFixed(4)),
    });
  }

  return { matrix, breakdownStage, endpointMatrix };
}

/**
 * Generates ASCII-styled text report for execution logs.
 */
function generateConsoleTextReport(matrix, breakdownStage) {
  let output = '\n' + '='.repeat(116) + '\n';
  output += '                                      K6 API LOAD TEST PERFORMANCE MATRIX\n';
  output += '='.repeat(116) + '\n';
  output += ` ${'Stage Name'.padEnd(12)} | ${'Target RPS'.padStart(10)} | ${'Actual RPS'.padStart(10)} | ${'Req Count'.padStart(10)} | ${'Avg Latency'.padStart(12)} | ${'p95 Latency'.padStart(12)} | ${'p99 Latency'.padStart(12)} | ${'Error Rate'.padStart(10)} | ${'SLA Status'.padEnd(10)}\n`;
  output += '-'.repeat(116) + '\n';
  
  for (const row of matrix) {
    const slaStr = row.totalRequests === 0 ? 'N/A' : (row.slaPassed ? 'PASS' : 'FAIL');
    output += ` ${row.stage.padEnd(12)} | ${row.targetRps.toString().padStart(10)} | ${row.actualRps.toFixed(2).padStart(10)} | ${row.totalRequests.toString().padStart(10)} | ${(row.avgLatency + 'ms').padStart(12)} | ${(row.p95Latency + 'ms').padStart(12)} | ${(row.p99Latency + 'ms').padStart(12)} | ${(row.errorRate.toFixed(2) + '%').padStart(10)} | ${slaStr.padEnd(10)}\n`;
  }
  output += '='.repeat(116) + '\n';
  
  const overallRequests = matrix.reduce((sum, r) => sum + r.totalRequests, 0);
  if (overallRequests === 0) {
    output += `\n[!] TEST ABORTED DURING SETUP/PREFLIGHT: No test requests were executed. Check console logs and setup() exception trace.\n\n`;
  } else if (breakdownStage) {
    output += `\n[!] SLA BREACH DETECTED: System breaks down at ${breakdownStage.targetRps} req/s (Stage: ${breakdownStage.name})\n`;
    output += `    Reason: ${breakdownStage.reason}\n\n`;
  } else {
    output += `\n[+] SLA SUCCESS: All stages successfully met response time and error rate SLA constraints!\n\n`;
  }
  
  return output;
}

/**
 * Renders a high-end, modern glassmorphism styled HTML Dashboard.
 */
function generateHtmlReport(matrix, breakdownStage, endpointMatrix, data) {
  const timestamp = new Date().toLocaleString();
  const baseSlaInfo = `p95 < ${SLA.P95_LATENCY_MS}ms, p99 < ${SLA.P99_LATENCY_MS}ms, error rate < ${(SLA.MAX_ERROR_RATE * 100).toFixed(1)}%`;
  
  const totalRequests = data.metrics.http_reqs ? data.metrics.http_reqs.values.count : 0;
  const overallAvgDuration = data.metrics.http_req_duration ? data.metrics.http_req_duration.values.avg.toFixed(1) : 'N/A';
  const overallP95Duration = data.metrics.http_req_duration ? data.metrics.http_req_duration.values['p(95)'].toFixed(1) : 'N/A';
  const overallErrorRate = data.metrics.http_req_failed ? (data.metrics.http_req_failed.values.value * 100).toFixed(2) : 'N/A';

  // Highlight SLA Breakdown Status Card
  let statusCardHtml = '';
  if (breakdownStage) {
    statusCardHtml = `
      <div class="card status-card status-failed animate-pulse-subtle">
        <div class="status-icon">⚠️</div>
        <div>
          <h3>SLA Breach Detected</h3>
          <p>The system failed SLA thresholds at <strong>${breakdownStage.targetRps} req/s</strong> (Stage: ${breakdownStage.name}).</p>
          <span class="breach-reason">Reason: ${breakdownStage.reason}</span>
        </div>
      </div>
    `;
  } else {
    statusCardHtml = `
      <div class="card status-card status-passed">
        <div class="status-icon">✅</div>
        <div>
          <h3>SLA Thresholds Passed</h3>
          <p>The system successfully completed all testing tiers up to <strong>${matrix[matrix.length - 1].targetRps} req/s</strong> without breaching SLA limits.</p>
          <span class="breach-reason">All response and error thresholds are fully compliant.</span>
        </div>
      </div>
    `;
  }

  // Generate table rows for stages
  const stageRowsHtml = matrix.map(row => {
    const slaBadge = row.totalRequests === 0 
      ? '<span class="badge badge-neutral">N/A</span>' 
      : (row.slaPassed 
          ? '<span class="badge badge-pass">PASS</span>' 
          : '<span class="badge badge-fail">FAIL</span>');
          
    const p95Class = row.p95Violated ? 'text-fail font-bold' : '';
    const p99Class = row.p99Violated ? 'text-fail font-bold' : '';
    const errClass = row.errorRateViolated ? 'text-fail font-bold' : '';

    return `
      <tr>
        <td><strong>${row.stage}</strong></td>
        <td>${row.targetRps.toLocaleString()}</td>
        <td>${row.actualRps.toLocaleString()}</td>
        <td>${row.totalRequests.toLocaleString()}</td>
        <td>${row.avgLatency} ms</td>
        <td class="${p95Class}">${row.p95Latency} ms</td>
        <td class="${p99Class}">${row.p99Latency} ms</td>
        <td class="${errClass}">${row.errorRate.toFixed(2)}%</td>
        <td>${slaBadge}</td>
      </tr>
    `;
  }).join('');

  // Generate table rows for endpoints
  const endpointRowsHtml = endpointMatrix.map(row => {
    return `
      <tr>
        <td><span class="method-badge method-${row.method.toLowerCase()}">${row.method}</span></td>
        <td><code>${row.path}</code></td>
        <td>${row.totalRequests.toLocaleString()}</td>
        <td>${row.avgLatency} ms</td>
        <td>${row.p95Latency} ms</td>
        <td>${row.p99Latency} ms</td>
        <td>${row.errorRate.toFixed(2)}%</td>
      </tr>
    `;
  }).join('');

  return `
  <!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>k6 API Load Test Report</title>
    <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600;700&display=swap" rel="stylesheet">
    <style>
      :root {
        --bg-color: #0b0f19;
        --card-bg: rgba(22, 28, 45, 0.6);
        --card-border: rgba(255, 255, 255, 0.08);
        --text-primary: #f3f4f6;
        --text-secondary: #9ca3af;
        --accent-glow: rgba(99, 102, 241, 0.15);
        --primary-gradient: linear-gradient(135deg, #6366f1 0%, #a855f7 100%);
        --pass-color: #10b981;
        --pass-glow: rgba(16, 185, 129, 0.15);
        --fail-color: #ef4444;
        --fail-glow: rgba(239, 68, 68, 0.15);
        --border-radius: 16px;
      }

      * {
        box-sizing: border-box;
        margin: 0;
        padding: 0;
      }

      body {
        font-family: 'Plus Jakarta Sans', sans-serif;
        background-color: var(--bg-color);
        color: var(--text-primary);
        min-height: 100vh;
        padding: 2rem 1.5rem;
        background-image: 
          radial-gradient(at 0% 0%, rgba(99, 102, 241, 0.12) 0px, transparent 50%),
          radial-gradient(at 100% 100%, rgba(168, 85, 247, 0.08) 0px, transparent 50%);
        background-attachment: fixed;
      }

      .container {
        max-width: 1200px;
        margin: 0 auto;
      }

      header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 2rem;
        padding-bottom: 1.5rem;
        border-bottom: 1px solid var(--card-border);
      }

      .logo-title h1 {
        font-size: 2rem;
        font-weight: 700;
        background: var(--primary-gradient);
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        letter-spacing: -0.025em;
      }

      .logo-title p {
        color: var(--text-secondary);
        font-size: 0.9rem;
        margin-top: 0.25rem;
      }

      .meta-info {
        text-align: right;
        font-size: 0.85rem;
        color: var(--text-secondary);
      }

      .meta-info span {
        display: block;
        margin-bottom: 0.25rem;
      }

      .meta-info strong {
        color: var(--text-primary);
      }

      .grid-3 {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
        gap: 1.5rem;
        margin-bottom: 2rem;
      }

      .card {
        background: var(--card-bg);
        border: 1px solid var(--card-border);
        border-radius: var(--border-radius);
        padding: 1.5rem;
        backdrop-filter: blur(12px);
        box-shadow: 0 4px 30px rgba(0, 0, 0, 0.2);
        transition: transform 0.2s ease, border-color 0.2s ease;
      }

      .card:hover {
        transform: translateY(-2px);
        border-color: rgba(99, 102, 241, 0.3);
      }

      .status-card {
        grid-column: 1 / -1;
        display: flex;
        align-items: flex-start;
        gap: 1.5rem;
      }

      .status-icon {
        font-size: 2.5rem;
        line-height: 1;
      }

      .status-card h3 {
        font-size: 1.25rem;
        font-weight: 600;
        margin-bottom: 0.25rem;
      }

      .status-card p {
        color: #e5e7eb;
        margin-bottom: 0.5rem;
      }

      .status-failed {
        background: linear-gradient(135deg, rgba(239, 68, 68, 0.1) 0%, rgba(22, 28, 45, 0.8) 100%);
        border-color: rgba(239, 68, 68, 0.25);
        box-shadow: 0 0 20px var(--fail-glow);
      }

      .status-passed {
        background: linear-gradient(135deg, rgba(16, 185, 129, 0.1) 0%, rgba(22, 28, 45, 0.8) 100%);
        border-color: rgba(16, 185, 129, 0.25);
        box-shadow: 0 0 20px var(--pass-glow);
      }

      .breach-reason {
        font-size: 0.85rem;
        color: var(--text-secondary);
        display: inline-block;
        padding: 0.25rem 0.75rem;
        background: rgba(0, 0, 0, 0.2);
        border-radius: 8px;
        margin-top: 0.25rem;
      }

      .stat-card {
        display: flex;
        flex-direction: column;
        justify-content: space-between;
      }

      .stat-label {
        font-size: 0.85rem;
        color: var(--text-secondary);
        font-weight: 500;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        margin-bottom: 0.5rem;
      }

      .stat-value {
        font-size: 2.25rem;
        font-weight: 700;
        background: linear-gradient(135deg, #ffffff 0%, #e2e8f0 100%);
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
      }

      .stat-subtitle {
        font-size: 0.8rem;
        color: var(--text-secondary);
        margin-top: 0.5rem;
      }

      .panel {
        background: var(--card-bg);
        border: 1px solid var(--card-border);
        border-radius: var(--border-radius);
        padding: 1.5rem;
        backdrop-filter: blur(12px);
        margin-bottom: 2rem;
      }

      .panel-header {
        margin-bottom: 1.25rem;
      }

      .panel-title {
        font-size: 1.25rem;
        font-weight: 600;
      }

      .panel-subtitle {
        font-size: 0.85rem;
        color: var(--text-secondary);
        margin-top: 0.25rem;
      }

      table {
        width: 100%;
        border-collapse: collapse;
        text-align: left;
        font-size: 0.9rem;
      }

      th {
        padding: 1rem;
        color: var(--text-secondary);
        font-weight: 600;
        border-bottom: 1px solid var(--card-border);
        text-transform: uppercase;
        font-size: 0.75rem;
        letter-spacing: 0.05em;
      }

      td {
        padding: 1rem;
        border-bottom: 1px solid rgba(255, 255, 255, 0.04);
        color: var(--text-primary);
      }

      tr:hover td {
        background: rgba(255, 255, 255, 0.02);
      }

      .badge {
        display: inline-block;
        padding: 0.25rem 0.6rem;
        border-radius: 6px;
        font-size: 0.75rem;
        font-weight: 600;
        letter-spacing: 0.025em;
      }

      .badge-pass {
        background: rgba(16, 185, 129, 0.15);
        color: var(--pass-color);
        border: 1px solid rgba(16, 185, 129, 0.3);
      }

      .badge-fail {
        background: rgba(239, 68, 68, 0.15);
        color: var(--fail-color);
        border: 1px solid rgba(239, 68, 68, 0.3);
      }

      .badge-neutral {
        background: rgba(156, 163, 175, 0.15);
        color: var(--text-secondary);
        border: 1px solid rgba(156, 163, 175, 0.3);
      }

      .method-badge {
        font-size: 0.7rem;
        font-weight: 700;
        padding: 0.15rem 0.4rem;
        border-radius: 4px;
        color: #fff;
        text-transform: uppercase;
      }

      .method-get { background-color: #0ea5e9; }
      .method-post { background-color: #10b981; }
      .method-put { background-color: #f59e0b; }
      .method-delete { background-color: #ef4444; }

      .text-fail {
        color: var(--fail-color);
      }

      .font-bold {
        font-weight: 600;
      }

      code {
        font-family: SFMono-Regular, Consolas, "Liberation Mono", Menlo, monospace;
        background: rgba(0, 0, 0, 0.2);
        padding: 0.2rem 0.4rem;
        border-radius: 6px;
        font-size: 0.85rem;
        color: #db2777;
      }

      @keyframes pulse {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.7; }
      }

      .animate-pulse-subtle {
        animation: pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite;
      }

      @media (max-width: 768px) {
        header {
          flex-direction: column;
          align-items: flex-start;
          gap: 1rem;
        }
        .meta-info {
          text-align: left;
        }
        td, th {
          padding: 0.75rem 0.5rem;
          font-size: 0.8rem;
        }
      }
    </style>
  </head>
  <body>
    <div class="container">
      <header>
        <div class="logo-title">
          <h1>API Load Test Report</h1>
          <p>Staged Concurrency & Ramping Arrival Performance Report</p>
        </div>
        <div class="meta-info">
          <span>Target URL: <strong>${BASE_URL}</strong></span>
          <span>Tested On: <strong>${timestamp}</strong></span>
        </div>
      </header>

      <div class="grid-3">
        ${statusCardHtml}

        <div class="card stat-card">
          <div class="stat-label">Total Requests</div>
          <div class="stat-value">${totalRequests.toLocaleString()}</div>
          <div class="stat-subtitle">Across all scenarios & stages</div>
        </div>

        <div class="card stat-card">
          <div class="stat-label">Avg / p95 Latency</div>
          <div class="stat-value">${overallAvgDuration} <span style="font-size: 1rem; color: var(--text-secondary);">/ ${overallP95Duration} ms</span></div>
          <div class="stat-subtitle">Overall suite performance</div>
        </div>

        <div class="card stat-card">
          <div class="stat-label">SLA Guidelines</div>
          <div class="stat-value" style="font-size: 1.15rem; padding: 0.6rem 0; font-weight: 600; color: #a855f7;">
            ${baseSlaInfo}
          </div>
          <div class="stat-subtitle">Configured SLA parameters</div>
        </div>
      </div>

      <div class="panel">
        <div class="panel-header">
          <h2 class="panel-title">Stage-by-Stage Performance Matrix</h2>
          <p class="panel-subtitle">Sequential arrival-rate stages with target scaling up to 10k rps</p>
        </div>
        <div style="overflow-x: auto;">
          <table>
            <thead>
              <tr>
                <th>Stage Name</th>
                <th>Target RPS</th>
                <th>Actual RPS</th>
                <th>Req Count</th>
                <th>Avg Latency</th>
                <th>p95 Latency</th>
                <th>p99 Latency</th>
                <th>Error Rate</th>
                <th>SLA Status</th>
              </tr>
            </thead>
            <tbody>
              ${stageRowsHtml}
            </tbody>
          </table>
        </div>
      </div>

      <div class="panel">
        <div class="panel-header">
          <h2 class="panel-title">Endpoint Performance Breakdown</h2>
          <p class="panel-subtitle">Aggregated metrics across all stages grouped by URL path</p>
        </div>
        <div style="overflow-x: auto;">
          <table>
            <thead>
              <tr>
                <th>Method</th>
                <th>Endpoint Path</th>
                <th>Total Requests</th>
                <th>Avg Latency</th>
                <th>p95 Latency</th>
                <th>p99 Latency</th>
                <th>Error Rate</th>
              </tr>
            </thead>
            <tbody>
              ${endpointRowsHtml}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </body>
  </html>
  `;
}

/**
 * Main summary reporter output hook for k6.
 */
export function handleSummary(data) {
  const { matrix, breakdownStage } = processMetrics(data);
  
  const textSummary = generateConsoleTextReport(matrix, breakdownStage);

  // Output ASCII report to console, and raw metrics json to k6_summary.json
  return {
    'stdout': textSummary,
    'load-tests/k6_summary.json': JSON.stringify(data, null, 2),
  };
}
