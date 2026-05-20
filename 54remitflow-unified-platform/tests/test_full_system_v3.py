import unittest
import requests

class TestFullSystemV3(unittest.TestCase):

    def test_ai_ml_platform(self):
        # This would be a more comprehensive test in a real scenario
        # For now, we just check if the services are running
        # In a real test, we would send data and check the output
        response = requests.get("http://localhost:5006/health") # Assuming a health endpoint
        self.assertEqual(response.status_code, 200)

    def test_defi_platform(self):
        response = requests.get("http://localhost:5004/health") # Assuming a health endpoint
        self.assertEqual(response.status_code, 200)

    def test_upi_connector(self):
        response = requests.get("http://localhost:5005/health")
        self.assertEqual(response.status_code, 200)

if __name__ == '__main__':
    unittest.main()

