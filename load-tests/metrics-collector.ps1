# load-tests/metrics-collector.ps1
param(
    [string]$OutputPath = "load-tests/system_metrics.json"
)

# Clear any lingering stop flag file
$flagPath = "load-tests/stop_collector.tmp"
if (Test-Path $flagPath) { Remove-Item $flagPath -Force }

$metrics = [System.Collections.Generic.List[PSObject]]::new()

Write-Host "[Collector] Starting background system performance monitoring loop..." -ForegroundColor Cyan

while (-not (Test-Path $flagPath)) {
    $timestamp = [DateTime]::UtcNow.ToString("o")
    
    # 1. System CPU Usage
    $systemCpu = 0.0
    try {
        $res = Invoke-RestMethod -Uri "http://localhost:8080/actuator/metrics/system.cpu.usage" -TimeoutSec 1
        if ($res.measurements) { $systemCpu = $res.measurements[0].value }
    } catch {}

    # 2. JVM Process CPU Usage
    $processCpu = 0.0
    try {
        $res = Invoke-RestMethod -Uri "http://localhost:8080/actuator/metrics/process.cpu.usage" -TimeoutSec 1
        if ($res.measurements) { $processCpu = $res.measurements[0].value }
    } catch {}

    # 3. JVM Memory Used
    $jvmMemoryUsed = 0.0
    try {
        $res = Invoke-RestMethod -Uri "http://localhost:8080/actuator/metrics/jvm.memory.used" -TimeoutSec 1
        if ($res.measurements) { $jvmMemoryUsed = $res.measurements[0].value }
    } catch {}

    # 4. Active JVM Threads
    $jvmThreads = 0.0
    try {
        $res = Invoke-RestMethod -Uri "http://localhost:8080/actuator/metrics/jvm.threads.live" -TimeoutSec 1
        if ($res.measurements) { $jvmThreads = $res.measurements[0].value }
    } catch {}

    # 5. Hikari DB Active Connections
    $hikariActive = 0.0
    try {
        $res = Invoke-RestMethod -Uri "http://localhost:8080/actuator/metrics/hikaricp.connections.active" -TimeoutSec 1
        if ($res.measurements) { $hikariActive = $res.measurements[0].value }
    } catch {}

    # 6. Hikari DB Connections Pending (waiting threads)
    $hikariPending = 0.0
    try {
        $res = Invoke-RestMethod -Uri "http://localhost:8080/actuator/metrics/hikaricp.connections.pending" -TimeoutSec 1
        if ($res.measurements) { $hikariPending = $res.measurements[0].value }
    } catch {}

    # 7. Kafka Consumer Lag Maximum
    $kafkaLag = 0.0
    try {
        $res = Invoke-RestMethod -Uri "http://localhost:8080/actuator/metrics/kafka.consumer.fetch.manager.records.lag.max" -TimeoutSec 1
        if ($res.measurements) { $kafkaLag = $res.measurements[0].value }
    } catch {}

    # 8. Redis/Lettuce command completion latency (seconds)
    $redisLatency = 0.0
    try {
        $res = Invoke-RestMethod -Uri "http://localhost:8080/actuator/metrics/lettuce.command.completion" -TimeoutSec 1
        if ($res.measurements) {
            $maxMeas = $res.measurements | Where-Object { $_.statistic -eq 'MAX' }
            if ($maxMeas) { $redisLatency = $maxMeas.value }
        }
    } catch {}

    $record = [PSCustomObject]@{
        timestamp         = $timestamp
        system_cpu        = $systemCpu
        process_cpu       = $processCpu
        jvm_memory_used   = $jvmMemoryUsed
        jvm_threads_live  = $jvmThreads
        hikari_active     = $hikariActive
        hikari_pending    = $hikariPending
        kafka_lag_max     = $kafkaLag
        redis_latency_max = $redisLatency
    }

    $metrics.Add($record)

    Start-Sleep -Seconds 1
}

# Write collected data to output
$metrics | ConvertTo-Json -Depth 5 | Out-File -FilePath $OutputPath -Encoding utf8
Write-Host "[Collector] Background metrics loop stopped and metrics saved to $OutputPath." -ForegroundColor Cyan

# Cleanup flag
if (Test-Path $flagPath) { Remove-Item $flagPath -Force }
