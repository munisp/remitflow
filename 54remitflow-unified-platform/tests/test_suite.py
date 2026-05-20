#!/usr/bin/env python3
"""
UNIFIED MCMC FRAUD DETECTION SYSTEM - COMPREHENSIVE TEST SUITE

Regression, integration, referential integrity, and smoke tests.
"""

import unittest
import asyncio
import pandas as pd
import numpy as np
import requests
import time
import os
import sys
import tempfile
import shutil
from unittest.mock import patch, MagicMock
import logging

# Add src to path
sys.path.append(os.path.join(os.path.dirname(__file__), '..', 'src'))
sys.path.append(os.path.join(os.path.dirname(__file__), '..'))

from config.config import config
from src.data_pipeline import UnifiedDataPipeline
from src.mcmc_model import UnifiedMCMCModel

# Setup logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class TestDataPipeline(unittest.TestCase):
    """Test suite for data pipeline functionality."""
    
    def setUp(self):
        """Set up test environment."""
        self.pipeline = UnifiedDataPipeline()
        self.test_data = pd.DataFrame({
            'amount': [100, 200, 50, 1000, 25],
            'hour_of_day': [10, 14, 22, 2, 8],
            'fraud_label': [0, 0, 1, 1, 0],
            'avg_transaction_amount': [150, 150, 150, 150, 150],
            'median_transaction_amount': [100, 100, 100, 100, 100],
            'kyc_level': ['basic', 'enhanced', 'basic', 'premium', 'basic'],
            'registration_date': pd.to_datetime(['2023-01-01', '2023-02-01', '2023-03-01', '2023-04-01', '2023-05-01']),
            'timestamp': pd.to_datetime(['2024-01-01', '2024-01-02', '2024-01-03', '2024-01-04', '2024-01-05']),
            'exchange_rate': [450, 455, 460, 465, 470],
            'rate_trend': ['stable', 'rising', 'volatile', 'falling', 'stable']
        })
    
    def test_feature_engineering(self):
        """Test feature engineering functionality."""
        logger.info("Testing feature engineering...")
        
        # Test feature engineering
        engineered_data = self.pipeline._engineer_features(self.test_data.copy())
        
        # Check that new features are created
        expected_features = [
            'amount_to_avg_ratio', 'amount_to_median_ratio',
            'is_night_transaction', 'is_weekend',
            'days_since_registration', 'kyc_level_encoded',
            'is_volatile_market', 'rate_trend_encoded'
        ]
        
        for feature in expected_features:
            self.assertIn(feature, engineered_data.columns, f"Feature {feature} not created")
        
        # Check feature values
        self.assertEqual(engineered_data['is_night_transaction'].iloc[3], 1)  # 2 AM
        self.assertEqual(engineered_data['is_night_transaction'].iloc[0], 0)  # 10 AM
        self.assertEqual(engineered_data['is_volatile_market'].iloc[2], 1)   # volatile market
        
        logger.info("Feature engineering tests passed")
    
    def test_data_validation(self):
        """Test data validation functionality."""
        logger.info("Testing data validation...")
        
        # Test with valid data
        validation_results = asyncio.run(self.pipeline.validate_data_integrity(self.test_data))
        
        self.assertTrue(validation_results['has_required_columns'])
        self.assertTrue(validation_results['no_null_critical_fields'])
        self.assertTrue(validation_results['fraud_labels_valid'])
        self.assertTrue(validation_results['amounts_positive'])
        self.assertTrue(validation_results['hours_valid'])
        
        # Test with invalid data
        invalid_data = self.test_data.copy()
        invalid_data.loc[0, 'amount'] = -100  # Negative amount
        invalid_data.loc[1, 'hour_of_day'] = 25  # Invalid hour
        
        validation_results = asyncio.run(self.pipeline.validate_data_integrity(invalid_data))
        
        self.assertFalse(validation_results['amounts_positive'])
        self.assertFalse(validation_results['hours_valid'])
        
        logger.info("Data validation tests passed")

