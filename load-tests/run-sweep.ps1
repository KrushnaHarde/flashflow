# load-tests/run-sweep.ps1
# Automates the controlled capacity sweep for Hikari pool sizes: 10, 20, 30, 50

$sweepDir = "load-tests/sweep"
if (-not (Test-Path $sweepDir)) {
    New-Item -ItemType Directory -Path $sweepDir -Force | Out-Null
} else {
    Remove-Item "$sweepDir/*.json" -ErrorAction SilentlyContinue
    Remove-Item "$sweepDir/*.html" -ErrorAction SilentlyContinue
}

$poolSizes = @(10, 20, 30, 50)
$propertiesPath = "server/src/main/resources/application-db.properties"
$backendRunner = "C:\Users\Admin\.gemini\antigravity-ide\brain\1087ca0c-8341-4706-b71a-5a2aa65b9893\scratch\run-backend.ps1"

function Kill-RunningServer {
    Write-Host "[Sweep] Stopping any running server instances on port 8080..." -ForegroundColor Gray
    
    # 1. Kill java processes
    $javaProc = Get-Process -Name java -ErrorAction SilentlyContinue
    if ($javaProc) {
        $javaProc | Stop-Process -Force
        Start-Sleep -Seconds 3
    }

    # 2. Wait until listening port 8080 is clear
    do {
        $conn = Get-NetTCPConnection -LocalPort 8080 -State Listen -ErrorAction SilentlyContinue
        if ($conn) {
            Write-Host "[Sweep] Port 8080 is still occupied by listener process $($conn.OwningProcess). Killing it..." -ForegroundColor Red
            Get-Process -Id $conn.OwningProcess -ErrorAction SilentlyContinue | Stop-Process -Force
            Start-Sleep -Seconds 2
        }
    } while ($conn)
    Write-Host "[Sweep] Port 8080 is completely cleared." -ForegroundColor Green
}

function Set-PoolSize($size) {
    Write-Host "[Sweep] Updating spring.datasource.hikari.maximum-pool-size to $size..." -ForegroundColor Cyan
    $content = Get-Content $propertiesPath
    $newContent = $content -replace "spring.datasource.hikari.maximum-pool-size=\d+", "spring.datasource.hikari.maximum-pool-size=$size"
    $newContent | Set-Content $propertiesPath -Encoding utf8
}

function Start-Server {
    Write-Host "[Sweep] Starting Spring Boot backend in the background..." -ForegroundColor Cyan
    Start-Process powershell -ArgumentList "-ExecutionPolicy Bypass -File $backendRunner" -NoNewWindow
    
    Write-Host "[Sweep] Waiting for Spring Boot Actuator health endpoint to return UP..." -ForegroundColor Gray
    $started = $false
    for ($i = 0; $i -lt 45; $i++) {
        try {
            $res = Invoke-RestMethod -Uri "http://localhost:8080/actuator/health" -TimeoutSec 2
            if ($res.status -eq "UP") {
                $started = $true
                break
            }
        } catch {}
        Start-Sleep -Seconds 2
    }
    
    if (-not $started) {
        Write-Error "[Sweep] Spring Boot server failed to startup and report healthy in 90 seconds."
        exit 1
    }
    Write-Host "[Sweep] Spring Boot backend is UP and responsive." -ForegroundColor Green
}

# Iterate through each pool size
foreach ($size in $poolSizes) {
    Write-Host ""
    Write-Host "============================================================" -ForegroundColor Yellow
    Write-Host " RUNNING EXPERIMENT FOR HIKARI CONNECTION POOL SIZE: $size" -ForegroundColor Yellow
    Write-Host "============================================================" -ForegroundColor Yellow
    
    # 1. Stop existing instance
    Kill-RunningServer

    # 2. Flush Redis to clean active state, rate limiters, and caches
    Write-Host "[Sweep] Flushing Redis database..." -ForegroundColor Gray
    & docker exec flashflow-redis redis-cli flushall | Out-Null
    
    # 3. Re-seed Postgres database to reset inventory and active flash sale start/end times
    Write-Host "[Sweep] Re-seeding PostgreSQL database..." -ForegroundColor Gray
    Get-Content load-tests/seed-data.sql | docker exec -i flashflow-postgres psql -U postgres -d flashflow | Out-Null

    # 4. Update config file
    Set-PoolSize $size
    
    # 5. Check DB maximum connections setting
    Write-Host "[Sweep] Fetching Postgres max_connections setting..." -ForegroundColor Gray
    & docker exec flashflow-postgres psql -U postgres -c "SHOW max_connections;"
    
    # 6. Boot server
    Start-Server
    
    # 7. Run short ramp-up test
    Write-Host "[Sweep] Launching load test scenario..." -ForegroundColor Cyan
    powershell -ExecutionPolicy Bypass -File load-tests/run-tests.ps1 -Scenario ramp -BaseUrl "http://localhost:8080" -ShortRun
    
    # 6. Archive the outputs from this run
    $latestResults = Get-ChildItem -Path "results_ramp_*.json" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    $latestHtml = Get-ChildItem -Path "summary_ramp_*.html" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    
    if ($latestResults) {
        Copy-Item -Path $latestResults.FullName -Destination "$sweepDir/run_pool_$size.json" -Force
        Write-Host "[Sweep] Copied $($latestResults.Name) to $sweepDir/run_pool_$size.json" -ForegroundColor Green
    } else {
        Write-Error "[Sweep] Failed to locate generated JSON results."
    }

    if ($latestHtml) {
        Copy-Item -Path $latestHtml.FullName -Destination "$sweepDir/run_pool_$size.html" -Force
    }
}

# Cleanup and restore default pool size 50
Write-Host ""
Write-Host "[Sweep] Restoring default maximum-pool-size=50..." -ForegroundColor Cyan
Kill-RunningServer
Set-PoolSize 50
Start-Server

Write-Host ""
Write-Host "[Sweep] Analyzing connection pool size sweep results..." -ForegroundColor Yellow
node load-tests/sweep-analyzer.js
