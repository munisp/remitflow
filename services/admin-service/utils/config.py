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
    # Base URL for calling out to auth-service / user-service (e.g. account
    # suspension on repeated failed logins). Configure per environment —
    # never hardcode a real hostname here.
    INTERNAL_API_BASE_URL = os.getenv("INTERNAL_API_BASE_URL", "")


class DevelopmentConfig(Config):
    """Development specific config"""

    DEBUG = True


class ProductionConfig(Config):
    """Production specific config"""

    DEBUG = False


config = {"development": DevelopmentConfig, "production": ProductionConfig}

config_name = os.getenv("APP_ENV", "development")


def get_config() -> Config:
    config_data = config.get(config_name)

    if config_data is None:
        raise Exception("Config {} not found".format(config_name))

    return config_data