class TestMCMCModel(unittest.TestCase):
    """Test suite for MCMC model functionality."""
    
    def setUp(self):
        """Set up test environment."""
        self.model = UnifiedMCMCModel()
        
        # Create synthetic test data
        np.random.seed(42)
        n_samples = 1000
        
        self.test_data = pd.DataFrame({
            'amount': np.random.lognormal(4, 1, n_samples),
            'hour_of_day': np.random.randint(0, 24, n_samples),
            'amount_to_avg_ratio': np.random.normal(1, 0.3, n_samples),
            'amount_to_median_ratio': np.random.normal(1, 0.3, n_samples),
            'is_night_transaction': np.random.binomial(1, 0.2, n_samples),
            'is_weekend': np.random.binomial(1, 0.3, n_samples),
            'days_since_registration': np.random.randint(1, 1000, n_samples),
            'kyc_level_encoded': np.random.randint(0, 3, n_samples),
            'is_volatile_market': np.random.binomial(1, 0.1, n_samples),
            'rate_trend_encoded': np.random.randint(0, 4, n_samples)
        })
        
        # Create fraud labels with some correlation to features
        fraud_prob = (
            0.1 + 
            0.3 * (self.test_data['amount'] > self.test_data['amount'].quantile(0.9)) +
            0.2 * self.test_data['is_night_transaction'] +
            0.1 * self.test_data['is_volatile_market']
        )
        self.test_data['fraud_label'] = np.random.binomial(1, fraud_prob, n_samples)
    
    def test_data_preparation(self):
        """Test data preparation functionality."""
        logger.info("Testing data preparation...")
        
        train_data, test_data = self.model.prepare_data(self.test_data)
        
        # Check data splits
        self.assertGreater(len(train_data), 0)
        self.assertGreater(len(test_data), 0)
        self.assertEqual(len(train_data) + len(test_data), len(self.test_data))
        
        # Check fraud label distribution
        train_fraud_rate = train_data['fraud_label'].mean()
        test_fraud_rate = test_data['fraud_label'].mean()
        
        self.assertGreater(train_fraud_rate, 0)
        self.assertGreater(test_fraud_rate, 0)
        self.assertLess(abs(train_fraud_rate - test_fraud_rate), 0.1)  # Similar rates
        
        logger.info("Data preparation tests passed")
    
    def test_model_building(self):
        """Test model building functionality."""
        logger.info("Testing model building...")
        
        train_data, _ = self.model.prepare_data(self.test_data)
        model = self.model.build_model(train_data)
        
        self.assertIsNotNone(model)
        self.assertIsNotNone(self.model.model)
        
        logger.info("Model building tests passed")
    
    @patch('pymc.sample')
    def test_model_training(self, mock_sample):
        """Test model training functionality (mocked)."""
        logger.info("Testing model training (mocked)...")
        
        # Mock the sampling process
        mock_trace = MagicMock()
        mock_trace.posterior = {
            'intercept': MagicMock(),
            'amount_coeff': MagicMock(),
            'hour_of_day_coeff': MagicMock()
        }
        mock_sample.return_value = mock_trace
        
        train_data, _ = self.model.prepare_data(self.test_data)
        trace = self.model.train_model(train_data)
        
        self.assertIsNotNone(trace)
        mock_sample.assert_called_once()
        
        logger.info("Model training tests passed")

class TestAPIService(unittest.TestCase):
    """Test suite for API service functionality."""
    
    @classmethod
    def setUpClass(cls):
        """Set up API service for testing."""
        # This would typically start the API service in a separate process
        # For now, we'll test the validation functions directly
        pass
    
    def test_transaction_validation(self):
        """Test transaction data validation."""
        logger.info("Testing transaction validation...")
        
        # Import the validation function
        from api.fraud_detection_api import validate_transaction_data
        
        # Test valid transaction
        valid_transaction = {
            'amount': 100.0,
            'hour_of_day': 14
        }
        
        validation = validate_transaction_data(valid_transaction)
        self.assertTrue(validation['valid'])
        self.assertEqual(len(validation['errors']), 0)
        
        # Test invalid transaction
        invalid_transaction = {
            'amount': -100.0,  # Negative amount
            'hour_of_day': 25   # Invalid hour
        }
        
        validation = validate_transaction_data(invalid_transaction)
        self.assertFalse(validation['valid'])
        self.assertGreater(len(validation['errors']), 0)
        
        # Test missing fields
        incomplete_transaction = {
            'amount': 100.0
            # Missing hour_of_day
        }
        
        validation = validate_transaction_data(incomplete_transaction)
        self.assertFalse(validation['valid'])
        self.assertIn('Missing required field: hour_of_day', validation['errors'])
        
        logger.info("Transaction validation tests passed")
    
    def test_transaction_preprocessing(self):
        """Test transaction preprocessing."""
        logger.info("Testing transaction preprocessing...")
        
        from api.fraud_detection_api import preprocess_transaction
        
        transaction_data = {
            'amount': 100.0,
            'hour_of_day': 14,
            'is_weekend': 1
        }
        
        processed_df = preprocess_transaction(transaction_data)
        
        self.assertEqual(len(processed_df), 1)
        self.assertEqual(processed_df['amount'].iloc[0], 100.0)
        self.assertEqual(processed_df['hour_of_day'].iloc[0], 14)
        self.assertEqual(processed_df['is_weekend'].iloc[0], 1)
        self.assertEqual(processed_df['is_night_transaction'].iloc[0], 0)  # 14 is not night
        
        logger.info("Transaction preprocessing tests passed")

