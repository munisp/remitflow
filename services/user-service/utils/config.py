import os

from dotenv import load_dotenv

load_dotenv()


class Config:
    """Base config"""

    AUDIT_SVC_URL = os.getenv("AUDIT_SVC_URL", "http://audit-service:8000")
    DATABASE_URI = os.getenv("DATABASE_URI", "")
    ROOT_PATH = os.getenv("ROOT_PATH", "/")
    DAPR_PUBSUB_NAME = os.getenv("DAPR_PUBSUB_NAME", "pubsub")
    KAFKA_BOOTSTRAP_SERVERS = os.getenv("KAFKA_BOOTSTRAP_SERVERS", "localhost:9092")
    KAFKA_SECURITY_PROTOCOL = os.getenv("KAFKA_SECURITY_PROTOCOL", "PLAINTEXT")
    KAFKA_SASL_MECHANISM = os.getenv("KAFKA_SASL_MECHANISM", "")
    KAFKA_SASL_USERNAME = os.getenv("KAFKA_SASL_USERNAME", "")
    KAFKA_SASL_PASSWORD = os.getenv("KAFKA_SASL_PASSWORD", "")
    # Base URL for calling out to admin-service/auth-service.
    INTERNAL_API_BASE_URL = os.getenv("INTERNAL_API_BASE_URL", "")
    # KYC liveness-check provider
    VERIFICATION_SERVICE_URL = os.getenv("VERIFICATION_SERVICE_URL", "")
    VERIFICATION_CLIENT_ID = os.getenv("VERIFICATION_CLIENT_ID", "")
    VERIFICATION_CLIENT_SECRET = os.getenv("VERIFICATION_CLIENT_SECRET", "")
    KYC_REDIRECT_URL = os.getenv("KYC_REDIRECT_URL", "")


class DevelopmentConfig(Config):
    DEBUG = True


class ProductionConfig(Config):
    DEBUG = False


config = {"development": DevelopmentConfig, "production": ProductionConfig}

config_name = os.getenv("APP_ENV", "development")


def get_config() -> Config:
    config_data = config.get(config_name)

    if config_data is None:
        raise Exception("Config {} not found".format(config_name))

    return config_data
