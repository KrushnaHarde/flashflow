import os
import sys
import time
import json
import urllib.request
import subprocess

# Output path
output_path = "load-tests/system_metrics.json"
if len(sys.argv) > 1:
    output_path = sys.argv[1]

# Base URL of target API
base_url = os.environ.get("BASE_URL", "http://localhost:8080")

# Stop flag path
flag_path = "load-tests/stop_collector.tmp"
if os.path.exists(flag_path):
    try:
        os.remove(flag_path)
    except:
        pass

metrics_list = []

print(f"[Collector] Starting performance metrics collection from {base_url}...")

def scrape_metric(name):
    url = f"{base_url}/actuator/metrics/{name}"
    try:
        req = urllib.request.Request(url, headers={'Accept': 'application/json'})
        with urllib.request.urlopen(req, timeout=1.0) as response:
            data = json.loads(response.read().decode())
            if 'measurements' in data and len(data['measurements']) > 0:
                measurements = data['measurements']
                # Try to get MAX statistic first
                max_meas = next((m for m in measurements if m.get('statistic') == 'MAX'), None)
                if max_meas:
                    return max_meas['value']
                return measurements[0]['value']
    except Exception:
        pass
    return None

def get_kafka_lag():
    try:
        result = subprocess.run(
            ["docker", "exec", "flashflow-kafka", "kafka-consumer-groups", "--bootstrap-server", "localhost:9092", "--list"],
            capture_output=True, text=True, timeout=2.0
        )
        if result.returncode == 0:
            groups = result.stdout.strip().splitlines()
            group_name = "flashflow-group"
            for g in groups:
                if "flashflow-group" in g:
                    group_name = g.strip()
                    break
            
            lag_result = subprocess.run(
                ["docker", "exec", "flashflow-kafka", "kafka-consumer-groups", "--bootstrap-server", "localhost:9092", "--describe", "--group", group_name],
                capture_output=True, text=True, timeout=2.0
            )
            if lag_result.returncode == 0:
                max_lag = 0
                found_group = False
                for line in lag_result.stdout.strip().splitlines():
                    if group_name in line:
                        found_group = True
                        parts = line.split()
                        if len(parts) >= 6:
                            try:
                                lag_val = int(parts[5])
                                if lag_val > max_lag:
                                    max_lag = lag_val
                            except ValueError:
                                pass
                if found_group:
                    return max_lag
    except Exception:
        pass
    
    # Fallback to Actuator
    return scrape_metric("kafka.consumer.fetch.manager.records.lag.max")

try:
    while not os.path.exists(flag_path):
        timestamp = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        
        record = {
            "timestamp": timestamp,
            "system_cpu": scrape_metric("system.cpu.usage"),
            "process_cpu": scrape_metric("process.cpu.usage"),
            "jvm_memory_used": scrape_metric("jvm.memory.used"),
            "jvm_threads_live": scrape_metric("jvm.threads.live"),
            "hikari_active": scrape_metric("hikaricp.connections.active"),
            "hikari_max": scrape_metric("hikaricp.connections.max"),
            "hikari_pending": scrape_metric("hikaricp.connections.pending"),
            "kafka_lag_max": get_kafka_lag(),
            "reservations_expired": scrape_metric("reservations.expired.count") or 0,
            "orders_confirmed": scrape_metric("orders.confirmed.count") or 0,
            "redis_latency_max": scrape_metric("lettuce.command.completion"),
            "reservations_reconciled": scrape_metric("reservations.reconciled.count") or 0,
            "reservations_recon_failed": scrape_metric("reservations.reconciliation.failed.count") or 0,
            "idempotency_mismatch": scrape_metric("idempotency.mismatch.count") or 0,
            "optimistic_lock_retry": scrape_metric("optimistic.lock.retry.count") or 0
        }
        
        metrics_list.append(record)
        time.sleep(1.0)
except KeyboardInterrupt:
    print("[Collector] Interrupted by user.")

# Write to output file
with open(output_path, "w") as f:
    json.dump(metrics_list, f, indent=2)

print(f"[Collector] Stopped. Metrics saved to {output_path}")
if os.path.exists(flag_path):
    try:
        os.remove(flag_path)
    except:
        pass
