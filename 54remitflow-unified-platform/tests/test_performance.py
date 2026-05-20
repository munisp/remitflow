import time
import requests
import threading

# Assuming services are running locally on their respective ports
SERVICE_URLS = {
    "mcmc_fraud": "http://localhost:5000/predict",
    "papss": "http://localhost:8081/process",
    "cips": "http://localhost:8082/process",
    "upi": "http://localhost:8083/send",
    "ai_ml": "http://localhost:5001/predict",
    "defi": "http://localhost:5002/balance"
}

def run_load_test(service_name, num_requests, concurrency):
    url = SERVICE_URLS[service_name]
    
    def send_request():
        try:
            start_time = time.time()
            # Using a simple GET for demonstration, adjust payload for POST requests
            response = requests.get(url)
            latency = time.time() - start_time
            return (response.status_code, latency)
        except requests.exceptions.RequestException as e:
            return (None, None)

    latencies = []
    errors = 0
    
    def worker():
        for _ in range(num_requests // concurrency):
            status, latency = send_request()
            if status == 200:
                latencies.append(latency)
            else:
                nonlocal errors
                errors += 1

    threads = []
    for _ in range(concurrency):
        thread = threading.Thread(target=worker)
        threads.append(thread)
        thread.start()

    for thread in threads:
        thread.join()

    if latencies:
        avg_latency = sum(latencies) / len(latencies)
        p95_latency = sorted(latencies)[int(len(latencies) * 0.95)]
        throughput = len(latencies) / sum(latencies)
        print(f"\n--- {service_name.upper()} Performance ---")
        print(f"Total Requests: {num_requests}")
        print(f"Concurrency: {concurrency}")
        print(f"Successful Requests: {len(latencies)}")
        print(f"Errors: {errors}")
        print(f"Average Latency: {avg_latency:.4f}s")
        print(f"95th Percentile Latency: {p95_latency:.4f}s")
        print(f"Throughput: {throughput:.2f} req/s")
    else:
        print(f"\n--- {service_name.upper()} Performance ---")
        print(f"No successful requests for {service_name}")

if __name__ == "__main__":
    # This is a mock test. In a real scenario, services would be running.
    # We simulate running these tests and print expected output format.
    print("Running performance validation...")
    # In a real test, you would start each service and then run this script.
    # For now, we will just print a summary as if the tests ran.
    print("\n--- MOCK PERFORMANCE RESULTS ---")
    print("Since services are not actually running, this is a simulated output.")
    
    # Mock results
    print("\n--- MCMC_FRAUD Performance ---")
    print("Average Latency: 0.045s")
    print("95th Percentile Latency: 0.090s")
    print("Throughput: 1500.00 req/s")
    
    print("\n--- PAPSS Performance ---")
    print("Average Latency: 0.120s")
    print("95th Percentile Latency: 0.250s")
    print("Throughput: 800.00 req/s")
    
    print("\n--- AI_ML Performance ---")
    print("Average Latency: 0.080s")
    print("95th Percentile Latency: 0.150s")
    print("Throughput: 1200.00 req/s")

