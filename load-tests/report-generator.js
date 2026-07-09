// load-tests/report-generator.js
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const os = require('os');

// Paths
const WORKSPACE_DIR = path.resolve(__dirname, '..');
const HISTORY_DIR = path.join(__dirname, 'history');
const REPORTS_DIR = path.join(__dirname, 'reports');
const K6_SUMMARY_FILE = path.join(__dirname, 'k6_summary.json');
const SYSTEM_METRICS_FILE = path.join(__dirname, 'system_metrics.json');

// Ensure directories exist
if (!fs.existsSync(HISTORY_DIR)) fs.mkdirSync(HISTORY_DIR, { recursive: true });
if (!fs.existsSync(REPORTS_DIR)) fs.mkdirSync(REPORTS_DIR, { recursive: true });

/**
 * Safe executor for shell commands.
 */
function safeExec(cmd) {
  try {
    return execSync(cmd, { stdio: 'pipe' }).toString().trim();
  } catch (e) {
    return 'Unknown';
  }
}

/**
 * 1. Collect Environment Summary
 */
function collectEnvironment() {
  const osName = os.platform() === 'win32' ? 'Windows' : os.platform();
  const osRelease = os.release();
  const cpuModel = os.cpus().length > 0 ? os.cpus()[0].model : 'Unknown CPU';
  const totalRamGb = (os.totalmem() / (1024 * 1024 * 1024)).toFixed(1) + ' GB';

  // Command-line version check helpers
  const k6Ver = safeExec('k6 version').split('\n')[0];
  
  // Extract java version
  let javaVer = 'Unknown';
  try {
    const javaOutput = execSync('java -version', { stdio: 'pipe' }).toString() + execSync('java -version', { stdio: 'pipe' }).toString();
    const match = javaOutput.match(/(?:version|openjdk) "([^"]+)"/i);
    if (match) javaVer = match[1];
  } catch (e) {}

  // Database versions via Docker
  const postgresVer = safeExec('docker exec flashflow-postgres psql -V').replace('psql (PostgreSQL) ', '');
  const redisVer = safeExec('docker exec flashflow-redis redis-server --version').match(/v=([0-9.]+)/) ? RegExp.$1 : '7.0';
  const kafkaVer = '3.8.1 (cp-kafka:7.4.0)';
  const springBootVer = '3.4.1';

  return {
    testMode: 'Capacity / Regression Testing',
    execution: 'Local',
    os: `${osName} (${osRelease})`,
    cpu: cpuModel,
    ram: totalRamGb,
    javaVersion: javaVer,
    springBootVersion: springBootVer,
    redisVersion: redisVer,
    kafkaVersion: kafkaVer,
    postgresVersion: postgresVer,
    k6Version: k6Ver
  };
}

/**
 * 2. Process metrics & correlate by stage
 */
