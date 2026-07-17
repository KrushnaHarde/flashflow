# load-tests/metrics-collector.ps1
param(
    [string]$OutputPath = "load-tests/system_metrics.json",
    [string]$BaseUrl = "http://localhost:8080"
)

# Clear any lingering stop flag file
$flagPath = "load-tests/stop_collector.tmp"
if (Test-Path $flagPath) { Remove-Item $flagPath -Force }

$metrics = [System.Collections.Generic.List[PSObject]]::new()

# Startup reachability verification check
Write-Host "[Collector] Performing startup check against ${BaseUrl}..." -ForegroundColor Cyan
$endpointsToCheck = @(
    "/actuator/health",
    "/actuator/metrics/system.cpu.usage"
)

foreach ($endpoint in $endpointsToCheck) {
    $url = "${BaseUrl}${endpoint}"
    try {
        $res = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 3 -ErrorAction Stop
        if ($res.StatusCode -ne 200) {
            Write-Error "[Collector] ERROR: Startup check failed. Endpoint $url returned status $($res.StatusCode)"
            exit 1
        }
    } catch {
        Write-Error "[Collector] ERROR: Startup check failed. Cannot reach $url. Error: $_"
        exit 1
    }
}
Write-Host "[Collector] Startup check passed successfully." -ForegroundColor Green

Write-Host "[Collector] Starting background system performance monitoring loop against ${BaseUrl}..." -ForegroundColor Cyan

