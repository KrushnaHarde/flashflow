#!/bin/bash

# Default values
SCENARIO="smoke"
BASE_URL="http://localhost:8080"
SHORT_RUN=false
MAX_VUS_OVERRIDE=""

# Simple CLI parsing
while [[ "$#" -gt 0 ]]; do
    case $1 in
        smoke|ramp|spike) SCENARIO="$1"; shift ;;
        http*) BASE_URL="$1"; shift ;;
        --short-run) SHORT_RUN=true; shift ;;
        --max-vus-override) MAX_VUS_OVERRIDE="$2"; shift 2 ;;
        *) echo "Unknown parameter passed: $1"; exit 1 ;;
    esac
done

# 1. Verify k6 installation
K6_CMD="k6"
if command -v k6 &> /dev/null; then
    K6_CMD="k6"
elif command -v k6.exe &> /dev/null; then
    K6_CMD="k6.exe"
elif [ -f "/c/Program Files/k6/k6.exe" ]; then
    K6_CMD="/c/Program Files/k6/k6.exe"
elif [ -f "/mnt/c/Program Files/k6/k6.exe" ]; then
    K6_CMD="/mnt/c/Program Files/k6/k6.exe"
else
    echo "Error: k6 is not installed or not in PATH."
    echo "To install k6 on Debian/Ubuntu Linux:"
    echo "  sudo gpg -k"
    echo "  sudo gpg --no-default-keyring --keyring /usr/share/keyrings/k6-archive-keyring.gpg --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5DCC117B3C18D34"
    echo "  echo \"deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main\" | sudo tee /etc/apt/sources.list.d/k6.list"
    echo "  sudo apt-get update"
    echo "  sudo apt-get install k6"
    exit 1
fi

# 2. Locate the target test script
SCRIPT_FILE="load-tests/${SCENARIO}-test.js"
if [ ! -f "$SCRIPT_FILE" ]; then
    # Fallback if executing from inside load-tests directory
    SCRIPT_FILE="${SCENARIO}-test.js"
    if [ ! -f "$SCRIPT_FILE" ]; then
        echo "Error: Unable to locate '${SCENARIO}-test.js'. Please run from the project root."
        exit 1
    fi
fi

# 3. Handle configuration messages
export BASE_URL
if [ "$SHORT_RUN" = true ]; then
    export SHORT_RUN=true
    echo "=== SHORT RUN ENABLED ==="
    echo "Overriding test durations to 5s ramp, 10s hold for quick debugging..."
else
    export SHORT_RUN=false
    echo "=== FULL SCALE RUN ==="
    if [ "$SCENARIO" = "ramp" ]; then
        echo "Warning: The full ramping test takes approximately 20 minutes to complete."
    fi
fi

if [ -n "$MAX_VUS_OVERRIDE" ]; then
    export MAX_VUS_OVERRIDE
    echo "VU Override Target : $MAX_VUS_OVERRIDE VUs max"
fi

echo "Executing Scenario : $SCENARIO"
echo "Target BASE_URL    : $BASE_URL"
echo ""

# Pre-flight available memory check
MEM_PER_VU_MB=2
MAX_VUS=1 # Default for smoke

if [ "$SCENARIO" = "ramp" ]; then
    MAX_VUS=6000
elif [ "$SCENARIO" = "spike" ]; then
    if [ "$SHORT_RUN" = true ]; then
        MAX_VUS=300
    else
        MAX_VUS=15000
    fi
fi

if [ -n "$MAX_VUS_OVERRIDE" ]; then
    MAX_VUS=$MAX_VUS_OVERRIDE
fi

REQUIRED_MEM_MB=$(( MAX_VUS * MEM_PER_VU_MB ))

if command -v free &> /dev/null; then
    AVAILABLE_MEM_MB=$(free -m | awk '/^Mem:/{print $7}')
    if [ -n "$AVAILABLE_MEM_MB" ]; then
        echo "Pre-flight memory check: Available: ${AVAILABLE_MEM_MB}MB, Required: ${REQUIRED_MEM_MB}MB (for ${MAX_VUS} max VUs)"
        if [ "$AVAILABLE_MEM_MB" -lt "$REQUIRED_MEM_MB" ]; then
            echo "ERROR: Insufficient memory headroom on this host."
            echo "Required: ${REQUIRED_MEM_MB}MB, but only ${AVAILABLE_MEM_MB}MB is available."
            echo "To prevent k6 OOM crash, please set --max-vus-override to a lower value (e.g. --max-vus-override 1000)."
            exit 1
        fi
    fi
fi