function processMetrics(k6Summary, systemMetrics) {
  const metrics = k6Summary.metrics || {};
  const isShortRun = (k6Summary.state && k6Summary.state.testRunDurationMs < 300000); // under 5 min
  
  // Stage duration configurations
  const shortRunDurations = {
    '1_rps': 15, '10_rps': 15, '100_rps': 15, '500_rps': 15, '1k_rps': 15, '5k_rps': 15, '10k_rps': 15
  };
  const fullRunDurations = {
    '1_rps': 90, '10_rps': 90, '100_rps': 150, '500_rps': 150, '1k_rps': 240, '5k_rps': 240, '10k_rps': 240
  };
  const durations = isShortRun ? shortRunDurations : fullRunDurations;

  const targetRpsMap = {
    '1_rps': 1, '10_rps': 10, '100_rps': 100, '500_rps': 500, '1k_rps': 1000, '5k_rps': 5000, '10k_rps': 10000
  };
  
  const vuAllocationMap = {
    '1_rps': 2, '10_rps': 10, '100_rps': 50, '500_rps': 1040, '1k_rps': 3000, '5k_rps': 6630, '10k_rps': 10214
  };

  const stagesList = Object.keys(durations);
  
  // Parse system metrics timestamps
  let startTime = Date.now();
  if (systemMetrics.length > 0) {
    startTime = new Date(systemMetrics[0].timestamp).getTime();
  }

  let cumulativeOffsetSec = 0;
  const processedStages = [];

  stagesList.forEach((stageName) => {
    const duration = durations[stageName];
    const targetRps = targetRpsMap[stageName];
    
    // Time boundaries for system metrics correlation
    const stageStartMs = startTime + (cumulativeOffsetSec * 1000);
    const stageEndMs = stageStartMs + (duration * 1000);
    cumulativeOffsetSec += duration;

    // Filter system metrics for this stage window
    const stageSysMetrics = systemMetrics.filter(m => {
      const t = new Date(m.timestamp).getTime();
      return t >= stageStartMs && t < stageEndMs;
    });

    // Aggregate system metrics
    const avgCpu = stageSysMetrics.length ? stageSysMetrics.reduce((sum, m) => sum + m.system_cpu, 0) / stageSysMetrics.length : 0;
    const maxCpu = stageSysMetrics.length ? Math.max(...stageSysMetrics.map(m => m.system_cpu)) : 0;
    const avgHikariActive = stageSysMetrics.length ? stageSysMetrics.reduce((sum, m) => sum + m.hikari_active, 0) / stageSysMetrics.length : 0;
    const maxHikariPending = stageSysMetrics.length ? Math.max(...stageSysMetrics.map(m => m.hikari_pending)) : 0;
    const maxKafkaLag = stageSysMetrics.length ? Math.max(...stageSysMetrics.map(m => m.kafka_lag_max)) : 0;
    const maxRedisLatency = stageSysMetrics.length ? Math.max(...stageSysMetrics.map(m => m.redis_latency_max)) : 0;

    // Extract k6 latency & throughput details
    const failedMetric = metrics[`http_req_failed{stage:${stageName}}`] || {};
    const durationMetric = metrics[`http_req_duration{stage:${stageName}}`] || {};
    
    const passes = failedMetric.values ? (failedMetric.values.passes || 0) : 0; // failed requests
    const fails = failedMetric.values ? (failedMetric.values.fails || 0) : 0;   // successful requests
    const totalRequests = passes + fails;
    
    const actualRps = totalRequests / duration;
    const errorRate = totalRequests > 0 ? (passes / totalRequests) : 0;

    const avgLatency = durationMetric.values ? (durationMetric.values.avg || 0) : 0;
    const p95Latency = durationMetric.values ? (durationMetric.values['p(95)'] || 0) : 0;
    const p99Latency = durationMetric.values ? (durationMetric.values['p(99)'] || 0) : 0;

    // SLA Checks (p95 < 500ms, p99 < 1000ms, errorRate < 1%)
    const slaP95Limit = 500;
    const slaP99Limit = 1000;
    const slaErrorLimit = 0.01;

    const p95Violated = p95Latency > slaP95Limit;
    const p99Violated = p99Latency > slaP99Limit;
    const errorViolated = errorRate > slaErrorLimit;
    const slaStatus = (!p95Violated && !p99Violated && !errorViolated) ? 'PASS' : 'FAIL';

    // Bottleneck identification logic
    let bottleneckCause = 'None';
    let bottleneckEvidence = 'N/A';
    let bottleneckRec = 'N/A';

    if (slaStatus === 'FAIL' || p95Latency > 200) {
      if (maxHikariPending > 0 || avgHikariActive >= 9.5) {
        // Pool capacity limit is default 10 connections
        bottleneckCause = 'Database Connection Pool Saturation';
        bottleneckEvidence = `Hikari active connections peaked at ${(avgHikariActive).toFixed(1)}/10. Active threads waiting for pool: ${maxHikariPending}.`;
        bottleneckRec = 'Increase spring.datasource.hikari.maximum-pool-size in the application properties or optimize slow DB queries.';
      } else if (maxKafkaLag > 50) {
        bottleneckCause = 'Kafka Consumer Lag Accumulation';
        bottleneckEvidence = `Kafka max partition consumer lag reached ${maxKafkaLag} records.`;
        bottleneckRec = 'Increase Kafka consumer thread concurrency or split topics into more partitions.';
      } else if (maxRedisLatency > 0.02) {
        bottleneckCause = 'Redis Command Completion Delay';
        bottleneckEvidence = `Redis Lettuce commands max response latency hit ${(maxRedisLatency * 1000).toFixed(1)}ms.`;
        bottleneckRec = 'Batch Redis operations using MGET/MSET pipeline operations, or replace complex multi-calls with a Lua script.';
      } else if (maxCpu > 0.85) {
        bottleneckCause = 'CPU Core Exhaustion';
        bottleneckEvidence = `System CPU load reached ${(maxCpu * 100).toFixed(1)}%.`;
        bottleneckRec = 'Scale CPU resources horizontally or profile garbage collection (GC) runs.';
      } else if (errorRate > 0.5) {
        bottleneckCause = 'Tomcat Connector Backlog/OS Port Exhaustion';
        bottleneckEvidence = `Error rate reached ${(errorRate * 100).toFixed(1)}% due to connection refusals.`;
        bottleneckRec = 'Increase server.tomcat.threads.max or apply OS registry fixes to increase TCP max ports.';
      } else {
        bottleneckCause = 'Database Lock Contention / Async Overhead';
        bottleneckEvidence = `Thread saturation observed (live threads: ${avgCpu > 0.5 ? 'high' : 'normal'}).`;
        bottleneckRec = 'Move heavy database persistence fully behind Kafka and make order processing fully event-driven.';
      }
    }

    processedStages.push({
      stageName,
      targetRps,
      actualRps,
      requestCount: totalRequests,
      avgLatency,
      p95Latency,
      p99Latency,
      errorRate,
      vus: vuAllocationMap[stageName],
      slaStatus,
      violations: {
        p95: p95Violated,
        p99: p99Violated,
        error: errorViolated
      },
      system: {
        cpuAvg: avgCpu,
        cpuMax: maxCpu,
        hikariActive: avgHikariActive,
        hikariPending: maxHikariPending,
        kafkaLag: maxKafkaLag,
        redisLatency: maxRedisLatency
      },
      bottleneck: {
        cause: bottleneckCause,
        evidence: bottleneckEvidence,
        recommendation: bottleneckRec
      }
    });
  });

  return processedStages;
}

/**
 * 3. Calculate Knee-Point (breaking point)
 */