while (-not (Test-Path $flagPath)) {
    $timestamp = [DateTime]::UtcNow.ToString("o")
    
    # 1. System CPU Usage
    $systemCpu = $null
    try {
        $res = Invoke-RestMethod -Uri "${BaseUrl}/actuator/metrics/system.cpu.usage" -TimeoutSec 1
        if ($res.measurements) { $systemCpu = $res.measurements[0].value }
    } catch {
        Write-Warning "Failed to scrape system.cpu.usage: $_"
    }

    # 2. JVM Process CPU Usage
    $processCpu = $null
    try {
        $res = Invoke-RestMethod -Uri "${BaseUrl}/actuator/metrics/process.cpu.usage" -TimeoutSec 1
        if ($res.measurements) { $processCpu = $res.measurements[0].value }
    } catch {
        Write-Warning "Failed to scrape process.cpu.usage: $_"
    }

    # 3. JVM Memory Used
    $jvmMemoryUsed = $null
    try {
        $res = Invoke-RestMethod -Uri "${BaseUrl}/actuator/metrics/jvm.memory.used" -TimeoutSec 1
        if ($res.measurements) { $jvmMemoryUsed = $res.measurements[0].value }
    } catch {
        Write-Warning "Failed to scrape jvm.memory.used: $_"
    }

    # 4. Active JVM Threads
    $jvmThreads = $null
    try {
        $res = Invoke-RestMethod -Uri "${BaseUrl}/actuator/metrics/jvm.threads.live" -TimeoutSec 1
        if ($res.measurements) { $jvmThreads = $res.measurements[0].value }
    } catch {
        Write-Warning "Failed to scrape jvm.threads.live: $_"
    }

    # 5. Hikari DB Active Connections
    $hikariActive = $null
    try {
        $res = Invoke-RestMethod -Uri "${BaseUrl}/actuator/metrics/hikaricp.connections.active" -TimeoutSec 1
        if ($res.measurements) { $hikariActive = $res.measurements[0].value }
    } catch {
        Write-Warning "Failed to scrape hikaricp.connections.active: $_"
    }

    # 5.5 Hikari DB Max Connections
    $hikariMax = $null
    try {
        $res = Invoke-RestMethod -Uri "${BaseUrl}/actuator/metrics/hikaricp.connections.max" -TimeoutSec 1
        if ($res.measurements) { $hikariMax = $res.measurements[0].value }
    } catch {
        Write-Warning "Failed to scrape hikaricp.connections.max: $_"
    }

    # 6. Hikari DB Connections Pending (waiting threads)
    $hikariPending = $null
    try {
        $res = Invoke-RestMethod -Uri "${BaseUrl}/actuator/metrics/hikaricp.connections.pending" -TimeoutSec 1
        if ($res.measurements) { $hikariPending = $res.measurements[0].value }
    } catch {
        Write-Warning "Failed to scrape hikaricp.connections.pending: $_"
    }

    # 7. Kafka Consumer Lag
    $kafkaLag = $null
    try {
        # 7a. Query custom Micrometer gauge for Kafka consumer lag via Actuator
        $res = Invoke-RestMethod -Uri "${BaseUrl}/actuator/metrics/kafka.consumer.lag" -TimeoutSec 1
        if ($res.measurements) {
            $kafkaLag = $res.measurements[0].value
        }
    } catch {
        try {
            # 7b. Fallback to remote JSON endpoint
            $res = Invoke-RestMethod -Uri "${BaseUrl}/api/v1/metrics/kafka-lag" -TimeoutSec 1
            if ($res -and $res.maxLag -ne $null) {
                $kafkaLag = $res.maxLag
            }
        } catch {
            try {
                # 7c. Fallback to standard spring kafka metric
                $res = Invoke-RestMethod -Uri "${BaseUrl}/actuator/metrics/kafka.consumer.fetch.manager.records.lag.max" -TimeoutSec 1
                if ($res.measurements) { $kafkaLag = $res.measurements[0].value }
            } catch {}
        }
    }
    if ($kafkaLag -eq $null) { $kafkaLag = 0 }

    # 7.5 Expired Reservations Count
    $reservationsExpired = $null
    try {
        $res = Invoke-RestMethod -Uri "${BaseUrl}/actuator/metrics/reservations.expired.count" -TimeoutSec 1
        if ($res.measurements) { $reservationsExpired = $res.measurements[0].value }
    } catch {
        # Micrometer returns 404 if the counter has not been incremented/created yet, fallback to 0
        $reservationsExpired = 0
    }

    # 7.6 Orders Confirmed Count
    $ordersConfirmed = $null
    try {
        $res = Invoke-RestMethod -Uri "${BaseUrl}/actuator/metrics/orders.confirmed.count" -TimeoutSec 1
        if ($res.measurements) { $ordersConfirmed = $res.measurements[0].value }
    } catch {
        # Micrometer returns 404 if the counter has not been incremented/created yet, fallback to 0
        $ordersConfirmed = 0
    }

    # 7.7 Reconciled Count
    $reservationsReconciled = 0
    try {
        $res = Invoke-RestMethod -Uri "${BaseUrl}/actuator/metrics/reservations.reconciled.count" -TimeoutSec 1
        if ($res.measurements) { $reservationsReconciled = $res.measurements[0].value }
    } catch {}

    # 7.8 Reconciliation Failed Count
    $reservationsReconFailed = 0
    try {
        $res = Invoke-RestMethod -Uri "${BaseUrl}/actuator/metrics/reservations.reconciliation.failed.count" -TimeoutSec 1
        if ($res.measurements) { $reservationsReconFailed = $res.measurements[0].value }
    } catch {}

    # 7.9 Idempotency Mismatch Count
    $idempotencyMismatch = 0
    try {
        $res = Invoke-RestMethod -Uri "${BaseUrl}/actuator/metrics/idempotency.mismatch.count" -TimeoutSec 1
        if ($res.measurements) { $idempotencyMismatch = $res.measurements[0].value }
    } catch {}

    # 7.10 Optimistic Lock Retry Count
    $optimisticLockRetry = 0
    try {
        $res = Invoke-RestMethod -Uri "${BaseUrl}/actuator/metrics/optimistic.lock.retry.count" -TimeoutSec 1
        if ($res.measurements) { $optimisticLockRetry = $res.measurements[0].value }
    } catch {}

    # 8. Redis/Lettuce command completion latency (seconds)
    $redisLatency = $null
    try {
        $res = Invoke-RestMethod -Uri "${BaseUrl}/actuator/metrics/lettuce.command.completion" -TimeoutSec 1
        if ($res.measurements) {
            $maxMeas = $res.measurements | Where-Object { $_.statistic -eq 'MAX' }
            if ($maxMeas) { $redisLatency = $maxMeas.value }
        }
    } catch {
        Write-Warning "Failed to scrape lettuce Redis latency: $_"
    }

    $record = [PSCustomObject]@{
        timestamp                 = $timestamp
        system_cpu                = $systemCpu
        process_cpu               = $processCpu
        jvm_memory_used           = $jvmMemoryUsed
        jvm_threads_live          = $jvmThreads
        hikari_active             = $hikariActive
        hikari_max                = $hikariMax
        hikari_pending            = $hikariPending
        kafka_lag_max             = $kafkaLag
        reservations_expired      = $reservationsExpired
        orders_confirmed          = $ordersConfirmed
        redis_latency_max         = $redisLatency
        reservations_reconciled   = $reservationsReconciled
        reservations_recon_failed = $reservationsReconFailed
        idempotency_mismatch      = $idempotencyMismatch
        optimistic_lock_retry     = $optimisticLockRetry
    }

    $metrics.Add($record)

    Start-Sleep -Seconds 1
}

# Write collected data to output
$metrics | ConvertTo-Json -Depth 5 | Out-File -FilePath $OutputPath -Encoding utf8
Write-Host "[Collector] Background metrics loop stopped and metrics saved to $OutputPath." -ForegroundColor Cyan

# Cleanup flag
if (Test-Path $flagPath) { Remove-Item $flagPath -Force }