# 4. Generate user pool for the test run
echo "Pre-registering 20,000 test users at $BASE_URL..."
USERS_FILE="load-tests/users_pool.json"
# Ensure directory exists
mkdir -p load-tests

curl_request() {
    local url="$1"
    local outfile="$2"
    local timeout="$3"
    if [[ "$url" =~ "localhost" || "$url" =~ "127.0.0.1" ]]; then
        if command -v curl.exe &> /dev/null; then
            curl.exe -s -X POST "$url" -o "$outfile" --max-time "$timeout"
            return $?
        fi
    fi
    curl -s -X POST "$url" -o "$outfile" --max-time "$timeout"
    return $?
}

curl_request "$BASE_URL/api/v1/auth/bulk-register?count=20000" "$USERS_FILE" 120
if [ $? -eq 0 ] && [ -s "$USERS_FILE" ]; then
    USER_COUNT=$(python3 -c "import json; print(len(json.load(open('$USERS_FILE'))))" 2>/dev/null || echo "unknown")
    echo "Successfully pre-registered users and generated $USERS_FILE. (Count: $USER_COUNT)"
else
    echo "Warning: Failed to pre-register users or empty response returned."
    echo "[]" > "$USERS_FILE"
fi

# 5. Purge Kafka topics if Kafka is running locally (i.e. if we are on the same machine)
if command -v docker &> /dev/null && docker ps | grep -q flashflow-kafka; then
    echo "Purging historical messages from Kafka topics..."
    docker exec flashflow-kafka kafka-configs --bootstrap-server localhost:9092 --entity-type topics --entity-name flashflow.orders --alter --add-config retention.ms=1 &> /dev/null
    docker exec flashflow-kafka kafka-configs --bootstrap-server localhost:9092 --entity-type topics --entity-name flashflow.payments --alter --add-config retention.ms=1 &> /dev/null
    sleep 2
    docker exec flashflow-kafka kafka-configs --bootstrap-server localhost:9092 --entity-type topics --entity-name flashflow.orders --alter --delete-config retention.ms &> /dev/null
    docker exec flashflow-kafka kafka-configs --bootstrap-server localhost:9092 --entity-type topics --entity-name flashflow.payments --alter --delete-config retention.ms &> /dev/null
    echo "Kafka topics successfully purged."
else
    echo "Skipping local Kafka topic purge (Kafka docker container not running on this host)."
    echo "If running remote tests, purge Kafka topics on the target server if you want clean database queue metrics."
fi

# 6. Launch background metrics collector
METRICS_FILE="load-tests/system_metrics.json"
rm -f "$METRICS_FILE"
rm -f "load-tests/stop_collector.tmp"

echo "Starting background performance metrics collection..."
python3 load-tests/metrics-collector.py "$METRICS_FILE" &
COLLECTOR_PID=$!

# Ensure cleanup if script is interrupted
cleanup() {
    echo "Stopping background metrics collector..."
    touch "load-tests/stop_collector.tmp"
    wait $COLLECTOR_PID 2>/dev/null
    exit
}
trap cleanup SIGINT SIGTERM

# 7. Run the k6 command
K6_ARGS=("run" "--env" "BASE_URL=$BASE_URL")
if [ "$SHORT_RUN" = true ]; then
    K6_ARGS+=("--env" "SHORT_RUN=true")
fi
if [ -n "$MAX_VUS_OVERRIDE" ]; then
    K6_ARGS+=("--env" "MAX_VUS_OVERRIDE=$MAX_VUS_OVERRIDE")
fi
K6_ARGS+=("$SCRIPT_FILE")

echo "Command: k6 ${K6_ARGS[*]}"
rm -f load-tests/k6_run.log
# Run k6 and pipe to tee to output to both console and log file
"$K6_CMD" "${K6_ARGS[@]}" 2>&1 | tee load-tests/k6_run.log
K6_EXIT_CODE=${PIPESTATUS[0]}
export K6_EXIT_CODE

# 8. Stop metrics collector and wait for file persistence
echo "Stopping background metrics collector..."
touch "load-tests/stop_collector.tmp"
wait $COLLECTOR_PID 2>/dev/null

# Wait for system_metrics.json to be written
for i in {1..10}; do
    if [ -f "$METRICS_FILE" ] && [ -s "$METRICS_FILE" ]; then
        sleep 0.5
        break
    fi
    sleep 1
done

# 9. Generate advanced performance reports
if command -v node &> /dev/null; then
    echo "Generating performance engineering dashboard and raw exports..."
    node load-tests/report-generator.js "$SCENARIO"
else
    echo "Warning: Node.js is not installed. Skipping HTML report generation."
    echo "To install Node.js, run: sudo apt install -y nodejs"
fi

echo "Done."