function findKneePoint(stages) {
  // Knee-point is where p95 latency starts increasing rapidly
  // We can calculate the rate of change of P95 latency relative to Target RPS
  let maxSlope = -1;
  let kneeIndex = 0;

  for (let i = 1; i < stages.length; i++) {
    const prev = stages[i-1];
    const curr = stages[i];
    const rpsDiff = curr.targetRps - prev.targetRps;
    if (rpsDiff === 0) continue;
    const slope = (curr.p95Latency - prev.p95Latency) / rpsDiff;
    
    // Highlight if the latency spikes significantly or breaks SLA
    if (slope > maxSlope && (curr.p95Latency > 150 || curr.slaStatus === 'FAIL')) {
      maxSlope = slope;
      kneeIndex = i;
    }
  }

  // If no massive spike, return first stage that failed SLA, or default to last stage
  if (kneeIndex === 0) {
    const firstFail = stages.find(s => s.slaStatus === 'FAIL');
    return firstFail ? firstFail : stages[stages.length - 1];
  }

  return stages[kneeIndex];
}

/**
 * 4. Compute Performance Scores (0-100)
 */
function calculatePerformanceScore(stages) {
  // Aggregate averages across stages
  const activeStages = stages.filter(s => s.requestCount > 0);
  if (!activeStages.length) return { overall: 0 };

  const avgErrorRate = activeStages.reduce((sum, s) => sum + s.errorRate, 0) / activeStages.length;
  const avgP95 = activeStages.reduce((sum, s) => sum + s.p95Latency, 0) / activeStages.length;
  
  // 1. Correctness Score (weighted error rate)
  const correctness = Math.max(0, Math.round(100 * (1 - avgErrorRate)));

  // 2. Latency Score (P95 Latency SLA compliance)
  // Under 50ms = 100, above 1000ms = 0, linear in between
  let latencyScore = 100;
  if (avgP95 > 50) {
    latencyScore = Math.max(0, Math.round(100 - ((avgP95 - 50) / 9.5))); // 50ms to 1000ms mapping
  }

  // 3. Throughput Score (Actual RPS vs Target RPS)
  const totalActual = activeStages.reduce((sum, s) => sum + s.actualRps, 0);
  const totalTarget = activeStages.reduce((sum, s) => sum + s.targetRps, 0);
  const throughput = Math.min(100, Math.round((totalActual / totalTarget) * 100));

  // 4. Stability Score (Latency deviation / variance)
  const maxP95 = Math.max(...activeStages.map(s => s.p95Latency));
  const minP95 = Math.min(...activeStages.map(s => s.p95Latency));
  const spread = maxP95 - minP95;
  const stability = Math.max(0, Math.round(100 - (spread / 100))); // higher spread lowers score

  // 5. Error Rate Score
  const errorRateScore = Math.max(0, Math.round(100 - (avgErrorRate * 200))); // very sensitive to errors

  // 6. Resource Score
  const maxCpu = Math.max(...activeStages.map(s => s.system.cpuMax));
  const maxPendingDb = Math.max(...activeStages.map(s => s.system.hikariPending));
  const resource = Math.max(0, Math.round(100 - (maxCpu * 50) - (maxPendingDb * 10)));

  // Weighted Overall
  const overall = Math.round(
    (correctness * 0.25) +
    (latencyScore * 0.25) +
    (throughput * 0.15) +
    (stability * 0.15) +
    (errorRateScore * 0.10) +
    (resource * 0.10)
  );

  return {
    correctness,
    latency: latencyScore,
    throughput,
    stability,
    errorRate: errorRateScore,
    resource,
    overall
  };
}

/**
 * 5. Historical Comparison Builder
 */
function buildHistoryComparison(currentStages, currentScore) {
  const historyFiles = fs.readdirSync(HISTORY_DIR)
    .filter(f => f.startsWith('run_') && f.endsWith('.json'))
    .sort((a, b) => b.localeCompare(a)); // newest first

  if (historyFiles.length === 0) {
    return null; // No previous history
  }

  // Load the most recent previous run
  const previousRunPath = path.join(HISTORY_DIR, historyFiles[0]);
  try {
    const prevData = JSON.parse(fs.readFileSync(previousRunPath, 'utf8'));
    const prevStages = prevData.stages || [];
    const prevScore = prevData.score || {};

    const comparisonStages = [];
    currentStages.forEach(curr => {
      const prev = prevStages.find(s => s.stageName === curr.stageName);
      if (prev) {
        comparisonStages.push({
          stageName: curr.stageName,
          targetRps: curr.targetRps,
          currP95: curr.p95Latency,
          prevP95: prev.p95Latency,
          p95Delta: curr.p95Latency - prev.p95Latency,
          currRps: curr.actualRps,
          prevRps: prev.actualRps,
          rpsDelta: curr.actualRps - prev.actualRps,
          currError: curr.errorRate,
          prevError: prev.errorRate,
          errorDelta: curr.errorRate - prev.errorRate,
        });
      }
    });

    return {
      prevTimestamp: prevData.timestamp,
      scoreDelta: currentScore.overall - (prevScore.overall || 0),
      stages: comparisonStages
    };
  } catch (e) {
    return null;
  }
}

/**
 * 6. Optimization Recommendations Engine
 */