class TestSystemIntegration(unittest.TestCase):
    """Integration tests for the complete system."""
    
    def setUp(self):
        """Set up integration test environment."""
        self.temp_dir = tempfile.mkdtemp()
        
    def tearDown(self):
        """Clean up integration test environment."""
        if os.path.exists(self.temp_dir):
            shutil.rmtree(self.temp_dir)
    
    def test_end_to_end_pipeline(self):
        """Test complete end-to-end pipeline."""
        logger.info("Testing end-to-end pipeline...")
        
        # Create test data
        test_data = pd.DataFrame({
            'amount': np.random.lognormal(4, 1, 100),
            'hour_of_day': np.random.randint(0, 24, 100),
            'fraud_label': np.random.binomial(1, 0.1, 100),
            'avg_transaction_amount': [150] * 100,
            'median_transaction_amount': [100] * 100,
            'kyc_level': ['basic'] * 100,
            'registration_date': pd.to_datetime(['2023-01-01'] * 100),
            'timestamp': pd.to_datetime(['2024-01-01'] * 100),
            'exchange_rate': [450] * 100,
            'rate_trend': ['stable'] * 100
        })
        
        # Test data pipeline
        pipeline = UnifiedDataPipeline()
        processed_data = pipeline._engineer_features(test_data)
        
        # Test model preparation
        model = UnifiedMCMCModel()
        train_data, test_data = model.prepare_data(processed_data)
        
        self.assertGreater(len(train_data), 0)
        self.assertGreater(len(test_data), 0)
        
        logger.info("End-to-end pipeline tests passed")

class TestReferentialIntegrity(unittest.TestCase):
    """Test referential integrity and data consistency."""
    
    def test_config_consistency(self):
        """Test configuration consistency."""
        logger.info("Testing configuration consistency...")
        
        # Test that all required config sections exist
        self.assertIsNotNone(config.database)
        self.assertIsNotNone(config.model)
        self.assertIsNotNone(config.api)
        self.assertIsNotNone(config.data)
        
        # Test that config values are reasonable
        self.assertGreater(config.model.samples, 0)
        self.assertGreater(config.model.chains, 0)
        self.assertGreater(config.api.port, 0)
        self.assertLessEqual(config.api.port, 65535)
        
        logger.info("Configuration consistency tests passed")
    
    def test_data_type_consistency(self):
        """Test data type consistency across components."""
        logger.info("Testing data type consistency...")
        
        # Create test data with specific types
        test_data = pd.DataFrame({
            'amount': [100.0, 200.0, 50.0],
            'hour_of_day': [10, 14, 22],
            'fraud_label': [0, 1, 0],
            'avg_transaction_amount': [150.0, 150.0, 150.0],
            'median_transaction_amount': [100.0, 100.0, 100.0],
            'kyc_level': ['basic', 'enhanced', 'premium'],
            'registration_date': pd.to_datetime(['2023-01-01', '2023-01-01', '2023-01-01']),
            'timestamp': pd.to_datetime(['2024-01-01', '2024-01-01', '2024-01-01']),
            'exchange_rate': [450.0, 450.0, 450.0],
            'rate_trend': ['stable', 'volatile', 'rising']
        })
        
        # Test that data types are preserved through processing
        pipeline = UnifiedDataPipeline()
        processed_data = pipeline._engineer_features(test_data)
        
        # Check that critical columns maintain correct types
        self.assertTrue(pd.api.types.is_numeric_dtype(processed_data['amount']))
        self.assertTrue(pd.api.types.is_integer_dtype(processed_data['hour_of_day']))
        self.assertTrue(pd.api.types.is_bool_dtype(processed_data['fraud_label']) or 
                       pd.api.types.is_integer_dtype(processed_data['fraud_label']))
        
        logger.info("Data type consistency tests passed")

