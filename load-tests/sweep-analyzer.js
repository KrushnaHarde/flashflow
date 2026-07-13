const fs = require('fs');
const path = require('path');

const SWEEP_DIR = path.join(__dirname, 'sweep');
const REPORT_PATH = path.join(__dirname, '../sweep_report.md');

function main() {
  console.log('[Sweep Analyzer] Starting analysis...');
  if (!fs.existsSync(SWEEP_DIR)) {
    console.error(`Error: Sweep directory does not exist: ${SWEEP_DIR}`);
    process.exit(1);
  }

  const files = fs.readdirSync(SWEEP_DIR)
    .filter(f => f.startsWith('run_pool_') && f.endsWith('.json'));

  const results = [];

  files.forEach(file => {
    const size = parseInt(file.match(/run_pool_(\d+)\.json/)[1], 10);
    const content = JSON.parse(fs.readFileSync(path.join(SWEEP_DIR, file), 'utf8'));
    const stages = content.stages || [];

    // Max sustained RPS is the actual RPS of the highest stage that PASSed
    const passedStages = stages.filter(s => s.slaStatus === 'PASS');
    let maxSustainedRps = 0;
    let maxSustainedStage = 'None';
    if (passedStages.length > 0) {
      // Find the one with highest target RPS
      const highest = passedStages.reduce((prev, curr) => (curr.targetRps > prev.targetRps) ? curr : prev, passedStages[0]);
      maxSustainedRps = Math.round(highest.actualRps);
      maxSustainedStage = highest.stageName;
    }

    // p95 latency at 100_rps stage
    const stage100 = stages.find(s => s.stageName === '100_rps');
    const p95At100 = stage100 ? stage100.p95Latency : null;

    results.push({
      poolSize: size,
      maxRps: maxSustainedRps,
      maxStage: maxSustainedStage,
      p95At100: p95At100
    });
  });

  // Sort by pool size ascending
  results.sort((a, b) => a.poolSize - b.poolSize);

  let md = `# Connection Pool Sweep Experiment Report\n\n`;
  md += `This report compiles the results of a controlled capacity sweep changing only the database connection pool size (\`spring.datasource.hikari.maximum-pool-size\`) to isolate its effect on throughput ceiling and latency.\n\n`;
  md += `## Experiment Parameters\n\n`;
  md += `- **Database Setting (\`max_connections\`)**: 100 (Postgres ceiling)\n`;
  md += `- **Scenario profile**: ShortRun capacity test (5s ramp-up, 10s hold per stage)\n`;
  md += `- **Scale bounds**: 1 RPS $\\rightarrow$ 10,000 RPS (7 sequential stages)\n\n`;
  
  md += `## Combined Comparison Table\n\n`;
  md += `| Hikari Pool Size | Max Sustained Stage | Max Sustained RPS | p95 Latency at 100 RPS |\n`;
  md += `| :---: | :---: | :---: | :---: |\n`;
  
  results.forEach(r => {
    const latencyStr = r.p95At100 !== null ? `${r.p95At100.toFixed(1)} ms` : 'N/A';
    md += `| **${r.poolSize}** | ${r.maxStage} | ${r.maxRps} RPS | ${latencyStr} |\n`;
  });
  
  md += `\n`;
  md += `## Performance Analysis & Conclusions\n\n`;
  
  // Find where the plateau occurs
  let conclusionText = '';
  if (results.length >= 2) {
    const bestRun = results.reduce((prev, curr) => (curr.maxRps > prev.maxRps) ? curr : prev, results[0]);
    conclusionText += `Based on the gathered test runs, the optimal connection pool size is **${bestRun.poolSize}**.\n`;
    conclusionText += `Increasing the pool size beyond this point yields diminishing returns or plateaus due to database execution boundaries or other architectural limits.`;
  } else {
    conclusionText += `Insufficient runs to compute a solid conclusion. Please verify that the sweep completed successfully.`;
  }
  md += `${conclusionText}\n`;

  fs.writeFileSync(REPORT_PATH, md, 'utf8');
  console.log(`[Sweep Analyzer] Generated summary comparison report at ${REPORT_PATH}`);
  
  // Also print to console so it is visible in the logs
  console.log('\n================================================================');
  console.log('                 HIKARI POOL SIZE SWEEP RESULTS');
  console.log('================================================================');
  console.log('Pool Size | Max Stage   | Max Sustained RPS | p95 Latency @ 100 RPS');
  console.log('----------------------------------------------------------------');
  results.forEach(r => {
    const latencyStr = r.p95At100 !== null ? `${r.p95At100.toFixed(1)} ms` : 'N/A';
    console.log(`${String(r.poolSize).padEnd(9)} | ${r.maxStage.padEnd(11)} | ${String(r.maxRps).padEnd(17)} | ${latencyStr}`);
  });
  console.log('================================================================\n');
}

main();
