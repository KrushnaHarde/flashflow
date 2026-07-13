# load-tests/run-tests.ps1
[CmdletBinding()]
param(
    [ValidateSet('smoke', 'ramp', 'spike')]
    [string]$Scenario = 'smoke',

    [string]$BaseUrl = 'http://localhost:3000',

    [switch]$ShortRun,

    [switch]$OpenReport,

    [int]$MaxVusOverride = 0
)

# 1. Verify k6 installation
$k6Check = Get-Command k6 -ErrorAction SilentlyContinue
if (-not $k6Check) {
    Write-Warning "k6 was not detected on this system's PATH."
    Write-Host "To install k6 via winget, execute the following command in an Admin PowerShell:" -ForegroundColor Cyan
    Write-Host "  winget install k6.k6" -ForegroundColor Yellow
    Write-Host "Alternatively, download the installer from: https://dl.k6.io/msi/k6-latest-amd64.msi" -ForegroundColor Cyan
    exit 1
}

# 2. Locate the target test script
$ScriptFile = "load-tests/$Scenario-test.js"
$ReportPath = "summary.html"
$JsonPath = "results.json"

if (-not (Test-Path $ScriptFile)) {
    # Fallback if the user runs the script from inside the load-tests directory itself
    $ScriptFile = "$Scenario-test.js"
    $ReportPath = "summary.html"
    $JsonPath = "results.json"
    if (-not (Test-Path $ScriptFile)) {
        Write-Error "Unable to locate '$Scenario-test.js'. Please execute this script from the workspace root."
        exit 1
    }
}

# 3. Set environment variable configurations
$envString = "BASE_URL=$BaseUrl"
if ($ShortRun) {
    $envString += ",SHORT_RUN=true"
    Write-Host "=== SHORT RUN ENABLED ===" -ForegroundColor Yellow
    Write-Host "Overriding test durations to 5s ramp, 10s hold for quick debugging..." -ForegroundColor Yellow
} else {
    Write-Host "=== FULL SCALE RUN ===" -ForegroundColor Cyan
    if ($Scenario -eq 'ramp') {
        Write-Host "Warning: The full ramping test takes approximately 20 minutes to complete." -ForegroundColor DarkYellow
    }
}

Write-Host "Executing Scenario : $Scenario" -ForegroundColor Green
Write-Host "Target BASE_URL    : $BaseUrl" -ForegroundColor Green
Write-Host "JSON Log Output    : $JsonPath" -ForegroundColor Green
Write-Host "HTML Report Output : $ReportPath" -ForegroundColor Green
Write-Host ""

# 4. Generate user pool for the test run
$BackendUrl = $BaseUrl
if ($BaseUrl -match "3000") {
    $BackendUrl = "http://localhost:8080"
}
Write-Host "Pre-registering 20000 test users at $BackendUrl..." -ForegroundColor Gray
try {
    Invoke-RestMethod -Method Post -Uri "$BackendUrl/api/v1/auth/bulk-register?count=20000" -OutFile "load-tests/users_pool.json" -TimeoutSec 30
    Write-Host "Successfully pre-registered users and generated load-tests/users_pool.json." -ForegroundColor Green
} catch {
    Write-Warning "Failed to pre-register users: $_"
    "[]" | Out-File -FilePath "load-tests/users_pool.json" -Encoding utf8
}

# Purge historical messages from Kafka topics to start with fresh zero lag
Write-Host "Purging historical messages from Kafka topics..." -ForegroundColor Gray
try {
    docker exec flashflow-kafka kafka-configs --bootstrap-server localhost:9092 --entity-type topics --entity-name flashflow.orders --alter --add-config retention.ms=1 2>$null | Out-Null
    docker exec flashflow-kafka kafka-configs --bootstrap-server localhost:9092 --entity-type topics --entity-name flashflow.payments --alter --add-config retention.ms=1 2>$null | Out-Null
    Start-Sleep -Seconds 2
    docker exec flashflow-kafka kafka-configs --bootstrap-server localhost:9092 --entity-type topics --entity-name flashflow.orders --alter --delete-config retention.ms 2>$null | Out-Null
    docker exec flashflow-kafka kafka-configs --bootstrap-server localhost:9092 --entity-type topics --entity-name flashflow.payments --alter --delete-config retention.ms 2>$null | Out-Null
    Write-Host "Kafka topics successfully purged." -ForegroundColor Green
} catch {
    Write-Warning "Failed to purge Kafka topics: $_"
}

# 4. Launch background metrics collector
$metricsPath = "load-tests/system_metrics.json"
if (Test-Path $metricsPath) { Remove-Item $metricsPath -Force }

Write-Host "Starting background performance metrics collection..." -ForegroundColor Gray
$collectorProcess = Start-Process powershell -ArgumentList "-ExecutionPolicy Bypass -File load-tests/metrics-collector.ps1 -OutputPath $metricsPath -BaseUrl $BaseUrl" -NoNewWindow -PassThru

# 5. Run the k6 command
$k6Args = @("run")
$k6Args += @("--env", "BASE_URL=$BaseUrl")
if ($ShortRun) {
    $k6Args += @("--env", "SHORT_RUN=true")
}
if ($MaxVusOverride -gt 0) {
    $k6Args += @("--env", "MAX_VUS_OVERRIDE=$MaxVusOverride")
}
$k6Args += $ScriptFile

Write-Host "Command: k6 $($k6Args -join ' ')" -ForegroundColor Gray
& k6 $k6Args

# 7. Stop metrics collector and wait for file persistence
Write-Host "Stopping background metrics collector..." -ForegroundColor Gray
New-Item -ItemType File -Path "load-tests/stop_collector.tmp" -Force | Out-Null
$collectorProcess | Wait-Process -Timeout 15 -ErrorAction SilentlyContinue

# Wait for system_metrics.json to be fully written and closed
for ($i = 0; $i -lt 10; $i++) {
    if (Test-Path $metricsPath) {
        $fileInfo = Get-Item $metricsPath
        if ($fileInfo.Length -gt 10) {
            Start-Sleep -Milliseconds 500
            break
        }
    }
    Start-Sleep -Seconds 1
}

# 8. Generate advanced performance reports and charts
Write-Host "Generating performance engineering dashboard and raw exports..." -ForegroundColor Cyan
node load-tests/report-generator.js $Scenario

# 8. Open report automatically if requested
if ($OpenReport) {
    $ReportFile = Get-ChildItem -Path "summary_${Scenario}_*.html" -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if ($ReportFile) {
        Write-Host "Launching generated HTML summary report ($($ReportFile.Name))..." -ForegroundColor Cyan
        Start-Process $ReportFile.FullName
    } else {
        Write-Warning "HTML report matching 'summary_${Scenario}_*.html' was not found."
    }
}