class TestSmokeTests(unittest.TestCase):
    """Smoke tests to verify basic system functionality."""
    
    def test_import_all_modules(self):
        """Test that all modules can be imported without errors."""
        logger.info("Testing module imports...")
        
        try:
            from config.config import config
            from src.data_pipeline import UnifiedDataPipeline
            from src.mcmc_model import UnifiedMCMCModel
            from api.fraud_detection_api import app
            
            self.assertTrue(True)  # If we get here, imports succeeded
            
        except ImportError as e:
            self.fail(f"Module import failed: {e}")
        
        logger.info("Module import tests passed")
    
    def test_basic_functionality(self):
        """Test basic functionality of core components."""
        logger.info("Testing basic functionality...")
        
        # Test data pipeline initialization
        pipeline = UnifiedDataPipeline()
        self.assertIsNotNone(pipeline)
        
        # Test model initialization
        model = UnifiedMCMCModel()
        self.assertIsNotNone(model)
        
        # Test configuration access
        self.assertIsNotNone(config.database.host)
        self.assertIsNotNone(config.api.port)
        
        logger.info("Basic functionality tests passed")

class TestRegressionTests(unittest.TestCase):
    """Regression tests to ensure no functionality breaks."""
    
    def test_feature_engineering_regression(self):
        """Test that feature engineering produces consistent results."""
        logger.info("Testing feature engineering regression...")
        
        # Create deterministic test data
        test_data = pd.DataFrame({
            'amount': [100, 200, 300],
            'hour_of_day': [10, 2, 14],
            'avg_transaction_amount': [150, 150, 150],
            'median_transaction_amount': [100, 100, 100],
            'kyc_level': ['basic', 'enhanced', 'premium'],
            'registration_date': pd.to_datetime(['2023-01-01', '2023-01-01', '2023-01-01']),
            'timestamp': pd.to_datetime(['2024-01-01', '2024-01-01', '2024-01-01']),
            'exchange_rate': [450, 450, 450],
            'rate_trend': ['stable', 'volatile', 'rising'],
            'fraud_label': [0, 1, 0]
        })
        
        pipeline = UnifiedDataPipeline()
        result1 = pipeline._engineer_features(test_data.copy())
        result2 = pipeline._engineer_features(test_data.copy())
        
        # Results should be identical for same input
        pd.testing.assert_frame_equal(result1.sort_index(axis=1), result2.sort_index(axis=1))
        
        logger.info("Feature engineering regression tests passed")

def run_all_tests():
    """Run all test suites."""
    logger.info("Starting comprehensive test suite...")
    
    # Create test suite
    test_suite = unittest.TestSuite()
    
    # Add all test classes
    test_classes = [
        TestDataPipeline,
        TestMCMCModel,
        TestAPIService,
        TestSystemIntegration,
        TestReferentialIntegrity,
        TestSmokeTests,
        TestRegressionTests
    ]
    
    for test_class in test_classes:
        tests = unittest.TestLoader().loadTestsFromTestCase(test_class)
        test_suite.addTests(tests)
    
    # Run tests
    runner = unittest.TextTestRunner(verbosity=2)
    result = runner.run(test_suite)
    
    # Report results
    total_tests = result.testsRun
    failures = len(result.failures)
    errors = len(result.errors)
    success_rate = ((total_tests - failures - errors) / total_tests) * 100 if total_tests > 0 else 0
    
    logger.info(f"Test Results:")
    logger.info(f"Total Tests: {total_tests}")
    logger.info(f"Passed: {total_tests - failures - errors}")
    logger.info(f"Failed: {failures}")
    logger.info(f"Errors: {errors}")
    logger.info(f"Success Rate: {success_rate:.1f}%")
    
    return result.wasSuccessful()

if __name__ == "__main__":
    success = run_all_tests()
    sys.exit(0 if success else 1)