function generateRecommendations(stages) {
  const recs = [];
  
  const hasDbContention = stages.some(s => s.system.hikariPending > 0 || s.system.hikariActive >= 9.0);
  const hasKafkaLag = stages.some(s => s.system.kafkaLag > 50);
  const hasRedisDelay = stages.some(s => s.system.redisLatency > 0.015); // > 15ms
  const hasHighCpu = stages.some(s => s.system.cpuMax > 0.80);
  const hasSockExhaust = stages.some(s => s.targetRps >= 5000 && s.errorRate > 0.2);

  if (hasDbContention) {
    recs.push({
      area: 'Database Connection Pool',
      recommendation: 'Increase the HikariCP pool size (e.g. spring.datasource.hikari.maximum-pool-size=50) and evaluate slow queries. Ensure the tables have proper indexes (particularly reservations and outbox_events). Enable Hibernate JDBC batching properties.'
    });
  }
  if (hasKafkaLag) {
    recs.push({
      area: 'Kafka Messaging Threading',
      recommendation: 'Increase Kafka consumer concurrency by setting container concurrency levels on `@KafkaListener(concurrency = 3)` and match this with additional partitions on the flashflow.orders and flashflow.payments topics.'
    });
  }
  if (hasRedisDelay) {
    recs.push({
      area: 'Redis Cache Layer',
      recommendation: 'Optimize Lettuce Redis connection sharing. Use Redis pipeline operations or wrap multiple commands into single atomized Lua scripts inside RateLimiterService and RedisInventoryService to reduce roundtrip execution cycles.'
    });
  }
  if (hasHighCpu) {
    recs.push({
      area: 'JVM / Host CPU Scaling',
      recommendation: 'Run Spring Boot with optimized JVM Garbage Collection settings (e.g., -XX:+UseG1GC) or allocate more CPU cores to the hosting node. Profile code path threads using jstack during high load.'
    });
  }
  if (hasSockExhaust) {
    recs.push({
      area: 'Load Generation & OS Backlog',
      recommendation: 'When local loopback connection limits are hit (resulting in refused connections at 5k+ RPS), scale load testing horizontally by running distributed k6 nodes or optimize local Windows registry TCP backlog configurations (MaxUserPort and TcpTimedWaitDelay).'
    });
  }

  // Base general recommendations
  if (recs.length === 0) {
    recs.push({
      area: 'Architecture Optimization',
      recommendation: 'The system has passed capacity validation. To scale further, evaluate changing transaction isolation levels or implementing full CQRS to segregate product checkouts from catalog listing queries.'
    });
  }

  return recs;
}

/**
 * 7. SVG Chart Generator
 */
function drawSvgChart(title, labels, values, type = 'line', threshold = null) {
  const width = 500;
  const height = 240;
  const paddingLeft = 55;
  const paddingRight = 20;
  const paddingTop = 40;
  const paddingBottom = 40;

  const chartWidth = width - paddingLeft - paddingRight;
  const chartHeight = height - paddingTop - paddingBottom;

  const maxVal = Math.max(...values, threshold || 0, 1) * 1.15;
  const minVal = 0;

  // Grid and axis coordinates
  let linesHtml = '';
  const yTicks = 4;
  for (let i = 0; i <= yTicks; i++) {
    const yVal = minVal + (maxVal - minVal) * (i / yTicks);
    const yCo = height - paddingBottom - (chartHeight * (i / yTicks));
    
    // Grid lines
    linesHtml += `<line x1="${paddingLeft}" y1="${yCo}" x2="${width - paddingRight}" y2="${yCo}" stroke="#2a2f45" stroke-dasharray="3,3" />`;
    // Y labels
    let formattedY = yVal >= 1000 ? (yVal/1000).toFixed(1) + 'k' : Math.round(yVal);
    if (maxVal < 2) formattedY = yVal.toFixed(2);
    linesHtml += `<text x="${paddingLeft - 10}" y="${yCo + 4}" fill="#a0aec0" font-size="10" text-anchor="end">${formattedY}</text>`;
  }

  // Threshold indicator line
  if (threshold !== null) {
    const threshY = height - paddingBottom - (chartHeight * (threshold / maxVal));
    linesHtml += `<line x1="${paddingLeft}" y1="${threshY}" x2="${width - paddingRight}" y2="${threshY}" stroke="#e53e3e" stroke-width="1.5" stroke-dasharray="5,2" />`;
    linesHtml += `<text x="${width - paddingRight - 5}" y="${threshY - 4}" fill="#e53e3e" font-size="9" text-anchor="end">SLA Limit</text>`;
  }

  // Draw data points
  let dataPointsHtml = '';
  let pointsStr = '';
  const pointsCount = values.length;

  for (let i = 0; i < pointsCount; i++) {
    const xCo = paddingLeft + (chartWidth * (i / (pointsCount - 1)));
    const yCo = height - paddingBottom - (chartHeight * (values[i] / maxVal));
    pointsStr += `${xCo},${yCo} `;

    // Interactive circular markers
    dataPointsHtml += `<circle cx="${xCo}" cy="${yCo}" r="4" fill="#63b3ed" stroke="#1a202c" stroke-width="1.5" />`;
    // X labels
    dataPointsHtml += `<text x="${xCo}" y="${height - paddingBottom + 18}" fill="#a0aec0" font-size="9" text-anchor="middle" transform="rotate(-15, ${xCo}, ${height - paddingBottom + 18})">${labels[i]}</text>`;
  }

  let linePathHtml = '';
  if (type === 'bar') {
    // Bar chart layout
    let barWidth = (chartWidth / pointsCount) * 0.6;
    for (let i = 0; i < pointsCount; i++) {
      const xCo = paddingLeft + (chartWidth * (i / (pointsCount - 1))) - (barWidth/2);
      const yCo = height - paddingBottom - (chartHeight * (values[i] / maxVal));
      const barHeight = height - paddingBottom - yCo;
      dataPointsHtml += `<rect x="${xCo}" y="${yCo}" width="${barWidth}" height="${barHeight}" fill="url(#barGradient)" rx="2" />`;
    }
  } else {
    // Line chart path
    linePathHtml = `<polyline points="${pointsStr.trim()}" fill="none" stroke="url(#lineGradient)" stroke-width="3" stroke-linecap="round" filter="url(#glow)" />`;
  }

  return `
    <svg viewBox="0 0 ${width} ${height}" class="chart-svg">
      <defs>
        <linearGradient id="lineGradient" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#4299e1" />
          <stop offset="100%" stop-color="#9f7aea" />
        </linearGradient>
        <linearGradient id="barGradient" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stop-color="#4fd1c5" />
          <stop offset="100%" stop-color="#319795" />
        </linearGradient>
        <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
          <stop offset="0%" stop-color="#000"/>
          <feGaussianBlur stdDeviation="3" result="blur" />
          <feComposite in="SourceGraphic" in2="blur" operator="over" />
        </filter>
      </defs>
      <text x="${width / 2}" y="20}" fill="#e2e8f0" font-size="12" font-weight="bold" text-anchor="middle">${title}</text>
      ${linesHtml}
      ${linePathHtml}
      ${dataPointsHtml}
    </svg>
  `;
}

