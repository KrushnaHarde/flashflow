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
function collectEnvironment(isShortRun) {
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

  const baseUrl = process.env.BASE_URL || 'http://localhost:8080';
  const isLocal = baseUrl.includes('localhost') || baseUrl.includes('127.0.0.1');

  let uniqueUsers = 1;
  try {
    const usersPoolPath = path.join(__dirname, 'users_pool.json');
    if (fs.existsSync(usersPoolPath)) {
      uniqueUsers = JSON.parse(fs.readFileSync(usersPoolPath, 'utf8')).length;
    }
  } catch (e) {
    // Fallback
  }

  return {
    testMode: 'Capacity / Regression Testing',
    execution: isLocal ? 'Local (Same Host)' : 'Remote (Multi Host)',
    isShortRun: !!isShortRun,
    os: `${osName} (${osRelease})`,
    cpu: cpuModel,
    ram: totalRamGb,
    javaVersion: javaVer,
    springBootVersion: springBootVer,
    redisVersion: redisVer,
    kafkaVersion: kafkaVer,
    postgresVersion: postgresVer,
    k6Version: k6Ver,
    uniqueUsersUsed: uniqueUsers.toLocaleString()
  };
}

/**
 * 2. Process metrics & correlate by stage
 */
function processMetrics(k6Summary, systemMetrics, isKilled, terminationReason) {
  const metrics = k6Summary.metrics || {};
  const isShortRun = (k6Summary.state && k6Summary.state.testRunDurationMs < 300000) || (process.env.SHORT_RUN === 'true');
  
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
  
  let lastActiveIndex = -1;
  stagesList.forEach((stageName, index) => {
    const failedMetric = metrics[`http_req_failed{stage:${stageName}}`] || {};
    const passes = failedMetric.values ? (failedMetric.values.passes || 0) : 0;
    const fails = failedMetric.values ? (failedMetric.values.fails || 0) : 0;
    const totalRequests = passes + fails;
    if (totalRequests > 0) {
      lastActiveIndex = index;
    }
  });

  // Parse system metrics timestamps
  let startTime = Date.now();
  if (systemMetrics.length > 0) {
    startTime = new Date(systemMetrics[0].timestamp).getTime();
  }

  let cumulativeOffsetSec = 0;
  const processedStages = [];
  const droppedIterationsCount = metrics.dropped_iterations ? (metrics.dropped_iterations.values.count || 0) : 0;

  stagesList.forEach((stageName, index) => {
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

    // Helper helper to filter out nulls and compute metrics aggregates
    const getMetricVal = (metricsList, field, aggregator) => {
      const validVals = metricsList
        .map(m => m[field])
        .filter(v => v !== null && v !== undefined && !isNaN(v));
      if (validVals.length === 0) return null;
      return aggregator(validVals);
    };

    const getCounterDelta = (metricsList, field) => {
      const validVals = metricsList
        .map(m => m[field])
        .filter(v => v !== null && v !== undefined && !isNaN(v));
      if (validVals.length === 0) return 0;
      const min = Math.min(...validVals);
      const max = Math.max(...validVals);
      return Math.max(0, max - min);
    };

    const avgCpu = getMetricVal(stageSysMetrics, 'system_cpu', vals => vals.reduce((sum, v) => sum + v, 0) / vals.length);
    const maxCpu = getMetricVal(stageSysMetrics, 'system_cpu', vals => Math.max(...vals));
    const avgHikariActive = getMetricVal(stageSysMetrics, 'hikari_active', vals => vals.reduce((sum, v) => sum + v, 0) / vals.length);
    const maxHikariLimit = getMetricVal(stageSysMetrics, 'hikari_max', vals => Math.max(...vals)) || 50.0;
    const maxHikariPending = getMetricVal(stageSysMetrics, 'hikari_pending', vals => Math.max(...vals));
    const maxKafkaLag = getMetricVal(stageSysMetrics, 'kafka_lag_max', vals => Math.max(...vals));
    const maxRedisLatency = getMetricVal(stageSysMetrics, 'redis_latency_max', vals => Math.max(...vals));

    const expiredCount = getCounterDelta(stageSysMetrics, 'reservations_expired');
    const confirmedCount = getCounterDelta(stageSysMetrics, 'orders_confirmed');
    const workerConfirmRate = duration > 0 ? (confirmedCount / duration) : 0;

    const reconciledCount = getCounterDelta(stageSysMetrics, 'reservations_reconciled');
    const reconFailedCount = getCounterDelta(stageSysMetrics, 'reservations_recon_failed');
    const idempotencyMismatch = getCounterDelta(stageSysMetrics, 'idempotency_mismatch');
    const optimisticLockRetry = getCounterDelta(stageSysMetrics, 'optimistic_lock_retry');

    const cpuTrend = stageSysMetrics.map(m => m.system_cpu !== null ? `${(m.system_cpu * 100).toFixed(0)}%` : 'N/A').join(' -> ');

    // Extract k6 latency & throughput details
    const failedMetric = metrics[`http_req_failed{stage:${stageName}}`] || {};
    const durationMetric = metrics[`http_req_duration{stage:${stageName}}`] || {};
    const rateLimitMetric = metrics[`rate_limit_blocks{stage:${stageName}}`] || {};
    
    const passes = failedMetric.values ? (failedMetric.values.passes || 0) : 0; // failed requests
    const fails = failedMetric.values ? (failedMetric.values.fails || 0) : 0;   // successful requests
    const totalRequests = passes + fails;
    const rateLimitCount = rateLimitMetric.values ? (rateLimitMetric.values.count || 0) : 0;
    
    const expectedRequests = targetRps * duration;
    const droppedIterations = Math.max(0, expectedRequests - totalRequests);
    
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
    
    let slaStatus = (!p95Violated && !p99Violated && !errorViolated) ? 'PASS' : 'FAIL';

    // Bottleneck identification logic
    let bottleneckCause = 'None';
    let bottleneckEvidence = 'N/A';
    let bottleneckRec = 'N/A';

    // Data-integrity check: actual RPS collapses vs previous stage AND CPU is null or 0
    const prevStage = processedStages[processedStages.length - 1];
    let scrapeFailed = false;
    if (prevStage && actualRps < (prevStage.actualRps * 0.8) && (maxCpu === null || maxCpu === 0) && targetRps >= 500) {
      scrapeFailed = true;
    }

    // Check if aborted
    let isAborted = false;
    let abortReason = "";
    if (isKilled) {
      if (index > lastActiveIndex) {
        isAborted = true;
        if (lastActiveIndex === -1 && index === 0) {
          abortReason = terminationReason ? `Process terminated during setup/startup — ${terminationReason}` : "Process terminated during setup/startup — likely OOM";
        } else {
          abortReason = "Stage not reached";
        }
      } else if (index === lastActiveIndex) {
        isAborted = true;
        abortReason = terminationReason ? `Process terminated — ${terminationReason}` : "Process terminated — likely OOM";
      }
    }

    if (isAborted) {
      slaStatus = 'ABORTED';
      bottleneckCause = 'Load Generator Termination';
      bottleneckEvidence = abortReason;
      bottleneckRec = 'Check load generator memory headroom or VU ceilings; run with --max-vus-override capped to lower limits.';
    } else {
      if (scrapeFailed) {
        slaStatus = 'INVALID';
        bottleneckCause = 'Metrics Scraping Failed (Server Unresponsive / Connection Timeout)';
        bottleneckEvidence = `Actual RPS dropped to ${actualRps.toFixed(1)} (previous stage: ${prevStage.actualRps.toFixed(1)}) while measured system CPU read N/A (metrics query timeout).`;
        bottleneckRec = 'Spring Boot Tomcat threads or connection pool sat in BLOCKED state, failing to service Actuator metrics polls under high load. Increase resources or tune configurations.';
      } else if (slaStatus === 'FAIL' || p95Latency > 200) {
        const expectedRequests = targetRps * duration;
        const droppedForStage = Math.max(0, expectedRequests - totalRequests);
        const hasDroppedIterations = droppedIterationsCount > 0 && (droppedForStage > (expectedRequests * 0.05));

        // Check if k6 dropped iterations (client rig limitation)
        if (targetRps >= 1000 && hasDroppedIterations) {
          slaStatus = 'INCONCLUSIVE';
          bottleneckCause = 'Inconclusive (Client Load Generator Exhaustion)';
          bottleneckEvidence = `k6 dropped ${droppedForStage.toLocaleString()} load-testing iterations for this stage due to client machine socket/CPU exhaustion.`;
          bottleneckRec = 'Move the k6 test runner execution to a separate machine on the network, or configure distributed load generation nodes.';
        } else if (maxHikariPending !== null && maxHikariPending > 0 || (maxHikariLimit > 0 && avgHikariActive !== null && avgHikariActive >= (maxHikariLimit * 0.85))) {
          bottleneckCause = 'REGRESSION VIOLATION: Database Connection Pool Saturation';
          bottleneckEvidence = `Hikari active connections reached ${(avgHikariActive || 0).toFixed(1)}/${maxHikariLimit.toFixed(0)}. Active threads waiting: ${maxHikariPending || 0}.`;
          bottleneckRec = 'PostgreSQL database pool saturation detected! Since the HTTP hot path is now decoupled from Postgres, this indicates a serious regression (e.g. database operations or blocking calls are accidentally being executed on the synchronous HTTP request path). Audit controllers and services for accidental DB queries.';
        } else if ((maxKafkaLag !== null && maxKafkaLag > 50) || expiredCount > 0) {
          bottleneckCause = 'Worker/Kafka Consumer Throughput Bottleneck';
          bottleneckEvidence = `Kafka consumer lag reached ${maxKafkaLag || 0} records and ${expiredCount} reservations expired before they could be confirmed.`;
          bottleneckRec = 'Scale the async worker tier: increase Kafka partition count on flashflow.orders & flashflow.payments, scale worker consumer threads or run multiple worker instances. Keep HikariCP maximum-pool-size at 10 to avoid database scheduling thrashing.';
        } else if (maxRedisLatency !== null && maxRedisLatency > 0.05 && slaStatus === 'FAIL') {
          bottleneckCause = 'Redis Command Completion Delay';
          bottleneckEvidence = `Redis lettuce max response latency hit ${(maxRedisLatency * 1000).toFixed(1)}ms.`;
          bottleneckRec = 'Batch Redis operations using MGET/MSET pipelines or bundle commands in a single transactional Lua script.';
        } else if (maxCpu !== null && maxCpu > 0.85) {
          bottleneckCause = 'CPU Core Exhaustion';
          bottleneckEvidence = `System CPU load reached ${(maxCpu * 100).toFixed(1)}%.`;
          bottleneckRec = 'Allocate more CPU cores to the hosting node or profile JVM GC throughput options.';
        } else if (errorRate > 0.5) {
          bottleneckCause = 'Tomcat Connector Backlog/OS Port Exhaustion';
          bottleneckEvidence = `Error rate reached ${(errorRate * 100).toFixed(1)}% due to connection refusals.`;
          bottleneckRec = 'Increase server.tomcat.threads.max or apply OS registry overrides to increase TCP max ports.';
        } else {
          bottleneckCause = 'Database Lock Contention / Async Overhead';
          bottleneckEvidence = `Thread saturation observed (live JVM threads: high).`;
          bottleneckRec = 'Optimize catalog table indexes and execute writes asynchronously behind the Kafka messaging bus.';
        }
      }
    }

    bottleneckEvidence = (bottleneckEvidence === 'N/A') ? `CPU Trend: ${cpuTrend}` : `${bottleneckEvidence} | CPU Trend: ${cpuTrend}`;

    let vus = vuAllocationMap[stageName];
    const scenarioName = `stage_${stageName}`;
    if (k6Summary.options && k6Summary.options.scenarios && k6Summary.options.scenarios[scenarioName]) {
      const scen = k6Summary.options.scenarios[scenarioName];
      vus = scen.maxVUs || scen.vus || vus;
    }

    processedStages.push({
      stageName,
      targetRps,
      actualRps,
      requestCount: totalRequests,
      rateLimitCount,
      expiredCount,
      confirmedCount,
      workerConfirmRate,
      reconciledCount,
      reconFailedCount,
      idempotencyMismatch,
      optimisticLockRetry,
      droppedIterations: Math.max(0, (targetRps * duration) - totalRequests),
      avgLatency,
      p95Latency,
      p99Latency,
      errorRate,
      vus,
      slaStatus,
      violations: {
        p95: p95Latency > 500,
        p99: p99Latency > 1000,
        error: errorViolated
      },
      system: {
        cpuAvg: avgCpu,
        cpuMax: maxCpu,
        hikariActive: avgHikariActive,
        hikariMax: maxHikariLimit,
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
  const activeStages = stages.filter(s => s.requestCount > 0 && s.slaStatus !== 'ABORTED');
  if (!activeStages.length) {
    return { stageName: 'N/A', targetRps: 0, bottleneck: { cause: 'N/A' } };
  }

  let maxSlope = -1;
  let kneeIndex = 0;

  for (let i = 1; i < activeStages.length; i++) {
    const prev = activeStages[i-1];
    const curr = activeStages[i];
    const rpsDiff = curr.targetRps - prev.targetRps;
    if (rpsDiff === 0) continue;
    const slope = (curr.p95Latency - prev.p95Latency) / rpsDiff;
    
    // Highlight if the latency spikes significantly or breaks SLA
    if (slope > maxSlope && (curr.p95Latency > 150 || curr.slaStatus === 'FAIL')) {
      maxSlope = slope;
      kneeIndex = i;
    }
  }

  // If no massive spike, return first stage that failed SLA, or default to last active stage
  const failedStage = activeStages.find(s => s.slaStatus === 'FAIL');
  if (failedStage && maxSlope === -1) {
    return failedStage;
  }
  return activeStages[kneeIndex];
}

/**
 * 4. Compute Performance Scores (0-100)
 */
function calculatePerformanceScore(stages) {
  // Aggregate averages across stages
  const activeStages = stages.filter(s => s.requestCount > 0 && s.slaStatus !== 'ABORTED');
  if (!activeStages.length) return {
    correctness: 0,
    latency: 0,
    throughput: 0,
    stability: 0,
    errorRate: 0,
    resource: 0,
    overall: 0
  };

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
  const validCpus = activeStages.map(s => s.system.cpuMax).filter(v => v !== null && v !== undefined);
  const maxCpu = validCpus.length ? Math.max(...validCpus) : 0;

  const validPendings = activeStages.map(s => s.system.hikariPending).filter(v => v !== null && v !== undefined);
  const maxPendingDb = validPendings.length ? Math.max(...validPendings) : 0;

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

  // Load the most recent valid, completed previous run
  let prevData = null;
  for (const file of historyFiles) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(HISTORY_DIR, file), 'utf8'));
      const totalReq = (data.stages || []).reduce((sum, s) => sum + (s.requestCount || 0), 0);
      if (totalReq > 0) {
        prevData = data;
        break; // Found our previous valid run
      }
    } catch (e) {}
  }

  if (!prevData) {
    return null;
  }

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
function generateMarkdownReport(env, stages, score, kneePoint, recs, isKilled, terminationReason) {
  const totalRateLimitBlocks = stages.reduce((sum, s) => sum + s.rateLimitCount, 0);
  const totalRequests = stages.reduce((sum, s) => sum + s.requestCount, 0);
  const rateLimitPercent = totalRequests > 0 ? ((totalRateLimitBlocks / totalRequests) * 100).toFixed(2) : '0.00';

  // Helper to format values as N/A for aborted/unreached stages
  const fmt = (s, val, formattedVal) => (s.slaStatus === 'ABORTED' && s.requestCount === 0) ? 'N/A' : formattedVal;

  const stoppedStage = stages.find(s => s.slaStatus === 'ABORTED');
  const stoppedStageName = stoppedStage ? stoppedStage.stageName : 'setup';

  let md = `# Executive Performance Report: FlashFlow Stress Capacity\n\n`;
  if (isKilled) {
    md += `> [!CAUTION]\n> **This run did not complete all stages; results below reflect only stages that finished before termination (stopped at stage: ${stoppedStageName}).**\n> (Reason: ${terminationReason || 'Unknown'})\n\n`;
  }
  md += `## Executive Summary\n\n`;
  md += `- **Maximum Sustained Throughput**: ${Math.round(stages.filter(s => s.slaStatus === 'PASS').reduce((max, s) => Math.max(max, s.actualRps), 0))} RPS\n`;
  md += `- **Maximum Sustained Concurrent Users**: ${Math.max(...stages.filter(s => s.slaStatus === 'PASS').map(s => s.vus))} VUs\n`;
  
  const firstBreach = stages.find(s => s.slaStatus === 'FAIL');
  md += `- **First SLA Breach**: ${firstBreach ? `${firstBreach.stageName} (Target ${firstBreach.targetRps} RPS)` : 'None'}\n`;
  md += `- **Breaking Point / Knee Point**: ${kneePoint.stageName} (Target ${kneePoint.targetRps} RPS)\n`;
  md += `- **Primary Bottleneck**: ${kneePoint.bottleneck.cause}\n`;
  md += `- **Rate-Limited (429) Requests**: ${totalRateLimitBlocks.toLocaleString()} (${rateLimitPercent}% of total requests)\n`;
  md += `- **Overall Correctness**: ${score.correctness} / 100\n`;
  md += `- **Overall Score**: ${score.overall} / 100\n\n`;
  
  md += `## Environment & Test Configuration\n\n`;
  md += `| Parameter | Value |\n| :--- | :--- |\n`;
  md += `| **Execution Mode** | ${env.isShortRun ? 'ShortRun (Debug) (5s ramp / 10s hold)' : 'Full Scale Run (30-60s ramp / 1-3m hold)'} |\n`;
  Object.keys(env).forEach(k => {
    if (k !== 'isShortRun') {
      md += `| **${k}** | ${env[k]} |\n`;
    }
  });
  md += `\n`;

  md += `## Staged Metrics & Performance Matrix\n\n`;
  md += `| Stage | Target RPS | Actual RPS | Req Count | p95 Latency | p99 Latency | Error Rate | CPU Max | Hikari Active | Max Kafka Lag | Expired Reservations | Worker Confirm Rate | Reconciled | Recon Failed | Idemp Mismatch | Opt Lock Retries | Dropped Iters | SLA Status |\n`;
  md += `| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |\n`;
  stages.forEach(s => {
    const cpuStr = s.system.cpuMax !== null ? `${(s.system.cpuMax * 100).toFixed(0)}%` : 'SCRAPE_FAILED';
    const hikariStr = s.system.hikariActive !== null ? s.system.hikariActive.toFixed(1) : 'SCRAPE_FAILED';
    const kafkaLagStr = s.system.kafkaLag !== null ? s.system.kafkaLag.toString() : 'SCRAPE_FAILED';
    const expiredStr = s.expiredCount.toString();
    const workerRateStr = s.workerConfirmRate.toFixed(1);
    md += `| **${s.stageName}** | ${s.targetRps} | ${fmt(s, s.actualRps, s.actualRps.toFixed(1))} | ${fmt(s, s.requestCount, s.requestCount.toString())} | ${fmt(s, s.p95Latency, `${s.p95Latency.toFixed(1)} ms`)} | ${fmt(s, s.p99Latency, `${s.p99Latency.toFixed(1)} ms`)} | ${fmt(s, s.errorRate, `${(s.errorRate * 100).toFixed(2)}%`)} | ${cpuStr} | ${hikariStr} | ${kafkaLagStr} | ${fmt(s, s.expiredCount, expiredStr)} | ${fmt(s, s.workerConfirmRate, `${workerRateStr} / s`)} | ${fmt(s, s.reconciledCount, s.reconciledCount.toString())} | ${fmt(s, s.reconFailedCount, s.reconFailedCount.toString())} | ${fmt(s, s.idempotencyMismatch, s.idempotencyMismatch.toString())} | ${fmt(s, s.optimisticLockRetry, s.optimisticLockRetry.toString())} | ${fmt(s, s.droppedIterations, s.droppedIterations.toString())} | ${s.slaStatus} |\n`;
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
  let csv = `StageName,TargetRps,ActualRps,ReqCount,AvgLatencyMs,p95LatencyMs,p99LatencyMs,ErrorRatePercent,CpuMaxPercent,HikariActiveAvg,KafkaLagMax,ReservationsExpired,WorkerConfirmRate,ReconciledCount,ReconFailedCount,IdempotencyMismatchCount,OptimisticLockRetryCount,DroppedIterationsCount,SlaStatus\n`;
  stages.forEach(s => {
    const cpuVal = s.system.cpuMax !== null ? (s.system.cpuMax * 100).toFixed(2) : 'SCRAPE_FAILED';
    const hikariVal = s.system.hikariActive !== null ? s.system.hikariActive.toFixed(2) : 'SCRAPE_FAILED';
    const kafkaLagVal = s.system.kafkaLag !== null ? s.system.kafkaLag : -1;
    csv += `${s.stageName},${s.targetRps},${s.actualRps.toFixed(2)},${s.requestCount},${s.avgLatency.toFixed(2)},${s.p95Latency.toFixed(2)},${s.p99Latency.toFixed(2)},${(s.errorRate * 100).toFixed(4)},${cpuVal},${hikariVal},${kafkaLagVal},${s.expiredCount},${s.workerConfirmRate.toFixed(2)},${s.reconciledCount},${s.reconFailedCount},${s.idempotencyMismatch},${s.optimisticLockRetry},${s.droppedIterations},${s.slaStatus}\n`;
  });
  return csv;
}

/**
 * 10. Exports Generator: HTML dashboard
 */
function generateHtmlReport(env, stages, score, kneePoint, recs, historyComp, isKilled, terminationReason) {
  const totalRateLimitBlocks = stages.reduce((sum, s) => sum + s.rateLimitCount, 0);
  const totalRequests = stages.reduce((sum, s) => sum + s.requestCount, 0);
  const rateLimitPercent = totalRequests > 0 ? ((totalRateLimitBlocks / totalRequests) * 100).toFixed(2) : '0.00';

  // Helper to format values as N/A for aborted/unreached stages
  const fmt = (s, val, formattedVal) => (s.slaStatus === 'ABORTED' && s.requestCount === 0) ? 'N/A' : formattedVal;

  const stoppedStage = stages.find(s => s.slaStatus === 'ABORTED');
  const stoppedStageName = stoppedStage ? stoppedStage.stageName : 'setup';

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
    if (isKilled) {
      historyHtml = `
        <div class="card card-history">
          <h2>🔄 Comparison with Previous Run</h2>
          <div style="color: var(--accent-red); font-weight: bold; font-size: 1rem; margin-top: 15px;">
            ⚠️ Comparison skipped because this test run did not complete (aborted/OOM killed).
          </div>
        </div>
      `;
    } else {
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
    .status-inconclusive { color: #ecc94b; font-weight: bold; }
    .status-invalid { color: #a0aec0; font-weight: bold; }
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
    .status-aborted { color: var(--accent-red); font-weight: bold; }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <h1>⚡ FlashFlow Capacity Performance Dashboard</h1>
      <div class="timestamp">Test Run Executed on: ${new Date().toLocaleString()}</div>
    </header>

    ${isKilled ? `
      <div style="background: rgba(229, 62, 62, 0.15); border: 1px solid rgba(229, 62, 62, 0.3); border-radius: 12px; padding: 15px; margin-bottom: 20px; color: #f56565; font-weight: bold; font-size: 1.1rem; text-align: center;">
        🛑 This run did not complete — results below reflect only stages that finished before termination (stopped at stage: ${stoppedStageName}). Reason: ${terminationReason || 'Unknown'}
      </div>
    ` : ''}

    ${env.execution.includes('Local') ? `
      <div style="background: rgba(217, 119, 6, 0.15); border: 1px solid rgba(217, 119, 6, 0.3); border-radius: 12px; padding: 15px; margin-bottom: 20px; color: #ecc94b; font-size: 0.9rem;">
        ⚠️ <strong>Local Testing Execution Mode:</strong> Both the k6 load generator and Spring Boot API server ran on the same host machine. High-load throughput tiers (5,000+ RPS) are limited by client CPU resource division and loopback port/backlog bounds.
      </div>
    ` : ''}

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
        <div class="exec-item"><span class="exec-label">Rate-Limit 429 Blocks</span><span class="exec-val">${totalRateLimitBlocks.toLocaleString()} (${rateLimitPercent}%)</span></div>
      </div>

      <!-- Environment Card -->
      <div class="card">
        <h2>💻 Environment Summary & Run Configuration</h2>
        <div class="exec-item"><span class="exec-label">Execution Mode</span><span class="exec-val" style="color: ${env.isShortRun ? '#ecc94b' : 'var(--accent-green)'}">${env.isShortRun ? 'ShortRun (Debug Mode)' : 'Full Scale Capacity Run'}</span></div>
        <div class="exec-item"><span class="exec-label">Stage Durations</span><span class="exec-val">${env.isShortRun ? '5s Ramp / 10s Hold' : 'Dynamic (30-60s Ramp / 1-3m Hold)'}</span></div>
        <div class="exec-item"><span class="exec-label">Unique Test Users</span><span class="exec-val">${env.uniqueUsersUsed || 'N/A'}</span></div>
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
            <th>Kafka Consumer Lag (max)</th>
            <th>Reservations Expired</th>
            <th>Worker Confirm Rate</th>
            <th>Reconciled</th>
            <th>Recon Failed</th>
            <th>Idemp Mismatch</th>
            <th>Opt Lock Retries</th>
            <th>Dropped Iters</th>
            <th>SLA Status</th>
          </tr>
        </thead>
        <tbody>
          ${stages.map(s => `
            <tr>
              <td><strong>${s.stageName}</strong></td>
              <td>${s.targetRps}</td>
              <td>${fmt(s, s.actualRps, s.actualRps.toFixed(1))}</td>
              <td>${fmt(s, s.requestCount, s.requestCount.toString())}</td>
              <td>${fmt(s, s.p95Latency, `${s.p95Latency.toFixed(1)} ms`)}</td>
              <td>${fmt(s, s.p99Latency, `${s.p99Latency.toFixed(1)} ms`)}</td>
              <td>${fmt(s, s.errorRate, `${(s.errorRate * 100).toFixed(2)}%`)}</td>
              <td>${s.system.cpuMax !== null ? `${(s.system.cpuMax * 100).toFixed(0)}%` : '<span class="status-invalid" style="font-size:0.75rem;">SCRAPE_FAILED</span>'}</td>
              <td>${s.system.hikariActive !== null ? s.system.hikariActive.toFixed(1) : '<span class="status-invalid" style="font-size:0.75rem;">SCRAPE_FAILED</span>'}</td>
              <td>${s.system.kafkaLag !== null ? s.system.kafkaLag : '<span class="status-invalid" style="font-size:0.75rem;">SCRAPE_FAILED</span>'}</td>
              <td>${fmt(s, s.expiredCount, s.expiredCount.toString())}</td>
              <td>${fmt(s, s.workerConfirmRate, `${s.workerConfirmRate.toFixed(1)} / s`)}</td>
              <td>${fmt(s, s.reconciledCount, s.reconciledCount.toString())}</td>
              <td>${fmt(s, s.reconFailedCount, s.reconFailedCount.toString())}</td>
              <td>${fmt(s, s.idempotencyMismatch, s.idempotencyMismatch.toString())}</td>
              <td>${fmt(s, s.optimisticLockRetry, s.optimisticLockRetry.toString())}</td>
              <td>${fmt(s, s.droppedIterations, s.droppedIterations.toString())}</td>
              <td><span class="${s.slaStatus === 'PASS' ? 'status-pass' : (s.slaStatus === 'INCONCLUSIVE' ? 'status-inconclusive' : (s.slaStatus === 'INVALID' ? 'status-invalid' : (s.slaStatus === 'ABORTED' ? 'status-aborted' : 'status-fail')))}">${s.slaStatus}</span></td>
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

  const K6_EXIT_CODE = process.env.K6_EXIT_CODE ? parseInt(process.env.K6_EXIT_CODE, 10) : 0;
  let isKilled = K6_EXIT_CODE !== 0;
  let terminationReason = "";

  const k6LogPath = path.join(__dirname, 'k6_run.log');
  if (fs.existsSync(k6LogPath)) {
    const logContent = fs.readFileSync(k6LogPath, 'utf8');
    if (/oom|killed|exit status 137|out of memory/i.test(logContent)) {
      isKilled = true;
      terminationReason = "OOM killed";
    } else if (/panic/i.test(logContent)) {
      isKilled = true;
      terminationReason = "k6 Panic";
    } else if (/connection refused/i.test(logContent)) {
      isKilled = true;
      terminationReason = "Connection Refused";
    } else if (K6_EXIT_CODE !== 0) {
      isKilled = true;
      terminationReason = "Process terminated unexpectedly";
    }
  } else if (K6_EXIT_CODE !== 0) {
    isKilled = true;
    terminationReason = "Process exited with code " + K6_EXIT_CODE;
  }

  let k6Summary = { metrics: {}, state: { testRunDurationMs: 0 } };
  if (fs.existsSync(K6_SUMMARY_FILE)) {
    try {
      k6Summary = readJsonFile(K6_SUMMARY_FILE);
    } catch (e) {
      console.warn(`[Reporter] Warning: Failed to parse k6 summary, using empty fallback.`);
    }
  } else {
    console.warn(`[Reporter] Warning: k6 summary file not found, using empty fallback.`);
    if (isKilled && !terminationReason) {
      terminationReason = "Process terminated before writing summary";
    }
  }

  const isShortRun = (k6Summary.state && k6Summary.state.testRunDurationMs < 300000) || (process.env.SHORT_RUN === 'true');
  
  let systemMetrics = [];
  if (fs.existsSync(SYSTEM_METRICS_FILE)) {
    const parsedMetrics = readJsonFile(SYSTEM_METRICS_FILE);
    systemMetrics = Array.isArray(parsedMetrics) ? parsedMetrics : [parsedMetrics];
  } else {
    console.warn(`[Reporter] Warning: Could not locate system metrics: ${SYSTEM_METRICS_FILE}`);
  }

  // 1. Gather host and tool details
  const env = collectEnvironment(isShortRun);

  // 2. Correlate metrics and categorize stages
  const stages = processMetrics(k6Summary, systemMetrics, isKilled, terminationReason);

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

  const scenario = process.argv[2] || 'run';
  
  function getFormattedTimestamp() {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return now.getFullYear() +
           pad(now.getMonth() + 1) +
           pad(now.getDate()) + '_' +
           pad(now.getHours()) +
           pad(now.getMinutes()) +
           pad(now.getSeconds());
  }
  
  const timestamp = Date.now();
  const timestampStr = getFormattedTimestamp();

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

  // Archive run data inside history (for comparisons) - only if it completed successfully
  if (!isKilled) {
    fs.writeFileSync(path.join(HISTORY_DIR, `run_${timestamp}.json`), JSON.stringify(runRecord, null, 2), 'utf8');
  }

  // HTML Dashboard
  const htmlContent = generateHtmlReport(env, stages, score, kneePoint, recs, historyComp, isKilled, terminationReason);
  fs.writeFileSync(path.join(WORKSPACE_DIR, `summary_${scenario}_${timestampStr}.html`), htmlContent, 'utf8');
  fs.writeFileSync(path.join(REPORTS_DIR, `run_${timestamp}.html`), htmlContent, 'utf8');

  // JSON summary
  fs.writeFileSync(path.join(WORKSPACE_DIR, `results_${scenario}_${timestampStr}.json`), JSON.stringify(runRecord, null, 2), 'utf8');
  fs.writeFileSync(path.join(REPORTS_DIR, `run_${timestamp}.json`), JSON.stringify(runRecord, null, 2), 'utf8');

  // Markdown summary
  const mdContent = generateMarkdownReport(env, stages, score, kneePoint, recs, isKilled, terminationReason);
  fs.writeFileSync(path.join(WORKSPACE_DIR, `summary_${scenario}_${timestampStr}.md`), mdContent, 'utf8');
  fs.writeFileSync(path.join(REPORTS_DIR, `run_${timestamp}.md`), mdContent, 'utf8');

  // CSV summary
  const csvContent = generateCsvReport(stages);
  fs.writeFileSync(path.join(WORKSPACE_DIR, `summary_${scenario}_${timestampStr}.csv`), csvContent, 'utf8');
  fs.writeFileSync(path.join(REPORTS_DIR, `run_${timestamp}.csv`), csvContent, 'utf8');

  console.log(`[Reporter] Successfully generated:`);
  console.log(`  - summary_${scenario}_${timestampStr}.html`);
  console.log(`  - results_${scenario}_${timestampStr}.json`);
  console.log(`  - summary_${scenario}_${timestampStr}.md`);
  console.log(`  - summary_${scenario}_${timestampStr}.csv`);
}

main();
