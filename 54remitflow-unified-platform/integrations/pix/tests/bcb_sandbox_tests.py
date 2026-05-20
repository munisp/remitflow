#!/usr/bin/env python3
"""
PIX BCB Sandbox Testing Suite
Comprehensive tests for BCB PIX integration
Version: 1.0.0
"""

import os
import sys
import json
import time
import uuid
import requests
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Tuple
import logging

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)


class BCBSandboxTester:
    """Comprehensive BCB Sandbox Testing Suite"""
    
    def __init__(self):
        # BCB Sandbox Endpoints
        self.bcb_endpoint = os.getenv("BCB_ENDPOINT", "https://api-sandbox.bcb.gov.br/pix/v2")
        self.dict_endpoint = os.getenv("BCB_DICT_ENDPOINT", "https://dict-sandbox.pi.rsfn.net.br/api/v1")
        self.spi_endpoint = os.getenv("BCB_SPI_ENDPOINT", "https://spi-sandbox.pi.rsfn.net.br/api/v1")
        
        # Credentials
        self.api_key = os.getenv("BCB_API_KEY", "test-api-key")
        self.client_id = os.getenv("BCB_CLIENT_ID", "12345678")
        self.client_secret = os.getenv("BCB_CLIENT_SECRET", "test-secret")
        
        # OAuth2 token
        self.access_token = None
        self.token_expiry = None
        
        # Test results
        self.test_results = []
        self.total_tests = 0
        self.passed_tests = 0
        self.failed_tests = 0
    
    def authenticate(self) -> bool:
        """Authenticate with BCB OAuth2"""
        logger.info("Authenticating with BCB OAuth2...")
        
        try:
            response = requests.post(
                "https://oauth-sandbox.bcb.gov.br/token",
                data={
                    "grant_type": "client_credentials",
                    "client_id": self.client_id,
                    "client_secret": self.client_secret,
                    "scope": "pix.read pix.write dict.read dict.write"
                },
                headers={"Content-Type": "application/x-www-form-urlencoded"},
                timeout=10
            )
            
            if response.status_code == 200:
                data = response.json()
                self.access_token = data["access_token"]
                self.token_expiry = datetime.now() + timedelta(seconds=data["expires_in"])
                logger.info("✅ Authentication successful")
                return True
            else:
                logger.error(f"❌ Authentication failed: {response.status_code} - {response.text}")
                return False
                
        except Exception as e:
            logger.error(f"❌ Authentication error: {str(e)}")
            return False
    
    def get_headers(self) -> Dict[str, str]:
        """Get request headers with authentication"""
        return {
            "Authorization": f"Bearer {self.access_token}",
            "Content-Type": "application/json",
            "X-API-Key": self.api_key
        }
    
    def record_test_result(self, test_name: str, passed: bool, details: str = ""):
        """Record test result"""
        self.total_tests += 1
        if passed:
            self.passed_tests += 1
            logger.info(f"✅ Test {self.total_tests}: {test_name} - PASSED")
        else:
            self.failed_tests += 1
            logger.error(f"❌ Test {self.total_tests}: {test_name} - FAILED: {details}")
        
        self.test_results.append({
            "test_number": self.total_tests,
            "test_name": test_name,
            "passed": passed,
            "details": details,
            "timestamp": datetime.now().isoformat()
        })
    
    # Test 1: BCB Connection Test
    def test_bcb_connection(self) -> bool:
        """Test 1: Verify BCB API connection"""
        logger.info("\n" + "="*60)
        logger.info("Test 1: BCB Connection Test")
        logger.info("="*60)
        
        try:
            response = requests.get(
                f"{self.bcb_endpoint}/health",
                headers=self.get_headers(),
                timeout=10
            )
            
            if response.status_code == 200:
                self.record_test_result("BCB Connection", True)
                return True
            else:
                self.record_test_result("BCB Connection", False, f"Status: {response.status_code}")
                return False
                
        except Exception as e:
            self.record_test_result("BCB Connection", False, str(e))
            return False
    
    # Test 2: PIX Key Registration (CPF)
    def test_pix_key_registration_cpf(self) -> Tuple[bool, Optional[str]]:
        """Test 2: Register PIX key (CPF type)"""
        logger.info("\n" + "="*60)
        logger.info("Test 2: PIX Key Registration (CPF)")
        logger.info("="*60)
        
        # Generate test CPF (11 digits)
        test_cpf = "12345678901"
        
        try:
            payload = {
                "keyType": "CPF",
                "key": test_cpf,
                "accountType": "CACC",  # Current account
                "branch": "0001",
                "accountNumber": "123456",
                "accountHolderName": "Test User",
                "accountHolderDocument": test_cpf
            }
            
            response = requests.post(
                f"{self.dict_endpoint}/keys",
                headers=self.get_headers(),
                json=payload,
                timeout=10
            )
            
            if response.status_code in [200, 201]:
                data = response.json()
                registration_id = data.get("registrationId")
                logger.info(f"PIX Key registered: {test_cpf}, Registration ID: {registration_id}")
                self.record_test_result("PIX Key Registration (CPF)", True)
                return True, test_cpf
            elif response.status_code == 409:
                # Key already registered - that's okay for testing
                logger.info(f"PIX Key already registered: {test_cpf}")
                self.record_test_result("PIX Key Registration (CPF)", True, "Key already exists")
                return True, test_cpf
            else:
                self.record_test_result("PIX Key Registration (CPF)", False, f"Status: {response.status_code}")
                return False, None
                
        except Exception as e:
            self.record_test_result("PIX Key Registration (CPF)", False, str(e))
            return False, None
    
    # Test 3: PIX Key Lookup
    def test_pix_key_lookup(self, pix_key: str) -> bool:
        """Test 3: Lookup PIX key in DICT"""
        logger.info("\n" + "="*60)
        logger.info("Test 3: PIX Key Lookup")
        logger.info("="*60)
        
        try:
            response = requests.get(
                f"{self.dict_endpoint}/keys/{pix_key}",
                headers=self.get_headers(),
                timeout=10
            )
            
            if response.status_code == 200:
                data = response.json()
                logger.info(f"PIX Key found: {json.dumps(data, indent=2)}")
                self.record_test_result("PIX Key Lookup", True)
                return True
            else:
                self.record_test_result("PIX Key Lookup", False, f"Status: {response.status_code}")
                return False
                
        except Exception as e:
            self.record_test_result("PIX Key Lookup", False, str(e))
            return False
    
    # Test 4: PIX Transfer (Payment)
    def test_pix_transfer(self, pix_key: str) -> Tuple[bool, Optional[str]]:
        """Test 4: Create PIX transfer"""
        logger.info("\n" + "="*60)
        logger.info("Test 4: PIX Transfer")
        logger.info("="*60)
        
        transfer_id = str(uuid.uuid4())
        
        try:
            payload = {
                "transferId": transfer_id,
                "pixKey": pix_key,
                "amount": 100.00,
                "currency": "BRL",
                "description": "Test payment",
                "senderName": "Test Sender",
                "senderDocument": "98765432109",
                "senderBank": "00000000"
            }
            
            response = requests.post(
                f"{self.spi_endpoint}/payments",
                headers=self.get_headers(),
                json=payload,
                timeout=10
            )
            
            if response.status_code in [200, 201, 202]:
                data = response.json()
                bcb_transaction_id = data.get("transactionId")
                end_to_end_id = data.get("endToEndId")
                logger.info(f"Transfer created: {transfer_id}")
                logger.info(f"BCB Transaction ID: {bcb_transaction_id}")
                logger.info(f"End-to-End ID: {end_to_end_id}")
                self.record_test_result("PIX Transfer", True)
                return True, bcb_transaction_id
            else:
                self.record_test_result("PIX Transfer", False, f"Status: {response.status_code}")
                return False, None
                
        except Exception as e:
            self.record_test_result("PIX Transfer", False, str(e))
            return False, None
    
    # Test 5: PIX Transfer Status Query
    def test_transfer_status_query(self, transaction_id: str) -> bool:
        """Test 5: Query PIX transfer status"""
        logger.info("\n" + "="*60)
        logger.info("Test 5: PIX Transfer Status Query")
        logger.info("="*60)
        
        try:
            response = requests.get(
                f"{self.spi_endpoint}/payments/{transaction_id}",
                headers=self.get_headers(),
                timeout=10
            )
            
            if response.status_code == 200:
                data = response.json()
                status = data.get("status")
                logger.info(f"Transfer status: {status}")
                logger.info(f"Transfer details: {json.dumps(data, indent=2)}")
                self.record_test_result("PIX Transfer Status Query", True)
                return True
            else:
                self.record_test_result("PIX Transfer Status Query", False, f"Status: {response.status_code}")
                return False
                
        except Exception as e:
            self.record_test_result("PIX Transfer Status Query", False, str(e))
            return False
    
    # Test 6: QR Code Generation (Static)
    def test_qr_code_generation_static(self, pix_key: str) -> bool:
        """Test 6: Generate static PIX QR code"""
        logger.info("\n" + "="*60)
        logger.info("Test 6: QR Code Generation (Static)")
        logger.info("="*60)
        
        try:
            payload = {
                "qrCodeType": "STATIC",
                "pixKey": pix_key,
                "amount": 50.00,
                "description": "Test QR code",
                "merchantName": "Test Merchant",
                "merchantCity": "Sao Paulo"
            }
            
            response = requests.post(
                f"{self.bcb_endpoint}/qrcodes",
                headers=self.get_headers(),
                json=payload,
                timeout=10
            )
            
            if response.status_code in [200, 201]:
                data = response.json()
                qr_code_data = data.get("qrCodeData")
                qr_code_id = data.get("qrCodeId")
                logger.info(f"QR Code generated: {qr_code_id}")
                logger.info(f"QR Code data length: {len(qr_code_data)} characters")
                self.record_test_result("QR Code Generation (Static)", True)
                return True
            else:
                self.record_test_result("QR Code Generation (Static)", False, f"Status: {response.status_code}")
                return False
                
        except Exception as e:
            self.record_test_result("QR Code Generation (Static)", False, str(e))
            return False
    
    # Test 7: QR Code Generation (Dynamic)
    def test_qr_code_generation_dynamic(self, pix_key: str) -> bool:
        """Test 7: Generate dynamic PIX QR code"""
        logger.info("\n" + "="*60)
        logger.info("Test 7: QR Code Generation (Dynamic)")
        logger.info("="*60)
        
        try:
            payload = {
                "qrCodeType": "DYNAMIC",
                "pixKey": pix_key,
                "description": "Test dynamic QR code",
                "merchantName": "Test Merchant",
                "merchantCity": "Sao Paulo",
                "expiresIn": 3600  # 1 hour
            }
            
            response = requests.post(
                f"{self.bcb_endpoint}/qrcodes",
                headers=self.get_headers(),
                json=payload,
                timeout=10
            )
            
            if response.status_code in [200, 201]:
                data = response.json()
                qr_code_data = data.get("qrCodeData")
                qr_code_id = data.get("qrCodeId")
                expires_at = data.get("expiresAt")
                logger.info(f"Dynamic QR Code generated: {qr_code_id}")
                logger.info(f"Expires at: {expires_at}")
                self.record_test_result("QR Code Generation (Dynamic)", True)
                return True
            else:
                self.record_test_result("QR Code Generation (Dynamic)", False, f"Status: {response.status_code}")
                return False
                
        except Exception as e:
            self.record_test_result("QR Code Generation (Dynamic)", False, str(e))
            return False
    
    # Test 8: PIX Refund
    def test_pix_refund(self, transaction_id: str) -> bool:
        """Test 8: Process PIX refund"""
        logger.info("\n" + "="*60)
        logger.info("Test 8: PIX Refund")
        logger.info("="*60)
        
        refund_id = str(uuid.uuid4())
        
        try:
            payload = {
                "refundId": refund_id,
                "originalTransactionId": transaction_id,
                "amount": 100.00,
                "reason": "Test refund"
            }
            
            response = requests.post(
                f"{self.spi_endpoint}/refunds",
                headers=self.get_headers(),
                json=payload,
                timeout=10
            )
            
            if response.status_code in [200, 201, 202]:
                data = response.json()
                refund_status = data.get("status")
                logger.info(f"Refund created: {refund_id}")
                logger.info(f"Refund status: {refund_status}")
                self.record_test_result("PIX Refund", True)
                return True
            else:
                self.record_test_result("PIX Refund", False, f"Status: {response.status_code}")
                return False
                
        except Exception as e:
            self.record_test_result("PIX Refund", False, str(e))
            return False
    
    # Test 9: PIX Key Registration (Email)
    def test_pix_key_registration_email(self) -> bool:
        """Test 9: Register PIX key (Email type)"""
        logger.info("\n" + "="*60)
        logger.info("Test 9: PIX Key Registration (Email)")
        logger.info("="*60)
        
        test_email = f"test{int(time.time())}@example.com"
        
        try:
            payload = {
                "keyType": "EMAIL",
                "key": test_email,
                "accountType": "CACC",
                "branch": "0001",
                "accountNumber": "654321",
                "accountHolderName": "Test User Email",
                "accountHolderDocument": "11122233344"
            }
            
            response = requests.post(
                f"{self.dict_endpoint}/keys",
                headers=self.get_headers(),
                json=payload,
                timeout=10
            )
            
            if response.status_code in [200, 201]:
                logger.info(f"PIX Key (Email) registered: {test_email}")
                self.record_test_result("PIX Key Registration (Email)", True)
                return True
            elif response.status_code == 409:
                logger.info(f"PIX Key (Email) already registered: {test_email}")
                self.record_test_result("PIX Key Registration (Email)", True, "Key already exists")
                return True
            else:
                self.record_test_result("PIX Key Registration (Email)", False, f"Status: {response.status_code}")
                return False
                
        except Exception as e:
            self.record_test_result("PIX Key Registration (Email)", False, str(e))
            return False
    
    # Test 10: PIX Key Registration (Phone)
    def test_pix_key_registration_phone(self) -> bool:
        """Test 10: Register PIX key (Phone type)"""
        logger.info("\n" + "="*60)
        logger.info("Test 10: PIX Key Registration (Phone)")
        logger.info("="*60)
        
        test_phone = "+5511987654321"
        
        try:
            payload = {
                "keyType": "PHONE",
                "key": test_phone,
                "accountType": "CACC",
                "branch": "0001",
                "accountNumber": "789012",
                "accountHolderName": "Test User Phone",
                "accountHolderDocument": "55566677788"
            }
            
            response = requests.post(
                f"{self.dict_endpoint}/keys",
                headers=self.get_headers(),
                json=payload,
                timeout=10
            )
            
            if response.status_code in [200, 201]:
                logger.info(f"PIX Key (Phone) registered: {test_phone}")
                self.record_test_result("PIX Key Registration (Phone)", True)
                return True
            elif response.status_code == 409:
                logger.info(f"PIX Key (Phone) already registered: {test_phone}")
                self.record_test_result("PIX Key Registration (Phone)", True, "Key already exists")
                return True
            else:
                self.record_test_result("PIX Key Registration (Phone)", False, f"Status: {response.status_code}")
                return False
                
        except Exception as e:
            self.record_test_result("PIX Key Registration (Phone)", False, str(e))
            return False
    
    # Test 11: PIX Key Registration (Random/EVP)
    def test_pix_key_registration_random(self) -> bool:
        """Test 11: Register PIX key (Random/EVP type)"""
        logger.info("\n" + "="*60)
        logger.info("Test 11: PIX Key Registration (Random/EVP)")
        logger.info("="*60)
        
        # Random key is generated by BCB
        try:
            payload = {
                "keyType": "EVP",
                "accountType": "CACC",
                "branch": "0001",
                "accountNumber": "345678",
                "accountHolderName": "Test User Random",
                "accountHolderDocument": "99988877766"
            }
            
            response = requests.post(
                f"{self.dict_endpoint}/keys",
                headers=self.get_headers(),
                json=payload,
                timeout=10
            )
            
            if response.status_code in [200, 201]:
                data = response.json()
                random_key = data.get("key")
                logger.info(f"PIX Key (Random) registered: {random_key}")
                self.record_test_result("PIX Key Registration (Random/EVP)", True)
                return True
            else:
                self.record_test_result("PIX Key Registration (Random/EVP)", False, f"Status: {response.status_code}")
                return False
                
        except Exception as e:
            self.record_test_result("PIX Key Registration (Random/EVP)", False, str(e))
            return False
    
    # Test 12: Performance Test (Multiple Transfers)
    def test_performance_multiple_transfers(self, pix_key: str, count: int = 10) -> bool:
        """Test 12: Performance test with multiple transfers"""
        logger.info("\n" + "="*60)
        logger.info(f"Test 12: Performance Test ({count} transfers)")
        logger.info("="*60)
        
        start_time = time.time()
        successful = 0
        failed = 0
        
        for i in range(count):
            transfer_id = str(uuid.uuid4())
            
            try:
                payload = {
                    "transferId": transfer_id,
                    "pixKey": pix_key,
                    "amount": 10.00,
                    "currency": "BRL",
                    "description": f"Performance test {i+1}",
                    "senderName": "Test Sender",
                    "senderDocument": "98765432109",
                    "senderBank": "00000000"
                }
                
                response = requests.post(
                    f"{self.spi_endpoint}/payments",
                    headers=self.get_headers(),
                    json=payload,
                    timeout=10
                )
                
                if response.status_code in [200, 201, 202]:
                    successful += 1
                else:
                    failed += 1
                    
            except Exception as e:
                failed += 1
                logger.error(f"Transfer {i+1} failed: {str(e)}")
        
        end_time = time.time()
        duration = end_time - start_time
        avg_time = duration / count
        
        logger.info(f"Performance test completed:")
        logger.info(f"  Total transfers: {count}")
        logger.info(f"  Successful: {successful}")
        logger.info(f"  Failed: {failed}")
        logger.info(f"  Total time: {duration:.2f}s")
        logger.info(f"  Average time per transfer: {avg_time:.3f}s")
        logger.info(f"  Throughput: {count/duration:.2f} transfers/second")
        
        success_rate = (successful / count) * 100
        passed = success_rate >= 90  # 90% success rate required
        
        self.record_test_result(
            "Performance Test (Multiple Transfers)",
            passed,
            f"Success rate: {success_rate:.1f}%"
        )
        
        return passed
    
    def print_summary(self):
        """Print test summary"""
        logger.info("\n" + "="*60)
        logger.info("TEST SUMMARY")
        logger.info("="*60)
        logger.info(f"Total tests: {self.total_tests}")
        logger.info(f"Passed: {self.passed_tests} ✅")
        logger.info(f"Failed: {self.failed_tests} ❌")
        logger.info(f"Success rate: {(self.passed_tests/self.total_tests*100):.1f}%")
        logger.info("="*60)
        
        if self.failed_tests > 0:
            logger.info("\nFailed tests:")
            for result in self.test_results:
                if not result["passed"]:
                    logger.info(f"  - Test {result['test_number']}: {result['test_name']}")
                    logger.info(f"    Details: {result['details']}")
        
        # Save results to file
        with open("bcb_sandbox_test_results.json", "w") as f:
            json.dump({
                "summary": {
                    "total_tests": self.total_tests,
                    "passed_tests": self.passed_tests,
                    "failed_tests": self.failed_tests,
                    "success_rate": (self.passed_tests/self.total_tests*100) if self.total_tests > 0 else 0
                },
                "tests": self.test_results
            }, f, indent=2)
        
        logger.info("\nTest results saved to: bcb_sandbox_test_results.json")
    
    def run_all_tests(self):
        """Run all BCB sandbox tests"""
        logger.info("\n" + "="*60)
        logger.info("BCB PIX SANDBOX TESTING SUITE")
        logger.info("Version: 1.0.0")
        logger.info("="*60)
        
        # Authenticate
        if not self.authenticate():
            logger.error("Authentication failed. Cannot proceed with tests.")
            return
        
        # Test 1: BCB Connection
        self.test_bcb_connection()
        
        # Test 2: PIX Key Registration (CPF)
        success, pix_key = self.test_pix_key_registration_cpf()
        
        if success and pix_key:
            # Test 3: PIX Key Lookup
            self.test_pix_key_lookup(pix_key)
            
            # Test 4: PIX Transfer
            success, transaction_id = self.test_pix_transfer(pix_key)
            
            if success and transaction_id:
                # Test 5: Transfer Status Query
                time.sleep(2)  # Wait for processing
                self.test_transfer_status_query(transaction_id)
                
                # Test 8: PIX Refund
                time.sleep(2)  # Wait for settlement
                self.test_pix_refund(transaction_id)
            
            # Test 6: QR Code Generation (Static)
            self.test_qr_code_generation_static(pix_key)
            
            # Test 7: QR Code Generation (Dynamic)
            self.test_qr_code_generation_dynamic(pix_key)
            
            # Test 12: Performance Test
            self.test_performance_multiple_transfers(pix_key, count=10)
        
        # Test 9: PIX Key Registration (Email)
        self.test_pix_key_registration_email()
        
        # Test 10: PIX Key Registration (Phone)
        self.test_pix_key_registration_phone()
        
        # Test 11: PIX Key Registration (Random/EVP)
        self.test_pix_key_registration_random()
        
        # Print summary
        self.print_summary()


def main():
    """Main function"""
    tester = BCBSandboxTester()
    tester.run_all_tests()
    
    # Exit with appropriate code
    sys.exit(0 if tester.failed_tests == 0 else 1)


if __name__ == "__main__":
    main()