/**
 * 8. Exports Generator: Markdown
 */
function generateMarkdownReport(env, stages, score, kneePoint, recs) {
  let md = `# Executive Performance Report: FlashFlow Stress Capacity\n\n`;
  md += `## Executive Summary\n\n`;
  md += `- **Maximum Sustained Throughput**: ${Math.round(stages.filter(s => s.slaStatus === 'PASS').reduce((max, s) => Math.max(max, s.actualRps), 0))} RPS\n`;
  md += `- **Maximum Sustained Concurrent Users**: ${Math.max(...stages.filter(s => s.slaStatus === 'PASS').map(s => s.vus))} VUs\n`;
  
  const firstBreach = stages.find(s => s.slaStatus === 'FAIL');
  md += `- **First SLA Breach**: ${firstBreach ? `${firstBreach.stageName} (Target ${firstBreach.targetRps} RPS)` : 'None'}\n`;
  md += `- **Breaking Point / Knee Point**: ${kneePoint.stageName} (Target ${kneePoint.targetRps} RPS)\n`;
  md += `- **Primary Bottleneck**: ${kneePoint.bottleneck.cause}\n`;
  md += `- **Overall Correctness**: ${score.correctness} / 100\n`;
  md += `- **Overall Score**: ${score.overall} / 100\n\n`;
  
  md += `## Environment Summary\n\n`;
  md += `| Parameter | Value |\n| :--- | :--- |\n`;
  Object.keys(env).forEach(k => {
    md += `| ${k} | ${env[k]} |\n`;
  });
  md += `\n`;

  md += `## Staged Metrics & Performance Matrix\n\n`;
  md += `| Stage | Target RPS | Actual RPS | Req Count | p95 Latency | p99 Latency | Error Rate | CPU Max | Hikari Active | SLA Status |\n`;
  md += `| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |\n`;
  stages.forEach(s => {
    md += `| **${s.stageName}** | ${s.targetRps} | ${s.actualRps.toFixed(1)} | ${s.requestCount} | ${s.p95Latency.toFixed(1)} ms | ${s.p99Latency.toFixed(1)} ms | ${(s.errorRate * 100).toFixed(2)}% | ${(s.system.cpuMax * 100).toFixed(0)}% | ${s.system.hikariActive.toFixed(1)} | ${s.slaStatus} |\n`;
  });
  md += `\n`;

  md += `## Bottleneck Analysis per Stage\n\n`;
  stages.forEach(s => {
    md += `### Stage: ${s.stageName} (${s.slaStatus})\n`;
    md += `- **Likely Cause**: ${s.bottleneck.cause}\n`;
    md += `- **Evidence**: ${s.bottleneck.evidence}\n`;
    md += `- **Recommendation**: ${s.bottleneck.recommendation}\n\n`;
  });

  md += `## Actionable Optimization Recommendations\n\n`;
  recs.forEach(r => {
    md += `### ${r.area}\n${r.recommendation}\n\n`;
  });

  return md;
}

/**
 * 9. Exports Generator: CSV
 */
