#!/usr/bin/env python3
"""
PHASE 5: MCMC FRAUD DETECTION - INTEGRATION TESTING

This script performs an end-to-end integration test of the MCMC fraud detection system.
"""

import requests
import time

def main():
    """Main function to run the integration test."""
    print("Starting Phase 5: Integration Testing...")

    # Wait for the service to be available
    time.sleep(5)

    # Test the inference service
    try:
        response = requests.post(
            "http://127.0.0.1:5000/predict",
            json={"amount": 200, "hour_of_day": 15}
        )
        response.raise_for_status()  # Raise an exception for bad status codes
        prediction = response.json()
        print(f"Inference service returned: {prediction}")
        assert "fraud_probability" in prediction
    except requests.exceptions.RequestException as e:
        print(f"Error connecting to the inference service: {e}")
        exit(1)

    print("Phase 5 completed successfully. Integration test passed.")

if __name__ == "__main__":
    main()

