"""
Shared test fixtures and configuration.
"""
import pytest

@pytest.fixture(scope="session")
def base_urls():
    import os
    return {
        "compliance_ml": os.getenv("COMPLIANCE_ML_URL", "http://localhost:8097"),
        "kyc_liveness": os.getenv("KYC_LIVENESS_URL", "http://localhost:8095"),
        "aml_scorer": os.getenv("AML_SCORER_URL", "http://localhost:8096"),
        "fx_engine": os.getenv("FX_ENGINE_URL", "http://localhost:8093"),
        "core_banking": os.getenv("CORE_BANKING_URL", "http://localhost:8092"),
        "transaction_processor": os.getenv("TX_PROCESSOR_URL", "http://localhost:8081"),
    }