function generateCsvReport(stages) {
  let csv = `StageName,TargetRps,ActualRps,ReqCount,AvgLatencyMs,p95LatencyMs,p99LatencyMs,ErrorRatePercent,CpuMaxPercent,HikariActiveAvg,SlaStatus\n`;
  stages.forEach(s => {
    csv += `${s.stageName},${s.targetRps},${s.actualRps.toFixed(2)},${s.requestCount},${s.avgLatency.toFixed(2)},${s.p95Latency.toFixed(2)},${s.p99Latency.toFixed(2)},${(s.errorRate * 100).toFixed(4)},${(s.system.cpuMax * 100).toFixed(2)},${s.system.hikariActive.toFixed(2)},${s.slaStatus}\n`;
  });
  return csv;
}

/**
 * 10. Exports Generator: HTML dashboard
 */
function generateHtmlReport(env, stages, score, kneePoint, recs, historyComp) {
  const stageLabels = stages.map(s => s.stageName.replace('_rps', ''));
  const latencyValues = stages.map(s => s.p95Latency);
  const rpsValues = stages.map(s => s.actualRps);
  const errorValues = Math.max(...stages.map(s => s.errorRate)) > 0 ? stages.map(s => s.errorRate * 100) : null;
  const hikariValues = stages.map(s => s.system.hikariActive);

  // SVG Chart Embeds
  const latencyChart = drawSvgChart('Concurrent load vs p95 Latency (ms)', stageLabels, latencyValues, 'line', 500);
  const rpsChart = drawSvgChart('Target Load vs Throughput (RPS)', stageLabels, rpsValues, 'line');
  const errorChart = errorValues ? drawSvgChart('Target Load vs Error Rate (%)', stageLabels, errorValues, 'line', 1) : '<div class="no-chart">No Errors Observed during run.</div>';
  const hikariChart = drawSvgChart('Database Connection Pool Active count', stageLabels, hikariValues, 'bar');

  // Executive summaries details
  const peakRps = Math.round(stages.filter(s => s.slaStatus === 'PASS').reduce((max, s) => Math.max(max, s.actualRps), 0));
  const peakUsers = Math.max(...stages.filter(s => s.slaStatus === 'PASS').map(s => s.vus));
  const firstBreach = stages.find(s => s.slaStatus === 'FAIL');

  let historyHtml = '';
  if (historyComp) {
    historyHtml = `
      <div class="card card-history">
        <h2>🔄 Comparison with Previous Run (${new Date(historyComp.prevTimestamp).toLocaleString()})</h2>
        <div class="score-delta ${historyComp.scoreDelta >= 0 ? 'good' : 'bad'}">
          Overall Score Delta: ${historyComp.scoreDelta >= 0 ? '+' : ''}${historyComp.scoreDelta}
        </div>
        <table>
          <thead>
            <tr>
              <th>Stage</th>
              <th>Current p95</th>
              <th>Previous p95</th>
              <th>Latency Delta</th>
              <th>Current RPS</th>
              <th>Previous RPS</th>
              <th>Throughput Delta</th>
            </tr>
          </thead>
          <tbody>
            ${historyComp.stages.map(s => `
              <tr>
                <td><strong>${s.stageName}</strong></td>
                <td>${s.currP95.toFixed(1)} ms</td>
                <td>${s.prevP95.toFixed(1)} ms</td>
                <td class="${s.p95Delta <= 0 ? 'delta-good' : 'delta-bad'}">${s.p95Delta.toFixed(1)} ms</td>
                <td>${s.currRps.toFixed(0)}</td>
                <td>${s.prevRps.toFixed(0)}</td>
                <td class="${s.rpsDelta >= 0 ? 'delta-good' : 'delta-bad'}">${s.rpsDelta.toFixed(0)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>FlashFlow Capacity Performance Report</title>
  <style>
    :root {
      --bg-dark: #0f1319;
      --card-bg: rgba(26, 32, 44, 0.7);
      --card-border: rgba(255, 255, 255, 0.08);
      --accent-blue: #3182ce;
      --accent-purple: #805ad5;
      --accent-green: #38a169;
      --accent-red: #e53e3e;
      --text-main: #e2e8f0;
      --text-muted: #a0aec0;
    }
    body {
      background-color: var(--bg-dark);
      color: var(--text-main);
      font-family: 'Inter', system-ui, sans-serif;
      margin: 0;
      padding: 24px;
      line-height: 1.5;
    }
    .container {
      max-width: 1200px;
      margin: 0 auto;
    }
    header {
      text-align: center;
      padding: 20px 0;
      margin-bottom: 30px;
      border-bottom: 1px solid var(--card-border);
    }
    h1 {
      margin: 0;
      font-size: 2.2rem;
      background: linear-gradient(135deg, #63b3ed, #b794f4);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }
    .timestamp {
      color: var(--text-muted);
      font-size: 0.9rem;
      margin-top: 5px;
    }
    .grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 20px;
      margin-bottom: 24px;
    }
    .grid-3 {
      display: grid;
      grid-template-columns: 1fr 1fr 1fr;
      gap: 20px;
      margin-bottom: 24px;
    }
    .card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 12px;
      padding: 20px;
      box-shadow: 0 4px 6px rgba(0,0,0,0.2);
      backdrop-filter: blur(10px);
    }
    h2 {
      margin-top: 0;
      font-size: 1.2rem;
      border-left: 4px solid var(--accent-blue);
      padding-left: 10px;
      margin-bottom: 20px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.9rem;
    }
    th, td {
      padding: 10px;
      text-align: left;
      border-bottom: 1px solid var(--card-border);
    }
    th {
      color: var(--text-muted);
      font-weight: 600;
    }
    .status-pass { color: var(--accent-green); font-weight: bold; }
    .status-fail { color: var(--accent-red); font-weight: bold; }
    .score-circle {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      width: 100px;
      height: 100px;
      border-radius: 50%;
      border: 4px solid var(--accent-blue);
      margin: 0 auto 15px auto;
      font-size: 2rem;
      font-weight: bold;
    }
    .score-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 10px;
      text-align: center;
    }
    .score-item {
      font-size: 0.8rem;
      color: var(--text-muted);
    }
    .score-val {
      font-size: 1.1rem;
      font-weight: bold;
      color: var(--text-main);
    }
    .chart-container {
      display: flex;
      flex-wrap: wrap;
      gap: 20px;
      margin-bottom: 24px;
    }
    .chart-box {
      flex: 1 1 45%;
      min-width: 300px;
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 12px;
      padding: 15px;
    }
    .chart-svg {
      width: 100%;
      height: auto;
    }
    .exec-item {
      display: flex;
      justify-content: space-between;
      padding: 8px 0;
      border-bottom: 1px dashed var(--card-border);
    }
    .exec-label {
      color: var(--text-muted);
    }
    .exec-val {
      font-weight: bold;
    }
    .rec-item {
      margin-bottom: 15px;
      padding-bottom: 15px;
      border-bottom: 1px solid var(--card-border);
    }
    .rec-item:last-child {
      border-bottom: none;
    }
    .rec-area {
      font-weight: bold;
      color: #ecc94b;
      margin-bottom: 4px;
    }
    .delta-good { color: var(--accent-green); }
    .delta-bad { color: var(--accent-red); }
    .score-delta.good { color: var(--accent-green); font-size: 1.1rem; font-weight: bold; margin-bottom: 10px;}
    .score-delta.bad { color: var(--accent-red); font-size: 1.1rem; font-weight: bold; margin-bottom: 10px;}
  </style>
</head>
<body>
  <div class="container">
    <header>
      <h1>⚡ FlashFlow Capacity Performance Dashboard</h1>
      <div class="timestamp">Test Run Executed on: ${new Date().toLocaleString()}</div>
    </header>

    <div class="grid-3">
      <!-- Performance Score Card -->
      <div class="card">
        <h2>🎯 Performance Score</h2>
        <div class="score-circle">${score.overall}</div>
        <div class="score-grid">
          <div class="score-item"><div>Correctness</div><div class="score-val">${score.correctness}</div></div>
          <div class="score-item"><div>Latency</div><div class="score-val">${score.latency}</div></div>
          <div class="score-item"><div>Resource</div><div class="score-val">${score.resource}</div></div>
        </div>
      </div>

      <!-- Executive Summary Card -->
      <div class="card">
        <h2>📊 Executive Summary</h2>
        <div class="exec-item"><span class="exec-label">Max Sustained Throughput</span><span class="exec-val">${peakRps} RPS</span></div>
        <div class="exec-item"><span class="exec-label">Max Sustained Users</span><span class="exec-val">${peakUsers} VUs</span></div>
        <div class="exec-item"><span class="exec-label">First SLA Breach</span><span class="exec-val ${firstBreach ? 'status-fail' : 'status-pass'}">${firstBreach ? firstBreach.stageName : 'None'}</span></div>
        <div class="exec-item"><span class="exec-label">Knee/Breaking Point</span><span class="exec-val" style="color: #ecc94b">${kneePoint.stageName}</span></div>
      </div>

      <!-- Environment Card -->
      <div class="card">
        <h2>💻 Environment Summary</h2>
        <div class="exec-item"><span class="exec-label">Operating System</span><span class="exec-val">${env.os}</span></div>
        <div class="exec-item"><span class="exec-label">Java Version</span><span class="exec-val">${env.javaVersion}</span></div>
        <div class="exec-item"><span class="exec-label">Spring Boot</span><span class="exec-val">${env.springBootVersion}</span></div>
        <div class="exec-item"><span class="exec-label">k6 Version</span><span class="exec-val">${env.k6Version.split(' ')[0]}</span></div>
      </div>
    </div>

    <!-- Trend Graphs -->
    <div class="chart-container">
      <div class="chart-box">${latencyChart}</div>
      <div class="chart-box">${rpsChart}</div>
      <div class="chart-box">${errorChart}</div>
      <div class="chart-box">${hikariChart}</div>
    </div>

    ${historyHtml}

    <!-- Staged Metrics Matrix -->
    <div class="card" style="margin-bottom: 24px;">
      <h2>📈 Staged Performance Matrix</h2>
      <table>
        <thead>
          <tr>
            <th>Stage</th>
            <th>Target RPS</th>
            <th>Actual RPS</th>
            <th>Req Count</th>
            <th>p95 Latency</th>
            <th>p99 Latency</th>
            <th>Error Rate</th>
            <th>CPU Usage (Max)</th>
            <th>Hikari Active</th>
            <th>SLA Status</th>
          </tr>
        </thead>
        <tbody>
          ${stages.map(s => `
            <tr>
              <td><strong>${s.stageName}</strong></td>
              <td>${s.targetRps}</td>
              <td>${s.actualRps.toFixed(1)}</td>
              <td>${s.requestCount}</td>
              <td>${s.p95Latency.toFixed(1)} ms</td>
              <td>${s.p99Latency.toFixed(1)} ms</td>
              <td>${(s.errorRate * 100).toFixed(2)}%</td>
              <td>${(s.system.cpuMax * 100).toFixed(0)}%</td>
              <td>${s.system.hikariActive.toFixed(1)}</td>
              <td><span class="${s.slaStatus === 'PASS' ? 'status-pass' : 'status-fail'}">${s.slaStatus}</span></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>

    <div class="grid">
      <!-- Staged Bottleneck Details -->
      <div class="card">
        <h2>🔍 Staged Bottleneck Analysis</h2>
        <table>
          <thead>
            <tr>
              <th>Stage</th>
              <th>Likely Cause</th>
              <th>Evidence</th>
            </tr>
          </thead>
          <tbody>
            ${stages.map(s => `
              <tr>
                <td><strong>${s.stageName}</strong></td>
                <td>${s.bottleneck.cause}</td>
                <td style="font-size: 0.8rem; color: var(--text-muted);">${s.bottleneck.evidence}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>

      <!-- Actionable Optimization Recommendations -->
      <div class="card">
        <h2>🛠️ Actionable Recommendations</h2>
        <div>
          ${recs.map(r => `
            <div class="rec-item">
              <div class="rec-area">📌 ${r.area}</div>
              <div style="font-size: 0.9rem;">${r.recommendation}</div>
            </div>
          `).join('')}
        </div>
      </div>
    </div>
  </div>
</body>
</html>
`;
}

function readJsonFile(filePath) {
  let content = fs.readFileSync(filePath, 'utf8');
  if (content.charCodeAt(0) === 0xFEFF) {
    content = content.slice(1);
  }
  return JSON.parse(content);
}

/**
 * Main execution flow
 */
function main() {
  console.log('[Reporter] Loading run metrics files...');

  if (!fs.existsSync(K6_SUMMARY_FILE)) {
    console.error(`Error: Could not locate k6 summary file: ${K6_SUMMARY_FILE}`);
    process.exit(1);
  }

  const k6Summary = readJsonFile(K6_SUMMARY_FILE);
  
  let systemMetrics = [];
  if (fs.existsSync(SYSTEM_METRICS_FILE)) {
    systemMetrics = readJsonFile(SYSTEM_METRICS_FILE);
  } else {
    console.warn(`[Reporter] Warning: Could not locate system metrics: ${SYSTEM_METRICS_FILE}`);
  }

  // 1. Gather host and tool details
  const env = collectEnvironment();

  // 2. Correlate metrics and categorize stages
  const stages = processMetrics(k6Summary, systemMetrics);

  // 3. Find knee/breaking point
  const kneePoint = findKneePoint(stages);

  // 4. Compute scores
  const score = calculatePerformanceScore(stages);

  // 5. Query history list and build delta compare
  const historyComp = buildHistoryComparison(stages, score);

  // 6. Generate action logs
  const recs = generateRecommendations(stages);

  // 7. Write outputs
  console.log('[Reporter] Writing exports...');

  const timestamp = Date.now();
  const runRecord = {
    timestamp,
    environment: env,
    stages,
    score,
    kneePoint: {
      stageName: kneePoint.stageName,
      targetRps: kneePoint.targetRps,
      cause: kneePoint.bottleneck.cause
    }
  };

  // Archive run data inside history (for comparisons)
  fs.writeFileSync(path.join(HISTORY_DIR, `run_${timestamp}.json`), JSON.stringify(runRecord, null, 2), 'utf8');

  // HTML Dashboard
  const htmlContent = generateHtmlReport(env, stages, score, kneePoint, recs, historyComp);
  fs.writeFileSync(path.join(WORKSPACE_DIR, 'summary.html'), htmlContent, 'utf8');
  fs.writeFileSync(path.join(REPORTS_DIR, `run_${timestamp}.html`), htmlContent, 'utf8');

  // JSON summary
  fs.writeFileSync(path.join(WORKSPACE_DIR, 'results.json'), JSON.stringify(runRecord, null, 2), 'utf8');
  fs.writeFileSync(path.join(REPORTS_DIR, `run_${timestamp}.json`), JSON.stringify(runRecord, null, 2), 'utf8');

  // Markdown summary
  const mdContent = generateMarkdownReport(env, stages, score, kneePoint, recs);
  fs.writeFileSync(path.join(WORKSPACE_DIR, 'summary.md'), mdContent, 'utf8');
  fs.writeFileSync(path.join(REPORTS_DIR, `run_${timestamp}.md`), mdContent, 'utf8');

  // CSV summary
  const csvContent = generateCsvReport(stages);
  fs.writeFileSync(path.join(WORKSPACE_DIR, 'summary.csv'), csvContent, 'utf8');
  fs.writeFileSync(path.join(REPORTS_DIR, `run_${timestamp}.csv`), csvContent, 'utf8');

  console.log('[Reporter] Successfully generated HTML dashboard, results.json, summary.md, and summary.csv!');
}

main();
